from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app.copilot_runtime import (
    PydanticAIAgentExecutor,
    RuntimeBridge,
    RuntimeScaffold,
    build_router,
    build_runtime_scaffold,
)
from app.copilot_runtime.session_store import InMemorySessionStore


TEST_MODEL_REPLY = "Hello from the test model."


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

    assert response.status_code == 200
    assert response.json() == scaffold.build_info_response().to_dict()


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
    assert events[2]["role"] == "assistant"
    assert events[3]["delta"] == TEST_MODEL_REPLY
    assert events[-1]["result"]["ok"] is True
    assert events[-1]["result"]["agentName"] == "default"
    assert events[-1]["result"]["output"] == TEST_MODEL_REPLY
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
    assert payload["error"]["code"] == "invalid_runtime_request"
    assert payload["error"]["requestedMethod"] is None
    assert payload["error"]["supportedMethods"] == ["info", "agent/connect", "agent/run"]
    assert payload["error"]["stage"] == "phase3-run-bridge"


def test_root_post_agent_connect_returns_sse_connect_result() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_connect_request(state={"mode": "connect"}),
        )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = _parse_sse_events(response.text)
    assert events == [
        {
            "type": "RUN_STARTED",
            "threadId": "thread-1",
            "runId": "run-1",
        },
        {
            "type": "STATE_SNAPSHOT",
            "snapshot": {"mode": "connect"},
        },
        {
            "type": "MESSAGES_SNAPSHOT",
            "messages": [],
        },
        {
            "type": "RUN_FINISHED",
            "threadId": "thread-1",
            "runId": "run-1",
            "result": {
                "ok": True,
                "threadId": "thread-1",
                "runId": "run-1",
                "agentName": "default",
                "session": {
                    "threadId": "thread-1",
                    "agentName": "default",
                    "createdAt": events[3]["result"]["session"]["createdAt"],
                    "updatedAt": events[3]["result"]["session"]["updatedAt"],
                    "newlyCreated": True,
                    "metadata": {"last_connect_run_id": "run-1"},
                },
            },
        },
    ]


def test_root_post_agent_connect_unknown_agent_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_connect_request(agent_id="missing-agent"),
        )

    assert response.status_code == 404

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_not_found"
    assert payload["error"]["requestedMethod"] == "agent/connect"
    assert payload["error"]["supportedMethods"] == ["info", "agent/connect", "agent/run"]
    assert payload["error"]["details"] == {"agentName": "missing-agent"}
    assert payload["error"]["message"] == "Unknown agent 'missing-agent'."


def test_root_post_agent_connect_missing_thread_id_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()
    request_payload = _build_connect_request()
    del request_payload["body"]["threadId"]

    with TestClient(app) as client:
        response = client.post("/", json=request_payload)

    assert response.status_code == 400

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_runtime_request"
    assert payload["error"]["requestedMethod"] == "agent/connect"
    assert payload["error"]["details"] == {"field": "threadId"}
    assert payload["error"]["message"] == "Runtime request field 'threadId' must be a non-empty string."


def test_root_post_agent_connect_invalid_messages_payload_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_connect_request(body_overrides={"messages": "invalid"}),
        )

    assert response.status_code == 400

    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_runtime_request"
    assert payload["error"]["requestedMethod"] == "agent/connect"
    assert payload["error"]["details"] == {"field": "messages"}
    assert payload["error"]["message"] == "Runtime request field 'messages' must be an array of objects."


def test_root_post_agent_connect_existing_thread_is_reused() -> None:
    app, _scaffold, _store = _build_app()

    with TestClient(app) as client:
        first_response = client.post("/", json=_build_connect_request(run_id="run-1"))
        second_response = client.post("/", json=_build_connect_request(run_id="run-2"))

    first_events = _parse_sse_events(first_response.text)
    second_events = _parse_sse_events(second_response.text)

    first_result = first_events[-1]["result"]
    second_result = second_events[-1]["result"]
    first_session = first_result["session"]
    second_session = second_result["session"]

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_session["threadId"] == "thread-1"
    assert second_session["threadId"] == "thread-1"
    assert first_session["newlyCreated"] is True
    assert second_session["newlyCreated"] is False
    assert second_session["createdAt"] == first_session["createdAt"]
    assert second_session["metadata"] == {"last_connect_run_id": "run-2"}
    assert second_result["runId"] == "run-2"


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
    assert payload["error"]["details"] == {
        "modelEnvironmentKeys": ["COPILOT_RUNTIME_MODEL", "COPILOT_MODEL"]
    }


def test_root_post_agent_run_missing_thread_id_returns_structured_error() -> None:
    app, _scaffold, _store = _build_app()
    request_payload = _build_run_request(user_text="Hello")
    del request_payload["body"]["threadId"]

    with TestClient(app) as client:
        response = client.post("/", json=request_payload)

    assert response.status_code == 400
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_runtime_request"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["details"] == {"field": "threadId"}


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
                            "content": [{"type": "binary", "mimeType": "text/plain", "url": "https://example.com/file.txt"}],
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


def _build_app(
    *,
    agent_executor: PydanticAIAgentExecutor | None = None,
) -> tuple[FastAPI, RuntimeScaffold, InMemorySessionStore]:
    executor = agent_executor or PydanticAIAgentExecutor(
        model=TestModel(custom_output_text=TEST_MODEL_REPLY)
    )
    store = InMemorySessionStore()
    bridge = RuntimeBridge(session_store=store, agent_executor=executor)
    scaffold = build_runtime_scaffold(
        session_store_type=store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
    )
    app = FastAPI()
    app.include_router(build_router(scaffold, store, bridge))
    return app, scaffold, store


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
