from __future__ import annotations

from collections.abc import Iterator, Mapping
from types import MappingProxyType

import pytest

from app.copilot_runtime.session_store import BoundAgentMismatchError, InMemorySessionStore


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



def test_append_turn_persists_minimal_text_history_for_same_thread() -> None:
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
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "hello"),
        ("assistant", "hi there"),
        ("user", "how are you?"),
        ("assistant", "doing well"),
    ]
    assert second_session.created_at <= second_session.updated_at


class TrackingMetadata(Mapping[str, object]):
    def __init__(self) -> None:
        self.returned_values: list[object] = []

    def __getitem__(self, key: str) -> object:
        if key != "last_run_id":
            raise KeyError(key)
        value = object()
        self.returned_values.append(value)
        return value

    def __iter__(self) -> Iterator[str]:
        return iter(("last_run_id",))

    def __len__(self) -> int:
        return 1



def test_append_turn_merges_metadata_once_for_existing_thread() -> None:
    store = InMemorySessionStore()
    store.create(
        session_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )
    metadata = TrackingMetadata()

    session, created = store.append_turn(
        session_id="thread-1",
        bound_agent_id="default",
        user_text="hello",
        assistant_text="hi there",
        metadata=metadata,
    )

    assert created is False
    assert len(metadata.returned_values) == 1
    assert session.metadata == {
        "source": "connect",
        "last_run_id": metadata.returned_values[0],
    }
