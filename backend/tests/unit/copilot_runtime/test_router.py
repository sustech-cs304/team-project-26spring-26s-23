from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app.copilot_runtime import (
    AgentExecutionError,
    PydanticAIAgentExecutor,
    RuntimeBridge,
    RuntimeBridgeResult,
    RuntimeRunRequest,
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
from app.copilot_runtime.session_store import InMemorySessionStore, RuntimeTextMessage


TEST_MODEL_REPLY = "Hello from the test model."
SUPPORTED_METHODS = [
    "info",
    "agents/list",
    "session/create",
    "capabilities/get",
    "message/send",
    "agent/connect",
    "agent/run",
]


def test_root_post_info_request_returns_runtime_info() -> None:
    app, scaffold, _ = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "method": "info",
                "properties": {"mode": "desktop"},
                "frontendUrl": "http://localhost:5173",
            },
        )

    payload = response.json()

    assert response.status_code == 200
    assert payload == scaffold.build_info_response().to_dict()
    assert list(payload["agents"]) == ["default"]


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

    assert response.status_code == 404
    payload = response.json()
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

    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_not_found"
    assert payload["error"]["requestedMethod"] == "capabilities/get"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"agentName": "missing-agent"}


def test_root_post_info_shape_without_method_is_recognized() -> None:
    app, scaffold, _ = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "properties": {"mode": "desktop"},
                "frontendUrl": "http://localhost:5173",
            },
        )

    assert response.status_code == 200
    assert response.json() == scaffold.build_info_response().to_dict()


def test_root_post_run_like_request_is_recognized_and_streamed() -> None:
    app, _, store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={
                "threadId": "thread-1",
                "runId": "run-1",
                "messages": [_build_user_message("Hello")],
                "state": {"mode": "chat"},
            },
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(response.text)
    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "STATE_SNAPSHOT",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]
    assert events[-1]["result"]["agentName"] == "default"
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "Hello"),
        ("assistant", TEST_MODEL_REPLY),
    ]


def test_root_post_invalid_method_shape_returns_structured_bad_request() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json={"method": 123})

    assert response.status_code == 400

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_request"
    assert payload["error"]["requestedMethod"] is None
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["stage"] == "phase3-run-bridge"


def test_root_post_agent_connect_returns_sse_connect_result() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_connect_request(state={"mode": "connect"}))

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(response.text)
    assert events[-1]["result"]["session"]["metadata"] == {"last_connect_run_id": "run-1"}


def test_root_post_agent_connect_unknown_agent_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_connect_request(agent_id="missing-agent"))

    assert response.status_code == 404

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_not_found"
    assert payload["error"]["requestedMethod"] == "agent/connect"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS
    assert payload["error"]["details"] == {"agentName": "missing-agent"}


def test_root_post_agent_connect_existing_thread_is_reused() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        first_response = client.post("/", json=_build_connect_request(run_id="run-1"))
        second_response = client.post("/", json=_build_connect_request(run_id="run-2"))

    first_events = _parse_sse_events(first_response.text)
    second_events = _parse_sse_events(second_response.text)
    first_session = first_events[-1]["result"]["session"]
    second_session = second_events[-1]["result"]["session"]

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_session["threadId"] == "thread-1"
    assert second_session["newlyCreated"] is False
    assert second_session["createdAt"] == first_session["createdAt"]
    assert second_session["metadata"] == {"last_connect_run_id": "run-2"}


def test_root_post_agent_connect_rebinding_existing_thread_returns_agent_mismatch() -> None:
    app, _scaffold, _store = _build_app_with_secondary_agent()

    with TestClient(app) as client:
        client.post("/", json=_build_connect_request(agent_id="default", run_id="run-1"))
        response = client.post("/", json=_build_connect_request(agent_id="secondary", run_id="run-2"))

    payload = response.json()

    assert response.status_code == 409
    assert payload["error"]["code"] == "agent_mismatch"
    assert payload["error"]["details"] == {
        "sessionId": "thread-1",
        "boundAgentId": "default",
        "requestedAgentId": "secondary",
    }


def test_root_post_message_send_returns_request_scoped_resolution() -> None:
    app, _scaffold, store, executor = _build_app_with_recording_executor()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                model="openai/gpt-4.1",
                enabled_tools=["tool.file-convert"],
                request_options={"temperature": 0.2},
            ),
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["sessionId"] == "session-1"
    assert payload["boundAgent"]["agentId"] == "default"
    assert payload["resolvedModelId"] == "openai/gpt-4.1"
    assert payload["resolvedToolIds"] == ["tool.file-convert"]
    assert payload["requestOptions"] == {"temperature": 0.2}
    assert payload["assistantMessage"] == {"role": "assistant", "content": TEST_MODEL_REPLY}
    assert executor.calls == [
        {
            "agent_name": "default",
            "user_prompt": "Hello",
            "message_history": [],
            "model": "openai/gpt-4.1",
            "enabled_tools": ["tool.file-convert"],
            "request_options": {"temperature": 0.2},
        }
    ]
    assert [(message.role, message.content) for message in store.list_messages("session-1")] == [
        ("user", "Hello"),
        ("assistant", TEST_MODEL_REPLY),
    ]


def test_root_post_message_send_agent_mismatch_returns_conflict() -> None:
    app, _scaffold, store = _build_app_with_secondary_agent()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                agent_id="secondary",
                model="openai/gpt-4.1",
            ),
        )

    payload = response.json()
    assert response.status_code == 409
    assert payload["error"]["code"] == "agent_mismatch"
    assert payload["error"]["requestedMethod"] == "message/send"
    assert payload["error"]["details"] == {
        "sessionId": "session-1",
        "boundAgentId": "default",
        "requestedAgentId": "secondary",
    }


def test_root_post_message_send_unknown_tool_returns_structured_error() -> None:
    app, _scaffold, store = _build_app()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                model="openai/gpt-4.1",
                enabled_tools=["tool.missing"],
            ),
        )

    payload = response.json()
    assert response.status_code == 400
    assert payload["error"]["code"] == "tool_not_found"
    assert payload["error"]["requestedMethod"] == "message/send"
    assert payload["error"]["details"] == {"toolId": "tool.missing"}


def test_root_post_message_send_intersects_requested_tools_with_available_tools() -> None:
    app, _scaffold, store, executor = _build_app_with_unavailable_tool_catalog()
    store.create(bound_agent_id="default", session_id="session-1")

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_message_send_request(
                session_id="session-1",
                model="openai/gpt-4.1",
                enabled_tools=["tool.file-convert", "tool.disabled"],
            ),
        )

    payload = response.json()
    assert response.status_code == 200
    assert payload["resolvedToolIds"] == ["tool.file-convert"]
    assert executor.calls[0]["enabled_tools"] == ["tool.file-convert"]


def test_root_post_agent_run_success_persists_history_across_same_thread() -> None:
    app, _scaffold, store = _build_app()

    with TestClient(app) as client:
        first_response = client.post("/", json=_build_run_request(run_id="run-1", user_text="Hello"))
        second_response = client.post("/", json=_build_run_request(run_id="run-2", user_text="Again"))

    first_events = _parse_sse_events(first_response.text)
    second_events = _parse_sse_events(second_response.text)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_events[-1]["result"]["session"]["newlyCreated"] is True
    assert second_events[-1]["result"]["session"]["newlyCreated"] is False
    assert second_events[-1]["result"]["session"]["metadata"] == {"last_run_id": "run-2"}
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "Hello"),
        ("assistant", TEST_MODEL_REPLY),
        ("user", "Again"),
        ("assistant", TEST_MODEL_REPLY),
    ]


def test_root_post_agent_run_unknown_agent_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_request(agent_id="missing-agent", user_text="Hello"))

    assert response.status_code == 404
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_not_found"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["details"] == {"agentName": "missing-agent"}


def test_root_post_agent_run_model_not_configured_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app(agent_executor=PydanticAIAgentExecutor(env={}))

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_request(user_text="Hello"))

    assert response.status_code == 503
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "model_not_configured"
    assert payload["error"]["requestedMethod"] == "agent/run"


def test_root_post_agent_run_corrupted_session_history_returns_structured_conflict() -> None:
    app, _scaffold, store = _build_app()
    session, _ = store.get_or_create(
        session_id="thread-1",
        bound_agent_id="default",
        metadata={"last_run_id": "run-0"},
    )
    session.messages.append(RuntimeTextMessage(role="assistant", content="orphan assistant"))

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_request(user_text="Hello"))

    assert response.status_code == 409
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_message_history"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS


def test_root_post_agent_run_rebinding_existing_thread_returns_agent_mismatch() -> None:
    app, _scaffold, store = _build_app_with_secondary_agent()
    store.create(bound_agent_id="default", session_id="thread-1")

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_request(agent_id="secondary", user_text="Hello"))

    assert response.status_code == 409
    payload = response.json()
    assert payload["error"]["code"] == "agent_mismatch"
    assert payload["error"]["details"] == {
        "sessionId": "thread-1",
        "boundAgentId": "default",
        "requestedAgentId": "secondary",
    }


def test_root_post_agent_run_agent_execution_failure_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app(
        runtime_bridge=_ExplodingRuntimeBridge(AgentExecutionError("executor boom"))
    )

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_request(user_text="Hello"))

    assert response.status_code == 500
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_execution_failed"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["supportedMethods"] == SUPPORTED_METHODS


def test_root_post_agent_run_unsupported_message_shape_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_run_request(
                user_text="ignored",
                body_overrides={
                    "messages": [
                        {
                            "id": "u1",
                            "role": "user",
                            "content": [
                                {
                                    "type": "binary",
                                    "mimeType": "text/plain",
                                    "url": "https://example.com/file.txt",
                                }
                            ],
                        }
                    ]
                },
            ),
        )

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "unsupported_message_shape"
    assert payload["error"]["requestedMethod"] == "agent/run"


class _ExplodingRuntimeBridge(RuntimeBridge):
    def __init__(self, error: Exception) -> None:
        self._error = error

    async def run(self, *, request: RuntimeRunRequest) -> RuntimeBridgeResult:
        raise self._error


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
        message_history: list[object],
        model: object | None = None,
        enabled_tools: list[str] | tuple[str, ...] = (),
        request_options: dict[str, object] | None = None,
    ) -> str:
        return self._reply


class _RecordingExecutor(_PermissiveExecutor):
    def __init__(self, *, reply: str) -> None:
        super().__init__(reply=reply)
        self.calls: list[dict[str, object]] = []

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model: object | None = None,
        enabled_tools: list[str] | tuple[str, ...] = (),
        request_options: dict[str, object] | None = None,
    ) -> str:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model": model,
                "enabled_tools": list(enabled_tools),
                "request_options": dict(request_options or {}),
            }
        )
        return await super().run(
            agent_name=agent_name,
            user_prompt=user_prompt,
            message_history=message_history,
            model=model,
            enabled_tools=enabled_tools,
            request_options=request_options,
        )


def _build_app(
    *,
    agent_executor: PydanticAIAgentExecutor | None = None,
    runtime_bridge: RuntimeBridge | None = None,
) -> tuple[FastAPI, RuntimeScaffold, InMemorySessionStore]:
    executor = agent_executor or PydanticAIAgentExecutor(
        model=TestModel(custom_output_text=TEST_MODEL_REPLY)
    )
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
    bridge = runtime_bridge or RuntimeBridge(
        session_store=store,
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
    bridge = RuntimeBridge(session_store=store, agent_registry=registry, scaffold=scaffold)
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
    bridge = RuntimeBridge(session_store=store, agent_registry=agent_registry, scaffold=scaffold)
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
    bridge = RuntimeBridge(session_store=store, agent_registry=agent_registry, scaffold=scaffold)
    app = FastAPI()
    app.include_router(build_router(scaffold, store, bridge))
    return app, scaffold, store, executor


def _build_connect_request(
    *,
    agent_id: str = "default",
    thread_id: str = "thread-1",
    run_id: str = "run-1",
    state: dict[str, object] | None = None,
    body_overrides: dict[str, object] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "threadId": thread_id,
        "runId": run_id,
        "messages": [],
        "state": state or {},
        "tools": [],
        "context": [],
        "forwardedProps": {},
    }
    if body_overrides:
        body.update(body_overrides)

    return {
        "method": "agent/connect",
        "params": {"agentId": agent_id},
        "body": body,
    }


def _build_run_request(
    *,
    agent_id: str = "default",
    thread_id: str = "thread-1",
    run_id: str = "run-1",
    user_text: str,
    state: dict[str, object] | None = None,
    body_overrides: dict[str, object] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "threadId": thread_id,
        "runId": run_id,
        "messages": [_build_user_message(user_text)],
        "state": state or {},
        "actions": [],
        "metaEvents": [],
        "forwardedProps": {},
    }
    if body_overrides:
        body.update(body_overrides)

    return {
        "method": "agent/run",
        "params": {"agentId": agent_id},
        "body": body,
    }


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
        "model": model,
        "enabledTools": list(enabled_tools or []),
        "requestOptions": dict(request_options or {}),
    }
    if agent_id is not None:
        body["agent"] = agent_id
    return {"method": "message/send", "body": body}


def _build_user_message(user_text: str) -> dict[str, Any]:
    return {
        "id": "user-message-1",
        "role": "user",
        "content": user_text,
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
