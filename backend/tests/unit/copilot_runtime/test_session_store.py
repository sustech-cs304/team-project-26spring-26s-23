from __future__ import annotations

from app.copilot_runtime.session_store import InMemorySessionStore


def test_get_or_create_returns_new_session_for_new_thread() -> None:
    store = InMemorySessionStore()

    session, created = store.get_or_create(
        thread_id="thread-1",
        agent_name="default",
        metadata={"source": "connect"},
    )

    assert created is True
    assert store.storage_type == "in-memory"
    assert store.get("thread-1") is session
    assert session.thread_id == "thread-1"
    assert session.agent_name == "default"
    assert session.metadata == {"source": "connect"}
    assert session.created_at == session.updated_at
    assert store.list_messages("thread-1") == ()


def test_get_or_create_reuses_existing_thread_and_merges_metadata() -> None:
    store = InMemorySessionStore()
    first_session, first_created = store.get_or_create(
        thread_id="thread-1",
        agent_name="default",
        metadata={"first": "one"},
    )

    second_session, second_created = store.get_or_create(
        thread_id="thread-1",
        agent_name="default",
        metadata={"second": "two"},
    )

    assert first_created is True
    assert second_created is False
    assert second_session is first_session
    assert second_session.metadata == {"first": "one", "second": "two"}
    assert second_session.created_at <= second_session.updated_at


def test_append_turn_persists_minimal_text_history_for_same_thread() -> None:
    store = InMemorySessionStore()

    first_session, first_created = store.append_turn(
        thread_id="thread-1",
        agent_name="default",
        user_text="  hello  ",
        assistant_text="  hi there  ",
        metadata={"last_run_id": "run-1"},
    )
    second_session, second_created = store.append_turn(
        thread_id="thread-1",
        agent_name="default",
        user_text="how are you?",
        assistant_text="doing well",
        metadata={"last_run_id": "run-2"},
    )

    assert first_created is True
    assert second_created is False
    assert second_session is first_session
    assert second_session.metadata == {"last_run_id": "run-2"}
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "hello"),
        ("assistant", "hi there"),
        ("user", "how are you?"),
        ("assistant", "doing well"),
    ]
    assert second_session.created_at <= second_session.updated_at
