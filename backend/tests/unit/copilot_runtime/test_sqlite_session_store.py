from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import pytest

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.persistence import (
    DEFAULT_CHAT_DATABASE_FILE_NAME,
    SQLiteSessionStore,
    create_session_factory,
)
from app.copilot_runtime.persistence.repositories import run_lifecycle_transaction
from app.copilot_runtime.session_store import (
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)
from app.desktop_runtime.config import DesktopRuntimeConfig, DesktopRuntimePaths


def test_sqlite_session_store_uses_runtime_database_dir(tmp_path: Path) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    store = SQLiteSessionStore(runtime_config=runtime_config)
    try:
        assert store.storage_type == "sqlite"
        assert store.db_path.parent == runtime_config.database_dir
        assert store.db_path.name == DEFAULT_CHAT_DATABASE_FILE_NAME
    finally:
        store.dispose()


def test_sqlite_session_store_persists_history_and_allocates_event_sequences(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "database" / "chat.db"

    first_store = SQLiteSessionStore(db_path=db_path)
    try:
        first_store.create_thread(bound_agent_id="default", thread_id="thread-1")
        first_store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="hello sqlite"),
        )
        first_store.record_run_event(
            "run-1",
            event_type="run_started",
            payload={"assistantMessageId": "run-1:assistant"},
            sequence=99,
        )
        first_store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"delta": "hello back", "accessToken": "super-secret"},
            sequence=1,
        )
        first_store.mark_run_streaming(
            "run-1", metadata={"assistant_message_id": "run-1:assistant"}
        )
        first_store.mark_run_completed("run-1", assistant_text="hello back")

        events = first_store.list_run_events("run-1")
        messages = first_store.list_messages("thread-1")

        assert [(event.event_type, event.sequence) for event in events] == [
            ("run_started", 1),
            ("text_delta", 2),
        ]
        assert events[1].payload["accessToken"] == "[redacted]"
        assert [(message.role, message.content) for message in messages] == [
            ("user", "hello sqlite"),
            ("assistant", "hello back"),
        ]
    finally:
        first_store.dispose()

    second_store = SQLiteSessionStore(db_path=db_path)
    try:
        restored_run = second_store.get_run("run-1")
        restored_messages = second_store.list_messages("thread-1")

        assert restored_run is not None
        assert restored_run.status == "completed"
        assert restored_run.assistant_text == "hello back"
        assert [
            (event.event_type, event.sequence) for event in restored_run.event_log
        ] == [
            ("run_started", 1),
            ("text_delta", 2),
        ]
        assert [(message.role, message.content) for message in restored_messages] == [
            ("user", "hello sqlite"),
            ("assistant", "hello back"),
        ]
    finally:
        second_store.dispose()


def test_sqlite_session_store_projects_cancelled_run_interrupted_draft_from_events(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "database" / "chat.db"

    first_store = SQLiteSessionStore(db_path=db_path)
    try:
        first_store.create_thread(bound_agent_id="default", thread_id="thread-1")
        first_store.create_run(
            thread_id="thread-1",
            run_id="run-cancelled",
            request=_build_stored_run_input(user_text="please continue"),
        )
        first_store.record_run_event(
            "run-cancelled",
            event_type="run_started",
            payload={"assistantMessageId": "run-cancelled:assistant"},
            sequence=1,
        )
        first_store.record_run_event(
            "run-cancelled",
            event_type="text_delta",
            payload={"delta": "partial cancelled draft"},
            sequence=2,
        )
        first_store.mark_run_cancelled(
            "run-cancelled",
            metadata={
                "terminal_event": "run_cancelled",
                "terminal_payload": {"reason": "cancelled"},
            },
        )

        assert [
            (event.event_type, event.payload)
            for event in first_store.list_run_events("run-cancelled")
        ] == [
            ("run_started", {"assistantMessageId": "run-cancelled:assistant"}),
            ("text_delta", {"delta": "partial cancelled draft"}),
        ]
        assert [
            (message.role, message.content)
            for message in first_store.list_messages("thread-1")
        ] == [
            ("user", "please continue"),
            ("assistant", "partial cancelled draft"),
        ]
    finally:
        first_store.dispose()

    second_store = SQLiteSessionStore(db_path=db_path)
    try:
        assert [
            (message.role, message.content)
            for message in second_store.list_messages("thread-1")
        ] == [
            ("user", "please continue"),
            ("assistant", "partial cancelled draft"),
        ]
    finally:
        second_store.dispose()


def test_sqlite_session_store_persists_tool_permission_policy_round_trip(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "database" / "chat.db"

    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-policy")
        store.create_run(
            thread_id="thread-policy",
            run_id="run-policy",
            request=_build_stored_run_input(
                user_text="persist tool policy",
                tool_permission_policy={
                    "schemaVersion": 1,
                    "defaultMode": "allow",
                    "toolModes": {"tool.fs.read": "delay"},
                    "toolTimeoutSeconds": {"tool.fs.read": 15},
                    "toolTimeoutActions": {"tool.fs.read": "deny"},
                },
            ),
        )
    finally:
        store.dispose()

    restored = SQLiteSessionStore(db_path=db_path)
    try:
        restored_run = restored.get_run("run-policy")
        assert restored_run is not None
        assert restored_run.request.policy.tool_permission_policy == {
            "schemaVersion": 1,
            "defaultMode": "allow",
            "toolModes": {"tool.fs.read": "delay"},
            "toolTimeoutSeconds": {"tool.fs.read": 15},
            "toolTimeoutActions": {"tool.fs.read": "deny"},
        }
    finally:
        restored.dispose()


def test_sqlite_session_store_supports_persistent_rename_and_duplicate(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="clone this thread"),
        )
        store.record_run_event(
            "run-1",
            event_type="run_started",
            payload={"assistantMessageId": "run-1:assistant"},
        )
        store.record_run_event(
            "run-1",
            event_type="tool_event",
            payload={
                "toolCallId": "tool.weather-current:call-1",
                "toolId": "tool.weather-current",
                "phase": "completed",
                "summary": "tool output",
            },
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"assistantMessageId": "run-1:assistant", "delta": "copied answer"},
        )
        store.record_run_event(
            "run-1",
            event_type="run_completed",
            payload={
                "assistantMessageId": "run-1:assistant",
                "assistantText": "copied answer",
            },
        )
        store.mark_run_completed("run-1", assistant_text="copied answer")

        history_service = store.create_history_query_service()
        rename_result = history_service.rename_thread("thread-1", title="手动标题")
        duplicate_result = history_service.duplicate_thread("thread-1")
        duplicate_thread_id = duplicate_result.thread.threadId
        duplicate_run_id = duplicate_result.thread.lastRunId

        assert duplicate_run_id is not None

        duplicate_detail = history_service.get_thread_detail(duplicate_thread_id)
        duplicate_replay = history_service.get_run_replay(duplicate_run_id)
        duplicated_runs = store.list_runs(duplicate_thread_id)
        duplicated_messages = store.list_messages(duplicate_thread_id)

        assert rename_result.thread.title == "手动标题"
        assert rename_result.thread.titleSource == "manual"
        assert duplicate_result.thread.threadId != "thread-1"
        assert duplicate_result.thread.title == "手动标题（副本）"
        assert duplicate_result.thread.titleSource == "manual"
        assert duplicate_result.thread.lastRunStatus == "completed"
        assert len(duplicated_runs) == 1
        assert duplicated_runs[0].run_id != "run-1"
        assert [(message.role, message.content) for message in duplicated_messages] == [
            ("user", "clone this thread"),
            ("assistant", "copied answer"),
        ]
        assert duplicate_detail.thread.threadId == duplicate_thread_id
        assert duplicate_detail.thread.title == "手动标题（副本）"
        assert [run.requestedMessageText for run in duplicate_detail.runSummaries] == [
            "clone this thread"
        ]
        assert [
            item["text"] for item in duplicate_detail.timelineItems if "text" in item
        ] == [
            "clone this thread",
            "copied answer",
        ]
        assert [event.eventType for event in duplicate_replay.orderedEvents] == [
            "run_started",
            "tool_event",
            "text_delta",
            "run_completed",
        ]
        assert (
            duplicate_replay.orderedEvents[0].payload["assistantMessageId"]
            == f"{duplicate_run_id}:assistant"
        )
        assert (
            duplicate_replay.orderedEvents[1].payload["toolCallId"]
            == f"{duplicate_run_id}:call-1"
        )
        assert (
            duplicate_replay.orderedEvents[3].payload["assistantMessageId"]
            == f"{duplicate_run_id}:assistant"
        )
        assert duplicate_replay.run.threadId == duplicate_thread_id
        assert duplicate_replay.run.runId == duplicate_run_id
        assert duplicate_replay.run.assistantText == "copied answer"
    finally:
        store.dispose()


def test_sqlite_session_store_thread_detail_skips_invalid_legacy_timeline_items(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="legacy timeline"),
        )
        store.record_run_event(
            "run-1",
            event_type="run_started",
            payload={"assistantMessageId": "run-1:assistant"},
        )
        store.record_run_event(
            "run-1",
            event_type="run_completed",
            payload={
                "assistantMessageId": "run-1:assistant",
                "assistantText": "stable reply",
            },
        )
        store.mark_run_completed("run-1", assistant_text="stable reply")

        session_factory = create_session_factory(store.engine)
        with run_lifecycle_transaction(session_factory) as repositories:
            run_projection = repositories.projections.get_run_projection("run-1")
            assert run_projection is not None
            run_projection.timeline_items_json = cast(
                list[dict[str, Any]],
                [
                    {
                        "kind": "user_message",
                        "runId": "run-1",
                        "threadId": "thread-1",
                        "sequenceStart": 0,
                        "sequenceEnd": 0,
                        "createdAt": "2026-04-19T14:00:00Z",
                        "role": "user",
                        "text": "legacy timeline",
                    },
                    {
                        "kind": "future_block",
                        "runId": "run-1",
                        "threadId": "thread-1",
                        "sequenceStart": 1,
                        "sequenceEnd": 1,
                        "createdAt": "2026-04-19T14:00:01Z",
                    },
                    {
                        "kind": "assistant_message",
                        "runId": "run-1",
                    },
                    "not-a-mapping",
                ],
            )

        history_service = store.create_history_query_service()
        with caplog.at_level("WARNING", logger="uvicorn.error"):
            detail = history_service.get_thread_detail("thread-1")
    finally:
        store.dispose()

    assert detail.thread.threadId == "thread-1"
    assert [run.runId for run in detail.runSummaries] == ["run-1"]
    assert [item["kind"] for item in detail.timelineItems] == ["user_message"]
    assert [item["text"] for item in detail.timelineItems if "text" in item] == [
        "legacy timeline"
    ]

    persistence_logs = [
        record.getMessage()
        for record in caplog.records
        if "chat history timeline item skipped" in record.getMessage()
    ]
    assert len(persistence_logs) == 3
    assert "index=1" in persistence_logs[0]
    assert "kind='future_block'" in persistence_logs[0]
    assert "Unsupported timeline item kind" in persistence_logs[0]
    assert "index=2" in persistence_logs[1]
    assert "Field required" in persistence_logs[1]
    assert "index=3" in persistence_logs[2]
    assert "timeline item is not an object" in persistence_logs[2]


def test_sqlite_session_store_supports_delete_backup_and_restore(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(
                user_text="restore this thread",
                structured_payload={
                    "type": "inline_form_submission",
                    "formId": "course-form",
                    "values": {
                        "courseCode": "CS304",
                    },
                },
            ),
        )
        store.mark_run_streaming("run-1")
        store.mark_run_completed("run-1", assistant_text="restored reply")

        backup_result = store.backup_database()
        history_service = store.create_history_query_service()
        initial_threads = history_service.list_threads()
        initial_detail = history_service.get_thread_detail("thread-1")
        initial_replay = history_service.get_run_replay("run-1")
        delete_result = store.delete_thread("thread-1")
        hidden_threads = history_service.list_threads()
        deleted_thread = store.get_thread("thread-1")
        deleted_run = store.get_run("run-1")

        with pytest.raises(LookupError, match="Thread 'thread-1' does not exist."):
            history_service.get_thread_detail("thread-1")
        with pytest.raises(LookupError, match="Run 'run-1' does not exist."):
            history_service.get_run_replay("run-1")

        restore_result = store.restore_database(source_path=backup_result.backupPath)
        restored_threads = history_service.list_threads()
        restored_detail = history_service.get_thread_detail("thread-1")
        restored_replay = history_service.get_run_replay("run-1")
        restored_run = store.get_run("run-1")

        assert initial_threads.threads[0].driftSummary is not None
        assert initial_threads.threads[0].driftSummary["status"] == "not_evaluated"
        assert initial_threads.threads[0].driftSummary["historicalModelId"] == "gpt-4.1"
        assert initial_detail.availabilityDrift is not None
        assert initial_detail.availabilityDrift["status"] == "not_evaluated"
        assert initial_detail.availabilityDrift["historicalModelId"] == "gpt-4.1"
        assert initial_replay.availabilityInterpretation is not None
        assert initial_replay.availabilityInterpretation["status"] == "not_evaluated"
        assert (
            initial_replay.availabilityInterpretation["historicalModelId"] == "gpt-4.1"
        )
        assert delete_result.threadId == "thread-1"
        assert delete_result.deletedAt is not None
        assert [thread.threadId for thread in hidden_threads.threads] == []
        assert deleted_thread is None
        assert deleted_run is None
        assert Path(backup_result.backupPath).is_file()
        assert restore_result.sourcePath == backup_result.backupPath
        assert [thread.threadId for thread in restored_threads.threads] == ["thread-1"]
        assert restored_detail.availabilityDrift is not None
        assert restored_detail.availabilityDrift["status"] == "not_evaluated"
        assert restored_replay.availabilityInterpretation is not None
        assert restored_replay.availabilityInterpretation["status"] == "not_evaluated"
        assert restored_run is not None
        assert restored_run.status == "completed"
        assert restored_run.assistant_text == "restored reply"
        assert restored_run.request.message_structured_payload == {
            "type": "inline_form_submission",
            "formId": "course-form",
            "values": {
                "courseCode": "CS304",
            },
        }
        assert store.list_messages("thread-1")[0].content == (
            "restore this thread\n\n"
            "[structured_payload]\n"
            '{"formId": "course-form", "type": "inline_form_submission", "values": {"courseCode": "CS304"}}'
        )
    finally:
        store.dispose()


def test_sqlite_session_store_logs_backup_and_restore_failures_with_actionable_context(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with caplog.at_level("ERROR", logger="uvicorn.error"):
            with pytest.raises(
                ValueError, match="must be relative to the backups directory"
            ):
                store.backup_database(target_path=str(db_path))
            with pytest.raises(
                ValueError, match="must stay within the backups directory"
            ):
                store.restore_database(source_path=str(db_path))
    finally:
        store.dispose()

    persistence_logs = [
        record.getMessage()
        for record in caplog.records
        if "chat persistence" in record.getMessage()
    ]

    assert len(persistence_logs) == 2
    assert "chat persistence backup failed" in persistence_logs[0]
    assert f"db_path={db_path}" in persistence_logs[0]
    assert f"requested_target_path={db_path}" in persistence_logs[0]
    assert "resolved_target_path=None" in persistence_logs[0]
    assert "exception_type=ValueError" in persistence_logs[0]
    assert (
        "exception_message=Database backup and restore paths must be relative to the backups directory."
        in persistence_logs[0]
    )
    assert "chat persistence restore failed" in persistence_logs[1]
    assert f"db_path={db_path}" in persistence_logs[1]
    assert f"requested_source_path={db_path}" in persistence_logs[1]
    assert "resolved_source_path=None" in persistence_logs[1]
    assert "exception_type=ValueError" in persistence_logs[1]
    assert (
        "exception_message=Database backup and restore paths must stay within the backups directory."
        in persistence_logs[1]
    )


def test_sqlite_session_store_restricts_backup_restore_paths_to_backups_directory(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        backup_result = store.backup_database(target_path="named-backup.bak")
        assert (
            Path(backup_result.backupPath)
            == (tmp_path / "backups" / "named-backup.bak").resolve()
        )

        with pytest.raises(ValueError, match="must not traverse parent directories"):
            store.backup_database(target_path="../escape.db")
        with pytest.raises(ValueError, match="must use one of"):
            store.backup_database(target_path="named-backup.txt")
        restore_result = store.restore_database(
            source_path=str(tmp_path / "backups" / "named-backup.bak")
        )
        assert restore_result.sourcePath == str(
            (tmp_path / "backups" / "named-backup.bak").resolve()
        )
    finally:
        store.dispose()


def test_create_thread_and_get_thread_round_trip(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        created = store.create_thread(bound_agent_id="default", thread_id="thread-1")
        assert created.thread_id == "thread-1"
        assert created.bound_agent_id == "default"

        retrieved = store.get_thread("thread-1")
        assert retrieved is not None
        assert retrieved.thread_id == "thread-1"
        assert retrieved.bound_agent_id == "default"
    finally:
        store.dispose()


def test_get_thread_returns_none_for_missing(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        assert store.get_thread("nonexistent") is None
    finally:
        store.dispose()


def test_create_thread_duplicate_raises(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        with pytest.raises(ValueError, match="Thread 'thread-1' already exists."):
            store.create_thread(bound_agent_id="default", thread_id="thread-1")
    finally:
        store.dispose()


def test_create_thread_auto_generates_thread_id(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        created = store.create_thread(bound_agent_id="default")
        assert created.thread_id.startswith("thread-")
        assert len(created.thread_id) > len("thread-")
    finally:
        store.dispose()


def test_create_thread_rejects_empty_bound_agent_id(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with pytest.raises(ValueError, match="must be a non-empty string"):
            store.create_thread(bound_agent_id="  ")
        with pytest.raises(ValueError, match="must be a non-empty string"):
            store.create_thread(bound_agent_id="")
    finally:
        store.dispose()


def test_get_or_create_thread_creates_when_missing(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        thread, created = store.get_or_create_thread(
            thread_id="thread-1", bound_agent_id="default"
        )
        assert created is True
        assert thread.thread_id == "thread-1"
    finally:
        store.dispose()


def test_get_or_create_thread_returns_existing(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        first, created_first = store.get_or_create_thread(
            thread_id="thread-1", bound_agent_id="default"
        )
        assert created_first is True
        second, created_second = store.get_or_create_thread(
            thread_id="thread-1", bound_agent_id="default"
        )
        assert created_second is False
        assert second.thread_id == first.thread_id
    finally:
        store.dispose()


def test_get_or_create_thread_rejects_bound_agent_mismatch(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.get_or_create_thread(thread_id="thread-1", bound_agent_id="default")
        with pytest.raises(RuntimeError):
            store.get_or_create_thread(thread_id="thread-1", bound_agent_id="other-agent")
    finally:
        store.dispose()


def test_create_run_round_trip(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        created = store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test message"),
        )
        assert created.run_id == "run-1"
        assert created.thread_id == "thread-1"
        assert created.request.message_content == "test message"
        assert created.status == "pending"
    finally:
        store.dispose()


def test_get_run_returns_none_for_missing(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        assert store.get_run("nonexistent") is None
    finally:
        store.dispose()


def test_create_run_duplicate_raises(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="first"),
        )
        with pytest.raises(ValueError, match="Run 'run-1' already exists."):
            store.create_run(
                thread_id="thread-1",
                run_id="run-1",
                request=_build_stored_run_input(user_text="second"),
            )
    finally:
        store.dispose()


def test_create_run_auto_generates_run_id(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        created = store.create_run(
            thread_id="thread-1",
            request=_build_stored_run_input(user_text="test"),
        )
        assert created.run_id.startswith("run-")
    finally:
        store.dispose()


def test_create_run_rejects_empty_thread_id(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with pytest.raises(ValueError, match="must be a non-empty string"):
            store.create_run(
                thread_id="",
                request=_build_stored_run_input(user_text="test"),
            )
    finally:
        store.dispose()


def test_list_runs_returns_correct_order(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="first"),
        )
        store.create_run(
            thread_id="thread-1",
            run_id="run-2",
            request=_build_stored_run_input(user_text="second"),
        )
        store.create_run(
            thread_id="thread-1",
            run_id="run-3",
            request=_build_stored_run_input(user_text="third"),
        )

        runs = store.list_runs("thread-1")
        assert len(runs) == 3
        assert [r.run_id for r in runs] == ["run-1", "run-2", "run-3"]
    finally:
        store.dispose()


def test_list_run_events_returns_empty_for_run_without_events(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        events = store.list_run_events("run-1")
        assert events == ()
    finally:
        store.dispose()


def test_list_run_events_raises_for_missing_run(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with pytest.raises(LookupError, match="Run 'nonexistent' does not exist."):
            store.list_run_events("nonexistent")
    finally:
        store.dispose()


def test_append_run_event_and_retrieve(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        store.record_run_event(
            "run-1",
            event_type="custom_event",
            payload={"key": "value"},
        )
        events = store.list_run_events("run-1")
        assert len(events) == 1
        assert events[0].event_type == "custom_event"
        assert events[0].payload == {"key": "value"}
        assert events[0].sequence == 1
    finally:
        store.dispose()


def test_append_multiple_run_events_sequences_increment(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        store.record_run_event("run-1", event_type="event_a")
        store.record_run_event("run-1", event_type="event_b")
        store.record_run_event("run-1", event_type="event_c")

        events = store.list_run_events("run-1")
        assert len(events) == 3
        assert [(e.event_type, e.sequence) for e in events] == [
            ("event_a", 1), ("event_b", 2), ("event_c", 3),
        ]
    finally:
        store.dispose()


def test_list_messages_returns_empty_for_missing_thread(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        assert store.list_messages("nonexistent") == ()
    finally:
        store.dispose()


def test_list_messages_returns_user_and_assistant_messages(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="user request"),
        )
        store.record_run_event(
            "run-1",
            event_type="run_started",
            payload={"assistantMessageId": "run-1:assistant"},
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"delta": "assistant reply"},
        )
        store.mark_run_completed("run-1", assistant_text="assistant reply")

        messages = store.list_messages("thread-1")
        assert len(messages) == 2
        assert [(m.role, m.content) for m in messages] == [
            ("user", "user request"),
            ("assistant", "assistant reply"),
        ]
    finally:
        store.dispose()


def test_get_latest_run_for_thread(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="first"),
        )
        store.create_run(
            thread_id="thread-1",
            run_id="run-2",
            request=_build_stored_run_input(user_text="second"),
        )

        latest = store.get_latest_run_for_thread("thread-1")
        assert latest is not None
        assert latest.run_id == "run-2"
    finally:
        store.dispose()


def test_get_latest_run_for_thread_returns_none_for_missing(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        assert store.get_latest_run_for_thread("nonexistent") is None
    finally:
        store.dispose()


def test_mark_run_states_transition(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )

        assert store.get_run("run-1").status == "pending"

        streaming = store.mark_run_streaming("run-1")
        assert streaming.status == "streaming"

        completed = store.mark_run_completed("run-1", assistant_text="done")
        assert completed.status == "completed"
        assert completed.assistant_text == "done"
    finally:
        store.dispose()


def test_mark_run_failed_state(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        failed = store.mark_run_failed("run-1")
        assert failed.status == "failed"
    finally:
        store.dispose()


def test_mark_run_cancelled_state(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        cancelled = store.mark_run_cancelled("run-1")
        assert cancelled.status == "cancelled"
    finally:
        store.dispose()


def test_touch_run(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        created = store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        touched = store.touch_run("run-1", metadata={"extra": "data"})
        assert touched.run_id == created.run_id
        assert touched.metadata.get("extra") == "data"
    finally:
        store.dispose()


def test_request_run_cancel(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        store.mark_run_streaming("run-1")
        run_record, changed = store.request_run_cancel("run-1")
        assert changed is True
        assert run_record.cancel_requested is True
    finally:
        store.dispose()


def test_request_run_cancel_no_change_when_already_cancelled(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="test"),
        )
        run_record, changed = store.request_run_cancel("run-1")
        assert changed is True
        _run_record2, changed2 = store.request_run_cancel("run-1")
        assert changed2 is False
    finally:
        store.dispose()


def test_delete_thread_removes_from_store(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        result = store.delete_thread("thread-1")
        assert result.ok is True
        assert result.threadId == "thread-1"
        assert store.get_thread("thread-1") is None
    finally:
        store.dispose()


def test_delete_thread_raises_for_missing(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with pytest.raises(LookupError, match="Thread 'nonexistent' does not exist."):
            store.delete_thread("nonexistent")
    finally:
        store.dispose()


def test_backup_database_creates_backup_file(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        result = store.backup_database()
        assert result.ok is True
        assert Path(result.backupPath).is_file()
        assert result.databasePath == str(store.db_path)
    finally:
        store.dispose()


def test_backup_database_with_custom_path(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        result = store.backup_database(target_path="custom-backup.db")
        assert result.ok is True
        assert Path(result.backupPath).is_file()
        assert Path(result.backupPath).name == "custom-backup.db"
    finally:
        store.dispose()


def test_restore_database_rejects_missing_source(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with pytest.raises(ValueError, match="does not exist"):
            store.restore_database(source_path="nonexistent-backup.db")
    finally:
        store.dispose()


def test_create_thread_sets_default_title(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        thread = store.get_thread("thread-1")
        assert thread is not None
        assert thread.metadata.get("title") is None

        from app.copilot_runtime.persistence.db import create_session_factory
        from app.copilot_runtime.persistence.repositories import run_lifecycle_transaction

        session_factory = create_session_factory(store.engine)
        with run_lifecycle_transaction(session_factory) as repositories:
            model = repositories.threads.get("thread-1")
            assert model is not None
            assert model.title is not None
    finally:
        store.dispose()


def test_create_thread_assigns_default_chinese_title(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        thread = store.create_thread(bound_agent_id="default")
        from app.copilot_runtime.persistence.db import create_session_factory
        from app.copilot_runtime.persistence.repositories import run_lifecycle_transaction

        session_factory = create_session_factory(store.engine)
        with run_lifecycle_transaction(session_factory) as repositories:
            model = repositories.threads.get(thread.thread_id)
            assert model is not None
            assert model.title == "新话题"
            assert model.title_source == "deterministic"
    finally:
        store.dispose()


def test_rename_thread_updates_title_and_source(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        result_id = store.rename_thread("thread-1", title="My New Title")
        assert result_id == "thread-1"
        from app.copilot_runtime.persistence.db import create_session_factory
        from app.copilot_runtime.persistence.repositories import run_lifecycle_transaction

        session_factory = create_session_factory(store.engine)
        with run_lifecycle_transaction(session_factory) as repositories:
            model = repositories.threads.get("thread-1")
            assert model is not None
            assert model.title == "My New Title"
            assert model.title_source == "manual"
    finally:
        store.dispose()


def test_events_preserve_sequence_order(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="order test"),
        )
        for i in range(5):
            store.record_run_event("run-1", event_type=f"event_{i}")
        events = store.list_run_events("run-1")
        assert len(events) == 5
        assert [e.sequence for e in events] == [1, 2, 3, 4, 5]
        assert [e.event_type for e in events] == ["event_0", "event_1", "event_2", "event_3", "event_4"]
    finally:
        store.dispose()


def test_create_run_requires_existing_thread(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        with pytest.raises(LookupError, match="Thread 'nonexistent' does not exist."):
            store.create_run(
                thread_id="nonexistent",
                run_id="run-1",
                request=_build_stored_run_input(user_text="test"),
            )
    finally:
        store.dispose()


def test_backup_restore_preserves_all_data(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="backup roundtrip"),
        )
        store.record_run_event("run-1", event_type="run_started")
        store.record_run_event("run-1", event_type="text_delta", payload={"delta": "preserved"})
        store.mark_run_completed("run-1", assistant_text="preserved")

        original_threads = store.create_history_query_service().list_threads()

        backup_result = store.backup_database(target_path="roundtrip-bak.db")
        store.delete_thread("thread-1")
        store.restore_database(source_path=backup_result.backupPath)

        restored_threads = store.create_history_query_service().list_threads()
        restored_detail = store.create_history_query_service().get_thread_detail("thread-1")
        restored_messages = store.list_messages("thread-1")

        assert len(restored_threads.threads) == 1
        assert restored_threads.threads[0].threadId == "thread-1"
        assert restored_detail.runSummaries[0].assistantText == "preserved"
        assert [(m.role, m.content) for m in restored_messages] == [
            ("user", "backup roundtrip"),
            ("assistant", "preserved"),
        ]
    finally:
        store.dispose()


def _build_stored_run_input(
    *,
    user_text: str,
    tool_permission_policy: dict[str, object] | None = None,
    structured_payload: dict[str, object] | None = None,
) -> RuntimeStoredRunInput:
    return RuntimeStoredRunInput(
        message_role="user",
        message_content=user_text,
        message_structured_payload=structured_payload,
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
            tool_permission_policy=None
            if tool_permission_policy is None
            else dict(tool_permission_policy),
            request_options={},
        ),
        agent_id="default",
    )


def _build_runtime_config(tmp_path: Path) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host="127.0.0.1",
        port=8765,
        local_token=None,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=runtime_root_dir / "config",
            logs_dir=runtime_root_dir / "logs",
            database_dir=runtime_root_dir / "database",
            state_dir=runtime_root_dir / "state",
            debug_log_database_file=runtime_root_dir
            / "database"
            / "copilot-debug-log.db",
            copilot_settings_file=runtime_root_dir / "config" / "copilot-settings.json",
            host_log_file=runtime_root_dir / "logs" / "electron-host.log",
            backend_stdout_log_file=runtime_root_dir / "logs" / "backend.stdout.log",
            backend_stderr_log_file=runtime_root_dir / "logs" / "backend.stderr.log",
            runtime_snapshot_file=runtime_root_dir / "state" / "runtime-snapshot.json",
            last_failure_file=runtime_root_dir / "state" / "last-failure.json",
        ),
        app_mode="desktop",
        environment="test",
    )
