"""Contracts for persisted debug logging events and audit records."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any


class DebugLogLevel(StrEnum):
    TRACE = "TRACE"
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARN = "WARN"
    ERROR = "ERROR"


class DebugLogCategory(StrEnum):
    RUNTIME = "runtime"
    TRANSPORT = "transport"
    TOOL = "tool"
    PROVIDER = "provider"
    PERSISTENCE = "persistence"
    INTEGRATION = "integration"
    LIFECYCLE = "lifecycle"


class DebugLogEnvironmentMode(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"
    TEST = "test"
    UNKNOWN = "unknown"


@dataclass(frozen=True, slots=True)
class SanitizedPayload:
    """Sanitized payload summary allowed to be stored in SQLite."""

    content: dict[str, Any]
    truncated: bool = False
    redacted_keys: tuple[str, ...] = ()
    dropped_fields: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DebugLogEventContext:
    """Correlation and execution metadata for a debug log event."""

    phase: str | None = None
    run_id: str | None = None
    thread_id: str | None = None
    request_id: str | None = None
    correlation_id: str | None = None
    session_id: str | None = None
    component: str | None = None
    operation: str | None = None
    tags: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class DebugLogEvent:
    """Structured debug log event persisted by the store."""

    occurred_at: datetime
    level: DebugLogLevel
    category: DebugLogCategory
    event_name: str
    message: str
    environment: DebugLogEnvironmentMode
    context: DebugLogEventContext = field(default_factory=DebugLogEventContext)
    summary: SanitizedPayload = field(default_factory=lambda: SanitizedPayload(content={}))
    error_summary: str | None = None
    exception_type: str | None = None
    exception_stack: str | None = None

    @classmethod
    def create(
        cls,
        *,
        level: DebugLogLevel,
        category: DebugLogCategory,
        event_name: str,
        message: str,
        environment: DebugLogEnvironmentMode,
        context: DebugLogEventContext | None = None,
        summary: SanitizedPayload | None = None,
        error_summary: str | None = None,
        exception_type: str | None = None,
        exception_stack: str | None = None,
    ) -> "DebugLogEvent":
        return cls(
            occurred_at=datetime.now(UTC),
            level=level,
            category=category,
            event_name=event_name,
            message=message,
            environment=environment,
            context=context or DebugLogEventContext(),
            summary=summary or SanitizedPayload(content={}),
            error_summary=error_summary,
            exception_type=exception_type,
            exception_stack=exception_stack,
        )


@dataclass(frozen=True, slots=True)
class DebugLogAuditRecord:
    """Minimal audit record reserved for retention and maintenance actions."""

    occurred_at: datetime
    action: str
    trigger: str
    status: str
    details: dict[str, Any] = field(default_factory=dict)
    deleted_rows: int = 0
    error_summary: str | None = None

    @classmethod
    def create(
        cls,
        *,
        action: str,
        trigger: str,
        status: str,
        details: dict[str, Any] | None = None,
        deleted_rows: int = 0,
        error_summary: str | None = None,
    ) -> "DebugLogAuditRecord":
        return cls(
            occurred_at=datetime.now(UTC),
            action=action,
            trigger=trigger,
            status=status,
            details=dict(details) if details is not None else {},
            deleted_rows=deleted_rows,
            error_summary=error_summary,
        )


@dataclass(frozen=True, slots=True)
class DebugLogRetentionConfig:
    """Runtime-controlled retention settings for debug log maintenance."""

    retention_days: int = 14
    auto_cleanup_enabled: bool = True
    min_cleanup_interval_seconds: int = 6 * 60 * 60
    detailed_snapshot_retention_days: int | None = None
    delete_batch_size: int = 500
    checkpoint_after_cleanup: bool = False


@dataclass(frozen=True, slots=True)
class DebugLogQueryResult:
    """Recent debug event row returned for internal verification."""

    event_id: int
    occurred_at: datetime
    level: DebugLogLevel
    category: DebugLogCategory
    event_name: str
    message: str
    environment: DebugLogEnvironmentMode
    phase: str | None
    run_id: str | None
    thread_id: str | None
    request_id: str | None
    correlation_id: str | None
    session_id: str | None
    component: str | None
    operation: str | None
    tags: dict[str, str]
    summary: dict[str, Any]
    summary_truncated: bool
    summary_redacted_keys: tuple[str, ...]
    summary_dropped_fields: tuple[str, ...]
    error_summary: str | None
    exception_type: str | None
    exception_stack: str | None


@dataclass(frozen=True, slots=True)
class DebugLogQueryFilter:
    """Internal filter contract for querying persisted debug log events."""

    limit: int = 20
    run_id: str | None = None
    thread_id: str | None = None
    request_id: str | None = None
    correlation_id: str | None = None
    level: DebugLogLevel | None = None
    category: DebugLogCategory | None = None
    occurred_from: datetime | None = None
    occurred_to: datetime | None = None


@dataclass(frozen=True, slots=True)
class DebugLogSafeEventSummary:
    """Minimal safe event representation exposed by diagnostic routes."""

    event_id: int
    occurred_at: str
    level: str
    category: str
    event_name: str
    message: str
    environment: str
    phase: str | None
    run_id: str | None
    thread_id: str | None
    request_id: str | None
    correlation_id: str | None
    session_id: str | None
    component: str | None
    operation: str | None
    tags: dict[str, str]
    summary: dict[str, Any]
    summary_truncated: bool
    summary_redacted_keys: tuple[str, ...]
    summary_dropped_fields: tuple[str, ...]
    error_summary: str | None
    exception_type: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "eventId": self.event_id,
            "occurredAt": self.occurred_at,
            "level": self.level,
            "category": self.category,
            "eventName": self.event_name,
            "message": self.message,
            "environment": self.environment,
            "phase": self.phase,
            "runId": self.run_id,
            "threadId": self.thread_id,
            "requestId": self.request_id,
            "correlationId": self.correlation_id,
            "sessionId": self.session_id,
            "component": self.component,
            "operation": self.operation,
            "tags": dict(self.tags),
            "summary": dict(self.summary),
            "summaryTruncated": self.summary_truncated,
            "summaryRedactedKeys": list(self.summary_redacted_keys),
            "summaryDroppedFields": list(self.summary_dropped_fields),
            "errorSummary": self.error_summary,
            "exceptionType": self.exception_type,
        }


@dataclass(frozen=True, slots=True)
class DebugLogSafeEventDetail:
    """Detailed safe event representation for single-event diagnostics."""

    event: DebugLogSafeEventSummary
    exception_stack: str | None

    def to_dict(self) -> dict[str, Any]:
        payload = self.event.to_dict()
        payload["exceptionStack"] = self.exception_stack
        return payload


@dataclass(frozen=True, slots=True)
class DebugLogAuditSummary:
    """Safe summary of a maintenance audit record."""

    occurred_at: str
    action: str
    trigger: str
    status: str
    deleted_rows: int
    details: dict[str, Any]
    error_summary: str | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "occurredAt": self.occurred_at,
            "action": self.action,
            "trigger": self.trigger,
            "status": self.status,
            "deletedRows": self.deleted_rows,
            "details": dict(self.details),
            "errorSummary": self.error_summary,
        }


@dataclass(frozen=True, slots=True)
class DebugLogMaintenanceStatus:
    """Read-only maintenance status exposed to protected diagnostics routes."""

    retention: DebugLogRetentionConfig
    total_events: int
    database_file_size_bytes: int
    last_cleanup: DebugLogAuditSummary | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "retention": {
                "retentionDays": self.retention.retention_days,
                "autoCleanupEnabled": self.retention.auto_cleanup_enabled,
                "minCleanupIntervalSeconds": self.retention.min_cleanup_interval_seconds,
                "detailedSnapshotRetentionDays": self.retention.detailed_snapshot_retention_days,
                "deleteBatchSize": self.retention.delete_batch_size,
                "checkpointAfterCleanup": self.retention.checkpoint_after_cleanup,
            },
            "statistics": {
                "totalEvents": self.total_events,
                "databaseFileSizeBytes": self.database_file_size_bytes,
            },
            "lastCleanup": self.last_cleanup.to_dict() if self.last_cleanup is not None else None,
        }
