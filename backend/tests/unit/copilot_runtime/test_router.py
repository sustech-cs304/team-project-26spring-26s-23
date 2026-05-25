from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, cast

import pytest
from pydantic_ai.messages import ModelMessage
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.copilot_runtime import (
    RuntimeBridge,
    RuntimeScaffold,
    RuntimeToolPermissionPolicy,
    build_default_agent_registry,
    build_default_tool_registry,
    build_router,
    build_runtime_scaffold,
)
from app.copilot_runtime.agent_registry import AgentRegistry
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
)
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
    def __init__(
        self,
        *,
        events: list[RuntimeExecutionEvent],
        output: str,
        resolved_model_id: str,
    ) -> None:
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
        _ = (
            agent_name,
            user_prompt,
            message_history,
            model,
            enabled_tools,
            request_options,
        )
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


class _EchoModelRouteResolver:
    async def resolve(
        self, model_route: RuntimeModelRoute
    ) -> ResolvedRuntimeModelRoute:
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


def _build_text_execution_events(
    *, run_id: str, text: str
) -> list[RuntimeExecutionEvent]:
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


def test_root_post_thread_get_returns_bound_agent_recommendations_and_tool_catalog() -> (
    None
):
    app, scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="thread-1")

    with TestClient(app) as client:
        response = client.post(
            "/", json=_build_thread_get_request(thread_id=thread.thread_id)
        )

    payload = response.json()

    assert response.status_code == 200
    assert payload == scaffold.build_thread_get_response(thread=thread).to_dict()
    assert payload["recommendedTools"] == ["tool.fs.read"]
    assert payload["toolSelectionMode"] == "recommendation-only"
    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.fs.read" in tool_ids
    assert payload["capabilitiesVersion"] == "capabilities:agents-v1:tools-v1"
    assert payload["latestRunId"] is None
    assert scaffold.tool_registry.get_default().name == "default"


def test_root_post_thread_get_unknown_thread_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/", json=_build_thread_get_request(thread_id="missing-thread")
        )

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

def test_scaffold_capabilities_response_filters_denied_tools_from_catalog() -> None:
    _app, scaffold, store = _build_app()
    thread = store.create_thread(bound_agent_id="default", thread_id="session-deny")

    payload = scaffold.build_capabilities_response(
        thread=thread,
        tool_permission_resolver=RuntimeToolPermissionResolver.from_policy(
            RuntimeToolPermissionPolicy(
                schemaVersion=1,
                defaultMode="allow",
                toolModes={"tool.fs.read": "deny"},
            )
        ),
    ).to_dict()

    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.fs.read" not in tool_ids
    assert "tool.weather-current" in tool_ids
    assert payload["recommendedTools"] == []


def test_root_post_capabilities_get_unknown_session_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/", json=_build_capabilities_get_request(session_id="missing-session")
        )

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
    assert "tool.fs.read" in tool_ids

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
