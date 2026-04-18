from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from app.copilot_runtime.debug_log_store import (
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogEvent,
    DebugLogEventContext,
    DebugLogLevel,
    DebugLogRetentionConfig,
    DebugLogStore,
    RetentionCoordinator,
)


def test_retention_coordinator_deletes_expired_events_in_batches_and_writes_audit(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(store, occurred_at=datetime(2026, 4, 1, 8, 0, tzinfo=UTC), event_name="expired.1")
    _write_event(store, occurred_at=datetime(2026, 4, 2, 8, 0, tzinfo=UTC), event_name="expired.2")
    _write_event(store, occurred_at=datetime(2026, 4, 17, 8, 0, tzinfo=UTC), event_name="fresh.1")

    coordinator = RetentionCoordinator(
        store,
        config=DebugLogRetentionConfig(
            retention_days=7,
            auto_cleanup_enabled=True,
            min_cleanup_interval_seconds=0,
            delete_batch_size=1,
        ),
        clock=lambda: datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
    )

    result = coordinator.run_due_maintenance(trigger="startup")
    events = store.list_recent_events(limit=10)
    latest_audit = store.get_latest_audit_record(action="retention.cleanup")

    assert result.status == "succeeded"
    assert result.deleted_rows == 2
    assert [event.event_name for event in events] == ["fresh.1"]
    assert latest_audit is not None
    assert latest_audit.status == "succeeded"
    assert latest_audit.deleted_rows == 2
    assert latest_audit.details["retentionDays"] == 7
    assert latest_audit.details["extraMaintenancePerformed"] is False


def test_retention_coordinator_records_skipped_audit_when_auto_cleanup_disabled(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(store, occurred_at=datetime(2026, 4, 1, 8, 0, tzinfo=UTC), event_name="expired.1")

    coordinator = RetentionCoordinator(
        store,
        config=DebugLogRetentionConfig(
            retention_days=7,
            auto_cleanup_enabled=False,
            min_cleanup_interval_seconds=0,
        ),
        clock=lambda: datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
    )

    result = coordinator.run_due_maintenance(trigger="startup")
    latest_audit = store.get_latest_audit_record(action="retention.cleanup")

    assert result.status == "skipped"
    assert store.count_events() == 1
    assert latest_audit is not None
    assert latest_audit.status == "skipped"
    assert latest_audit.details["reason"] == "auto_cleanup_disabled"


def test_retention_coordinator_respects_minimum_cleanup_interval(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(store, occurred_at=datetime(2026, 4, 1, 8, 0, tzinfo=UTC), event_name="expired.1")

    coordinator = RetentionCoordinator(
        store,
        config=DebugLogRetentionConfig(
            retention_days=7,
            auto_cleanup_enabled=True,
            min_cleanup_interval_seconds=3600,
        ),
        clock=lambda: datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
    )

    first_result = coordinator.run_due_maintenance(trigger="startup")
    second_result = coordinator.run_due_maintenance(trigger="startup")
    audits = store.list_audit_records(limit=10, action="retention.cleanup")

    assert first_result.status == "succeeded"
    assert second_result.status == "skipped"
    assert len(audits) == 2
    assert audits[0].status == "skipped"
    assert audits[0].details["reason"] == "min_cleanup_interval_not_elapsed"


def test_retention_coordinator_allows_immediate_retry_after_failed_cleanup(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(store, occurred_at=datetime(2026, 4, 1, 8, 0, tzinfo=UTC), event_name="expired.1")

    delete_calls = 0
    original_delete = store.delete_events_older_than

    def flaky_delete(cutoff: datetime, *, limit: int) -> int:
        nonlocal delete_calls
        delete_calls += 1
        if delete_calls == 1:
            raise RuntimeError("database locked")
        return original_delete(cutoff, limit=limit)

    store.delete_events_older_than = flaky_delete  # type: ignore[method-assign]
    coordinator = RetentionCoordinator(
        store,
        config=DebugLogRetentionConfig(
            retention_days=7,
            auto_cleanup_enabled=True,
            min_cleanup_interval_seconds=3600,
        ),
        clock=lambda: datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
    )

    first_result = coordinator.run_due_maintenance(trigger="startup")
    second_result = coordinator.run_due_maintenance(trigger="startup")
    audits = store.list_audit_records(limit=10, action="retention.cleanup")

    assert first_result.status == "failed"
    assert second_result.status == "succeeded"
    assert delete_calls == 2
    assert len(audits) == 2
    assert audits[0].status == "succeeded"
    assert audits[1].status == "failed"


def test_retention_coordinator_runs_checkpoint_when_enabled(tmp_path: Path) -> None:
    store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    _write_event(store, occurred_at=datetime(2026, 4, 1, 8, 0, tzinfo=UTC), event_name="expired.1")

    checkpoint_calls: list[str] = []
    original_checkpoint_wal = store.checkpoint_wal

    def tracking_checkpoint_wal(*, mode: str = "PASSIVE") -> None:
        checkpoint_calls.append(mode)
        original_checkpoint_wal(mode=mode)

    store.checkpoint_wal = tracking_checkpoint_wal  # type: ignore[method-assign]
    coordinator = RetentionCoordinator(
        store,
        config=DebugLogRetentionConfig(
            retention_days=7,
            auto_cleanup_enabled=True,
            min_cleanup_interval_seconds=0,
            checkpoint_after_cleanup=True,
        ),
        clock=lambda: datetime(2026, 4, 18, 8, 0, tzinfo=UTC),
    )

    result = coordinator.run_due_maintenance(trigger="startup")
    latest_audit = store.get_latest_audit_record(action="retention.cleanup")

    assert result.status == "succeeded"
    assert checkpoint_calls == ["PASSIVE"]
    assert result.extra_maintenance_performed is True
    assert latest_audit is not None
    assert latest_audit.details["extraMaintenancePerformed"] is True


def _write_event(store: DebugLogStore, *, occurred_at: datetime, event_name: str) -> None:
    store.write_event(
        DebugLogEvent(
            occurred_at=occurred_at,
            level=DebugLogLevel.INFO,
            category=DebugLogCategory.RUNTIME,
            event_name=event_name,
            message=event_name,
            environment=DebugLogEnvironmentMode.TEST,
            context=DebugLogEventContext(component="test-component", operation="test-operation"),
            summary=store.sanitizer.sanitize_summary({"event": event_name}),
        )
    )
