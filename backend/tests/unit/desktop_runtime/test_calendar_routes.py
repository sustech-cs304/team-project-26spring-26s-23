from __future__ import annotations

from datetime import datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig, DesktopRuntimePaths
from app.desktop_runtime.server import create_app
from app.event_manager.data.db_manager import (
    DatabaseManager as EventDatabaseManager,
    resolve_default_event_manager_db_path,
)
from app.event_manager.data.dto import UnifiedCalendarEvent


def test_calendar_events_route_serializes_utc_datetimes(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="calendar-token"))

    with TestClient(app) as client:
        unauthorized = client.get("/calendar/events") 
        assert unauthorized.status_code == 401
        assert unauthorized.json()["detail"]["code"] == "missing_local_token"

        authorized = client.get(
            "/calendar/events",
            headers={LOCAL_TOKEN_HEADER_NAME: "calendar-token"},
        )
        assert authorized.status_code == 200

        payload = authorized.json()
        assert "items" in payload
        assert len(payload["items"]) == 3

        for item in payload["items"]:
            assert item["start_time"].endswith("Z")
            if item["end_time"] is not None:
                assert item["end_time"].endswith("Z")


def test_calendar_events_route_prefers_persisted_items_without_initialized_marker(tmp_path: Path) -> None:
    config = _build_config(tmp_path, local_token="calendar-token")
    db = EventDatabaseManager(
        resolve_default_event_manager_db_path(config.database_dir)
    )
    db.upsert_unified_calendar_event(
        UnifiedCalendarEvent(
            title="Persisted WakeUP Lesson",
            start_time=datetime(2026, 3, 2, 8, 0, 0),
            end_time=datetime(2026, 3, 2, 9, 50, 0),
            source="wakeup",
            source_id="wakeup_lesson_001",
            description="Imported through WakeUP ICS",
        )
    )
    db.engine.dispose()

    marker_file = Path(config.database_dir) / ".calendar_initialized"
    assert not marker_file.exists()

    app = create_app(config)
    with TestClient(app) as client:
        authorized = client.get(
            "/calendar/events",
            headers={LOCAL_TOKEN_HEADER_NAME: "calendar-token"},
        )

    assert authorized.status_code == 200
    payload = authorized.json()
    assert len(payload["items"]) == 1
    assert payload["items"][0]["title"] == "Persisted WakeUP Lesson"
    assert payload["items"][0]["source"] == "wakeup"


def _build_config(tmp_path: Path, *, local_token: str | None = None) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host="127.0.0.1",
        port=8765,
        local_token=local_token,
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
