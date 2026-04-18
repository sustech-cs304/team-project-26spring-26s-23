from __future__ import annotations

import logging
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app.copilot_runtime.debug_log_store import DebugLogQueryService, RetentionCoordinator
from app.copilot_runtime.agent import PydanticAIAgentExecutor
from app.desktop_runtime.app_factory import create_app
from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, parse_runtime_config


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


def test_create_app_supports_runtime_to_query_debug_log_regression_flow(tmp_path: Path) -> None:
    config = parse_runtime_config(
        [
            "--database-dir",
            str(tmp_path / "database"),
            "--debug-log-database-file",
            str(tmp_path / "database" / "runtime-debug.sqlite3"),
            "--environment",
            "test",
            "--local-token",
            "debug-token",
        ],
        env={},
        cwd=tmp_path,
    )
    app = create_app(config, agent_executor=PydanticAIAgentExecutor(model=TestModel(custom_output_text="unused")))

    with TestClient(app) as client:
        thread_response = client.post("/", json={"method": "thread/create", "body": {"agentId": "default"}})
        assert thread_response.status_code == 200
        thread_id = thread_response.json()["threadId"]

        run_start_response = client.post(
            "/",
            json={
                "method": "run/start",
                "body": {
                    "threadId": thread_id,
                    "agentId": "default",
                    "message": {"role": "user", "content": "hello"},
                    "policy": {
                        "modelRoute": {
                            "routeRef": {
                                "routeKind": "provider-model",
                                "profileId": "profile-1",
                                "modelId": "gpt-4.1",
                            }
                        }
                    },
                },
            },
        )
        assert run_start_response.status_code == 200
        run_id = run_start_response.json()["run"]["runId"]

        recent_response = client.get(
            "/diagnostics/debug-logs/recent",
            headers={LOCAL_TOKEN_HEADER_NAME: "debug-token"},
            params={"runId": run_id},
        )

    assert recent_response.status_code == 200
    payload = recent_response.json()
    assert payload["ok"] is True
    event_names = [event["eventName"] for event in payload["events"]]
    assert "runtime.run.start.succeeded" in event_names
    assert any(event_name.startswith("transport.http.run_start.") for event_name in event_names)


def test_create_app_keeps_startup_available_when_retention_maintenance_raises(tmp_path: Path, caplog) -> None:
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

    with patch(
        "app.desktop_runtime.app_factory.RetentionCoordinator.run_due_maintenance",
        side_effect=RuntimeError("database locked"),
    ) as run_due_maintenance:
        app = create_app(config)

        with caplog.at_level(logging.ERROR, logger="uvicorn.error"):
            with TestClient(app):
                assert app.state.copilot_runtime_debug_log_store.db_path == config.debug_log_database_file

    assert run_due_maintenance.call_count == 1
    assert "desktop-runtime startup retention maintenance failed; continuing startup" in caplog.text
