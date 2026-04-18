from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.copilot_runtime.debug_log_store import DebugLogQueryService, RetentionCoordinator
from app.desktop_runtime.app_factory import create_app
from app.desktop_runtime.config import parse_runtime_config


def test_create_app_initializes_debug_log_store_and_writes_lifecycle_events(tmp_path: Path) -> None:
    config = parse_runtime_config(
        [
            "--database-dir",
            str(tmp_path / "database"),
            "--debug-log-database-file",
            str(tmp_path / "database" / "runtime-debug.sqlite3"),
        ],
        env={},
        cwd=tmp_path,
    )

    app = create_app(config)

    with TestClient(app):
        debug_log_store = app.state.copilot_runtime_debug_log_store
        debug_log_retention_coordinator = app.state.copilot_runtime_debug_log_retention_coordinator
        debug_log_query_service = app.state.copilot_runtime_debug_log_query_service
        assert debug_log_store.db_path == config.debug_log_database_file
        assert isinstance(debug_log_retention_coordinator, RetentionCoordinator)
        assert isinstance(debug_log_query_service, DebugLogQueryService)
        startup_events = debug_log_store.list_recent_events(limit=5)
        assert any(event.event_name == "desktop_runtime.startup.initialized" for event in startup_events)
        startup_audit = debug_log_store.get_latest_audit_record(action="retention.cleanup")
        assert startup_audit is not None

    shutdown_events = app.state.copilot_runtime_debug_log_store.list_recent_events(limit=10)
    event_names = [event.event_name for event in shutdown_events]
    assert "desktop_runtime.startup.initialized" in event_names
    assert "desktop_runtime.shutdown.completed" in event_names
