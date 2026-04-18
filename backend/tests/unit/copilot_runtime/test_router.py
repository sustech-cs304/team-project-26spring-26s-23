from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.copilot_runtime import (
    RuntimeBridge,
    RuntimeRunStartResponse,
    RuntimeToolApprovalCoordinator,
    RuntimeScaffold,
    RuntimeToolPermissionPolicy,
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
    build_default_agent_registry,
    build_default_tool_registry,
    build_router,
    build_runtime_scaffold,
)
from app.copilot_runtime.agent import ModelNotConfiguredError
from app.copilot_runtime.agent_registry import AgentDescriptor, AgentRegistry
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute
from app.copilot_runtime.session_store import InMemorySessionStore


TEST_MODEL_REPLY = "Hello from the test model."
SUPPORTED_METHODS = [
    "agents/list",
    "thread/create",
    "thread/get",
    "run/start",
    "run/stream",
    "run/cancel",
    "capabilities/get",
    "tools/catalog/get",
    "thinking/capability/get",
    "tool-approval/resolve",
]


class _ImmediateEventStream:
    def __init__(self, *, events: list[RuntimeExecutionEvent], output: str, resolved_model_id: str) -> None:
        self.resolved_model_id = resolved_model_id
        self._events = list(events)
        self._output = output

    async def __aenter__(self) -> "_ImmediateEventStream":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_events(self):
        for event in self._events:
            yield event

    async def get_output(self) -> str:
        return self._output


class _PermissiveExecutor:
    def __init__(self, *, reply: str) -> None:
        self.model_configured = True
        self.model_environment_keys: tuple[str, ...] = ()
        self._reply = reply

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model: Any | None = None,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> str:
        _ = (agent_name, user_prompt, message_history, model, enabled_tools, request_options)
        return self._reply

    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: list[str] | tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateEventStream:
        _ = (
            run_id,
            agent_name,
            user_prompt,
            message_history,
            enabled_tools,
            debug_enabled,
            request_options,
            model_settings,
        )
        return _ImmediateEventStream(
            events=_build_text_execution_events(run_id=run_id, text=self._reply),
            output=self._reply,
            resolved_model_id=model_route.model_id,
        )


class _RecordingExecutor(_PermissiveExecutor):
    def __init__(self, *, reply: str) -> None:
        super().__init__(reply=reply)
        self.calls: list[dict[str, object]] = []

    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: list[str] | tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateEventStream:
        self.calls.append(
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
        return super().open_event_stream(
            run_id=run_id,
            agent_name=agent_name,
            user_prompt=user_prompt,
            message_history=message_history,
            model_route=model_route,
            enabled_tools=enabled_tools,
            debug_enabled=debug_enabled,
            request_options=request_options,
            model_settings=model_settings,
        )


class _EchoModelRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        provider_id = "openai"
        endpoint_type = "openai-compatible"
        base_url = "https://example.com/v1"
        runtime_status = "enabled"
        auth_kind = "api-key"
        api_key = "test-api-key"
        model_id = model_route.route_ref.model_id

        if model_route.provider_profile_id == "ollama":
            provider_id = "ollama"
            endpoint_type = "ollama-native"
            base_url = "http://127.0.0.1:11434/v1"
            auth_kind = "none"
            api_key = ""
        elif model_route.provider_profile_id == "openai-response":
            provider_id = "openai-response"
            endpoint_type = "openai-response"
            runtime_status = "legacy-unsupported"
        elif model_id == "openrouter/auto":
            provider_id = "openrouter"
            runtime_status = "catalog-only"
        elif model_id == "glm-5-turbo":
            base_url = "https://api.z.ai/api/paas/v4"

        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider=provider_id,
            provider_id=provider_id,
            adapter_id=provider_id,
            runtime_status=runtime_status,
            endpoint_type=endpoint_type,
            base_url=base_url,
            model_id=model_id,
            auth_kind=auth_kind,
            api_key=api_key,
            route_ref=model_route.route_ref,
        )



def _build_text_execution_events(*, run_id: str, text: str) -> list[RuntimeExecutionEvent]:
    return [
        RuntimeExecutionEvent(
            type="assistant_segment_delta",
            payload={
                "segmentId": f"{run_id}:assistant-segment-1",
                "delta": text,
            },
        )
    ]



def test_root_post_agents_list_returns_backend_agent_directory() -> None:
    app, scaffold, _ = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "agents/list"})

    assert response.status_code == 200
    assert response.json() == scaffold.build_agents_list_response().to_dict()



def test_root_post_thread_create_returns_bound_agent_thread_payload() -> None:
    app, scaffold, store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_thread_create_request())

    payload = response.json()
    thread = store.get_thread(payload["threadId"])

    assert response.status_code == 200
    assert thread is not None
    assert payload == scaffold.build_thread_create_response(thread=thread).to_dict()
    assert payload["threadId"].startswith("thread-")



def test_root_post_thread_get_returns_bound_agent_recommendations_and_tool_catalog() -> None:
    app, scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="thread-1")

    with TestClient(app) as client:
        response = client.post("/", json=_build_thread_get_request(thread_id=thread.thread_id))

    payload = response.json()

    assert response.status_code == 200
    assert payload == scaffold.build_thread_get_response(thread=thread).to_dict()
    assert payload["recommendedTools"] == ["tool.file-convert"]
    assert payload["toolSelectionMode"] == "recommendation-only"
    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.file-convert" in tool_ids
    assert payload["capabilitiesVersion"] == "capabilities:agents-v1:tools-v1"
    assert payload["latestRunId"] is None
    assert scaffold.tool_registry.get_default().name == "default"



def test_root_post_thread_get_unknown_thread_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_thread_get_request(thread_id="missing-thread"))

    payload = response.json()

    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "thread_not_found"
    assert payload["error"]["requestedMethod"] == "thread/get"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"threadId": "missing-thread"}



def test_root_post_global_tool_catalog_returns_default_toolset_catalog() -> None:
    app, scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "tools/catalog/get", "body": {}})

    assert response.status_code == 200
    assert response.json() == scaffold.build_global_tool_catalog_response().to_dict()
    assert scaffold.tool_registry.get_default().name == "default"



def test_root_post_global_tool_catalog_requires_explicit_body_wrapper() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "tools/catalog/get"})

    payload = response.json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_request"
    assert payload["error"]["requestedMethod"] == "tools/catalog/get"
    assert payload["error"]["details"] == {"field": "body"}



def test_root_post_run_start_returns_run_shell_payload() -> None:
    app, scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_run_start_request(thread_id="thread-1", model="gpt-4.1"),
        )

    payload = response.json()
    run = store.get_run(payload["run"]["runId"])

    assert response.status_code == 200
    assert run is not None
    assert payload == scaffold.build_run_start_response(run=run).to_dict()
    assert payload["run"]["status"] == "pending"
    assert payload["run"]["requestedThinkingSelection"] is None
    assert payload["run"]["appliedThinkingSelection"] is None
    assert payload["run"]["thinkingCapabilitySnapshot"] == {
        "status": "verified-supported",
        "source": "verified",
        "series": "openai-4-level-minimal-v1",
        "seriesLabelZh": "OpenAI 4 档 Minimal 系",
        "editorType": "discrete",
        "allowedValues": [
            {"valueType": "code", "code": "minimal", "mode": None, "budgetTokens": None, "labelZh": "极简"},
            {"valueType": "code", "code": "low", "mode": None, "budgetTokens": None, "labelZh": "低"},
            {"valueType": "code", "code": "medium", "mode": None, "budgetTokens": None, "labelZh": "中"},
            {"valueType": "code", "code": "high", "mode": None, "budgetTokens": None, "labelZh": "高"},
        ],
        "defaultValue": {
            "valueType": "code",
            "code": "medium",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "中",
        },
        "providerBuilderKey": "openai_reasoning_effort_v1",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
    }
    assert payload["run"]["thinkingSeriesDecision"] == {
        "requestedSelection": None,
        "appliedSelection": None,
        "applied": False,
        "reasonCode": "selection_missing",
        "errorCode": None,
        "providerBuilderKey": None,
        "mappingReasonCode": "selection_missing",
        "capabilityStatus": "verified-supported",
        "capabilitySource": "verified",
        "capabilitySeries": "openai-4-level-minimal-v1",
        "capabilitySeriesLabelZh": "OpenAI 4 档 Minimal 系",
        "capabilityReasonCode": "verified_series_resolved",
    }
    assert payload["run"]["reasoningSuppressionBasis"] == {
        "shouldSuppress": False,
        "source": "none",
        "reasonCode": None,
        "appliedThinkingSelection": None,
        "reasoningVisibility": "visible",
        "supportsSuppression": True,
        "capabilitySource": "verified",
        "capabilitySeries": "openai-4-level-minimal-v1",
    }



def test_root_post_run_start_provider_specific_thinking_selection_round_trips_without_500(
    caplog: pytest.LogCaptureFixture,
) -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    thinking_selection = {
        "series": "qwen-thinking-switch-v1",
        "value": {
            "valueType": "code",
            "code": "true",
            "labelZh": "开启",
        },
    }
    thinking_capability_override = {
        "supported": True,
        "series": "qwen-thinking-switch-v1",
        "template": {
            "editorType": "discrete",
            "allowedValues": [
                {"valueType": "code", "code": "false", "labelZh": "关闭"},
                {"valueType": "code", "code": "true", "labelZh": "开启"},
            ],
            "defaultValue": {"valueType": "code", "code": "true", "labelZh": "开启"},
        },
        "source": "settings-page",
    }

    with caplog.at_level("INFO", logger="uvicorn.error"):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.post(
                "/",
                json=_build_run_start_request(
                    thread_id="thread-1",
                    model="unknown-model",
                    debug_mode_enabled=True,
                    thinking_selection=thinking_selection,
                    thinking_capability_override=thinking_capability_override,
                ),
            )

    payload = response.json()
    run = store.get_run(payload["run"]["runId"])
    chain_logs = [
        record.getMessage()
        for record in caplog.records
        if "copilot-runtime-chain" in record.getMessage()
    ]

    assert response.status_code == 200
    assert run is not None
    assert run.request.policy.thinking_selection is not None
    assert run.request.policy.thinking_selection.value_payload == {
        "valueType": "code",
        "code": "true",
        "mode": None,
        "budgetTokens": None,
        "labelZh": "开启",
    }
    assert payload["run"]["requestedThinkingSelection"] == {
        "series": "qwen-thinking-switch-v1",
        "value": {
            "valueType": "code",
            "code": "true",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "开启",
        },
    }
    assert payload["run"]["appliedThinkingSelection"] == {
        "series": "qwen-thinking-switch-v1",
        "value": {
            "valueType": "code",
            "code": "true",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "开启",
        },
    }
    assert payload["run"]["thinkingCapabilitySnapshot"]["status"] == "unknown-with-override"
    assert payload["run"]["thinkingCapabilitySnapshot"]["series"] == "qwen-thinking-switch-v1"
    assert payload["run"]["thinkingSeriesDecision"]["reasonCode"] == "override_series_builder_applied"
    assert payload["run"]["thinkingSeriesDecision"]["mappingReasonCode"] == "qwen_switch_true"
    assert any('"event":"run_start.prime_run_metadata.enter"' in message for message in chain_logs)
    assert any(
        '"event":"thinking.run_metadata_primed"' in message
        and '"phase":"prime_run_metadata"' in message
        and '"requestId":' in message
        and '"runId":"' in message
        for message in chain_logs
    )



def test_root_post_run_start_unexpected_create_run_failure_returns_structured_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    def _raise_create_run(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("forced run/start failure")

    monkeypatch.setattr(store, "create_run", _raise_create_run)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/",
            json=_build_run_start_request(thread_id="thread-1", model="gpt-4.1"),
        )

    payload = response.json()

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert payload["ok"] is False
    assert payload["error"]["code"] == "internal_server_error"
    assert payload["error"]["requestedMethod"] == "run/start"
    assert payload["error"]["details"]["requestId"]



def test_root_post_run_start_serialization_failure_returns_structured_error_and_keeps_run_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    captured_logs: list[tuple[str, dict[str, object]]] = []
    router_module = __import__(
        "app.copilot_runtime.transport.response_mappers",
        fromlist=["log_runtime_chain_debug"],
    )

    def _capture_log(event_name: str, *, enabled: bool | None = None, **payload: object) -> None:
        captured_logs.append((event_name, payload))

    def _raise_to_dict(self: RuntimeRunStartResponse) -> dict[str, object]:
        raise RuntimeError("forced run/start serialization failure")

    monkeypatch.setattr(router_module, "log_runtime_chain_debug", _capture_log)
    monkeypatch.setattr(RuntimeRunStartResponse, "to_dict", _raise_to_dict)

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id="thread-1",
                model="gpt-4.1",
                debug_mode_enabled=True,
            ),
        )

    payload = response.json()
    runs = store.list_runs("thread-1")

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert payload["ok"] is False
    assert payload["error"]["code"] == "internal_server_error"
    assert payload["error"]["requestedMethod"] == "run/start"
    assert payload["error"]["details"]["requestId"]
    assert len(runs) == 1
    assert runs[0].status == "pending"
    assert runs[0].metadata["thinkingCapabilitySnapshot"]["status"] == "verified-supported"

    serialize_logs = [payload for name, payload in captured_logs if name == "run_start.serialize_run_start_response.failed"]
    assert len(serialize_logs) == 1
    assert serialize_logs[0]["phase"] == "serialize_run_start_response"
    assert serialize_logs[0]["threadId"] == "thread-1"
    assert serialize_logs[0]["runId"] == runs[0].run_id
    assert serialize_logs[0]["runtimeMethod"] == "run/start"
    assert serialize_logs[0]["exceptionType"] == "RuntimeError"
    assert serialize_logs[0]["exception"]["message"] == "forced run/start serialization failure"


def test_log_run_start_stage_skips_chain_logs_when_request_debug_disabled(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_CHAIN_DEBUG", "1")
    router_module = __import__("app.copilot_runtime.router", fromlist=["_log_run_start_stage"])
    request = _build_http_request(debug_mode_enabled=False)

    with caplog.at_level("INFO", logger="uvicorn.error"):
        router_module._log_run_start_stage(request, "run_start.request_received")

    chain_logs = [
        record.getMessage()
        for record in caplog.records
        if "copilot-runtime-chain" in record.getMessage()
    ]

    assert not any('"event":"run_start.request_received"' in message for message in chain_logs)



def test_log_run_start_stage_emits_chain_logs_when_request_debug_enabled(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.delenv("COPILOT_RUNTIME_CHAIN_DEBUG", raising=False)
    router_module = __import__("app.copilot_runtime.router", fromlist=["_log_run_start_stage"])
    request = _build_http_request(debug_mode_enabled=True)

    with caplog.at_level("INFO", logger="uvicorn.error"):
        router_module._log_run_start_stage(request, "run_start.request_received")

    chain_logs = [
        record.getMessage()
        for record in caplog.records
        if "copilot-runtime-chain" in record.getMessage()
    ]

    assert any(
        '"event":"run_start.request_received"' in message
        and '"phase":"create_run_record"' in message
        and '"threadId":"thread-1"' in message
        for message in chain_logs
    )



def test_log_run_start_stage_uses_service_debug_default_when_request_debug_omitted(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_CHAIN_DEBUG", "1")
    router_module = __import__("app.copilot_runtime.router", fromlist=["_log_run_start_stage"])
    request = _build_http_request(debug_mode_enabled=None)

    with caplog.at_level("INFO", logger="uvicorn.error"):
        router_module._log_run_start_stage(request, "run_start.request_received")

    chain_logs = [
        record.getMessage()
        for record in caplog.records
        if "copilot-runtime-chain" in record.getMessage()
    ]

    assert any('"event":"run_start.request_received"' in message for message in chain_logs)



def test_root_post_run_stream_executes_started_run_and_persists_thread_history() -> None:
    app, _scaffold, store, executor = _build_app_with_recording_executor()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    with TestClient(app) as client:
        start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id="thread-1",
                model="gpt-4.1",
                enabled_tools=["tool.file-convert"],
                debug_mode_enabled=True,
                request_options={"temperature": 0.2},
            ),
        )
        run_id = start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    events = _parse_sse_events(response.text)
    completed = events[-1]["payload"]

    assert start_response.status_code == 200
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["type"] for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]
    assert events[1]["payload"] == {
        "requestedThinkingSelection": None,
        "appliedThinkingSelection": None,
        "thinkingCapabilitySnapshot": {
            "status": "verified-supported",
            "source": "verified",
            "series": "openai-4-level-minimal-v1",
            "seriesLabelZh": "OpenAI 4 档 Minimal 系",
            "editorType": "discrete",
            "allowedValues": [
                {"valueType": "code", "code": "minimal", "mode": None, "budgetTokens": None, "labelZh": "极简"},
                {"valueType": "code", "code": "low", "mode": None, "budgetTokens": None, "labelZh": "低"},
                {"valueType": "code", "code": "medium", "mode": None, "budgetTokens": None, "labelZh": "中"},
                {"valueType": "code", "code": "high", "mode": None, "budgetTokens": None, "labelZh": "高"},
            ],
            "defaultValue": {
                "valueType": "code",
                "code": "medium",
                "mode": None,
                "budgetTokens": None,
                "labelZh": "中",
            },
            "providerBuilderKey": "openai_reasoning_effort_v1",
            "reasonCode": "verified_series_resolved",
            "routeFingerprint": {
                "providerProfileId": "provider-1",
                "provider": "openai",
                "endpointType": "openai-compatible",
                "baseUrl": "https://example.com/v1",
                "modelId": "gpt-4.1",
            },
        },
        "thinkingSeriesDecision": {
            "requestedSelection": None,
            "appliedSelection": None,
            "applied": False,
            "reasonCode": "selection_missing",
            "errorCode": None,
            "providerBuilderKey": None,
            "mappingReasonCode": "selection_missing",
            "capabilityStatus": "verified-supported",
            "capabilitySource": "verified",
            "capabilitySeries": "openai-4-level-minimal-v1",
            "capabilitySeriesLabelZh": "OpenAI 4 档 Minimal 系",
            "capabilityReasonCode": "verified_series_resolved",
        },
        "reasoningSuppressionBasis": {
            "shouldSuppress": False,
            "source": "none",
            "reasonCode": None,
            "appliedThinkingSelection": None,
            "reasoningVisibility": "visible",
            "supportsSuppression": True,
            "capabilitySource": "verified",
            "capabilitySeries": "openai-4-level-minimal-v1",
        },
    }
    assert events[2]["payload"]["delta"] == TEST_MODEL_REPLY
    assert completed["resolvedModelId"] == "gpt-4.1"
    assert completed["resolvedToolIds"] == ["tool.file-convert"]
    assert completed["requestOptions"] == {"temperature": 0.2}
    assert executor.calls == [
        {
            "agent_name": "default",
            "user_prompt": "Hello",
            "message_history": [],
            "resolved_model_id": "gpt-4.1",
            "enabled_tools": ["tool.file-convert"],
            "debug_enabled": True,
            "request_options": {"temperature": 0.2},
        }
    ]
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "Hello"),
        ("assistant", TEST_MODEL_REPLY),
    ]



def test_root_post_run_cancel_marks_pending_run_cancelled_and_stream_returns_cancelled_shell() -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    with TestClient(app) as client:
        start_response = client.post(
            "/",
            json=_build_run_start_request(thread_id="thread-1", model="gpt-4.1"),
        )
        run_id = start_response.json()["run"]["runId"]
        cancel_response = client.post("/", json=_build_run_cancel_request(run_id=run_id))
        stream_response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    cancel_payload = cancel_response.json()
    events = _parse_sse_events(stream_response.text)

    assert start_response.status_code == 200
    assert cancel_response.status_code == 200
    assert cancel_payload["cancelAccepted"] is True
    assert cancel_payload["run"]["runId"] == run_id
    assert cancel_payload["run"]["status"] == "cancelled"
    assert cancel_payload["run"]["cancelRequested"] is True
    assert cancel_payload["run"]["requestedThinkingSelection"] is None
    assert cancel_payload["run"]["appliedThinkingSelection"] is None
    assert cancel_payload["run"]["thinkingCapabilitySnapshot"] == {
        "status": "verified-supported",
        "source": "verified",
        "series": "openai-4-level-minimal-v1",
        "seriesLabelZh": "OpenAI 4 档 Minimal 系",
        "editorType": "discrete",
        "allowedValues": [
            {"valueType": "code", "code": "minimal", "mode": None, "budgetTokens": None, "labelZh": "极简"},
            {"valueType": "code", "code": "low", "mode": None, "budgetTokens": None, "labelZh": "低"},
            {"valueType": "code", "code": "medium", "mode": None, "budgetTokens": None, "labelZh": "中"},
            {"valueType": "code", "code": "high", "mode": None, "budgetTokens": None, "labelZh": "高"},
        ],
        "defaultValue": {
            "valueType": "code",
            "code": "medium",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "中",
        },
        "providerBuilderKey": "openai_reasoning_effort_v1",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
    }
    assert cancel_payload["run"]["thinkingSeriesDecision"] == {
        "requestedSelection": None,
        "appliedSelection": None,
        "applied": False,
        "reasonCode": "selection_missing",
        "errorCode": None,
        "providerBuilderKey": None,
        "mappingReasonCode": "selection_missing",
        "capabilityStatus": "verified-supported",
        "capabilitySource": "verified",
        "capabilitySeries": "openai-4-level-minimal-v1",
        "capabilitySeriesLabelZh": "OpenAI 4 档 Minimal 系",
        "capabilityReasonCode": "verified_series_resolved",
    }
    assert cancel_payload["run"]["reasoningSuppressionBasis"] == {
        "shouldSuppress": False,
        "source": "none",
        "reasonCode": None,
        "appliedThinkingSelection": None,
        "reasoningVisibility": "visible",
        "supportsSuppression": True,
        "capabilitySource": "verified",
        "capabilitySeries": "openai-4-level-minimal-v1",
    }

    assert stream_response.status_code == 200
    assert [event["type"] for event in events] == ["run_cancelled"]
    assert events[0]["payload"] == {
        "assistantMessageId": f"{run_id}:assistant",
        "reason": "cancelled",
    }



def test_root_post_run_stream_unknown_run_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_stream_request(run_id="run-missing"))

    payload = response.json()

    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "run_not_found"
    assert payload["error"]["requestedMethod"] == "run/stream"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"runId": "run-missing"}



def test_root_post_run_stream_runtime_error_before_sse_starts_returns_structured_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    def _raise_stream_run(
        self: RuntimeBridge,
        *,
        run_id: str,
        is_client_disconnected: Any | None = None,
    ) -> None:
        _ = (self, run_id, is_client_disconnected)
        raise RuntimeError("forced run/stream failure before sse starts")

    monkeypatch.setattr(RuntimeBridge, "stream_run", _raise_stream_run)

    with TestClient(app, raise_server_exceptions=False) as client:
        start_response = client.post(
            "/",
            json=_build_run_start_request(thread_id="thread-1", model="gpt-4.1"),
        )
        run_id = start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    payload = response.json()
    run = store.get_run(run_id)

    assert start_response.status_code == 200
    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_execution_failed"
    assert payload["error"]["message"] == "forced run/stream failure before sse starts"
    assert payload["error"]["requestedMethod"] == "run/stream"
    assert payload["error"]["details"] == {}
    assert run is not None
    assert run.status == "pending"



def test_root_post_run_stream_execution_failure_preserves_streaming_failure_semantics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    def _raise_open_event_stream(*args: Any, **kwargs: Any) -> None:
        raise ModelNotConfiguredError("forced streaming execution failure")

    monkeypatch.setattr(_PermissiveExecutor, "open_event_stream", _raise_open_event_stream)

    with TestClient(app) as client:
        start_response = client.post(
            "/",
            json=_build_run_start_request(thread_id="thread-1", model="gpt-4.1"),
        )
        run_id = start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    events = _parse_sse_events(response.text)
    run = store.get_run(run_id)

    assert start_response.status_code == 200
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["type"] for event in events] == ["run_started", "run_metadata", "run_failed"]
    assert events[-1]["payload"] == {
        "code": "model_not_configured",
        "message": "forced streaming execution failure",
        "details": {"modelEnvironmentKeys": []},
    }
    assert run is not None
    assert run.status == "failed"
    assert run.metadata["terminal_event"] == "run_failed"
    assert run.metadata["terminal_payload"] == events[-1]["payload"]


def test_root_post_thinking_capability_get_returns_canonical_schema_and_schema_version() -> None:
    app, _scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_thinking_capability_get_request(
                session_id=thread.thread_id,
                provider="openai",
                model="gpt-4.1",
            ),
        )

    payload = response.json()

    assert response.status_code == 200
    assert payload == {
        "ok": True,
        "sessionId": thread.thread_id,
        "capabilitySchemaVersion": "canonical-thinking-capability-v2",
        "capability": {
            "status": "verified-supported",
            "source": "verified",
            "series": "openai-4-level-minimal-v1",
            "seriesLabelZh": "OpenAI 4 档 Minimal 系",
            "editorType": "discrete",
            "allowedValues": [
                {"valueType": "code", "code": "minimal", "mode": None, "budgetTokens": None, "labelZh": "极简"},
                {"valueType": "code", "code": "low", "mode": None, "budgetTokens": None, "labelZh": "低"},
                {"valueType": "code", "code": "medium", "mode": None, "budgetTokens": None, "labelZh": "中"},
                {"valueType": "code", "code": "high", "mode": None, "budgetTokens": None, "labelZh": "高"},
            ],
            "defaultValue": {
                "valueType": "code",
                "code": "medium",
                "mode": None,
                "budgetTokens": None,
                "labelZh": "中",
            },
            "providerBuilderKey": "openai_reasoning_effort_v1",
            "reasonCode": "verified_series_resolved",
            "routeFingerprint": {
                "providerProfileId": "provider-1",
                "provider": "openai",
                "endpointType": "openai-compatible",
                "baseUrl": "https://example.com/v1",
                "modelId": "gpt-4.1",
            },
        },
    }


def test_root_post_capabilities_get_returns_bound_agent_recommendations_and_tool_catalog() -> None:
    app, scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="session-1")

    with TestClient(app) as client:
        response = client.post("/", json=_build_capabilities_get_request(session_id=thread.session_id))

    payload = response.json()

    assert response.status_code == 200
    assert payload == scaffold.build_capabilities_response(thread=thread).to_dict()
    assert payload["recommendedTools"] == ["tool.file-convert"]
    assert scaffold.tool_registry.get_default().name == "default"
    assert payload["toolSelectionMode"] == "recommendation-only"
    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.file-convert" in tool_ids
    assert payload["capabilitiesVersion"] == "capabilities:agents-v1:tools-v1"



def test_root_post_capabilities_get_routes_tool_permission_policy_to_bridge_catalog_filter() -> None:
    app, _scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="session-policy")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_capabilities_get_request(
                session_id=thread.session_id,
                tool_permission_policy={
                    "schemaVersion": 1,
                    "defaultMode": "allow",
                    "toolModes": {"tool.file-convert": "deny"},
                },
            ),
        )

    payload = response.json()

    assert response.status_code == 200
    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.file-convert" not in tool_ids
    assert "tool.weather-current" in tool_ids
    assert payload["recommendedTools"] == []



def test_scaffold_capabilities_response_filters_denied_tools_from_catalog() -> None:
    _app, scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="session-deny")

    payload = scaffold.build_capabilities_response(
        thread=thread,
        tool_permission_resolver=RuntimeToolPermissionResolver.from_policy(
            RuntimeToolPermissionPolicy(
                schemaVersion=1,
                defaultMode="allow",
                toolModes={"tool.file-convert": "deny"},
            )
        ),
    ).to_dict()

    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.file-convert" not in tool_ids
    assert "tool.weather-current" in tool_ids
    assert payload["recommendedTools"] == []



def test_root_post_capabilities_get_unknown_session_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_capabilities_get_request(session_id="missing-session"))

    payload = response.json()

    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "session_not_found"
    assert payload["error"]["requestedMethod"] == "capabilities/get"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"sessionId": "missing-session"}



def test_root_post_global_tool_catalog_get_returns_default_toolset_catalog() -> None:
    app, scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "tools/catalog/get", "body": {}})

    payload = response.json()

    assert response.status_code == 200
    assert payload == scaffold.build_global_tool_catalog_response().to_dict()
    assert payload["directoryVersion"] == "tools-v1"
    assert payload["defaultToolset"] == "default"
    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.file-convert" in tool_ids



def test_root_post_thinking_capability_get_returns_verified_unsupported_snapshot_for_catalog_only_provider() -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_thinking_capability_get_request(
                session_id="session-1",
                provider="openrouter",
                model="openrouter/auto",
            ),
        )

    payload = response.json()

    assert response.status_code == 200
    assert payload == {
        "ok": True,
        "sessionId": "session-1",
        "capabilitySchemaVersion": "canonical-thinking-capability-v2",
        "capability": {
            "status": "unknown-without-override",
            "source": "unknown",
            "series": None,
            "seriesLabelZh": None,
            "editorType": None,
            "allowedValues": [],
            "defaultValue": None,
            "providerBuilderKey": None,
            "reasonCode": "route_not_verified",
            "routeFingerprint": {
                "providerProfileId": "provider-1",
                "provider": "openrouter",
                "endpointType": "openai-compatible",
                "baseUrl": "https://example.com/v1",
                "modelId": "openrouter/auto",
            },
        },
    }



def test_root_post_run_stream_agent_mismatch_streams_failed_terminal_event() -> None:
    app, _scaffold, store = _build_app_with_secondary_agent()
    store.create_thread(bound_agent_id="default", thread_id="session-1")

    with TestClient(app) as client:
        start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id="session-1",
                agent_id="secondary",
                model="gpt-4.1",
            ),
        )
        run_id = start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    events = _parse_sse_events(response.text)

    assert start_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == ["run_started", "run_failed"]
    assert events[-1]["payload"] == {
        "code": "agent_mismatch",
        "message": "Session 'session-1' is bound to agent 'default', cannot use agent 'secondary'.",
        "details": {
            "sessionId": "session-1",
            "boundAgentId": "default",
            "requestedAgentId": "secondary",
        },
    }



def test_root_post_run_stream_unknown_tool_streams_failed_terminal_event() -> None:
    app, _scaffold, store = _build_app()
    store.create_thread(bound_agent_id="default", thread_id="session-1")

    with TestClient(app) as client:
        start_response = client.post(
            "/",
            json=_build_run_start_request(
                thread_id="session-1",
                model="gpt-4.1",
                enabled_tools=["tool.missing"],
            ),
        )
        run_id = start_response.json()["run"]["runId"]
        response = client.post("/", json=_build_run_stream_request(run_id=run_id))

    events = _parse_sse_events(response.text)

    assert start_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == ["run_started", "run_failed"]
    assert events[-1]["payload"] == {
        "code": "tool_not_found",
        "message": "Unknown tool 'tool.missing'.",
        "details": {"toolId": "tool.missing"},
    }



def test_root_post_run_start_unsupported_message_shape_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "method": "run/start",
                "body": {
                    "threadId": "session-1",
                    "message": {"role": "assistant", "content": "ignored"},
                    "policy": _build_policy(model="gpt-4.1"),
                },
            },
        )

    payload = response.json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "unsupported_message_shape"
    assert payload["error"]["requestedMethod"] == "run/start"



def test_root_post_run_start_requires_explicit_body_wrapper() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "method": "run/start",
                "threadId": "session-1",
            },
        )

    payload = response.json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_request"
    assert payload["error"]["requestedMethod"] == "run/start"
    assert payload["error"]["details"] == {"field": "body"}



def test_root_post_missing_method_returns_structured_bad_request() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "properties": {"mode": "desktop"},
                "frontendUrl": "http://localhost:5173",
            },
        )

    payload = response.json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_request"
    assert payload["error"]["requestedMethod"] is None
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS



def test_root_post_legacy_info_returns_method_not_implemented() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "info"})

    payload = response.json()

    assert response.status_code == 501
    assert payload["ok"] is False
    assert payload["error"]["code"] == "method_not_implemented"
    assert payload["error"]["requestedMethod"] == "info"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS



def _build_runtime_bridge(
    *,
    store: InMemorySessionStore,
    agent_registry: AgentRegistry,
    scaffold: RuntimeScaffold,
) -> RuntimeBridge:
    model_route_resolver = _EchoModelRouteResolver()
    return RuntimeBridge(
        session_store=store,
        agent_registry=agent_registry,
        scaffold=scaffold,
        message_run_orchestrator=RuntimeMessageRunOrchestrator(
            session_store=store,
            agent_registry=agent_registry,
            scaffold=scaffold,
            model_route_resolver=model_route_resolver,
        ),
        model_route_resolver=_EchoModelRouteResolver(),
    )



def _build_app() -> tuple[FastAPI, RuntimeScaffold, InMemorySessionStore]:
    executor = _PermissiveExecutor(reply=TEST_MODEL_REPLY)
    store = InMemorySessionStore()
    tool_registry = build_default_tool_registry()
    agent_registry = build_default_agent_registry(
        executor_factory=lambda: executor,
        toolset_name=tool_registry.get_default().name,
    )
    scaffold = build_runtime_scaffold(
        session_store_type=store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    bridge = _build_runtime_bridge(
        store=store,
        agent_registry=agent_registry,
        scaffold=scaffold,
    )
    app = FastAPI()
    app.include_router(build_router(scaffold, bridge))
    app.state.runtime_bridge = bridge
    return app, scaffold, store



def _build_app_with_secondary_agent() -> tuple[FastAPI, RuntimeScaffold, InMemorySessionStore]:
    executor = _PermissiveExecutor(reply=TEST_MODEL_REPLY)
    store = InMemorySessionStore()
    tool_registry = build_default_tool_registry()
    registry = AgentRegistry(
        [
            AgentDescriptor(
                name="default",
                label="Default",
                description="Default runtime agent.",
                default=True,
                toolset_name=tool_registry.get_default().name,
                executor_factory=lambda: executor,
                recommended_tools=("tool.file-convert",),
            ),
            AgentDescriptor(
                name="secondary",
                label="Secondary",
                description="Secondary runtime agent.",
                toolset_name=tool_registry.get_default().name,
                executor_factory=lambda: executor,
            ),
        ]
    )
    scaffold = build_runtime_scaffold(
        session_store_type=store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
        agent_registry=registry,
        tool_registry=tool_registry,
    )
    bridge = _build_runtime_bridge(store=store, agent_registry=registry, scaffold=scaffold)
    app = FastAPI()
    app.include_router(build_router(scaffold, bridge))
    return app, scaffold, store



def _build_app_with_recording_executor() -> tuple[
    FastAPI,
    RuntimeScaffold,
    InMemorySessionStore,
    _RecordingExecutor,
]:
    executor = _RecordingExecutor(reply=TEST_MODEL_REPLY)
    store = InMemorySessionStore()
    tool_registry = build_default_tool_registry()
    agent_registry = build_default_agent_registry(
        executor_factory=lambda: executor,
        toolset_name=tool_registry.get_default().name,
    )
    scaffold = build_runtime_scaffold(
        session_store_type=store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    bridge = _build_runtime_bridge(store=store, agent_registry=agent_registry, scaffold=scaffold)
    app = FastAPI()
    app.include_router(build_router(scaffold, bridge))
    return app, scaffold, store, executor



def _build_thread_create_request(*, agent_id: str = "default") -> dict[str, Any]:
    return {
        "method": "thread/create",
        "body": {
            "agentId": agent_id,
        },
    }



def _build_thread_get_request(*, thread_id: str) -> dict[str, Any]:
    return {
        "method": "thread/get",
        "body": {
            "threadId": thread_id,
        },
    }



def _build_capabilities_get_request(
    *,
    session_id: str,
    tool_permission_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "sessionId": session_id,
    }
    if tool_permission_policy is not None:
        body["toolPermissionPolicy"] = dict(tool_permission_policy)
    return {
        "method": "capabilities/get",
        "body": body,
    }



def _build_thinking_capability_get_request(
    *,
    session_id: str,
    provider: str,
    model: str,
) -> dict[str, Any]:
    return {
        "method": "thinking/capability/get",
        "body": {
            "sessionId": session_id,
            "modelRoute": {
                "routeRef": {
                    "routeKind": "provider-model",
                    "profileId": "provider-1",
                    "modelId": model,
                },
            },
        },
    }



def _build_http_request(*, debug_mode_enabled: bool | None) -> Request:
    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": [],
            "client": ("127.0.0.1", 50000),
            "server": ("testserver", 80),
            "root_path": "",
        }
    )
    router_module = __import__("app.copilot_runtime.router", fromlist=["_set_runtime_request_context"])
    if debug_mode_enabled is not None:
        request.state.copilot_runtime_debug_mode_enabled = debug_mode_enabled
    router_module._set_runtime_request_context(
        request,
        runtime_method="run/start",
        thread_id="thread-1",
        agent_id="default",
        run_id="run-1",
        phase="create_run_record",
    )
    return request



def _build_run_start_request(
    *,
    thread_id: str,
    model: str,
    user_text: str = "Hello",
    agent_id: str | None = "default",
    enabled_tools: list[str] | None = None,
    debug_mode_enabled: bool = False,
    request_options: dict[str, object] | None = None,
    thinking_selection: dict[str, object] | None = None,
    thinking_capability_override: dict[str, object] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "threadId": thread_id,
        "message": {"role": "user", "content": user_text},
        "policy": _build_policy(
            model=model,
            enabled_tools=enabled_tools,
            debug_mode_enabled=debug_mode_enabled,
            request_options=request_options,
            thinking_selection=thinking_selection,
            thinking_capability_override=thinking_capability_override,
        ),
    }
    if agent_id is not None:
        body["agent"] = agent_id
    return {"method": "run/start", "body": body}



def _build_run_stream_request(*, run_id: str) -> dict[str, Any]:
    return {
        "method": "run/stream",
        "body": {
            "runId": run_id,
        },
    }



def _build_run_cancel_request(*, run_id: str) -> dict[str, Any]:
    return {
        "method": "run/cancel",
        "body": {
            "runId": run_id,
        },
    }



def _build_tool_approval_resolve_request(
    *,
    run_id: str,
    tool_call_id: str,
    decision: str,
) -> dict[str, Any]:
    return {
        "method": "tool-approval/resolve",
        "body": {
            "runId": run_id,
            "toolCallId": tool_call_id,
            "decision": decision,
        },
    }



def test_root_post_tool_approval_resolve_approved_routes_to_coordinator() -> None:
    app, _scaffold, _store = _build_app()
    bridge = app.state.runtime_bridge
    bridge._approval_coordinator = RuntimeToolApprovalCoordinator(
        _loop_provider=asyncio.new_event_loop,
    )
    bridge._approval_coordinator.create_request(
        run_id="run-approved",
        tool_call_id="call-approved",
        tool_id="tool.file-convert",
        mode="ask",
    )

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_tool_approval_resolve_request(
                run_id="run-approved",
                tool_call_id="call-approved",
                decision="approved",
            ),
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["decision"] == "approved"
    assert payload["status"] == "approved"
    assert payload["details"] == {
        "toolId": "tool.file-convert",
        "mode": "ask",
    }



def test_root_post_tool_approval_resolve_rejected_routes_to_coordinator() -> None:
    app, _scaffold, _store = _build_app()
    bridge = app.state.runtime_bridge
    bridge._approval_coordinator = RuntimeToolApprovalCoordinator(
        _loop_provider=asyncio.new_event_loop,
    )
    bridge._approval_coordinator.create_request(
        run_id="run-rejected",
        tool_call_id="call-rejected",
        tool_id="tool.file-convert",
        mode="ask",
    )

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_tool_approval_resolve_request(
                run_id="run-rejected",
                tool_call_id="call-rejected",
                decision="rejected",
            ),
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["ok"] is True
    assert payload["decision"] == "rejected"
    assert payload["status"] == "rejected"
    assert payload["details"] == {
        "toolId": "tool.file-convert",
        "mode": "ask",
    }



def test_root_post_tool_approval_resolve_missing_request_returns_stable_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_tool_approval_resolve_request(
                run_id="run-missing",
                tool_call_id="call-missing",
                decision="approved",
            ),
        )

    payload = response.json()
    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "run_not_found"
    assert payload["error"]["requestedMethod"] == "tool-approval/resolve"
    assert payload["error"]["details"] == {"runId": "run-missing"}



def test_root_post_tool_approval_resolve_duplicate_decision_returns_stable_error() -> None:
    app, _scaffold, _store = _build_app()
    bridge = app.state.runtime_bridge
    bridge._approval_coordinator = RuntimeToolApprovalCoordinator(
        _loop_provider=asyncio.new_event_loop,
    )
    bridge._approval_coordinator.create_request(
        run_id="run-dup",
        tool_call_id="call-dup",
        tool_id="tool.file-convert",
        mode="ask",
    )

    with TestClient(app) as client:
        first_response = client.post(
            "/",
            json=_build_tool_approval_resolve_request(
                run_id="run-dup",
                tool_call_id="call-dup",
                decision="approved",
            ),
        )
        second_response = client.post(
            "/",
            json=_build_tool_approval_resolve_request(
                run_id="run-dup",
                tool_call_id="call-dup",
                decision="rejected",
            ),
        )

    assert first_response.status_code == 200
    payload = second_response.json()
    assert second_response.status_code == 404
    assert payload["error"]["code"] == "run_not_found"
    assert payload["error"]["requestedMethod"] == "tool-approval/resolve"



def _build_policy(
    *,
    model: str,
    enabled_tools: list[str] | None = None,
    debug_mode_enabled: bool = False,
    request_options: dict[str, object] | None = None,
    thinking_selection: dict[str, object] | None = None,
    thinking_capability_override: dict[str, object] | None = None,
) -> dict[str, object]:
    policy: dict[str, object] = {
        "modelRoute": {
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": model,
            },
        },
        "enabledTools": list(enabled_tools or []),
        "debugModeEnabled": debug_mode_enabled,
        "requestOptions": dict(request_options or {}),
    }
    if thinking_selection is not None:
        policy["thinkingSelection"] = dict(thinking_selection)
    if thinking_capability_override is not None:
        policy["thinkingCapabilityOverride"] = dict(thinking_capability_override)
    return policy



def _parse_sse_events(raw_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for chunk in raw_text.strip().split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
        if not lines:
            continue
        payload = "\n".join(line[6:] for line in lines)
        events.append(json.loads(payload))
    return events
