"""Invocation context models for runtime-agnostic tool contracts."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_trace(value: Mapping[str, str]) -> dict[str, str]:
    return {str(key): str(item) for key, item in value.items()}


def _normalize_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


@dataclass(frozen=True, slots=True)
class ToolInvocationContext:
    """Stable invocation metadata passed into a tool execution."""

    invocation_id: str
    tool_id: str
    actor: str = "agent"
    run_id: str | None = None
    thread_id: str | None = None
    request_id: str | None = None
    requested_at: datetime | None = None
    trace: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "invocation_id",
            _require_non_empty_text(self.invocation_id, field_name="invocation_id"),
        )
        object.__setattr__(
            self,
            "tool_id",
            _require_non_empty_text(self.tool_id, field_name="tool_id"),
        )
        object.__setattr__(
            self,
            "actor",
            _require_non_empty_text(self.actor, field_name="actor"),
        )
        object.__setattr__(self, "run_id", _normalize_optional_text(self.run_id))
        object.__setattr__(self, "thread_id", _normalize_optional_text(self.thread_id))
        object.__setattr__(self, "request_id", _normalize_optional_text(self.request_id))
        if self.requested_at is not None and (
            self.requested_at.tzinfo is None
            or self.requested_at.utcoffset() is None
        ):
            raise ValueError("requested_at must be timezone-aware when provided.")
        object.__setattr__(self, "trace", _normalize_trace(self.trace))
        object.__setattr__(self, "metadata", _normalize_metadata(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "invocationId": self.invocation_id,
            "toolId": self.tool_id,
            "actor": self.actor,
            "trace": _normalize_trace(self.trace),
            "metadata": _normalize_metadata(self.metadata),
        }
        if self.run_id is not None:
            payload["runId"] = self.run_id
        if self.thread_id is not None:
            payload["threadId"] = self.thread_id
        if self.request_id is not None:
            payload["requestId"] = self.request_id
        if self.requested_at is not None:
            payload["requestedAt"] = self.requested_at.isoformat()
        return payload


__all__ = ["ToolInvocationContext"]
