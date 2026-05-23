from __future__ import annotations

from pathlib import Path

import pytest

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.persistence import (
    SQLiteSessionStore,
    create_session_factory,
)
from app.copilot_runtime.persistence.queries import PersistedChatQueryService
from app.copilot_runtime.session_store import (
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)


def test_list_threads_returns_empty_when_no_threads(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.list_threads()
        assert result.ok is True
        assert result.threads == ()
    finally:
        store.dispose()


def test_list_threads_returns_created_thread(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.list_threads()
        assert result.ok is True
        assert len(result.threads) == 1
        assert result.threads[0].threadId == "thread-1"
        assert result.threads[0].boundAgentId == "default"
    finally:
        store.dispose()


def test_list_threads_ordered_by_updated_at_desc(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_thread(bound_agent_id="default", thread_id="thread-2")
        store.create_thread(bound_agent_id="default", thread_id="thread-3")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.list_threads()
        thread_ids = [t.threadId for t in result.threads]
        assert "thread-3" in thread_ids
        assert "thread-2" in thread_ids
        assert "thread-1" in thread_ids
    finally:
        store.dispose()


def test_get_thread_detail_returns_thread_info(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="hello world"),
        )
        store.record_run_event("run-1", event_type="run_started", payload={"assistantMessageId": "run-1:assistant"})
        store.record_run_event("run-1", event_type="text_delta", payload={"delta": "hello back"})
        store.record_run_event(
            "run-1", event_type="run_completed",
            payload={"assistantMessageId": "run-1:assistant", "assistantText": "hello back"},
        )
        store.mark_run_completed("run-1", assistant_text="hello back")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.get_thread_detail("thread-1")
        assert result.ok is True
        assert result.thread.threadId == "thread-1"
        assert len(result.runSummaries) == 1
        assert result.runSummaries[0].runId == "run-1"
    finally:
        store.dispose()


def test_get_thread_detail_raises_for_missing_thread(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        with pytest.raises(LookupError, match="Thread 'nonexistent' does not exist."):
            service.get_thread_detail("nonexistent")
    finally:
        store.dispose()


def test_get_run_replay_returns_run_data(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="replay this"),
        )
        store.record_run_event("run-1", event_type="run_started", payload={"assistantMessageId": "run-1:assistant"})
        store.record_run_event("run-1", event_type="text_delta", payload={"delta": "replay reply"})
        store.record_run_event(
            "run-1", event_type="run_completed",
            payload={"assistantMessageId": "run-1:assistant", "assistantText": "replay reply"},
        )
        store.mark_run_completed("run-1", assistant_text="replay reply")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.get_run_replay("run-1")
        assert result.ok is True
        assert result.run.runId == "run-1"
        assert result.run.assistantText == "replay reply"
        assert len(result.orderedEvents) == 3
        assert [e.eventType for e in result.orderedEvents] == ["run_started", "text_delta", "run_completed"]
    finally:
        store.dispose()


def test_get_run_replay_raises_for_missing_run(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        with pytest.raises(LookupError, match="Run 'nonexistent' does not exist."):
            service.get_run_replay("nonexistent")
    finally:
        store.dispose()


def test_delete_thread_via_query_service(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.delete_thread("thread-1")
        assert result.ok is True
        assert result.threadId == "thread-1"
        assert service.list_threads().threads == ()
    finally:
        store.dispose()


def test_rename_thread_via_query_service(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.rename_thread("thread-1", title="Custom Title")
        assert result.ok is True
        assert result.thread.title == "Custom Title"
        assert result.thread.titleSource == "manual"
    finally:
        store.dispose()


def test_duplicate_thread_via_query_service(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="original text"),
        )
        store.record_run_event("run-1", event_type="run_started", payload={"assistantMessageId": "run-1:assistant"})
        store.record_run_event(
            "run-1", event_type="run_completed",
            payload={"assistantMessageId": "run-1:assistant", "assistantText": "copied"},
        )
        store.mark_run_completed("run-1", assistant_text="copied")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.duplicate_thread("thread-1")
        assert result.ok is True
        assert result.thread.threadId != "thread-1"
        duplicated_id = result.thread.threadId
        detail = service.get_thread_detail(duplicated_id)
        assert detail.thread.threadId == duplicated_id
        assert len(service.list_threads().threads) == 2
    finally:
        store.dispose()


def test_duplicate_thread_with_custom_title(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.duplicate_thread("thread-1", title="Custom Copy")
        assert result.ok is True
        assert result.thread.title == "Custom Copy（副本）"
        assert result.thread.titleSource == "manual"
    finally:
        store.dispose()


def test_backup_and_restore_via_query_service(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="backup test"),
        )
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        backup_result = service.backup_database(target_path="service-backup.db")
        assert backup_result.ok is True
        assert Path(backup_result.backupPath).is_file()
        restore_result = service.restore_database(source_path=backup_result.backupPath)
        assert restore_result.ok is True
    finally:
        store.dispose()


def test_query_service_without_session_store_raises_for_mutations(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=None)
        with pytest.raises(RuntimeError, match="require the SQLite chat session store"):
            service.delete_thread("thread-1")
        with pytest.raises(RuntimeError, match="require the SQLite chat session store"):
            service.rename_thread("thread-1", title="test")
        with pytest.raises(RuntimeError, match="require the SQLite chat session store"):
            service.duplicate_thread("thread-1")
        with pytest.raises(RuntimeError, match="require the SQLite chat session store"):
            service.backup_database()
        with pytest.raises(RuntimeError, match="require the SQLite chat session store"):
            service.restore_database(source_path="test.db")
    finally:
        store.dispose()


def test_get_thread_detail_with_multiple_runs(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1", run_id="run-1",
            request=_build_stored_run_input(user_text="first"),
        )
        store.record_run_event("run-1", event_type="run_started", payload={"assistantMessageId": "run-1:assistant"})
        store.record_run_event(
            "run-1", event_type="run_completed",
            payload={"assistantMessageId": "run-1:assistant", "assistantText": "first reply"},
        )
        store.mark_run_completed("run-1", assistant_text="first reply")
        store.create_run(
            thread_id="thread-1", run_id="run-2",
            request=_build_stored_run_input(user_text="second"),
        )
        store.record_run_event("run-2", event_type="run_started", payload={"assistantMessageId": "run-2:assistant"})
        store.record_run_event(
            "run-2", event_type="run_completed",
            payload={"assistantMessageId": "run-2:assistant", "assistantText": "second reply"},
        )
        store.mark_run_completed("run-2", assistant_text="second reply")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.get_thread_detail("thread-1")
        assert len(result.runSummaries) == 2
        assert [r.runId for r in result.runSummaries] == ["run-1", "run-2"]
    finally:
        store.dispose()


def test_get_thread_detail_returns_latest_configuration_snapshot(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="snapshot test"),
        )
        store.mark_run_completed("run-1", assistant_text="done")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.get_thread_detail("thread-1")
        assert result.latestConfigurationSnapshot is not None
        assert result.latestConfigurationSnapshot.runId == "run-1"
    finally:
        store.dispose()


def test_get_run_replay_includes_historical_snapshot(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="history test"),
        )
        store.record_run_event("run-1", event_type="run_started", payload={"assistantMessageId": "run-1:assistant"})
        store.record_run_event(
            "run-1", event_type="run_completed",
            payload={"assistantMessageId": "run-1:assistant", "assistantText": "done"},
        )
        store.mark_run_completed("run-1", assistant_text="done")
        session_factory = create_session_factory(store.engine)
        service = PersistedChatQueryService(session_factory, session_store=store)
        result = service.get_run_replay("run-1")
        assert result.historicalSnapshot is not None
        assert result.historicalSnapshot.requestMessage.content == "history test"
    finally:
        store.dispose()


def _build_stored_run_input(*, user_text: str) -> RuntimeStoredRunInput:
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
        agent_id="default",
    )
