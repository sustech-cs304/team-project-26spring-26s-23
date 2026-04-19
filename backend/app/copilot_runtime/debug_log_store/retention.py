"""Retention coordination for SQLite-backed debug log maintenance."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Callable

from .contracts import DebugLogAuditRecord, DebugLogRetentionConfig
from .sanitizer import Sanitizer
from .store import DebugLogStore

_RETENTION_AUDIT_ACTION = "retention.cleanup"
_ERROR_SANITIZER = Sanitizer(max_string_length=500)
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class RetentionRunResult:
    status: str
    deleted_rows: int
    cutoff_at: datetime
    extra_maintenance_performed: bool
    error_summary: str | None = None


class RetentionCoordinator:
    """Run gentle, auditable, interval-limited retention maintenance."""

    def __init__(
        self,
        store: DebugLogStore,
        *,
        config: DebugLogRetentionConfig,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._config = config
        self._clock = clock or (lambda: datetime.now(UTC))

    @property
    def config(self) -> DebugLogRetentionConfig:
        return self._config

    @classmethod
    def from_runtime_config(
        cls,
        store: DebugLogStore,
        runtime_config: Any,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> "RetentionCoordinator":
        return cls(
            store,
            config=build_retention_config_from_runtime_config(runtime_config),
            clock=clock,
        )

    def run_due_maintenance(self, *, trigger: str = "startup") -> RetentionRunResult:
        now = _normalize_utc(self._clock())
        cutoff_at = now - timedelta(days=self._config.retention_days)
        base_details = {
            "retentionDays": self._config.retention_days,
            "cutoffAt": cutoff_at.isoformat(),
            "autoCleanupEnabled": self._config.auto_cleanup_enabled,
            "minCleanupIntervalSeconds": self._config.min_cleanup_interval_seconds,
            "detailedSnapshotRetentionDays": self._config.detailed_snapshot_retention_days,
            "batchSize": self._config.delete_batch_size,
        }

        if not self._config.auto_cleanup_enabled:
            self._write_audit(
                trigger=trigger,
                status="skipped",
                deleted_rows=0,
                details={
                    **base_details,
                    "reason": "auto_cleanup_disabled",
                    "extraMaintenancePerformed": False,
                },
            )
            return RetentionRunResult(
                status="skipped",
                deleted_rows=0,
                cutoff_at=cutoff_at,
                extra_maintenance_performed=False,
            )

        latest_audit = self._store.get_latest_audit_record(
            action=_RETENTION_AUDIT_ACTION,
            status="succeeded",
        )
        if latest_audit is not None and self._config.min_cleanup_interval_seconds > 0:
            next_allowed_at = latest_audit.occurred_at + timedelta(
                seconds=self._config.min_cleanup_interval_seconds
            )
            if now < next_allowed_at:
                self._write_audit(
                    trigger=trigger,
                    status="skipped",
                    deleted_rows=0,
                    details={
                        **base_details,
                        "reason": "min_cleanup_interval_not_elapsed",
                        "lastCleanupAt": latest_audit.occurred_at.isoformat(),
                        "nextEligibleAt": next_allowed_at.isoformat(),
                        "extraMaintenancePerformed": False,
                    },
                )
                return RetentionRunResult(
                    status="skipped",
                    deleted_rows=0,
                    cutoff_at=cutoff_at,
                    extra_maintenance_performed=False,
                )

        deleted_rows = 0
        extra_maintenance_performed = False
        try:
            while True:
                deleted_batch = self._store.delete_events_older_than(
                    cutoff_at, limit=self._config.delete_batch_size
                )
                deleted_rows += deleted_batch
                if deleted_batch < self._config.delete_batch_size:
                    break

            if deleted_rows > 0 and self._config.checkpoint_after_cleanup:
                self._store.checkpoint_wal(mode="PASSIVE")
                extra_maintenance_performed = True

            self._write_audit(
                trigger=trigger,
                status="succeeded",
                deleted_rows=deleted_rows,
                details={
                    **base_details,
                    "extraMaintenancePerformed": extra_maintenance_performed,
                },
            )
            return RetentionRunResult(
                status="succeeded",
                deleted_rows=deleted_rows,
                cutoff_at=cutoff_at,
                extra_maintenance_performed=extra_maintenance_performed,
            )
        except Exception as exc:
            self._write_audit(
                trigger=trigger,
                status="failed",
                deleted_rows=deleted_rows,
                details={
                    **base_details,
                    "extraMaintenancePerformed": extra_maintenance_performed,
                },
                error_summary=_truncate_error_summary(exc),
            )
            return RetentionRunResult(
                status="failed",
                deleted_rows=deleted_rows,
                cutoff_at=cutoff_at,
                extra_maintenance_performed=extra_maintenance_performed,
                error_summary=_truncate_error_summary(exc),
            )

    def _write_audit(
        self,
        *,
        trigger: str,
        status: str,
        deleted_rows: int,
        details: dict[str, Any],
        error_summary: str | None = None,
    ) -> None:
        try:
            self._store.write_audit_record(
                DebugLogAuditRecord.create(
                    action=_RETENTION_AUDIT_ACTION,
                    trigger=trigger,
                    status=status,
                    deleted_rows=deleted_rows,
                    details=details,
                    error_summary=error_summary,
                )
            )
        except Exception:
            _LOGGER.exception(
                "Debug log retention audit write failed; continuing maintenance flow.",
                extra={
                    "trigger": trigger,
                    "status": status,
                    "deleted_rows": deleted_rows,
                },
            )


def build_retention_config_from_runtime_config(
    runtime_config: Any,
) -> DebugLogRetentionConfig:
    return DebugLogRetentionConfig(
        retention_days=max(
            int(getattr(runtime_config, "debug_log_retention_days", 14)), 1
        ),
        auto_cleanup_enabled=bool(
            getattr(runtime_config, "debug_log_auto_cleanup_enabled", True)
        ),
        min_cleanup_interval_seconds=max(
            int(
                getattr(runtime_config, "debug_log_min_cleanup_interval_seconds", 21600)
            ),
            0,
        ),
        detailed_snapshot_retention_days=_normalize_optional_int(
            getattr(runtime_config, "debug_log_snapshot_retention_days", None)
        ),
    )


def _normalize_optional_int(value: object | None) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int | str):
        raise TypeError(
            "Expected retention configuration value to be int, str, or None."
        )
    normalized = int(value)
    return normalized if normalized > 0 else None


def _normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _truncate_error_summary(exc: Exception) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    return _ERROR_SANITIZER.sanitize_error_text(text) or exc.__class__.__name__


__all__ = [
    "DebugLogRetentionConfig",
    "RetentionCoordinator",
    "RetentionRunResult",
    "build_retention_config_from_runtime_config",
]
