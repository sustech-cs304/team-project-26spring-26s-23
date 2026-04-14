from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart
from pydantic_ai.models.test import TestModel

import app.blackboard.facade.tools as blackboard_facade_tools
import app.teaching_information_system.facade.tools as tis_facade_tools
from app.blackboard.api.dto import (
    AnnouncementDTO,
    AssignmentDTO,
    CourseDTO,
    GradeDTO,
    ResourceDTO,
)
from app.blackboard.provider.results import (
    BlackboardSnapshotFetchResult,
    BlackboardSnapshotSyncReport,
    BlackboardSyncPayloads,
)
from app.blackboard.shared import BlackboardLogEvent
from app.copilot_runtime.agent import RuntimeToolLifecycleEvent
from app.copilot_runtime.contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
)
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
)
from app.copilot_runtime.provider_adapter_registry import build_default_provider_adapter_registry
from app.copilot_runtime.session_store import (
    InMemorySessionStore,
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID
from app.desktop_runtime.capability_bridge_client import (
    HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME,
    DesktopCapabilityBridgeClient,
)
from app.desktop_runtime.server import create_app
from app.teaching_information_system.api.dto import (
    TISCreditGPAQueryResult,
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISHomepageProfile,
    TISProbeResult,
)
from app.teaching_information_system.shared import TISLogEvent


class _ImmediateEventStream:
    def __init__(
        self,
        *,
        output: str,
        resolved_model_id: str,
        events: list[RuntimeExecutionEvent],
    ) -> None:
        self.resolved_model_id = resolved_model_id
        self._output = output
        self._events = list(events)

    async def __aenter__(self) -> "_ImmediateEventStream":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_events(self):
        for event in self._events:
            yield event

    async def get_output(self) -> str:
        return self._output


class CapturingStreamingExecutor:
    def __init__(
        self,
        *,
        outputs: list[str],
        model_configured: bool = True,
        tool_events_by_call: list[list[RuntimeToolLifecycleEvent]] | None = None,
    ) -> None:
        self.model_configured = model_configured
        self.model_environment_keys: tuple[str, ...] = ()
        self.provider_adapter_registry = build_default_provider_adapter_registry()
        self._outputs = list(outputs)
        self._tool_events_by_call = [list(events) for events in (tool_events_by_call or [])]
        self.captured_calls: list[dict[str, object]] = []

    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateEventStream:
        self.captured_calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "resolved_model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "debug_enabled": debug_enabled,
                "request_options": dict(request_options or {}),
            }
        )
        tool_events = self._tool_events_by_call.pop(0) if self._tool_events_by_call else []
        output = self._outputs.pop(0)
        return _ImmediateEventStream(
            output=output,
            resolved_model_id=model_route.model_id,
            events=_build_execution_events(run_id=run_id, text=output, tool_events=tool_events),
        )


class _ContractToolCallingTestModel(TestModel):
    def __init__(
        self,
        *,
        tool_args_by_name: dict[str, dict[str, Any]],
        custom_output_text: str,
    ) -> None:
        super().__init__(
            call_tools=list(tool_args_by_name),
            custom_output_text=custom_output_text,
            seed=0,
        )
        self._tool_args_by_name = {
            name: dict(arguments)
            for name, arguments in tool_args_by_name.items()
        }

    def gen_tool_args(self, tool_def) -> Any:
        configured_arguments = self._tool_args_by_name.get(tool_def.name)
        if configured_arguments is not None:
            return dict(configured_arguments)
        return super().gen_tool_args(tool_def)


class _ResolvedRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://example.com/v1",
            model_id=model_route.route_ref.model_id,
            api_key="test-api-key",
            route_ref=model_route.route_ref,
        )


def _build_execution_events(
    *,
    run_id: str,
    text: str,
    tool_events: list[RuntimeToolLifecycleEvent],
) -> list[RuntimeExecutionEvent]:
    events = [
        RuntimeExecutionEvent(
            type={
                "started": "tool_started",
                "completed": "tool_completed",
                "failed": "tool_failed",
            }[tool_event.phase],
            payload=tool_event.to_payload(),
        )
        for tool_event in tool_events
    ]
    events.append(
        RuntimeExecutionEvent(
            type="assistant_segment_delta",
            payload={
                "segmentId": f"{run_id}:assistant-segment-1",
                "delta": text,
            },
        )
    )
    return events


SUPPORTED_METHODS = [
    AGENTS_LIST_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    RUN_CANCEL_METHOD,
    CAPABILITIES_GET_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
]


def test_post_root_legacy_methods_return_method_not_implemented() -> None:
    app = _create_app(CapturingStreamingExecutor(outputs=["unused reply"]))

    with TestClient(app) as client:
        for method_name in ("info", "agent/connect", "agent/run"):
            response = client.post("/", json={"method": method_name})
            payload = response.json()

            assert response.status_code == 501
            assert payload["ok"] is False
            assert payload["error"]["code"] == "method_not_implemented"
            assert payload["error"]["requestedMethod"] == method_name
            _assert_supported_methods(payload["error"]["supportedMethods"])


def test_post_root_thread_first_flow_reuses_history_across_same_thread() -> None:
    executor = CapturingStreamingExecutor(outputs=["First reply", "Second reply"])
    app = _create_app(executor)

    with TestClient(app) as client:
        agents_response = client.post("/", json={"method": "agents/list"})
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_payload = thread_response.json()
        capabilities_response = client.post(
            "/",
            json=_build_capabilities_get_request(thread_id=thread_payload["threadId"]),
        )
        first_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_payload["threadId"],
                model_id="gpt-4.1",
                user_text="Hello",
            ),
        )
        first_run_id = first_start_response.json()["run"]["runId"]
        first_stream_response = client.post(
            "/",
            json=_build_run_stream_request(run_id=first_run_id),
        )
        second_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_payload["threadId"],
                model_id="gpt-4.1",
                user_text="Follow up",
            ),
        )
        second_run_id = second_start_response.json()["run"]["runId"]
        second_stream_response = client.post(
            "/",
            json=_build_run_stream_request(run_id=second_run_id),
        )

    first_events = _parse_sse_events(first_stream_response.text)
    second_events = _parse_sse_events(second_stream_response.text)

    assert agents_response.status_code == 200
    assert thread_response.status_code == 200
    assert capabilities_response.status_code == 200
    assert first_start_response.status_code == 200
    assert first_stream_response.status_code == 200
    assert second_start_response.status_code == 200
    assert second_stream_response.status_code == 200
    assert agents_response.json()["defaultAgentId"] == "default"
    assert capabilities_response.json()["sessionId"] == thread_payload["threadId"]
    assert [event["type"] for event in first_events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]
    assert [event["type"] for event in second_events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]
    assert first_events[-1]["payload"]["assistantText"] == "First reply"
    assert second_events[-1]["payload"]["assistantText"] == "Second reply"

    assert len(executor.captured_calls) == 2
    assert executor.captured_calls[0]["user_prompt"] == "Hello"
    assert executor.captured_calls[0]["message_history"] == []
    assert executor.captured_calls[1]["user_prompt"] == "Follow up"

    reused_history = executor.captured_calls[1]["message_history"]
    assert isinstance(reused_history, list)
    assert len(reused_history) == 2
    assert isinstance(reused_history[0], ModelRequest)
    assert reused_history[0].parts[0].content == "Hello"
    assert isinstance(reused_history[1], ModelResponse)
    assert isinstance(reused_history[1].parts[0], TextPart)
    assert reused_history[1].parts[0].content == "First reply"


def test_post_root_run_stream_succeeds_without_startup_model_when_route_is_present() -> None:
    app = _create_app(CapturingStreamingExecutor(outputs=["Route scoped reply"], model_configured=False))

    with TestClient(app) as client:
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_id,
                model_id="gpt-4.1",
                user_text="Hello",
            ),
        )
        run_id = run_start_response.json()["run"]["runId"]
        response = client.post(
            "/",
            json=_build_run_stream_request(run_id=run_id),
        )

    events = _parse_sse_events(response.text)

    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]
    assert events[-1]["payload"]["assistantText"] == "Route scoped reply"


def test_post_root_run_start_unexpected_failure_with_origin_returns_json_and_cors_headers(caplog) -> None:
    class _FailingRunStartSessionStore(InMemorySessionStore):
        def create_run(self, *args: Any, **kwargs: Any):
            raise RuntimeError("forced run/start failure")

    app = create_app(
        session_store=_FailingRunStartSessionStore(),
        agent_executor=CapturingStreamingExecutor(outputs=["unused reply"]),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    with caplog.at_level("ERROR", logger="uvicorn.error"):
        with TestClient(app, raise_server_exceptions=False) as client:
            thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
            thread_id = thread_response.json()["threadId"]
            response = client.post(
                "/",
                json=_build_run_start_request(
                    thread_id=thread_id,
                    model_id="gpt-4.1",
                    user_text="Hello",
                ),
                headers={"Origin": "http://localhost:5173"},
            )

    payload = response.json()
    request_id = payload["error"]["details"]["requestId"]
    run_start_logs = [
        record.getMessage()
        for record in caplog.records
        if "run/start unexpected exception" in record.getMessage()
    ]

    assert thread_response.status_code == 200
    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert payload["ok"] is False
    assert payload["error"]["code"] == "internal_server_error"
    assert payload["error"]["requestedMethod"] == "run/start"
    assert request_id
    assert len(run_start_logs) == 1
    assert f"request_id={request_id}" in run_start_logs[0]
    assert "runtime_method=run/start" in run_start_logs[0]
    assert f"thread_id={thread_id}" in run_start_logs[0]
    assert "agent_id=default" in run_start_logs[0]
    assert "phase=create_run_record" in run_start_logs[0]
    assert all(
        "desktop-runtime unexpected exception" not in record.getMessage()
        for record in caplog.records
    )


def test_post_root_run_stream_emits_real_tool_lifecycle_events() -> None:
    tool_events = [
        RuntimeToolLifecycleEvent(
            tool_call_id="tool.weather-current:call-1",
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="started",
            title="调用天气工具",
            summary="正在获取 Shenzhen 的天气。",
            input_summary='{"location": "Shenzhen"}',
        ),
        RuntimeToolLifecycleEvent(
            tool_call_id="tool.weather-current:call-1",
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="completed",
            title="天气工具已返回结果",
            summary="Shenzhen：晴 / 24°C / 湿度 60%",
            input_summary='{"location": "Shenzhen"}',
            result_summary="Shenzhen：晴 / 24°C / 湿度 60%",
        ),
    ]
    executor = CapturingStreamingExecutor(
        outputs=["Weather answer"],
        tool_events_by_call=[tool_events],
    )
    app = _create_app(executor)

    with TestClient(app) as client:
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_id,
                model_id="gpt-4.1",
                user_text="Tell me the weather",
                enabled_tools=[WEATHER_CURRENT_TOOL_ID],
            ),
        )
        run_id = run_start_response.json()["run"]["runId"]
        response = client.post(
            "/",
            json=_build_run_stream_request(run_id=run_id),
        )

    events = _parse_sse_events(response.text)

    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == [
        "run_started",
        "run_metadata",
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    assert [event["payload"]["phase"] for event in events[2:4]] == ["started", "completed"]
    assert events[2]["payload"]["toolId"] == WEATHER_CURRENT_TOOL_ID
    assert events[3]["payload"]["resultSummary"] == "Shenzhen：晴 / 24°C / 湿度 60%"
    assert events[4]["payload"]["delta"] == "Weather answer"
    assert events[-1]["payload"]["assistantText"] == "Weather answer"
    assert events[-1]["payload"]["resolvedToolIds"] == [WEATHER_CURRENT_TOOL_ID]
    assert executor.captured_calls[0]["enabled_tools"] == [WEATHER_CURRENT_TOOL_ID]


def test_post_root_run_stream_executes_blackboard_snapshot_sync_with_bridge_backed_host_capabilities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_sync: dict[str, Any] = {}
    captured_bridge_payloads: list[dict[str, Any]] = []
    captured_headers: list[str | None] = []

    def _fake_sync(
        username: str,
        password: str,
        *,
        db_path: Path | None = None,
        reset_schema: bool = False,
        resource_course_limit: int = 3,
        verify_second_sync: bool = True,
        progress: Any = None,
        enable_console_logging: bool = False,
    ) -> BlackboardSnapshotSyncReport:
        _ = enable_console_logging
        captured_sync.update(
            {
                "username": username,
                "password": password,
                "db_path": db_path,
                "reset_schema": reset_schema,
                "resource_course_limit": resource_course_limit,
                "verify_second_sync": verify_second_sync,
            }
        )
        if progress is not None:
            progress("fetching courses")
            progress("syncing sqlite")
        return _build_blackboard_snapshot_report(
            db_path=Path("workspace-root/backend/data/default.db") if db_path is None else db_path,
            resource_course_limit=resource_course_limit,
        )

    monkeypatch.setattr(blackboard_facade_tools, "run_blackboard_snapshot_sync", _fake_sync)

    app = _create_app(
        host_capability_bridge_client=_create_recording_bridge_client(
            captured_payloads=captured_bridge_payloads,
            captured_headers=captured_headers,
            secret_values={"bb.username": "alice", "bb.password": "secret"},
        )
    )

    with TestClient(app) as client:
        assert app.state.copilot_runtime_agent_executor._tool_registry is app.state.copilot_runtime_tool_registry
        _configure_contract_tool_test_model(
            app,
            tool_id="blackboard.snapshot.sync",
            tool_arguments={
                "usernameSecretName": "bb.username",
                "passwordSecretName": "bb.password",
                "dbRelativePath": "backend/data/snapshot.db",
                "resourceCourseLimit": 2,
                "verifySecondSync": False,
                "stateKey": "snapshot-latest",
                "artifactName": "snapshot.json",
            },
            output_text="Blackboard bridge answer",
        )
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_id,
                model_id="gpt-4.1",
                user_text="Sync Blackboard snapshot through the desktop bridge.",
                enabled_tools=["blackboard.snapshot.sync"],
            ),
        )
        run_id = run_start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    events = _parse_sse_events(response.text)
    tool_call_id = _assert_contract_tool_run_events(
        events,
        tool_id="blackboard.snapshot.sync",
        assistant_text="Blackboard bridge answer",
    )

    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert response.status_code == 200
    assert captured_sync == {
        "username": "alice",
        "password": "secret",
        "db_path": Path("workspace-root/backend/data/snapshot.db"),
        "reset_schema": False,
        "resource_course_limit": 2,
        "verify_second_sync": False,
    }
    assert captured_headers == ["bridge-token-123"] * len(captured_headers)
    assert [(item["capability"], item["operation"]) for item in captured_bridge_payloads] == [
        ("event", "emit_event"),
        ("secret", "get_secret"),
        ("secret", "get_secret"),
        ("workspace", "resolve_path"),
        ("state", "put_value"),
        ("artifact", "save_text"),
        ("event", "emit_event"),
    ]
    assert all(item["toolId"] == "blackboard.snapshot.sync" for item in captured_bridge_payloads)
    assert all(item["runId"] == run_id for item in captured_bridge_payloads)
    assert all(item["toolCallId"] == tool_call_id for item in captured_bridge_payloads)

    started_event_request = captured_bridge_payloads[0]
    completed_event_request = captured_bridge_payloads[-1]
    state_request = next(
        item
        for item in captured_bridge_payloads
        if (item["capability"], item["operation"]) == ("state", "put_value")
    )
    artifact_request = next(
        item
        for item in captured_bridge_payloads
        if (item["capability"], item["operation"]) == ("artifact", "save_text")
    )

    assert started_event_request["payload"]["eventType"] == "blackboard.snapshot.sync.started"
    assert completed_event_request["payload"]["eventType"] == "blackboard.snapshot.sync.completed"
    assert state_request["payload"]["scope"] == "tool"
    assert str(state_request["payload"]["key"]).endswith(":snapshot-latest")
    assert state_request["payload"]["value"]["output"]["dbPath"] == "workspace-root/backend/data/snapshot.db"
    assert json.loads(artifact_request["payload"]["text"])["progressMessages"] == [
        "fetching courses",
        "syncing sqlite",
    ]
    assert artifact_request["payload"]["metadata"] == {
        "toolId": "blackboard.snapshot.sync",
        "invocationId": tool_call_id,
    }



def test_post_root_run_stream_executes_tis_credit_gpa_with_bridge_backed_host_capabilities(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured_fetch: dict[str, Any] = {}
    captured_bridge_payloads: list[dict[str, Any]] = []
    captured_headers: list[str | None] = []

    def _fake_fetch(
        username: str,
        password: str,
        *,
        role_code: str | None = None,
        homepage_html: str | None = None,
        config: Any = None,
        enable_console_logging: bool = False,
        persist: bool = False,
        db_manager: Any = None,
        owner_key: str | None = None,
    ) -> TISCreditGPAQueryResult:
        _ = (homepage_html, config, enable_console_logging)
        captured_fetch.update(
            {
                "username": username,
                "password": password,
                "role_code": role_code,
                "persist": persist,
                "db_manager": db_manager,
                "owner_key": owner_key,
            }
        )
        return _build_tis_credit_gpa_result()

    monkeypatch.setattr(tis_facade_tools, "fetch_credit_gpa_with_credentials", _fake_fetch)

    app = _create_app(
        host_capability_bridge_client=_create_recording_bridge_client(
            captured_payloads=captured_bridge_payloads,
            captured_headers=captured_headers,
            secret_values={"tis.username": "20251234", "tis.password": "cas-secret"},
        )
    )

    with TestClient(app) as client:
        assert app.state.copilot_runtime_agent_executor._tool_registry is app.state.copilot_runtime_tool_registry
        _configure_contract_tool_test_model(
            app,
            tool_id="tis.credit_gpa.fetch",
            tool_arguments={
                "usernameSecretName": "tis.username",
                "passwordSecretName": "tis.password",
                "stateKey": "credit-gpa-latest",
                "artifactName": "credit-gpa.json",
            },
            output_text="TIS bridge answer",
        )
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_id,
                model_id="gpt-4.1",
                user_text="Fetch TIS credit GPA through the desktop bridge.",
                enabled_tools=["tis.credit_gpa.fetch"],
            ),
        )
        run_id = run_start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    events = _parse_sse_events(response.text)
    tool_call_id = _assert_contract_tool_run_events(
        events,
        tool_id="tis.credit_gpa.fetch",
        assistant_text="TIS bridge answer",
    )

    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert response.status_code == 200
    assert captured_fetch == {
        "username": "20251234",
        "password": "cas-secret",
        "role_code": None,
        "persist": False,
        "db_manager": None,
        "owner_key": None,
    }
    assert captured_headers == ["bridge-token-123"] * len(captured_headers)
    assert [(item["capability"], item["operation"]) for item in captured_bridge_payloads] == [
        ("event", "emit_event"),
        ("secret", "get_secret"),
        ("secret", "get_secret"),
        ("state", "put_value"),
        ("artifact", "save_text"),
        ("event", "emit_event"),
    ]
    assert all(item["toolId"] == "tis.credit_gpa.fetch" for item in captured_bridge_payloads)
    assert all(item["runId"] == run_id for item in captured_bridge_payloads)
    assert all(item["toolCallId"] == tool_call_id for item in captured_bridge_payloads)

    state_request = next(
        item
        for item in captured_bridge_payloads
        if (item["capability"], item["operation"]) == ("state", "put_value")
    )
    artifact_request = next(
        item
        for item in captured_bridge_payloads
        if (item["capability"], item["operation"]) == ("artifact", "save_text")
    )

    assert state_request["payload"]["scope"] == "tool"
    assert str(state_request["payload"]["key"]).endswith(":credit-gpa-latest")
    assert state_request["payload"]["value"]["output"]["summary"]["average_credit_gpa"] == 3.82
    assert json.loads(artifact_request["payload"]["text"])["summary"]["average_credit_gpa"] == 3.82
    assert artifact_request["payload"]["metadata"] == {
        "toolId": "tis.credit_gpa.fetch",
        "invocationId": tool_call_id,
    }



def test_post_root_run_stream_corrupted_thread_history_returns_failed_event() -> None:
    app = _create_app(CapturingStreamingExecutor(outputs=["unused reply"]))

    with TestClient(app) as client:
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        store = app.state.copilot_runtime_session_store
        store.create_run(
            thread_id=thread_id,
            run_id="run-corrupted",
            request=RuntimeStoredRunInput(
                message_role="assistant",
                message_content="orphan assistant",
                policy=RuntimeStoredRunPolicy(
                    model_route=RuntimeStoredModelRoute(
                        provider_profile_id="provider-1",
                        route_ref=RuntimeModelRouteRef(
                            route_kind="provider-model",
                            profile_id="provider-1",
                            model_id="gpt-4.1",
                        ),
                    )
                ),
                agent_id="default",
            ),
        )
        store.mark_run_completed("run-corrupted", assistant_text="projected assistant reply")
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_id,
                model_id="gpt-4.1",
                user_text="Hello again",
            ),
        )
        run_id = run_start_response.json()["run"]["runId"]
        response = client.post(
            "/",
            json=_build_run_stream_request(run_id=run_id),
        )

    events = _parse_sse_events(response.text)

    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == ["run_started", "run_failed"]
    assert events[-1]["payload"]["code"] == "invalid_message_history"
    assert "expected role 'user'" in events[-1]["payload"]["message"]
    assert events[-1]["payload"]["details"] == {}


def _build_blackboard_log_event(source: str) -> BlackboardLogEvent:
    return BlackboardLogEvent(
        timestamp="2026-04-14T08:00:00Z",
        level="info",
        layer="provider",
        source=source,
        message="ok",
    )



def _build_blackboard_snapshot_report(
    *,
    db_path: Path,
    resource_course_limit: int,
) -> BlackboardSnapshotSyncReport:
    snapshot = BlackboardSnapshotFetchResult(
        courses=[CourseDTO(course_id="_course_1", name="CS305 Database Systems")],
        assignments_by_course={
            "_course_1": [
                AssignmentDTO(
                    assignment_id="asg_1",
                    course_id="_course_1",
                    title="Homework 1",
                )
            ]
        },
        resources_by_course={
            "_course_1": [
                ResourceDTO(
                    resource_id="res_1",
                    course_id="_course_1",
                    title="Lecture 1",
                )
            ]
        },
        grades_by_course={
            "_course_1": [
                GradeDTO(
                    grade_id="grd_1",
                    course_id="_course_1",
                    assignment_id=None,
                    item_name="Homework 1",
                )
            ]
        },
        announcements=[
            AnnouncementDTO(
                announcement_id="ann_1",
                course_id="_course_1",
                course_name="CS305 Database Systems",
                title="Welcome",
            )
        ],
        resource_course_limit=resource_course_limit,
        logs=[_build_blackboard_log_event("integration.blackboard.fetch")],
    )
    payloads = BlackboardSyncPayloads(
        course_payload=[{"course_id": "_course_1"}],
        assignment_payloads={"_course_1": [{"assignment_id": "asg_1"}]},
        resource_payloads={"_course_1": [{"resource_id": "res_1"}]},
        grade_payloads={"_course_1": [{"grade_id": "grd_1"}]},
        announcements_payload=[{"announcement_id": "ann_1"}],
    )
    return BlackboardSnapshotSyncReport(
        db_path=db_path,
        snapshot=snapshot,
        payloads=payloads,
        first_sync_stats={
            "courses": {"inserted": 1, "updated": 0, "deleted": 0},
            "assignments": {"inserted": 1, "updated": 0, "deleted": 0},
            "resources": {"inserted": 1, "updated": 0, "deleted": 0},
            "grades": {"inserted": 1, "updated": 0, "deleted": 0},
            "announcements": {"inserted": 1, "updated": 0, "deleted": 0},
        },
        second_sync_stats={
            "courses": {"inserted": 0, "updated": 1, "deleted": 0},
            "assignments": {"inserted": 0, "updated": 1, "deleted": 0},
            "resources": {"inserted": 0, "updated": 1, "deleted": 0},
            "grades": {"inserted": 0, "updated": 1, "deleted": 0},
            "announcements": {"inserted": 0, "updated": 1, "deleted": 0},
        },
        table_counts={
            "courses": {"total": 1, "active": 1},
            "assignments": {"total": 1, "active": 1},
            "resources": {"total": 1, "active": 1},
            "grades": {"total": 1, "active": 1},
            "announcements": {"total": 1, "active": 1},
        },
        expected_active_counts={
            "courses": 1,
            "assignments": 1,
            "resources": 1,
            "grades": 1,
            "announcements": 1,
        },
        integrity_ok=True,
        logs=[_build_blackboard_log_event("integration.blackboard.sync")],
    )



def _build_tis_log_event(source: str) -> TISLogEvent:
    return TISLogEvent(
        timestamp="2026-04-14T08:05:00Z",
        level="info",
        layer="provider",
        source=source,
        message="ok",
    )



def _build_tis_homepage() -> TISHomepageProfile:
    return TISHomepageProfile(
        page_url="https://tis.sustech.edu.cn/student_index",
        title="TIS",
        role_codes=["01"],
    )



def _build_tis_credit_gpa_result() -> TISCreditGPAQueryResult:
    return TISCreditGPAQueryResult(
        success=True,
        source_url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj",
        page_url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/xspjxfjcx",
        api_url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj",
        homepage=_build_tis_homepage(),
        summary=TISCreditGPASummary(
            average_credit_gpa=3.82,
            rank="5/100",
            raw={"PJXFJ": 3.82},
        ),
        term_records=[
            TISCreditGPATermRecord(
                academic_year_term="2025秋季",
                academic_year="2025-2026",
                term_code="1",
                term_credit_gpa=3.82,
                year_credit_gpa=3.82,
            )
        ],
        year_records=[
            TISCreditGPAYearRecord(
                academic_year="2025-2026",
                year_credit_gpa=3.82,
            )
        ],
        probes=[
            TISProbeResult(
                url="https://tis.sustech.edu.cn/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj",
                method="POST",
                status_code=200,
                is_json=True,
                probe_label="credit-gpa-api",
            )
        ],
        logs=[_build_tis_log_event("integration.tis.credit_gpa")],
        resolved_role_code="01",
    )



def _configure_contract_tool_test_model(
    app,
    *,
    tool_id: str,
    tool_arguments: dict[str, Any],
    output_text: str,
) -> None:
    executable_tool = app.state.copilot_runtime_tool_registry.resolve_tool(tool_id)
    function_name = executable_tool.function_name
    assert function_name is not None
    app.state.copilot_runtime_agent_executor._model_override = _ContractToolCallingTestModel(
        tool_args_by_name={function_name: tool_arguments},
        custom_output_text=output_text,
    )



def _assert_contract_tool_run_events(
    events: list[dict[str, Any]],
    *,
    tool_id: str,
    assistant_text: str,
) -> str:
    event_types = [event["type"] for event in events]
    tool_events = [event for event in events if event["type"] == "tool_event"]

    assert event_types[0] == "run_started"
    assert event_types[-1] == "run_completed"
    assert event_types.count("tool_event") == 2
    assert "run_failed" not in event_types
    assert event_types.index("tool_event") < event_types.index("run_completed")
    assert any(event_type == "text_delta" for event_type in event_types)
    assert [event["payload"]["phase"] for event in tool_events] == ["started", "completed"]
    assert all(event["payload"]["toolId"] == tool_id for event in tool_events)
    assert events[-1]["payload"]["assistantText"] == assistant_text
    assert events[-1]["payload"]["resolvedToolIds"] == [tool_id]
    return tool_events[0]["payload"]["toolCallId"]



def _create_recording_bridge_client(
    *,
    captured_payloads: list[dict[str, Any]],
    captured_headers: list[str | None],
    secret_values: dict[str, str],
) -> DesktopCapabilityBridgeClient:
    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(request.headers.get(HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME))
        payload = json.loads(request.content.decode("utf-8"))
        captured_payloads.append(payload)
        request_id = payload["requestId"]
        capability = payload["capability"]
        operation = payload["operation"]

        def success(result: dict[str, Any]) -> httpx.Response:
            return httpx.Response(
                200,
                json={"requestId": request_id, "ok": True, "result": result},
                request=request,
            )

        if (capability, operation) == ("secret", "get_secret"):
            return success({"value": secret_values.get(str(payload["payload"]["secretName"]))})
        if (capability, operation) == ("workspace", "resolve_path"):
            relative_path = payload["payload"].get("relativePath")
            resolved_path = "workspace-root" if relative_path is None else f"workspace-root/{relative_path}"
            return success({"path": resolved_path})
        if (capability, operation) == ("state", "put_value"):
            return success({})
        if (capability, operation) == ("artifact", "save_text"):
            return success(
                {
                    "artifactId": f"artifact-{len(captured_payloads)}",
                    "uri": f"artifact://desktop/artifact-{len(captured_payloads)}",
                    "name": payload["payload"]["name"],
                    "contentType": payload["payload"].get("contentType", "application/json"),
                    "metadata": payload["payload"].get("metadata", {}),
                }
            )
        if (capability, operation) == ("event", "emit_event"):
            return success({})

        raise AssertionError(f"Unhandled bridge request {(capability, operation)!r}")

    return DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )



def _create_app(
    executor: CapturingStreamingExecutor | None = None,
    *,
    host_capability_bridge_client: DesktopCapabilityBridgeClient | None = None,
):
    return create_app(
        agent_executor=executor,
        model_route_resolver=_ResolvedRouteResolver(),
        host_capability_bridge_client=host_capability_bridge_client,
    )


def _build_thread_create_request(*, agent_id: str) -> dict[str, Any]:
    return {
        "method": "thread/create",
        "body": {
            "agentId": agent_id,
        },
    }


def _build_capabilities_get_request(*, thread_id: str) -> dict[str, Any]:
    return {
        "method": "capabilities/get",
        "body": {
            "sessionId": thread_id,
        },
    }


def _build_run_start_request(
    *,
    thread_id: str,
    model_id: str,
    user_text: str,
    enabled_tools: list[str] | None = None,
    debug_mode_enabled: bool = False,
) -> dict[str, Any]:
    return {
        "method": "run/start",
        "body": {
            "threadId": thread_id,
            "agent": "default",
            "message": {
                "role": "user",
                "content": user_text,
            },
            "policy": {
                "modelRoute": {
                    "routeRef": {
                        "routeKind": "provider-model",
                        "profileId": "provider-1",
                        "modelId": model_id,
                    },
                },
                "enabledTools": list(enabled_tools or []),
                "debugModeEnabled": debug_mode_enabled,
                "requestOptions": {},
            },
        },
    }


def _build_run_stream_request(*, run_id: str) -> dict[str, Any]:
    return {
        "method": "run/stream",
        "body": {
            "runId": run_id,
        },
    }


def _parse_sse_events(raw_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for chunk in raw_text.strip().split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
        if not lines:
            continue
        payload = "\n".join(line[6:] for line in lines)
        events.append(json.loads(payload))
    return events


def _assert_supported_methods(supported_methods: list[str]) -> None:
    assert set(supported_methods) == set(SUPPORTED_METHODS)
