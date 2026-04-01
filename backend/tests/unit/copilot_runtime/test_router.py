from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.copilot_runtime import (
    RuntimeBridge,
    RuntimeScaffold,
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
    build_default_agent_registry,
    build_default_tool_registry,
    build_router,
    build_runtime_scaffold,
)
from app.copilot_runtime.agent_registry import AgentDescriptor, AgentRegistry
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute
from app.copilot_runtime.session_store import InMemorySessionStore


TEST_MODEL_REPLY = "Hello from the test model."
SUPPORTED_METHODS = [
    "agents/list",
    "session/create",
    "capabilities/get",
    "message/send",
]


class _ImmediateTextStream:
    def __init__(self, *, output: str, resolved_model_id: str) -> None:
        self.resolved_model_id = resolved_model_id
        self._output = output

    async def __aenter__(self) -> "_ImmediateTextStream":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_deltas(self):
        yield self._output

    async def get_output(self) -> str:
        return self._output


class _PermissiveExecutor:
    def __init__(self, *, reply: str) -> None:
        self.model_configured = True
        self.model_environment_keys: tuple[str, ...] = ()
        self._reply = reply

    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: list[str] | tuple[str, ...] = (),
        request_options: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        return _ImmediateTextStream(output=self._reply, resolved_model_id=model_route.model_id)


class _RecordingExecutor(_PermissiveExecutor):
    def __init__(self, *, reply: str) -> None:
        super().__init__(reply=reply)
        self.calls: list[dict[str, object]] = []

    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: list[str] | tuple[str, ...] = (),
        request_options: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "resolved_model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "request_options": dict(request_options or {}),
            }
        )
        return super().open_text_stream(
            agent_name=agent_name,
            user_prompt=user_prompt,
            message_history=message_history,
            model_route=model_route,
            enabled_tools=enabled_tools,
            request_options=request_options,
        )


class _EchoModelRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider=model_route.snapshot.provider,
            endpoint_type=model_route.snapshot.endpoint_type,
            base_url=model_route.snapshot.base_url,
            model_id=model_route.snapshot.model_id,
            api_key="test-api-key",
        )



def test_root_post_agents_list_returns_backend_agent_directory() -> None:
    app, scaffold, _ = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "agents/list"})

    assert response.status_code == 200
    assert response.json() == scaffold.build_agents_list_response().to_dict()



def test_root_post_session_create_returns_bound_agent_session_payload() -> None:
    app, scaffold, store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "session/create", "body": {"agentId": "default"}})

    payload = response.json()
    session = store.get(payload["sessionId"])

    assert response.status_code == 200
    assert session is not None
    assert payload == scaffold.build_session_create_response(session=session).to_dict()
    assert payload["capabilities"] == {
        "tools": {
            "selectionMode": "recommendation-only",
            "recommendedTools": ["tool.file-convert"],
        }
    }



def test_root_post_capabilities_get_returns_bound_agent_recommendations_and_tool_catalog() -> None:
    app, scaffold, store = _build_app()
    session = store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={"method": "capabilities/get", "body": {"sessionId": session.session_id}},
        )

    payload = response.json()

    assert response.status_code == 200
    assert payload == scaffold.build_capabilities_response(session=session).to_dict()
    assert payload["recommendedTools"] == ["tool.file-convert"]
    assert payload["toolSelectionMode"] == "recommendation-only"
    assert payload["tools"][0]["toolId"] == "tool.file-convert"
    assert payload["capabilitiesVersion"] == "capabilities:agents-v1:tools-v1"



def test_root_post_capabilities_get_unknown_session_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={"method": "capabilities/get", "body": {"sessionId": "missing-session"}},
        )

    payload = response.json()

    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "session_not_found"
    assert payload["error"]["requestedMethod"] == "capabilities/get"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"sessionId": "missing-session"}



def test_root_post_capabilities_get_unknown_agent_returns_structured_error() -> None:
    app, _scaffold, store = _build_app()
    store.create(bound_agent_id="missing-agent", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={"method": "capabilities/get", "body": {"sessionId": "session-1"}},
        )

    payload = response.json()

    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_not_found"
    assert payload["error"]["requestedMethod"] == "capabilities/get"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"agentName": "missing-agent"}



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



def test_root_post_invalid_method_shape_returns_structured_bad_request() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": 123})

    payload = response.json()

    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_request"
    assert payload["error"]["requestedMethod"] is None
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["stage"] == "phase3-run-bridge"



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



def test_root_post_legacy_agent_run_returns_method_not_implemented() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "agent/run"})

    payload = response.json()

    assert response.status_code == 501
    assert payload["ok"] is False
    assert payload["error"]["code"] == "method_not_implemented"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS



def test_root_post_legacy_agent_connect_returns_method_not_implemented() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": "agent/connect"})

    payload = response.json()

    assert response.status_code == 501
    assert payload["ok"] is False
    assert payload["error"]["code"] == "method_not_implemented"
    assert payload["error"]["requestedMethod"] == "agent/connect"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS



def test_root_post_message_send_streams_typed_events_and_persists_history() -> None:
    app, _scaffold, store, executor = _build_app_with_recording_executor()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                model="gpt-4.1",
                enabled_tools=["tool.file-convert"],
                request_options={"temperature": 0.2},
            ),
        )

    events = _parse_sse_events(response.text)
    completed = events[-1]["payload"]
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["type"] for event in events] == [
        "run_started",
        "text_delta",
        "run_completed",
    ]
    assert events[1]["payload"]["delta"] == TEST_MODEL_REPLY
    assert completed["resolvedModelId"] == "gpt-4.1"
    assert completed["resolvedToolIds"] == ["tool.file-convert"]
    assert completed["requestOptions"] == {"temperature": 0.2}
    assert completed["resolvedModelRoute"] == {
        "providerProfileId": "provider-1",
        "snapshot": {
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
    }
    assert executor.calls == [
        {
            "agent_name": "default",
            "user_prompt": "Hello",
            "message_history": [],
            "resolved_model_id": "gpt-4.1",
            "enabled_tools": ["tool.file-convert"],
            "request_options": {"temperature": 0.2},
        }
    ]
    assert [(message.role, message.content) for message in store.list_messages("session-1")] == [
        ("user", "Hello"),
        ("assistant", TEST_MODEL_REPLY),
    ]



def test_root_post_message_send_agent_mismatch_streams_failed_terminal_event() -> None:
    app, _scaffold, store = _build_app_with_secondary_agent()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                agent_id="secondary",
                model="gpt-4.1",
            ),
        )

    events = _parse_sse_events(response.text)
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



def test_root_post_message_send_unknown_tool_streams_failed_terminal_event() -> None:
    app, _scaffold, store = _build_app()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                model="gpt-4.1",
                enabled_tools=["tool.missing"],
            ),
        )

    events = _parse_sse_events(response.text)
    assert response.status_code == 200
    assert [event["type"] for event in events] == ["run_started", "run_failed"]
    assert events[-1]["payload"] == {
        "code": "tool_not_found",
        "message": "Unknown tool 'tool.missing'.",
        "details": {"toolId": "tool.missing"},
    }



def test_root_post_message_send_intersects_requested_tools_with_available_tools() -> None:
    app, _scaffold, store, executor = _build_app_with_unavailable_tool_catalog()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                model="gpt-4.1",
                enabled_tools=["tool.file-convert", "tool.disabled"],
            ),
        )

    events = _parse_sse_events(response.text)
    assert response.status_code == 200
    assert [event["type"] for event in events] == [
        "run_started",
        "text_delta",
        "run_completed",
    ]
    assert events[-1]["payload"]["resolvedToolIds"] == ["tool.file-convert"]
    assert executor.calls[0]["enabled_tools"] == ["tool.file-convert"]



def test_root_post_message_send_unsupported_message_shape_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "method": "message/send",
                "body": {
                    "sessionId": "session-1",
                    "message": {"role": "assistant", "content": "ignored"},
                    "policy": {
                        "modelRoute": {
                            "providerProfileId": "provider-1",
                            "snapshot": {
                                "provider": "openai",
                                "endpointType": "openai-compatible",
                                "baseUrl": "https://example.com/v1",
                                "modelId": "gpt-4.1",
                            },
                        }
                    },
                },
            },
        )

    payload = response.json()
    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "unsupported_message_shape"
    assert payload["error"]["requestedMethod"] == "message/send"



def test_root_post_message_send_requires_explicit_body_wrapper() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "method": "message/send",
                "sessionId": "session-1",
            },
        )

    payload = response.json()
    assert response.status_code == 400
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_request"
    assert payload["error"]["requestedMethod"] == "message/send"
    assert payload["error"]["details"] == {"field": "body"}



def _build_runtime_bridge(
    *,
    store: InMemorySessionStore,
    agent_registry: AgentRegistry,
    scaffold: RuntimeScaffold,
) -> RuntimeBridge:
    return RuntimeBridge(
        session_store=store,
        agent_registry=agent_registry,
        scaffold=scaffold,
        message_run_orchestrator=RuntimeMessageRunOrchestrator(
            session_store=store,
            agent_registry=agent_registry,
            scaffold=scaffold,
            model_route_resolver=_EchoModelRouteResolver(),
        ),
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
    app.include_router(build_router(scaffold, store, bridge))
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
    app.include_router(build_router(scaffold, store, bridge))
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
    app.include_router(build_router(scaffold, store, bridge))
    return app, scaffold, store, executor



def _build_app_with_unavailable_tool_catalog() -> tuple[
    FastAPI,
    RuntimeScaffold,
    InMemorySessionStore,
    _RecordingExecutor,
]:
    executor = _RecordingExecutor(reply=TEST_MODEL_REPLY)
    store = InMemorySessionStore()
    tool_registry = ToolRegistry(
        [
            ToolsetDescriptor(
                name="default",
                label="Default",
                description="Default tool catalog.",
                default=True,
                tools=(
                    ToolDescriptor(
                        tool_id="tool.file-convert",
                        kind="builtin",
                        display_name="File Convert",
                        availability="available",
                    ),
                    ToolDescriptor(
                        tool_id="tool.disabled",
                        kind="external",
                        display_name="Disabled Tool",
                        availability="disabled-by-global-setting",
                    ),
                ),
            )
        ]
    )
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
    app.include_router(build_router(scaffold, store, bridge))
    return app, scaffold, store, executor



def _build_message_send_request(
    *,
    session_id: str,
    model: str,
    user_text: str = "Hello",
    agent_id: str | None = "default",
    enabled_tools: list[str] | None = None,
    request_options: dict[str, object] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "sessionId": session_id,
        "message": {"role": "user", "content": user_text},
        "policy": {
            "modelRoute": {
                "providerProfileId": "provider-1",
                "snapshot": {
                    "provider": "openai",
                    "endpointType": "openai-compatible",
                    "baseUrl": "https://example.com/v1",
                    "modelId": model,
                },
            },
            "enabledTools": list(enabled_tools or []),
            "requestOptions": dict(request_options or {}),
        },
    }
    if agent_id is not None:
        body["agent"] = agent_id
    return {"method": "message/send", "body": body}



def _parse_sse_events(raw_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for chunk in raw_text.strip().split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
        if not lines:
            continue
        payload = "\n".join(line[6:] for line in lines)
        events.append(json.loads(payload))
    return events
