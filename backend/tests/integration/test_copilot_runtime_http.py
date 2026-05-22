from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart
from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import PydanticAIAgentExecutor, RuntimeToolLifecycleEvent
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
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent, RuntimeExecutionEventType
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
from app.desktop_runtime.server import create_app
from app.tooling.file_tools.runtime_bindings import FILE_TOOL_READ_ID


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
            type=cast(
                RuntimeExecutionEventType,
                {
                    "started": "tool_started",
                    "waiting_approval": "tool_waiting_approval",
                    "completed": "tool_completed",
                    "failed": "tool_failed",
                    "cancelled": "tool_cancelled",
                }[tool_event.phase],
            ),
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
    "tools/catalog/get",
    THINKING_CAPABILITY_GET_METHOD,
    "tool-approval/resolve",
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
        agent_executor=CapturingStreamingExecutor(outputs=["unused reply"]),  # type: ignore[arg-type]
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



def test_post_root_run_stream_corrupted_thread_history_returns_failed_event() -> None:
    app = _create_app(CapturingStreamingExecutor(outputs=["unused reply"]))

    with TestClient(app) as client:
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        corrupted_run_id = f"run-corrupted-{thread_id}"
        store = app.state.copilot_runtime_session_store
        store.create_run(
            thread_id=thread_id,
            run_id=corrupted_run_id,
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
        store.mark_run_completed(corrupted_run_id, assistant_text="projected assistant reply")
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


def test_post_root_run_stream_delay_tool_permission_policy_emits_waiting_approval_before_timeout_failure(
    tmp_path: Path,
) -> None:
    (tmp_path / "sample.txt").write_text("http runtime sample", encoding="utf-8")
    executor = PydanticAIAgentExecutor(workspace_root=tmp_path)
    app = _create_app(executor)

    with TestClient(app) as client:
        _configure_contract_tool_test_model(
            app,
            tool_id=FILE_TOOL_READ_ID,
            tool_arguments={"path": "sample.txt"},
            output_text="HTTP delayed tool answer.",
        )
        thread_response = client.post("/", json=_build_thread_create_request(agent_id="default"))
        thread_id = thread_response.json()["threadId"]
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id=thread_id,
                model_id="gpt-4.1",
                user_text="Read sample.txt with delayed approval.",
                enabled_tools=[FILE_TOOL_READ_ID],
                tool_permission_policy={
                    "schemaVersion": 1,
                    "defaultMode": "allow",
                    "toolModes": {FILE_TOOL_READ_ID: "delay"},
                    "toolTimeoutSeconds": {FILE_TOOL_READ_ID: 1},
                    "toolTimeoutActions": {FILE_TOOL_READ_ID: "deny"},
                },
            ),
        )
        run_id = run_start_response.json()["run"]["runId"]
        run_stream_response = client.post(
            "/",
            json=_build_run_stream_request(run_id=run_id),
        )

    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert run_stream_response.status_code == 200

    events = _parse_sse_events(run_stream_response.text)
    tool_events = [
        event
        for event in events
        if event["type"] == "tool_event" and event["payload"].get("toolId") == FILE_TOOL_READ_ID
    ]

    assert [event["payload"]["phase"] for event in tool_events] == [
        "started",
        "waiting_approval",
        "failed",
    ]
    assert tool_events[1]["payload"]["approval"] == {
        "mode": "delay",
        "timeoutAt": tool_events[1]["payload"]["approval"]["timeoutAt"],
        "timeoutSeconds": 1,
        "timeoutAction": "deny",
    }
    assert isinstance(tool_events[1]["payload"]["approval"]["timeoutAt"], str)
    assert tool_events[2]["payload"]["errorSummary"] == (
        "Tool approval timed out and was automatically rejected."
    )
    assert events[-1]["type"] == "run_completed"
    assert events[-1]["payload"]["assistantText"] == "HTTP delayed tool answer."



def _configure_contract_tool_test_model(
    app,
    *,
    tool_id: str,
    tool_arguments: dict[str, Any],
    output_text: str,
) -> None:
    tool_registry = getattr(app.state, "copilot_runtime_tool_registry", None)
    if tool_registry is None:
        runtime_executor = getattr(app.state, "copilot_runtime_agent_executor", None)
        tool_registry = getattr(runtime_executor, "_tool_registry", None)
    assert tool_registry is not None
    executable_tool = tool_registry.resolve_tool(tool_id)
    function_name = executable_tool.function_name
    assert function_name is not None
    app.state.copilot_runtime_agent_executor._model_override = _ContractToolCallingTestModel(
        tool_args_by_name={function_name: tool_arguments},
        custom_output_text=output_text,
    )



def _create_app(
    executor: PydanticAIAgentExecutor | CapturingStreamingExecutor | None = None,
    *,
    host_capability_bridge_client: Any | None = None,
):
    app = create_app(
        agent_executor=executor,  # type: ignore[arg-type]
        model_route_resolver=_ResolvedRouteResolver(),
        host_capability_bridge_client=host_capability_bridge_client,
    )
    if not hasattr(app.state, "copilot_runtime_tool_registry"):
        runtime_executor = getattr(app.state, "copilot_runtime_agent_executor", None)
        tool_registry = getattr(runtime_executor, "_tool_registry", None)
        if tool_registry is not None:
            app.state.copilot_runtime_tool_registry = tool_registry
    return app


def _build_thread_create_request(*, agent_id: str) -> dict[str, Any]:
    return {
        "method": "thread/create",
        "body": {
            "agentId": agent_id,
        },
    }


def _build_capabilities_get_request(
    *,
    thread_id: str,
    tool_permission_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "sessionId": thread_id,
    }
    if tool_permission_policy is not None:
        body["toolPermissionPolicy"] = dict(tool_permission_policy)
    return {
        "method": "capabilities/get",
        "body": body,
    }


def _build_run_start_request(
    *,
    thread_id: str,
    model_id: str,
    user_text: str,
    enabled_tools: list[str] | None = None,
    debug_mode_enabled: bool = False,
    tool_permission_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    policy: dict[str, Any] = {
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
    }
    if tool_permission_policy is not None:
        policy["toolPermissionPolicy"] = dict(tool_permission_policy)
    return {
        "method": "run/start",
        "body": {
            "threadId": thread_id,
            "agent": "default",
            "message": {
                "role": "user",
                "content": user_text,
            },
            "policy": policy,
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
