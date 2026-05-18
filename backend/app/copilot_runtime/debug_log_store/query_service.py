"""Read-only query service for safe debug log diagnostics views."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .contracts import (
    DebugLogAuditSummary,
    DebugLogCategory,
    DebugLogLevel,
    DebugLogMaintenanceStatus,
    DebugLogQueryFilter,
    DebugLogQueryResult,
    DebugLogRetentionConfig,
    DebugLogSafeEventDetail,
    DebugLogSafeEventSummary,
)
from .store import DebugLogStore


@dataclass(frozen=True, slots=True)
class DebugLogListResponse:
    events: tuple[DebugLogSafeEventSummary, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": True,
            "version": "debug-log-v1",
            "events": [event.to_dict() for event in self.events],
        }


@dataclass(frozen=True, slots=True)
class DebugLogDetailResponse:
    event: DebugLogSafeEventDetail

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": True,
            "version": "debug-log-v1",
            "event": self.event.to_dict(),
        }


@dataclass(frozen=True, slots=True)
class DebugLogMaintenanceStatusResponse:
    status: DebugLogMaintenanceStatus

    def to_dict(self) -> dict[str, object]:
        return {
            "ok": True,
            "version": "debug-log-v1",
            "maintenance": self.status.to_dict(),
        }


class DebugLogQueryService:
    """Compose internal store queries into safe, route-friendly read models."""

    def __init__(
        self,
        store: DebugLogStore,
        *,
        retention_config: DebugLogRetentionConfig | None = None,
    ) -> None:
        self._store = store
        self._retention_config = retention_config or DebugLogRetentionConfig()

    def list_recent_events(
        self,
        *,
        limit: int = 20,
        run_id: str | None = None,
        thread_id: str | None = None,
        request_id: str | None = None,
        correlation_id: str | None = None,
        level: str | None = None,
        category: str | None = None,
        occurred_from: datetime | None = None,
        occurred_to: datetime | None = None,
    ) -> DebugLogListResponse:
        query_filter = DebugLogQueryFilter(
            limit=limit,
            run_id=_normalize_optional_text(run_id),
            thread_id=_normalize_optional_text(thread_id),
            request_id=_normalize_optional_text(request_id),
            correlation_id=_normalize_optional_text(correlation_id),
            level=_parse_level(level),
            category=_parse_category(category),
            occurred_from=occurred_from,
            occurred_to=occurred_to,
        )
        results = self._store.query_events(query_filter)
        return DebugLogListResponse(
            events=tuple(self._to_safe_summary(result) for result in results)
        )

    def get_event_detail(self, event_id: int) -> DebugLogDetailResponse:
        result = self._store.get_event_by_id(event_id)
        if result is None:
            raise LookupError(f"Debug log event '{event_id}' was not found.")
        return DebugLogDetailResponse(event=self._to_safe_detail(result))

    def get_maintenance_status(self) -> DebugLogMaintenanceStatusResponse:
        latest_audit = self._store.get_latest_audit_record(action="retention.cleanup")
        audit_summary = None
        if latest_audit is not None:
            audit_summary = DebugLogAuditSummary(
                occurred_at=latest_audit.occurred_at.isoformat(),
                action=latest_audit.action,
                trigger=latest_audit.trigger,
                status=latest_audit.status,
                deleted_rows=latest_audit.deleted_rows,
                details=dict(latest_audit.details),
                error_summary=latest_audit.error_summary,
            )
        return DebugLogMaintenanceStatusResponse(
            status=DebugLogMaintenanceStatus(
                retention=self._retention_config,
                total_events=self._store.count_events(),
                database_file_size_bytes=self._store.get_database_file_size_bytes(),
                last_cleanup=audit_summary,
            )
        )

    def list_correlation_chain(
        self,
        *,
        run_id: str | None = None,
        thread_id: str | None = None,
        request_id: str | None = None,
        correlation_id: str | None = None,
        limit: int = 100,
    ) -> DebugLogListResponse:
        query_filter = DebugLogQueryFilter(
            limit=limit,
            run_id=_normalize_optional_text(run_id),
            thread_id=_normalize_optional_text(thread_id),
            request_id=_normalize_optional_text(request_id),
            correlation_id=_normalize_optional_text(correlation_id),
        )
        if not any(
            (
                query_filter.run_id,
                query_filter.thread_id,
                query_filter.request_id,
                query_filter.correlation_id,
            )
        ):
            raise ValueError(
                "Correlation chain queries require at least one of run_id, thread_id, request_id, or correlation_id."
            )
        results = self._store.query_events(query_filter)
        return DebugLogListResponse(
            events=tuple(self._to_safe_summary(result) for result in results)
        )

    def _to_safe_summary(self, result: DebugLogQueryResult) -> DebugLogSafeEventSummary:
        return DebugLogSafeEventSummary(
            event_id=result.event_id,
            occurred_at=result.occurred_at.isoformat(),
            level=result.level.value,
            category=result.category.value,
            event_name=result.event_name,
            message=result.message,
            environment=result.environment.value,
            phase=result.phase,
            run_id=result.run_id,
            thread_id=result.thread_id,
            request_id=result.request_id,
            correlation_id=result.correlation_id,
            session_id=result.session_id,
            component=result.component,
            operation=result.operation,
            tags=dict(result.tags),
            summary=dict(result.summary),
            summary_truncated=result.summary_truncated,
            summary_redacted_keys=result.summary_redacted_keys,
            summary_dropped_fields=result.summary_dropped_fields,
            error_summary=result.error_summary,
            exception_type=result.exception_type,
        )

    def _to_safe_detail(self, result: DebugLogQueryResult) -> DebugLogSafeEventDetail:
        return DebugLogSafeEventDetail(
            event=self._to_safe_summary(result),
            exception_stack=result.exception_stack,
        )


def _parse_level(level: str | None) -> DebugLogLevel | None:
    normalized = _normalize_optional_text(level)
    if normalized is None:
        return None
    return DebugLogLevel(normalized.upper())


def _parse_category(category: str | None) -> DebugLogCategory | None:
    normalized = _normalize_optional_text(category)
    if normalized is None:
        return None
    return DebugLogCategory(normalized.lower())


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


__all__ = [
    "DebugLogDetailResponse",
    "DebugLogListResponse",
    "DebugLogMaintenanceStatusResponse",
    "DebugLogQueryService",
]
