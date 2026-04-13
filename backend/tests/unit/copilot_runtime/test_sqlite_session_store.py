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



def test_sqlite_session_store_supports_delete_purge_backup_and_restore(tmp_path: Path) -> None:
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
        delete_result = store.delete_thread("thread-1")
        hidden_threads = history_service.list_threads()
        deleted_detail = history_service.get_thread_detail("thread-1")
        purge_result = store.purge_thread("thread-1")
        purged_thread = store.get_thread("thread-1")
        purged_run = store.get_run("run-1")
        restore_result = store.restore_database(source_path=backup_result.backupPath)
        restored_threads = history_service.list_threads()
        restored_run = store.get_run("run-1")

        assert delete_result.threadId == "thread-1"
        assert [thread.threadId for thread in hidden_threads.threads] == []
        assert deleted_detail.thread.threadId == "thread-1"
        assert purge_result.threadId == "thread-1"
        assert purge_result.deletedAt is not None
        assert purged_thread is None
        assert purged_run is None
        assert Path(backup_result.backupPath).is_file()
        assert restore_result.sourcePath == backup_result.backupPath
        assert [thread.threadId for thread in restored_threads.threads] == ["thread-1"]
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
            with pytest.raises(ValueError, match="live database file in place"):
                store.backup_database(target_path=str(db_path))
            with pytest.raises(ValueError, match="live database file in place"):
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
    assert f"resolved_target_path={db_path}" in persistence_logs[0]
    assert "exception_type=ValueError" in persistence_logs[0]
    assert "exception_message=Cannot backup the live database file in place." in persistence_logs[0]
    assert "chat persistence restore failed" in persistence_logs[1]
    assert f"db_path={db_path}" in persistence_logs[1]
    assert f"requested_source_path={db_path}" in persistence_logs[1]
    assert f"resolved_source_path={db_path}" in persistence_logs[1]
    assert "exception_type=ValueError" in persistence_logs[1]
    assert "exception_message=Cannot restore the live database file in place." in persistence_logs[1]



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
