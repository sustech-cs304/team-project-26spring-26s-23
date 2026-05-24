from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig, DesktopRuntimePaths
from app.desktop_runtime.server import create_app
from app.timeline_db import ensure_timeline_schema, insert_timeline_event


def _set_user_data_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Set COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR and return the timeline.db path."""
    user_data = tmp_path / "user-data"
    user_data.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR", str(user_data))
    return user_data / "timeline.db"


def test_calendar_events_route_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _set_user_data_env(tmp_path, monkeypatch)
    config = _build_config(tmp_path, local_token="calendar-token")
    app = create_app(config)

    with TestClient(app) as client:
        resp = client.get("/calendar/events", headers={LOCAL_TOKEN_HEADER_NAME: "calendar-token"})
        assert resp.status_code == 200
        assert resp.json()["items"] == []


def test_calendar_events_route_persisted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = _set_user_data_env(tmp_path, monkeypatch)
    ensure_timeline_schema(db_path)
    insert_timeline_event(
        db_path,
        source="wakeup", source_id="wk_001",
        title="WakeUP Lesson", start_time="2026-03-02T08:00:00",
        end_time="2026-03-02T09:50:00",
        description="Imported",
    )

    config = _build_config(tmp_path, local_token="calendar-token")
    app = create_app(config)
    with TestClient(app) as client:
        resp = client.get("/calendar/events", headers={LOCAL_TOKEN_HEADER_NAME: "calendar-token"})
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert len(items) == 1
        assert items[0]["title"] == "WakeUP Lesson"
        assert items[0]["source"] == "wakeup"


def _build_config(tmp_path: Path, *, local_token: str | None = None) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host="127.0.0.1", port=8765, local_token=local_token,
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
        app_mode="desktop", environment="test",
    )
