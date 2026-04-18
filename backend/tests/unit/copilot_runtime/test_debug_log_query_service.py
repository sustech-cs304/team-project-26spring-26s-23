from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from app.copilot_runtime.debug_log_store import (
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogEvent,
    DebugLogEventContext,
    DebugLogLevel,
    DebugLogQueryService,
    DebugLogStore,
)


def test_debug_log_query_service_filters_recent_events_and_returns_safe_summary(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 6, 0, tzinfo=UTC),
        event_name="provider.request.started",
        message="Provider request started.",
        category=DebugLogCategory.PROVIDER,
        level=DebugLogLevel.DEBUG,
        context=DebugLogEventContext(
            run_id="run-1",
            thread_id="thread-1",
            request_id="request-1",
            correlation_id="corr-1",
            component="provider-client",
        ),
        summary_payload={"token": "secret", "visible": "allowed"},
    )
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 7, 0, tzinfo=UTC),
        event_name="provider.request.failed",
        message="Provider request failed.",
        category=DebugLogCategory.PROVIDER,
        level=DebugLogLevel.ERROR,
        context=DebugLogEventContext(
            run_id="run-1",
            thread_id="thread-1",
            request_id="request-1",
            correlation_id="corr-1",
            component="provider-client",
        ),
        summary_payload={"password": "secret", "statusCode": 500},
        error_summary="Provider returned HTTP 500.",
        exception_type="RuntimeError",
        exception_stack="traceback...",
    )
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
        event_name="tool.executed",
        message="Tool executed.",
        category=DebugLogCategory.TOOL,
        level=DebugLogLevel.INFO,
        context=DebugLogEventContext(
            run_id="run-2",
            thread_id="thread-2",
            request_id="request-2",
            correlation_id="corr-2",
        ),
        summary_payload={"apiKey": "secret", "result": "ok"},
    )

    service = DebugLogQueryService(store)

    response = service.list_recent_events(
        limit=10,
        run_id="run-1",
        category="provider",
        level="error",
        occurred_from=datetime(2026, 4, 18, 6, 30, tzinfo=UTC),
        occurred_to=datetime(2026, 4, 18, 7, 30, tzinfo=UTC),
    )

    assert len(response.events) == 1
    event = response.events[0]
    assert event.event_name == "provider.request.failed"
    assert event.run_id == "run-1"
    assert event.category == "provider"
    assert event.level == "ERROR"
    assert event.summary["password"] == "***REDACTED***"
    assert event.summary_redacted_keys == ("password",)
    assert not hasattr(event, "exception_stack")


def test_debug_log_query_service_exposes_safe_detail_and_chain_queries(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 7, 0, tzinfo=UTC),
        event_name="runtime.phase.one",
        message="Phase one.",
        category=DebugLogCategory.RUNTIME,
        level=DebugLogLevel.INFO,
        context=DebugLogEventContext(correlation_id="corr-chain", run_id="run-chain"),
        summary_payload={"cookie": "secret", "step": 1},
    )
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 7, 1, tzinfo=UTC),
        event_name="runtime.phase.two",
        message="Phase two.",
        category=DebugLogCategory.RUNTIME,
        level=DebugLogLevel.WARN,
        context=DebugLogEventContext(correlation_id="corr-chain", run_id="run-chain"),
        summary_payload={"step": 2},
        exception_type="ValueError",
        exception_stack="trimmed traceback",
    )

    service = DebugLogQueryService(store)
    chain = service.list_correlation_chain(correlation_id="corr-chain")

    assert [event.event_name for event in chain.events] == ["runtime.phase.two", "runtime.phase.one"]

    detail = service.get_event_detail(chain.events[0].event_id)
    assert detail.event.event.event_name == "runtime.phase.two"
    assert detail.event.exception_stack == "trimmed traceback"
    assert detail.event.event.summary.get("cookie") is None


def test_debug_log_query_service_returns_redacted_error_fields(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 7, 0, tzinfo=UTC),
        event_name="provider.request.failed",
        message="Provider request failed.",
        category=DebugLogCategory.PROVIDER,
        level=DebugLogLevel.ERROR,
        context=DebugLogEventContext(correlation_id="corr-safe", run_id="run-safe"),
        summary_payload={"statusCode": 401},
        error_summary="Authorization: Bearer super-secret",
        exception_type="RuntimeError",
        exception_stack="https://example.com?refresh_token=refresh-secret",
    )

    service = DebugLogQueryService(store)
    detail = service.get_event_detail(store.list_recent_events(limit=1)[0].event_id)

    assert "super-secret" not in (detail.event.event.error_summary or "")
    assert "refresh-secret" not in (detail.event.exception_stack or "")
    assert "***REDACTED***" in (detail.event.event.error_summary or "")
    assert "***REDACTED***" in (detail.event.exception_stack or "")


def test_debug_log_query_service_redacts_message_and_summary_strings_and_normalizes_offset_filters(
    tmp_path: Path,
) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(
        store,
        occurred_at=datetime(2026, 4, 18, 6, 0, tzinfo=UTC),
        event_name="provider.request.failed",
        message="Authorization: Bearer detail-secret",
        category=DebugLogCategory.PROVIDER,
        level=DebugLogLevel.ERROR,
        context=DebugLogEventContext(correlation_id="corr-safe", run_id="run-safe"),
        summary_payload={
            "inputSummary": "api_key=input-secret",
            "errorSummary": "session_id=session-secret",
        },
        error_summary="api_key=error-secret",
    )

    service = DebugLogQueryService(store)
    response = service.list_recent_events(
        occurred_from=datetime(2026, 4, 18, 13, 30, tzinfo=timezone(timedelta(hours=8))),
        occurred_to=datetime(2026, 4, 18, 8, 30, tzinfo=timezone(timedelta(hours=2))),
        limit=10,
    )

    assert len(response.events) == 1
    event = response.events[0]
    assert "detail-secret" not in event.message
    assert "input-secret" not in event.summary["inputSummary"]
    assert "session-secret" not in event.summary["errorSummary"]
    assert "error-secret" not in (event.error_summary or "")
    assert "***REDACTED***" in event.message
    assert "***REDACTED***" in event.summary["inputSummary"]
    assert "***REDACTED***" in event.summary["errorSummary"]
    assert "***REDACTED***" in (event.error_summary or "")


def test_debug_log_query_service_requires_chain_filter(tmp_path: Path) -> None:
    service = DebugLogQueryService(DebugLogStore(db_path=tmp_path / "debug-log.sqlite3"))

    try:
        service.list_correlation_chain()
    except ValueError as exc:
        assert "require at least one" in str(exc)
    else:  # pragma: no cover - defensive assertion
        raise AssertionError("Expected chain query to require at least one correlation filter.")


def _write_event(
    store: DebugLogStore,
    *,
    occurred_at: datetime,
    event_name: str,
    message: str,
    category: DebugLogCategory,
    level: DebugLogLevel,
    context: DebugLogEventContext,
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
            message=message,
            environment=DebugLogEnvironmentMode.TEST,
            context=context,
            summary=store.sanitizer.sanitize_summary(summary_payload),
            error_summary=error_summary,
            exception_type=exception_type,
            exception_stack=exception_stack,
        )
    )
