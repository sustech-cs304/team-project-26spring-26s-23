"""Normalized error taxonomy for runtime-agnostic tool contracts."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, cast

NormalizedToolErrorCode = Literal[
    "invalid_input",
    "host_capability_missing",
    "authentication_required",
    "permission_denied",
    "not_found",
    "conflict",
    "rate_limited",
    "temporarily_unavailable",
    "timeout",
    "cancelled",
    "execution_failed",
]

NORMALIZED_TOOL_ERROR_CODES: tuple[NormalizedToolErrorCode, ...] = (
    "invalid_input",
    "host_capability_missing",
    "authentication_required",
    "permission_denied",
    "not_found",
    "conflict",
    "rate_limited",
    "temporarily_unavailable",
    "timeout",
    "cancelled",
    "execution_failed",
)

RETRYABLE_NORMALIZED_TOOL_ERROR_CODES = frozenset(
    {"rate_limited", "temporarily_unavailable", "timeout"}
)


def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_details(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


def _normalize_error_code(value: str) -> NormalizedToolErrorCode:
    normalized = value.strip()
    if normalized not in NORMALIZED_TOOL_ERROR_CODES:
        raise ValueError(
            "Unknown normalized tool error code "
            f"'{value}'. Expected one of {', '.join(NORMALIZED_TOOL_ERROR_CODES)}."
        )
    return cast(NormalizedToolErrorCode, normalized)


@dataclass(frozen=True, slots=True)
class NormalizedToolError:
    """Stable error payload independent from runtime or transport details."""

    code: NormalizedToolErrorCode
    message: str
    retryable: bool | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "code", _normalize_error_code(self.code))
        object.__setattr__(
            self,
            "message",
            _require_non_empty_text(self.message, field_name="message"),
        )
        resolved_retryable = self.retryable
        if resolved_retryable is None:
            resolved_retryable = self.code in RETRYABLE_NORMALIZED_TOOL_ERROR_CODES
        object.__setattr__(self, "retryable", resolved_retryable)
        object.__setattr__(self, "details", _normalize_details(self.details))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            payload["details"] = _normalize_details(self.details)
        return payload


__all__ = [
    "NORMALIZED_TOOL_ERROR_CODES",
    "RETRYABLE_NORMALIZED_TOOL_ERROR_CODES",
    "NormalizedToolError",
    "NormalizedToolErrorCode",
]
