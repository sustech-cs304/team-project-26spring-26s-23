from __future__ import annotations

from types import MappingProxyType

import pytest

from app.copilot_runtime.session_store import (
    BoundAgentMismatchError,
    InMemorySessionStore,
    RuntimeStoredModelRoute,
    RuntimeStoredModelRouteSnapshot,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)


def test_get_or_create_returns_new_session_for_new_thread() -> None:
    store = InMemorySessionStore()

    session, created = store.get_or_create(
        session_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )

    assert created is True
    assert store.storage_type == "in-memory"
    assert store.get("thread-1") is session
    assert session.session_id == "thread-1"
    assert session.bound_agent_id == "default"
    assert session.thread_id == "thread-1"
    assert session.agent_name == "default"
    assert session.metadata == {"source": "connect"}
    assert session.created_at == session.updated_at
    assert store.list_messages("thread-1") == ()


def test_get_or_create_reuses_existing_thread_and_merges_metadata() -> None:
    store = InMemorySessionStore()
    first_session, first_created = store.get_or_create(
        session_id="thread-1",
        bound_agent_id="default",
        metadata={"first": "one"},
    )

    second_session, second_created = store.get_or_create(
        session_id="thread-1",
        bound_agent_id="default",
        metadata={"second": "two"},
    )

    assert first_created is True
    assert second_created is False
    assert second_session is first_session
    assert second_session.metadata == {"first": "one", "second": "two"}
    assert second_session.created_at <= second_session.updated_at


def test_get_or_create_rejects_rebinding_existing_session_to_different_agent() -> None:
    store = InMemorySessionStore()
    store.get_or_create(
        session_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )

    with pytest.raises(BoundAgentMismatchError, match="bound to agent 'default'"):
        store.get_or_create(
            session_id="thread-1",
            bound_agent_id="secondary",
            metadata={"source": "run"},
        )


def test_create_generates_session_id_and_bound_agent_record() -> None:
    store = InMemorySessionStore()

    session = store.create(bound_agent_id="default")

    assert session.session_id.startswith("session-")
    assert session.bound_agent_id == "default"
    assert store.get(session.session_id) is session


def test_create_materializes_mapping_metadata() -> None:
    store = InMemorySessionStore()
    source_metadata = {"source": "connect"}

    session = store.create(
        bound_agent_id="default",
        metadata=MappingProxyType(source_metadata),
    )
    source_metadata["source"] = "mutated"

    assert session.metadata == {"source": "connect"}
    assert isinstance(session.metadata, dict)


def test_thread_run_source_projects_completed_messages_and_event_log() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    run = store.create_run(
        thread_id="thread-1",
        run_id="run-1",
        request=_build_stored_run_input(user_text="  hello from run source  "),
    )
    store.record_run_event(
        "run-1",
        event_type="run_started",
        payload={"assistantMessageId": "run-1:assistant"},
        sequence=1,
    )
    store.record_run_event(
        "run-1",
        event_type="text_delta",
        payload={"delta": "hi"},
        sequence=2,
    )
    store.mark_run_streaming("run-1", metadata={"assistant_message_id": "run-1:assistant"})
    store.mark_run_completed(
        "run-1",
        assistant_text="  hi there from projection  ",
        metadata={"terminal_event": "run_completed"},
    )

    assert store.get_run("run-1") is run
    assert store.get_latest_run_for_thread("thread-1") is run
    assert run.status == "completed"
    assert run.cancel_requested is False
    assert [(event.event_type, event.sequence) for event in store.list_run_events("run-1")] == [
        ("run_started", 1),
        ("text_delta", 2),
    ]
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "hello from run source"),
        ("assistant", "hi there from projection"),
    ]


def test_failed_and_cancelled_runs_do_not_project_messages() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")

    failed_run = store.create_run(
        thread_id="thread-1",
        run_id="run-failed",
        request=_build_stored_run_input(user_text="hello"),
    )
    cancelled_run = store.create_run(
        thread_id="thread-1",
        run_id="run-cancelled",
        request=_build_stored_run_input(user_text="follow up"),
    )

    store.mark_run_failed(
        "run-failed",
        metadata={"terminal_event": "run_failed", "terminal_payload": {"code": "boom"}},
    )
    store.mark_run_cancelled(
        "run-cancelled",
        metadata={"terminal_event": "run_cancelled", "terminal_payload": {"reason": "cancelled"}},
    )

    assert failed_run.status == "failed"
    assert cancelled_run.status == "cancelled"
    assert store.get_latest_run_for_thread("thread-1") is cancelled_run
    assert store.list_messages("thread-1") == ()


def test_append_turn_projects_compat_history_via_run_records() -> None:
    store = InMemorySessionStore()

    first_session, first_created = store.append_turn(
        session_id="thread-1",
        bound_agent_id="default",
        user_text="  hello  ",
        assistant_text="  hi there  ",
        metadata={"last_run_id": "run-1"},
    )
    second_session, second_created = store.append_turn(
        session_id="thread-1",
        bound_agent_id="default",
        user_text="how are you?",
        assistant_text="doing well",
        metadata={"last_run_id": "run-2"},
    )

    assert first_created is True
    assert second_created is False
    assert second_session is first_session
    assert second_session.metadata == {"last_run_id": "run-2"}
    assert [run.run_id for run in store.list_runs("thread-1")] == ["run-1", "run-2"]
    assert store.get_run("run-1") is not None
    assert store.get_run("run-2") is not None
    assert store.get_run("run-2").status == "completed"
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "hello"),
        ("assistant", "hi there"),
        ("user", "how are you?"),
        ("assistant", "doing well"),
    ]
    assert second_session.created_at <= second_session.updated_at


def test_append_turn_reuses_existing_run_when_last_run_id_is_present() -> None:
    store = InMemorySessionStore()
    store.create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )
    existing_run = store.create_run(
        thread_id="thread-1",
        run_id="run-1",
        request=_build_stored_run_input(user_text="hello"),
    )

    session, created = store.append_turn(
        session_id="thread-1",
        bound_agent_id="default",
        user_text="hello",
        assistant_text="hi there",
        metadata={"last_run_id": "run-1", "source": "compat"},
    )

    assert created is False
    assert store.get_run("run-1") is existing_run
    assert len(store.list_runs("thread-1")) == 1
    assert existing_run.status == "completed"
    assert existing_run.assistant_text == "hi there"
    assert session.metadata == {"source": "compat", "last_run_id": "run-1"}
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "hello"),
        ("assistant", "hi there"),
    ]


def _build_stored_run_input(*, user_text: str, agent_id: str = "default") -> RuntimeStoredRunInput:
    return RuntimeStoredRunInput(
        message_role="user",
        message_content=user_text,
        policy=RuntimeStoredRunPolicy(
            model_route=RuntimeStoredModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeStoredModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            enabled_tools=(),
            request_options={},
        ),
        agent_id=agent_id,
    )
