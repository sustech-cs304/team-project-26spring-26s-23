from __future__ import annotations

import sqlite3
from pathlib import Path

from app.copilot_runtime.debug_log_store import (
    DebugLogAuditRecord,
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogEvent,
    DebugLogEventContext,
    DebugLogLevel,
    DebugLogStore,
    Sanitizer,
    resolve_debug_log_database_path,
)
from app.desktop_runtime.config import parse_runtime_config


def test_resolve_debug_log_database_path_uses_runtime_config(tmp_path: Path) -> None:
    runtime_config = parse_runtime_config(
        ["--database-dir", str(tmp_path / "database")],
        env={},
        cwd=tmp_path,
    )

    resolved = resolve_debug_log_database_path(runtime_config=runtime_config)

    assert resolved == runtime_config.debug_log_database_file
    assert resolved.parent.exists()


def test_sanitizer_redacts_sensitive_keys_and_truncates_values() -> None:
    sanitizer = Sanitizer(max_string_length=12, max_collection_items=2, max_depth=2)

    sanitized = sanitizer.sanitize_summary(
        {
            "token": "secret-token",
            "message": "abcdefghijklmnopqrstuvwxyz",
            "payload": {
                "cookie": "cookie-value",
                "items": [1, 2, 3],
            },
        }
    )

    assert sanitized.content["token"] == "***REDACTED***"
    assert sanitized.content["message"] == "abcdefghijkl…"
    assert sanitized.content["payload"]["cookie"] == "***REDACTED***"
    assert sanitized.content["payload"]["items"] == [1, 2]
    assert sanitized.truncated is True
    assert sanitized.redacted_keys == ("token",)
    assert "message" in sanitized.dropped_fields
    assert "payload.items" in sanitized.dropped_fields


def test_sanitizer_matches_common_sensitive_key_variants() -> None:
    sanitizer = Sanitizer()

    sanitized = sanitizer.sanitize_summary(
        {
            "access_token": "secret-1",
            "refresh-token": "secret-2",
            "API_KEY": "secret-3",
            "session_id": "secret-4",
        }
    )

    assert sanitized.content["access_token"] == "***REDACTED***"
    assert sanitized.content["refresh-token"] == "***REDACTED***"
    assert sanitized.content["API_KEY"] == "***REDACTED***"
    assert sanitized.content["session_id"] == "***REDACTED***"
    assert sanitized.redacted_keys == ("API_KEY", "access_token", "refresh-token", "session_id")


def test_debug_log_store_initializes_schema_and_reads_recent_events(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    event = DebugLogEvent.create(
        level=DebugLogLevel.INFO,
        category=DebugLogCategory.LIFECYCLE,
        event_name="runtime.started",
        message="Runtime started.",
        environment=DebugLogEnvironmentMode.DEVELOPMENT,
        context=DebugLogEventContext(
            phase="startup",
            correlation_id="corr-123",
            component="desktop_runtime",
        ),
        summary=store.sanitizer.sanitize_summary(
            {
                "token": "should-not-persist",
                "summary": "visible",
            }
        ),
    )

    store.write_event(event)
    store.write_audit_record(
        DebugLogAuditRecord.create(
            action="retention.check",
            trigger="startup",
            status="skipped",
            details={"reason": "not-implemented-yet"},
        )
    )

    events = store.list_recent_events(limit=5)

    assert len(events) == 1
    persisted = events[0]
    assert persisted.event_name == "runtime.started"
    assert persisted.phase == "startup"
    assert persisted.correlation_id == "corr-123"
    assert persisted.summary["token"] == "***REDACTED***"
    assert persisted.summary_redacted_keys == ("token",)
    assert persisted.environment == DebugLogEnvironmentMode.DEVELOPMENT

    connection = sqlite3.connect(store.db_path)
    try:
        audit_count = connection.execute("SELECT COUNT(*) FROM debug_log_audit").fetchone()[0]
    finally:
        connection.close()
    assert audit_count == 1


def test_debug_log_store_truncates_exception_stack_before_persisting(tmp_path: Path) -> None:
    store = DebugLogStore(
        db_path=tmp_path / "debug-log.sqlite3",
        sanitizer=Sanitizer(max_string_length=16),
    )

    store.write_event(
        DebugLogEvent.create(
            level=DebugLogLevel.ERROR,
            category=DebugLogCategory.RUNTIME,
            event_name="runtime.failed",
            message="Runtime failed.",
            environment=DebugLogEnvironmentMode.TEST,
            exception_type="RuntimeError",
            exception_stack="0123456789abcdefghijklmnopqrstuvwxyz",
        )
    )

    persisted = store.list_recent_events(limit=1)[0]

    assert persisted.exception_type == "RuntimeError"
    assert persisted.exception_stack == "0123456789abcdef…"


def test_debug_log_store_redacts_sensitive_error_summary_and_stack_before_persisting(tmp_path: Path) -> None:
    store = DebugLogStore(
        db_path=tmp_path / "debug-log.sqlite3",
        sanitizer=Sanitizer(max_string_length=240),
    )

    store.write_event(
        DebugLogEvent.create(
            level=DebugLogLevel.ERROR,
            category=DebugLogCategory.RUNTIME,
            event_name="runtime.failed",
            message="Runtime failed.",
            environment=DebugLogEnvironmentMode.TEST,
            error_summary="request failed api_key=topsecret Bearer abc123",
            exception_type="RuntimeError",
            exception_stack=(
                "Traceback... https://example.com?access_token=alpha&x=1\n"
                "Authorization: Bearer zzz\n"
                "session_id=opaque"
            ),
        )
    )

    persisted = store.list_recent_events(limit=1)[0]

    assert "topsecret" not in (persisted.error_summary or "")
    assert "abc123" not in (persisted.error_summary or "")
    assert "alpha" not in (persisted.exception_stack or "")
    assert "zzz" not in (persisted.exception_stack or "")
    assert "opaque" not in (persisted.exception_stack or "")
    assert "***REDACTED***" in (persisted.error_summary or "")
    assert "***REDACTED***" in (persisted.exception_stack or "")


def test_checkpoint_wal_rejects_unsupported_mode(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")

    try:
        store.checkpoint_wal(mode="PASSIVE); DROP TABLE debug_log_events; --")
    except ValueError as exc:
        assert "Unsupported wal_checkpoint mode" in str(exc)
    else:  # pragma: no cover - defensive assertion
        raise AssertionError("Expected checkpoint_wal() to reject unsupported modes.")
