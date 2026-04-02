from __future__ import annotations

import json
from typing import Any

from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart

from app.copilot_runtime.agent import RuntimeToolLifecycleEvent
from app.copilot_runtime.contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    MESSAGE_SEND_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    SESSION_CREATE_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
)
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute
from app.copilot_runtime.session_store import (
    RuntimeStoredModelRoute,
    RuntimeStoredModelRouteSnapshot,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID
from app.desktop_runtime.server import create_app


class _ImmediateTextStream:
    def __init__(
        self,
        *,
        output: str,
        resolved_model_id: str,
        tool_events: list[RuntimeToolLifecycleEvent] | None = None,
    ) -> None:
        self.resolved_model_id = resolved_model_id
        self._output = output
        self._tool_events = list(tool_events or [])

    async def __aenter__(self) -> "_ImmediateTextStream":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_deltas(self):
        yield self._output

    async def get_output(self) -> str:
        return self._output

    def drain_tool_events(self) -> tuple[RuntimeToolLifecycleEvent, ...]:
        drained = tuple(self._tool_events)
        self._tool_events.clear()
        return drained


class CapturingStreamingExecutor:
    def __init__(
        self,
        *,
        outputs: list[str],
        model_configured: bool = True,
        tool_events_by_call: list[list[RuntimeToolLifecycleEvent]] | None = None,
    ) -> None:
        self.model_configured = model_configured
        self.model_environment_keys: tuple[str, ...] = (
            "COPILOT_RUNTIME_MODEL",
            "COPILOT_MODEL",
        )
        self._outputs = list(outputs)
        self._tool_events_by_call = [list(events) for events in (tool_events_by_call or [])]
        self.captured_calls: list[dict[str, object]] = []

    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        request_options: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        self.captured_calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "resolved_model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "request_options": dict(request_options or {}),
            }
        )
        tool_events = self._tool_events_by_call.pop(0) if self._tool_events_by_call else []
        return _ImmediateTextStream(
            output=self._outputs.pop(0),
            resolved_model_id=model_route.model_id,
            tool_events=tool_events,
        )


class _ResolvedRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider=model_route.snapshot.provider,
            endpoint_type=model_route.snapshot.endpoint_type,
            base_url=model_route.snapshot.base_url,
            model_id=model_route.snapshot.model_id,
            api_key="test-api-key",
        )


SUPPORTED_METHODS = [
    AGENTS_LIST_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    RUN_CANCEL_METHOD,
    SESSION_CREATE_METHOD,
    CAPABILITIES_GET_METHOD,
    MESSAGE_SEND_METHOD,
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



def test_post_root_session_first_flow_reuses_history_across_same_session() -> None:
    executor = CapturingStreamingExecutor(outputs=["First reply", "Second reply"])
    app = _create_app(executor)

    with TestClient(app) as client:
        agents_response = client.post("/", json={"method": "agents/list"})
        session_response = client.post("/", json=_build_session_create_request(agent_id="default"))
        session_payload = session_response.json()
        capabilities_response = client.post(
            "/",
            json=_build_capabilities_get_request(session_id=session_payload["sessionId"]),
        )
        first_response = client.post(
            "/",
            json=_build_message_send_request(
                session_id=session_payload["sessionId"],
                model_id="gpt-4.1",
                user_text="Hello",
            ),
        )
        second_response = client.post(
            "/",
            json=_build_message_send_request(
                session_id=session_payload["sessionId"],
                model_id="gpt-4.1",
                user_text="Follow up",
            ),
        )

    first_events = _parse_sse_events(first_response.text)
    second_events = _parse_sse_events(second_response.text)

    assert agents_response.status_code == 200
    assert session_response.status_code == 200
    assert capabilities_response.status_code == 200
    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert agents_response.json()["defaultAgentId"] == "default"
    assert capabilities_response.json()["sessionId"] == session_payload["sessionId"]
    assert [event["type"] for event in first_events] == ["run_started", "text_delta", "run_completed"]
    assert [event["type"] for event in second_events] == ["run_started", "text_delta", "run_completed"]
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



def test_post_root_message_send_succeeds_without_startup_model_when_route_is_present() -> None:
    app = _create_app(CapturingStreamingExecutor(outputs=["Route scoped reply"], model_configured=False))

    with TestClient(app) as client:
        session_response = client.post("/", json=_build_session_create_request(agent_id="default"))
        session_id = session_response.json()["sessionId"]
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id=session_id,
                model_id="gpt-4.1",
                user_text="Hello",
            ),
        )

    events = _parse_sse_events(response.text)

    assert session_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == ["run_started", "text_delta", "run_completed"]
    assert events[-1]["payload"]["assistantText"] == "Route scoped reply"



def test_post_root_message_send_emits_real_tool_lifecycle_events() -> None:
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
        session_response = client.post("/", json=_build_session_create_request(agent_id="default"))
        session_id = session_response.json()["sessionId"]
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id=session_id,
                model_id="gpt-4.1",
                user_text="Tell me the weather",
                enabled_tools=[WEATHER_CURRENT_TOOL_ID],
            ),
        )

    events = _parse_sse_events(response.text)

    assert session_response.status_code == 200
    assert response.status_code == 200
    assert [event["type"] for event in events] == [
        "run_started",
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    assert [event["payload"]["phase"] for event in events[1:3]] == ["started", "completed"]
    assert events[1]["payload"]["toolId"] == WEATHER_CURRENT_TOOL_ID
    assert events[2]["payload"]["resultSummary"] == "Shenzhen：晴 / 24°C / 湿度 60%"
    assert events[3]["payload"]["delta"] == "Weather answer"
    assert events[-1]["payload"]["assistantText"] == "Weather answer"
    assert events[-1]["payload"]["resolvedToolIds"] == [WEATHER_CURRENT_TOOL_ID]
    assert executor.captured_calls[0]["enabled_tools"] == [WEATHER_CURRENT_TOOL_ID]



def test_post_root_message_send_corrupted_session_history_returns_failed_event() -> None:
    app = _create_app(CapturingStreamingExecutor(outputs=["unused reply"]))

    with TestClient(app) as client:
        session_response = client.post("/", json=_build_session_create_request(agent_id="default"))
        session_id = session_response.json()["sessionId"]
        store = app.state.copilot_runtime_session_store
        store.create_run(
            thread_id=session_id,
            run_id="run-corrupted",
            request=RuntimeStoredRunInput(
                message_role="assistant",
                message_content="orphan assistant",
                policy=RuntimeStoredRunPolicy(
                    model_route=RuntimeStoredModelRoute(
                        provider_profile_id="provider-1",
                        snapshot=RuntimeStoredModelRouteSnapshot(
                            provider="openai",
                            endpoint_type="openai-compatible",
                            base_url="https://example.com/v1",
                            model_id="gpt-4.1",
                        ),
                    )
                ),
                agent_id="default",
            ),
        )
        store.mark_run_completed("run-corrupted", assistant_text="projected assistant reply")
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id=session_id,
                model_id="gpt-4.1",
                user_text="Hello again",
            ),
        )

    events = _parse_sse_events(response.text)

    assert response.status_code == 200
    assert [event["type"] for event in events] == ["run_started", "run_failed"]
    assert events[-1]["payload"]["code"] == "invalid_message_history"
    assert "expected role 'user'" in events[-1]["payload"]["message"]
    assert events[-1]["payload"]["details"] == {}



def _create_app(executor: CapturingStreamingExecutor):
    return create_app(
        agent_executor=executor,
        model_route_resolver=_ResolvedRouteResolver(),
    )



def _build_session_create_request(*, agent_id: str) -> dict[str, Any]:
    return {
        "method": "session/create",
        "body": {
            "agentId": agent_id,
        },
    }



def _build_capabilities_get_request(*, session_id: str) -> dict[str, Any]:
    return {
        "method": "capabilities/get",
        "body": {
            "sessionId": session_id,
        },
    }



def _build_message_send_request(
    *,
    session_id: str,
    model_id: str,
    user_text: str,
    enabled_tools: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "method": "message/send",
        "body": {
            "sessionId": session_id,
            "agent": "default",
            "message": {
                "role": "user",
                "content": user_text,
            },
            "policy": {
                "modelRoute": {
                    "providerProfileId": "provider-1",
                    "snapshot": {
                        "provider": "openai",
                        "endpointType": "openai-compatible",
                        "baseUrl": "https://example.com/v1",
                        "modelId": model_id,
                    },
                },
                "enabledTools": list(enabled_tools or []),
                "requestOptions": {},
            },
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
