from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart

from app.copilot_runtime import PydanticAIAgentExecutor
from app.copilot_runtime.session_store import RuntimeTextMessage
from app.desktop_runtime.server import create_app


def test_post_root_info_returns_runtime_summary() -> None:
    app = create_app(agent_executor=_build_stubbed_executor(outputs=["unused reply"]))

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
    assert payload["protocol"] == "single-endpoint"
    assert payload["defaultAgent"] == "default"
    assert payload["supportedMethods"] == ["info", "agent/connect", "agent/run"]


def test_post_root_agent_connect_returns_connect_sse_result() -> None:
    app = create_app(agent_executor=_build_stubbed_executor(outputs=["unused reply"]))

    with TestClient(app) as client:
        response = client.post("/", json=_build_connect_request(thread_id="thread-http", run_id="connect-1"))

    events = _parse_sse_events(response.text)
    result = events[-1]["result"]

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert [event["type"] for event in events] == [
        "RUN_STARTED",
        "STATE_SNAPSHOT",
        "MESSAGES_SNAPSHOT",
        "RUN_FINISHED",
    ]
    assert result["ok"] is True
    assert result["threadId"] == "thread-http"
    assert result["runId"] == "connect-1"
    assert result["agentName"] == "default"
    assert result["session"]["newlyCreated"] is True
    assert result["session"]["metadata"] == {"last_connect_run_id": "connect-1"}


def test_post_root_agent_run_reuses_history_across_same_thread() -> None:
    executor = _build_stubbed_executor(outputs=["First reply", "Second reply"])
    app = create_app(agent_executor=executor)

    with TestClient(app) as client:
        first_response = client.post(
            "/",
            json=_build_run_request(thread_id="thread-http", run_id="run-1", user_text="Hello"),
        )
        second_response = client.post(
            "/",
            json=_build_run_request(thread_id="thread-http", run_id="run-2", user_text="Follow up"),
        )

    first_events = _parse_sse_events(first_response.text)
    second_events = _parse_sse_events(second_response.text)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert first_events[-1]["result"]["output"] == "First reply"
    assert second_events[-1]["result"]["output"] == "Second reply"
    assert first_events[-1]["result"]["session"]["newlyCreated"] is True
    assert second_events[-1]["result"]["session"]["newlyCreated"] is False
    assert second_events[-1]["result"]["session"]["metadata"] == {"last_run_id": "run-2"}

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

def test_post_root_agent_run_model_not_configured_returns_structured_error() -> None:
    app = create_app(agent_executor=PydanticAIAgentExecutor(env={}))

    with TestClient(app) as client:
        response = client.post("/", json=_build_run_request(thread_id="thread-http", run_id="run-1", user_text="Hello"))

    payload = response.json()

    assert response.status_code == 503
    assert payload["ok"] is False
    assert payload["error"]["code"] == "model_not_configured"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["supportedMethods"] == ["info", "agent/connect", "agent/run"]
    assert payload["error"]["stage"] == "phase3-run-bridge"
    assert payload["error"]["details"] == {
        "modelEnvironmentKeys": ["COPILOT_RUNTIME_MODEL", "COPILOT_MODEL"]
    }



def test_post_root_agent_run_unknown_agent_returns_structured_not_found_error() -> None:
    app = create_app(agent_executor=_build_stubbed_executor(outputs=["unused reply"]))

    with TestClient(app) as client:
        response = client.post(
            "/",
            json=_build_run_request(
                thread_id="thread-http",
                run_id="run-1",
                user_text="Hello",
                agent_id="missing-agent",
            ),
        )

    payload = response.json()

    assert response.status_code == 404
    assert payload["ok"] is False
    assert payload["error"]["code"] == "agent_not_found"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["supportedMethods"] == ["info", "agent/connect", "agent/run"]
    assert payload["error"]["stage"] == "phase3-run-bridge"
    assert payload["error"]["details"] == {"agentName": "missing-agent"}
    assert payload["error"]["message"] == "Unknown agent 'missing-agent'."



def test_post_root_agent_run_corrupted_session_history_returns_explicit_error() -> None:
    app = create_app(agent_executor=_build_stubbed_executor(outputs=["unused reply"]))

    with TestClient(app) as client:
        store = app.state.copilot_runtime_session_store
        session, _ = store.get_or_create(
            thread_id="thread-http",
            agent_name="default",
            metadata={"last_run_id": "run-1"},
        )
        session.messages.append(RuntimeTextMessage(role="assistant", content="orphan assistant"))
        response = client.post(
            "/",
            json=_build_run_request(thread_id="thread-http", run_id="run-2", user_text="Hello again"),
        )

    payload = response.json()

    assert response.status_code == 409
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_message_history"
    assert payload["error"]["requestedMethod"] == "agent/run"
    assert payload["error"]["supportedMethods"] == ["info", "agent/connect", "agent/run"]
    assert payload["error"]["stage"] == "phase3-run-bridge"
    assert payload["error"]["details"] == {}
    assert "expected role 'user'" in payload["error"]["message"]



class CapturingExecutor(PydanticAIAgentExecutor):
    def __init__(self, *, outputs: list[str]) -> None:
        super().__init__(model="stub-model")
        self._outputs = list(outputs)
        self.captured_calls: list[dict[str, object]] = []



def _build_stubbed_executor(*, outputs: list[str]) -> CapturingExecutor:
    executor = CapturingExecutor(outputs=outputs)

    async def fake_run(
        user_prompt: str,
        *,
        message_history: list[object],
        model: object,
    ) -> SimpleNamespace:
        executor.captured_calls.append(
            {
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model": model,
            }
        )
        return SimpleNamespace(output=executor._outputs.pop(0))

    executor._agent.run = fake_run  # type: ignore[method-assign]
    return executor



def _build_connect_request(*, thread_id: str, run_id: str) -> dict[str, Any]:
    return {
        "method": "agent/connect",
        "params": {"agentId": "default"},
        "body": {
            "threadId": thread_id,
            "runId": run_id,
            "messages": [],
            "state": {"mode": "connect"},
            "tools": [],
            "context": [],
            "forwardedProps": {},
        },
    }



def _build_run_request(
    *,
    thread_id: str,
    run_id: str,
    user_text: str,
    agent_id: str = "default",
) -> dict[str, Any]:
    return {
        "method": "agent/run",
        "params": {"agentId": agent_id},
        "body": {
            "threadId": thread_id,
            "runId": run_id,
            "messages": [
                {
                    "id": f"{run_id}:user",
                    "role": "user",
                    "content": user_text,
                }
            ],
            "state": {"mode": "chat"},
            "actions": [],
            "metaEvents": [],
            "forwardedProps": {},
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
