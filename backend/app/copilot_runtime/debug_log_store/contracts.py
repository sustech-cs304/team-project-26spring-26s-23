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
class DebugLogQueryResult:
    """Recent debug event row returned for internal verification."""

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
