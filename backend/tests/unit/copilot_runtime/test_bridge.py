from __future__ import annotations

import asyncio
from collections.abc import Sequence

import pytest
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart

from app.copilot_runtime.agent_registry import build_default_agent_registry
from app.copilot_runtime.bridge import (
    AgentExecutionError,
    AgentNotFoundError,
    InvalidSessionHistoryError,
    RuntimeBridge,
)
from app.copilot_runtime.contracts import RuntimeRunRequest
from app.copilot_runtime.session_store import InMemorySessionStore, RuntimeTextMessage


class RecordingAgentExecutor:
    def __init__(self, *, reply: str = "Bridge reply", error: Exception | None = None) -> None:
        self._reply = reply
        self._error = error
        self.calls: list[dict[str, object]] = []

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
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


class RecordingExecutorFactory:
    def __init__(self, executor: RecordingAgentExecutor) -> None:
        self._executor = executor
        self.call_count = 0

    def __call__(self) -> RecordingAgentExecutor:
        self.call_count += 1
        return self._executor


def test_run_resolves_default_agent_through_registry_and_factory() -> None:
    store = InMemorySessionStore()
    store.append_turn(
        thread_id="thread-1",
        agent_name="default",
        user_text="hello",
        assistant_text="hi there",
        metadata={"last_run_id": "run-1"},
    )
    executor = RecordingAgentExecutor(reply="Bridge success")
    executor_factory = RecordingExecutorFactory(executor)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=build_default_agent_registry(executor_factory=executor_factory),
    )

    result = asyncio.run(
        bridge.run(
            request=_build_run_request(
                thread_id="thread-1",
                run_id="run-2",
                user_message_text="what next?",
            )
        )
    )

    assert executor_factory.call_count == 1
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


def test_run_creates_new_session_after_successful_first_turn() -> None:
    store = InMemorySessionStore()
    executor = RecordingAgentExecutor(reply="First reply")
    executor_factory = RecordingExecutorFactory(executor)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=build_default_agent_registry(executor_factory=executor_factory),
    )

    result = asyncio.run(
        bridge.run(
            request=_build_run_request(
                thread_id="thread-new",
                run_id="run-1",
                user_message_text="hello there",
            )
        )
    )

    assert executor_factory.call_count == 1
    assert result.assistant_text == "First reply"
    assert result.newly_created is True
    assert result.session.metadata == {"last_run_id": "run-1"}
    assert _message_pairs(store, "thread-new") == [
        ("user", "hello there"),
        ("assistant", "First reply"),
    ]

    assert len(executor.calls) == 1
    call = executor.calls[0]
    history = call["message_history"]
    assert isinstance(history, list)
    assert history == []


def test_run_raises_explicit_error_when_agent_is_not_registered() -> None:
    store = InMemorySessionStore()
    bridge = RuntimeBridge(session_store=store, agent_registry=build_default_agent_registry())

    with pytest.raises(AgentNotFoundError, match="Unknown agent 'missing-agent'."):
        asyncio.run(
            bridge.run(
                request=_build_run_request(
                    thread_id="thread-1",
                    run_id="run-1",
                    user_message_text="should fail",
                    agent_name="missing-agent",
                )
            )
        )

    assert store.get("thread-1") is None


def test_run_does_not_append_failed_turn_to_session_history() -> None:
    store = InMemorySessionStore()
    store.append_turn(
        thread_id="thread-1",
        agent_name="default",
        user_text="hello",
        assistant_text="hi there",
        metadata={"last_run_id": "run-1"},
    )
    session_before_failure = store.get("thread-1")
    assert session_before_failure is not None
    previous_updated_at = session_before_failure.updated_at
    executor = RecordingAgentExecutor(error=AgentExecutionError("executor boom"))
    executor_factory = RecordingExecutorFactory(executor)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=build_default_agent_registry(executor_factory=executor_factory),
    )

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

    assert executor_factory.call_count == 1
    assert _message_pairs(store, "thread-1") == [
        ("user", "hello"),
        ("assistant", "hi there"),
    ]
    session_after_failure = store.get("thread-1")
    assert session_after_failure is session_before_failure
    assert session_after_failure.metadata == {"last_run_id": "run-1"}
    assert session_after_failure.updated_at == previous_updated_at


def test_run_does_not_create_session_when_executor_fails_before_first_success() -> None:
    store = InMemorySessionStore()
    executor = RecordingAgentExecutor(error=AgentExecutionError("executor boom"))
    executor_factory = RecordingExecutorFactory(executor)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=build_default_agent_registry(executor_factory=executor_factory),
    )

    with pytest.raises(AgentExecutionError, match="executor boom"):
        asyncio.run(
            bridge.run(
                request=_build_run_request(
                    thread_id="thread-new",
                    run_id="run-1",
                    user_message_text="should fail",
                )
            )
        )

    assert executor_factory.call_count == 1
    assert store.get("thread-new") is None
    assert store.list_messages("thread-new") == ()


def test_run_raises_explicit_error_when_stored_history_is_corrupted() -> None:
    store = InMemorySessionStore()
    session, _ = store.get_or_create(
        thread_id="thread-1",
        agent_name="default",
        metadata={"last_run_id": "run-1"},
    )
    session.messages.append(RuntimeTextMessage(role="assistant", content="orphan assistant"))
    executor_factory = RecordingExecutorFactory(RecordingAgentExecutor())
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=build_default_agent_registry(executor_factory=executor_factory),
    )

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

    assert executor_factory.call_count == 0
    assert _message_pairs(store, "thread-1") == [("assistant", "orphan assistant")]


def _build_run_request(
    *,
    thread_id: str,
    run_id: str,
    user_message_text: str,
    agent_name: str = "default",
) -> RuntimeRunRequest:
    return RuntimeRunRequest(
        agent_name=agent_name,
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
