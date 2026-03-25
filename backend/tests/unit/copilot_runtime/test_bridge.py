from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart

from app.copilot_runtime.bridge import (
    AgentExecutionError,
    InvalidSessionHistoryError,
    RuntimeBridge,
)
from app.copilot_runtime.contracts import RuntimeRunRequest
from app.copilot_runtime.session_store import InMemorySessionStore, RuntimeTextMessage


class RecordingAgentExecutor:
    def __init__(self, *, reply: str = "Bridge reply", error: Exception | None = None) -> None:
        self.model_environment_keys = ("COPILOT_RUNTIME_MODEL",)
        self._reply = reply
        self._error = error
        self.calls: list[dict[str, object]] = []

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
    ) -> str:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
            }
        )
        if self._error is not None:
            raise self._error
        return self._reply


def test_run_reads_session_history_and_persists_successful_turn() -> None:
    store = InMemorySessionStore()
    store.append_turn(
        thread_id="thread-1",
        agent_name="default",
        user_text="hello",
        assistant_text="hi there",
        metadata={"last_run_id": "run-1"},
    )
    executor = RecordingAgentExecutor(reply="Bridge success")
    bridge = RuntimeBridge(session_store=store, agent_executor=executor)  # type: ignore[arg-type]

    result = asyncio.run(
        bridge.run(
            request=_build_run_request(
                thread_id="thread-1",
                run_id="run-2",
                user_message_text="what next?",
            )
        )
    )

    assert result.assistant_text == "Bridge success"
    assert result.newly_created is False
    assert result.session.metadata == {"last_run_id": "run-2"}
    assert _message_pairs(store, "thread-1") == [
        ("user", "hello"),
        ("assistant", "hi there"),
        ("user", "what next?"),
        ("assistant", "Bridge success"),
    ]

    assert len(executor.calls) == 1
    call = executor.calls[0]
    assert call["agent_name"] == "default"
    assert call["user_prompt"] == "what next?"

    history = call["message_history"]
    assert isinstance(history, list)
    assert len(history) == 2
    assert isinstance(history[0], ModelRequest)
    assert history[0].parts[0].content == "hello"
    assert isinstance(history[1], ModelResponse)
    assert isinstance(history[1].parts[0], TextPart)
    assert history[1].parts[0].content == "hi there"


def test_run_does_not_append_failed_turn_to_session_history() -> None:
    store = InMemorySessionStore()
    store.append_turn(
        thread_id="thread-1",
        agent_name="default",
        user_text="hello",
        assistant_text="hi there",
        metadata={"last_run_id": "run-1"},
    )
    executor = RecordingAgentExecutor(error=AgentExecutionError("executor boom"))
    bridge = RuntimeBridge(session_store=store, agent_executor=executor)  # type: ignore[arg-type]

    with pytest.raises(AgentExecutionError, match="executor boom"):
        asyncio.run(
            bridge.run(
                request=_build_run_request(
                    thread_id="thread-1",
                    run_id="run-2",
                    user_message_text="should fail",
                )
            )
        )

    assert _message_pairs(store, "thread-1") == [
        ("user", "hello"),
        ("assistant", "hi there"),
    ]


def test_run_raises_explicit_error_when_stored_history_is_corrupted() -> None:
    store = InMemorySessionStore()
    session, _ = store.get_or_create(
        thread_id="thread-1",
        agent_name="default",
        metadata={"last_run_id": "run-1"},
    )
    session.messages.append(RuntimeTextMessage(role="assistant", content="orphan assistant"))
    executor = RecordingAgentExecutor()
    bridge = RuntimeBridge(session_store=store, agent_executor=executor)  # type: ignore[arg-type]

    with pytest.raises(InvalidSessionHistoryError, match="expected role 'user'"):
        asyncio.run(
            bridge.run(
                request=_build_run_request(
                    thread_id="thread-1",
                    run_id="run-2",
                    user_message_text="should not execute",
                )
            )
        )

    assert executor.calls == []
    assert _message_pairs(store, "thread-1") == [("assistant", "orphan assistant")]


def _build_run_request(*, thread_id: str, run_id: str, user_message_text: str) -> RuntimeRunRequest:
    return RuntimeRunRequest(
        agent_name="default",
        thread_id=thread_id,
        run_id=run_id,
        user_message_text=user_message_text,
        state={},
        messages=(),
        actions=(),
        meta_events=(),
        node_name=None,
        forwarded_props={},
        metadata={},
    )


def _message_pairs(store: InMemorySessionStore, thread_id: str) -> list[tuple[str, str]]:
    return [(message.role, message.content) for message in store.list_messages(thread_id)]
