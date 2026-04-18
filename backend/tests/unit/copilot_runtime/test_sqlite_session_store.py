from __future__ import annotations

from pathlib import Path

import pytest

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.persistence import DEFAULT_CHAT_DATABASE_FILE_NAME, SQLiteSessionStore
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



def test_sqlite_session_store_persists_history_and_allocates_event_sequences(tmp_path: Path) -> None:
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
        first_store.mark_run_streaming("run-1", metadata={"assistant_message_id": "run-1:assistant"})
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
        assert [(event.event_type, event.sequence) for event in restored_run.event_log] == [
            ("run_started", 1),
            ("text_delta", 2),
        ]
        assert [(message.role, message.content) for message in restored_messages] == [
            ("user", "hello sqlite"),
            ("assistant", "hello back"),
        ]
    finally:
        second_store.dispose()


def test_sqlite_session_store_persists_tool_permission_policy_round_trip(tmp_path: Path) -> None:
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
        assert restored_run.request.policy.tool_permission_policy == {
            "schemaVersion": 1,
            "defaultMode": "allow",
            "toolModes": {"tool.fs.read": "delay"},
            "toolTimeoutSeconds": {"tool.fs.read": 15},
            "toolTimeoutActions": {"tool.fs.read": "deny"},
        }
    finally:
        restored.dispose()



def test_sqlite_session_store_supports_persistent_rename_and_duplicate(tmp_path: Path) -> None:
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
        assert [run.requestedMessageText for run in duplicate_detail.runSummaries] == ["clone this thread"]
        assert [item["text"] for item in duplicate_detail.timelineItems if "text" in item] == [
            "clone this thread",
            "copied answer",
        ]
        assert [event.eventType for event in duplicate_replay.orderedEvents] == [
            "run_started",
            "tool_event",
            "text_delta",
            "run_completed",
        ]
        assert duplicate_replay.orderedEvents[0].payload["assistantMessageId"] == f"{duplicate_run_id}:assistant"
        assert duplicate_replay.orderedEvents[1].payload["toolCallId"] == f"{duplicate_run_id}:call-1"
        assert duplicate_replay.orderedEvents[3].payload["assistantMessageId"] == f"{duplicate_run_id}:assistant"
        assert duplicate_replay.run.threadId == duplicate_thread_id
        assert duplicate_replay.run.runId == duplicate_run_id
        assert duplicate_replay.run.assistantText == "copied answer"
    finally:
        store.dispose()



def test_sqlite_session_store_supports_delete_backup_and_restore(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="restore this thread"),
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
        assert initial_replay.availabilityInterpretation["historicalModelId"] == "gpt-4.1"
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
            with pytest.raises(ValueError, match="must be relative to the backups directory"):
                store.backup_database(target_path=str(db_path))
            with pytest.raises(ValueError, match="must stay within the backups directory"):
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
    assert "exception_message=Database backup and restore paths must be relative to the backups directory." in persistence_logs[0]
    assert "chat persistence restore failed" in persistence_logs[1]
    assert f"db_path={db_path}" in persistence_logs[1]
    assert f"requested_source_path={db_path}" in persistence_logs[1]
    assert "resolved_source_path=None" in persistence_logs[1]
    assert "exception_type=ValueError" in persistence_logs[1]
    assert "exception_message=Database backup and restore paths must stay within the backups directory." in persistence_logs[1]



def test_sqlite_session_store_restricts_backup_restore_paths_to_backups_directory(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    try:
        backup_result = store.backup_database(target_path="named-backup.bak")
        assert Path(backup_result.backupPath) == (tmp_path / "backups" / "named-backup.bak").resolve()

        with pytest.raises(ValueError, match="must not traverse parent directories"):
            store.backup_database(target_path="../escape.db")
        with pytest.raises(ValueError, match="must use one of"):
            store.backup_database(target_path="named-backup.txt")
        restore_result = store.restore_database(source_path=str(tmp_path / "backups" / "named-backup.bak"))
        assert restore_result.sourcePath == str((tmp_path / "backups" / "named-backup.bak").resolve())
    finally:
        store.dispose()



def _build_stored_run_input(
    *,
    user_text: str,
    tool_permission_policy: dict[str, object] | None = None,
) -> RuntimeStoredRunInput:
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
            tool_permission_policy=None if tool_permission_policy is None else dict(tool_permission_policy),
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
