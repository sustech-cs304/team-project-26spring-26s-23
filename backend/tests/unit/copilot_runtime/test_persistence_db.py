from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import inspect

from app.copilot_runtime.persistence import (
    DEFAULT_CHAT_DATABASE_FILE_NAME,
    create_sqlite_engine,
    resolve_chat_database_path,
    upgrade_database,
)
from app.desktop_runtime.config import DesktopRuntimeConfig, DesktopRuntimePaths


def test_resolve_chat_database_path_prefers_runtime_database_dir(tmp_path: Path) -> None:
    runtime_config = _build_runtime_config(tmp_path)

    resolved = resolve_chat_database_path(runtime_config=runtime_config)

    assert resolved == runtime_config.database_dir / DEFAULT_CHAT_DATABASE_FILE_NAME
    assert resolved.parent == runtime_config.database_dir



def test_resolve_chat_database_path_respects_explicit_empty_env_mapping(tmp_path: Path) -> None:
    resolved = resolve_chat_database_path(
        db_path=tmp_path / 'database' / 'chat.db',
        env={},
    )

    assert resolved == (tmp_path / 'database' / 'chat.db').resolve()
    assert str(resolved) != os.environ.get('COPILOT_RUNTIME_CHAT_DATABASE_PATH', '')



def test_upgrade_database_creates_expected_tables_and_indexes(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"

    upgrade_database(db_path=db_path)
    engine = create_sqlite_engine(db_path=db_path)
    try:
        inspector = inspect(engine)
        table_names = set(inspector.get_table_names())

        assert {"threads", "runs", "run_events", "thread_projection", "run_projection"} <= table_names

        thread_columns = {column["name"] for column in inspector.get_columns("threads")}
        assert "archived_at" not in thread_columns
        assert "deleted_at" not in thread_columns

        run_event_indexes = {item["name"] for item in inspector.get_indexes("run_events")}
        run_unique_constraints = {
            item["name"] for item in inspector.get_unique_constraints("run_events") if item.get("name")
        }
        assert "ix_run_events_run_id_seq" in run_event_indexes
        assert "uq_run_events_run_id_seq" in run_unique_constraints

        run_indexes = {item["name"] for item in inspector.get_indexes("runs")}
        assert "ix_runs_thread_created_at" in run_indexes
        assert "ix_runs_thread_updated_at" in run_indexes
    finally:
        engine.dispose()



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
            debug_log_database_file=runtime_root_dir / "database" / "copilot-debug-log.db",
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
