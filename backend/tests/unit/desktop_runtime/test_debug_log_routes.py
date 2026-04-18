from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.copilot_runtime.debug_log_store import (
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogEvent,
    DebugLogEventContext,
    DebugLogLevel,
)
from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig, parse_runtime_config
from app.desktop_runtime.server import create_app


def test_debug_log_routes_require_local_token_and_support_recent_list_detail_and_chain(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="debug-token"))

    with TestClient(app) as client:
        store = app.state.copilot_runtime_debug_log_store
        _write_event(
            store,
            occurred_at=datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
            event_name="provider.request.started",
            level=DebugLogLevel.DEBUG,
            category=DebugLogCategory.PROVIDER,
            run_id="run-a",
            thread_id="thread-a",
            request_id="request-a",
            correlation_id="corr-a",
            summary_payload={"token": "secret", "preview": "safe"},
        )
        _write_event(
            store,
            occurred_at=datetime(2026, 4, 18, 8, 1, tzinfo=UTC),
            event_name="provider.request.failed",
            level=DebugLogLevel.ERROR,
            category=DebugLogCategory.PROVIDER,
            run_id="run-a",
            thread_id="thread-a",
            request_id="request-a",
            correlation_id="corr-a",
            summary_payload={"password": "secret", "statusCode": 500},
            exception_stack="safe traceback",
            error_summary="Request failed.",
            exception_type="RuntimeError",
        )

        unauthorized = client.get("/diagnostics/debug-logs/recent")
        headers = {LOCAL_TOKEN_HEADER_NAME: "debug-token"}
        recent = client.get(
            "/diagnostics/debug-logs/recent",
            headers=headers,
            params={"runId": "run-a", "category": "provider", "level": "ERROR"},
        )
        recent_payload = recent.json()
        event_id = recent_payload["events"][0]["eventId"]
        detail = client.get(f"/diagnostics/debug-logs/events/{event_id}", headers=headers)
        chain = client.get(
            "/diagnostics/debug-logs/chain",
            headers=headers,
            params={"correlationId": "corr-a"},
        )

    assert unauthorized.status_code == 401
    assert unauthorized.json()["detail"]["code"] == "invalid_local_token"

    assert recent.status_code == 200
    assert recent_payload["ok"] is True
    assert recent_payload["version"] == "debug-log-v1"
    assert len(recent_payload["events"]) == 1
    assert recent_payload["events"][0]["eventName"] == "provider.request.failed"
    assert recent_payload["events"][0]["summary"]["password"] == "***REDACTED***"
    assert "exceptionStack" not in recent_payload["events"][0]

    detail_payload = detail.json()
    assert detail.status_code == 200
    assert detail_payload["event"]["eventName"] == "provider.request.failed"
    assert detail_payload["event"]["exceptionStack"] == "safe traceback"
    assert detail_payload["event"]["summary"]["password"] == "***REDACTED***"

    chain_payload = chain.json()
    assert chain.status_code == 200
    assert [event["eventName"] for event in chain_payload["events"]] == [
        "provider.request.failed",
        "provider.request.started",
    ]


def test_debug_log_routes_validate_chain_filters_and_missing_events(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="debug-token"))

    with TestClient(app) as client:
        headers = {LOCAL_TOKEN_HEADER_NAME: "debug-token"}
        missing = client.get("/diagnostics/debug-logs/events/9999", headers=headers)
        invalid_chain = client.get("/diagnostics/debug-logs/chain", headers=headers)

    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "debug_log_event_not_found"
    assert invalid_chain.status_code == 400
    assert invalid_chain.json()["detail"]["code"] == "debug_log_chain_filter_required"


def test_debug_log_routes_expose_protected_maintenance_status(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="debug-token"))

    with TestClient(app) as client:
        store = app.state.copilot_runtime_debug_log_store
        _write_event(
            store,
            occurred_at=datetime(2026, 4, 18, 8, 2, tzinfo=UTC),
            event_name="runtime.maintenance.visible",
            level=DebugLogLevel.INFO,
            category=DebugLogCategory.RUNTIME,
            run_id="run-maintenance",
            thread_id="thread-maintenance",
            request_id="request-maintenance",
            correlation_id="corr-maintenance",
            summary_payload={"visible": True},
        )

        unauthorized = client.get("/diagnostics/debug-logs/maintenance-status")
        authorized = client.get(
            "/diagnostics/debug-logs/maintenance-status",
            headers={LOCAL_TOKEN_HEADER_NAME: "debug-token"},
        )

    assert unauthorized.status_code == 401
    assert unauthorized.json()["detail"]["code"] == "invalid_local_token"

    payload = authorized.json()
    assert authorized.status_code == 200
    assert payload["ok"] is True
    assert payload["version"] == "debug-log-v1"
    assert payload["maintenance"]["retention"]["retentionDays"] == 14
    assert payload["maintenance"]["retention"]["autoCleanupEnabled"] is True
    assert payload["maintenance"]["statistics"]["totalEvents"] >= 1
    assert payload["maintenance"]["lastCleanup"]["action"] == "retention.cleanup"
    assert payload["maintenance"]["lastCleanup"]["details"]["cutoffAt"]


def _build_config(tmp_path: Path, *, local_token: str | None = None) -> DesktopRuntimeConfig:
    argv = [
        "--user-data-dir",
        str(tmp_path / "user-data"),
        "--host",
        "127.0.0.1",
        "--port",
        "8100",
        "--environment",
        "test",
    ]
    if local_token is not None:
        argv.extend(["--local-token", local_token])
    return parse_runtime_config(
        argv,
        env={},
        cwd=tmp_path,
    )


def _write_event(
    store,
    *,
    occurred_at: datetime,
    event_name: str,
    level: DebugLogLevel,
    category: DebugLogCategory,
    run_id: str,
    thread_id: str,
    request_id: str,
    correlation_id: str,
    summary_payload: dict[str, object],
    error_summary: str | None = None,
    exception_type: str | None = None,
    exception_stack: str | None = None,
) -> None:
    store.write_event(
        DebugLogEvent(
            occurred_at=occurred_at,
            level=level,
            category=category,
            event_name=event_name,
            message=event_name,
            environment=DebugLogEnvironmentMode.TEST,
            context=DebugLogEventContext(
                run_id=run_id,
                thread_id=thread_id,
                request_id=request_id,
                correlation_id=correlation_id,
                component="test-component",
                operation="test-operation",
            ),
            summary=store.sanitizer.sanitize_summary(summary_payload),
            error_summary=error_summary,
            exception_type=exception_type,
            exception_stack=exception_stack,
        )
    )
