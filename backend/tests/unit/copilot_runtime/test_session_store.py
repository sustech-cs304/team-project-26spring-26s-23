from __future__ import annotations

from types import MappingProxyType

import pytest

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.session_store import (
    BoundAgentMismatchError,
    InMemorySessionStore,
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)
def test_get_or_create_thread_returns_new_thread_for_new_thread_id() -> None:
    store = InMemorySessionStore()

    thread, created = store.get_or_create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )

    assert created is True
    assert store.storage_type == "in-memory"
    assert store.get_thread("thread-1") is thread
    assert thread.thread_id == "thread-1"
    assert thread.bound_agent_id == "default"
    assert thread.metadata == {"source": "connect"}
    assert thread.created_at == thread.updated_at
    assert store.list_messages("thread-1") == ()



def test_get_or_create_thread_reuses_existing_thread_and_merges_metadata() -> None:
    store = InMemorySessionStore()
    first_thread, first_created = store.get_or_create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"first": "one"},
    )

    second_thread, second_created = store.get_or_create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"second": "two"},
    )

    assert first_created is True
    assert second_created is False
    assert second_thread is first_thread
    assert second_thread.metadata == {"first": "one", "second": "two"}
    assert second_thread.created_at <= second_thread.updated_at



def test_get_or_create_thread_rejects_rebinding_existing_thread_to_different_agent() -> None:
    store = InMemorySessionStore()
    store.get_or_create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )

    with pytest.raises(BoundAgentMismatchError, match="bound to agent 'default'"):
        store.get_or_create_thread(
            thread_id="thread-1",
            bound_agent_id="secondary",
            metadata={"source": "run"},
        )



def test_create_thread_generates_thread_id_and_bound_agent_record() -> None:
    store = InMemorySessionStore()

    thread = store.create_thread(bound_agent_id="default")

    assert thread.thread_id.startswith("thread-")
    assert thread.bound_agent_id == "default"
    assert store.get_thread(thread.thread_id) is thread



def test_create_thread_materializes_mapping_metadata() -> None:
    store = InMemorySessionStore()
    source_metadata = {"source": "connect"}

    thread = store.create_thread(
        bound_agent_id="default",
        metadata=MappingProxyType(source_metadata),
    )
    source_metadata["source"] = "mutated"

    assert thread.metadata == {"source": "connect"}
    assert isinstance(thread.metadata, dict)
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


def test_multiple_completed_runs_project_thread_history_in_run_order() -> None:
    store = InMemorySessionStore()
    thread = store.create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )
    first_run = store.create_run(
        thread_id="thread-1",
        run_id="run-1",
        request=_build_stored_run_input(user_text="  hello  "),
    )
    second_run = store.create_run(
        thread_id="thread-1",
        run_id="run-2",
        request=_build_stored_run_input(user_text="how are you?"),
    )

    store.mark_run_completed("run-1", assistant_text="  hi there  ")
    store.mark_run_completed("run-2", assistant_text="doing well")

    assert [run.run_id for run in store.list_runs("thread-1")] == ["run-1", "run-2"]
    assert store.get_run("run-1") is first_run
    assert store.get_run("run-2") is second_run
    assert store.get_latest_run_for_thread("thread-1") is second_run
    assert thread.last_run_id == "run-2"
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "hello"),
        ("assistant", "hi there"),
        ("user", "how are you?"),
        ("assistant", "doing well"),
    ]
    assert thread.created_at <= thread.updated_at



def test_get_latest_run_for_thread_falls_back_to_sorted_runs_when_pointer_missing() -> None:
    store = InMemorySessionStore()
    store.create_thread(
        thread_id="thread-1",
        bound_agent_id="default",
        metadata={"source": "connect"},
    )
    first_run = store.create_run(
        thread_id="thread-1",
        run_id="run-1",
        request=_build_stored_run_input(user_text="hello"),
    )
    second_run = store.create_run(
        thread_id="thread-1",
        run_id="run-2",
        request=_build_stored_run_input(user_text="follow up"),
    )

    thread = store.get_thread("thread-1")
    assert thread is not None
    assert store.get_latest_run_for_thread("thread-1") is second_run

    thread.last_run_id = None

    assert store.get_latest_run_for_thread("thread-1") is second_run
    assert first_run.run_id == "run-1"

def _build_stored_run_input(*, user_text: str, agent_id: str = "default") -> RuntimeStoredRunInput:
    return RuntimeStoredRunInput(
        message_role="user",
        message_content=user_text,
        policy=RuntimeStoredRunPolicy(
            model_route=RuntimeStoredModelRoute(
                provider_profile_id="provider-1",
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id="provider-1",
                    model_id="gpt-4.1",
                ),
            ),
            enabled_tools=(),
            request_options={},
        ),
        agent_id=agent_id,
    )
