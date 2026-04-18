"""Lightweight helpers for writing runtime-facing structured debug events."""

from __future__ import annotations

import traceback
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .contracts import (
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogEvent,
    DebugLogEventContext,
    DebugLogLevel,
)
from .store import DebugLogStore


def _normalize_optional_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _summarize_error(error: BaseException) -> tuple[str, str, str | None]:
    error_type = type(error).__name__
    error_summary = _normalize_optional_text(str(error)) or error_type
    exception_stack = _normalize_optional_text(
        "".join(traceback.format_exception(type(error), error, error.__traceback__))
    )
    return error_type, error_summary, exception_stack


@dataclass(slots=True)
class RuntimeDebugLogWriter:
    """Small adapter for writing structured runtime, transport, and tool events."""

    store: DebugLogStore
    environment: DebugLogEnvironmentMode

    def write(
        self,
        *,
        category: DebugLogCategory,
        level: DebugLogLevel,
        event_name: str,
        message: str,
        component: str,
        operation: str,
        phase: str | None = None,
        run_id: str | None = None,
        thread_id: str | None = None,
        request_id: str | None = None,
        correlation_id: str | None = None,
        session_id: str | None = None,
        tags: Mapping[str, str] | None = None,
        summary: Mapping[str, Any] | None = None,
        error: BaseException | None = None,
    ) -> None:
        exception_type: str | None = None
        error_summary: str | None = None
        exception_stack: str | None = None
        if error is not None:
            exception_type, error_summary, exception_stack = _summarize_error(error)

        self.store.write_event(
            DebugLogEvent.create(
                level=level,
                category=category,
                event_name=event_name,
                message=message,
                environment=self.environment,
                context=DebugLogEventContext(
                    phase=_normalize_optional_text(phase),
                    run_id=_normalize_optional_text(run_id),
                    thread_id=_normalize_optional_text(thread_id),
                    request_id=_normalize_optional_text(request_id),
                    correlation_id=_normalize_optional_text(correlation_id)
                    or _normalize_optional_text(request_id)
                    or _normalize_optional_text(run_id),
                    session_id=_normalize_optional_text(session_id)
                    or _normalize_optional_text(thread_id),
                    component=_normalize_optional_text(component),
                    operation=_normalize_optional_text(operation),
                    tags={str(key): str(value) for key, value in (tags or {}).items()},
                ),
                summary=self.store.sanitizer.sanitize_summary(dict(summary or {})),
                error_summary=error_summary,
                exception_type=exception_type,
                exception_stack=exception_stack,
            )
        )


__all__ = ["RuntimeDebugLogWriter"]
