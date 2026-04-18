"""Normalized error taxonomy for runtime-agnostic tool contracts."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import dataclass, field
import re
import traceback
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


_SENSITIVE_ERROR_FIELD_MARKERS = (
    "password",
    "token",
    "secret",
    "cookie",
    "authorization",
)
_REDACTED_TOOL_ERROR_VALUE = "[REDACTED]"
_QUOTED_SENSITIVE_TEXT_PATTERN = re.compile(
    r"(?i)(['\"]?(?:password|token|secret|cookie|authorization)['\"]?\s*[:=]\s*)(['\"])(.*?)(\2)"
)
_HEADER_SENSITIVE_TEXT_PATTERN = re.compile(
    r"(?im)(\b(?:authorization|cookie)\b\s*:\s*)([^\r\n]+)"
)
_INLINE_SENSITIVE_TEXT_PATTERN = re.compile(
    r"(?i)(\b(?:password|token|secret|cookie|authorization)\b\s*=\s*)([^\s,;]+)"
)



def _is_sensitive_error_key(key: str) -> bool:
    normalized = key.strip().casefold()
    return any(marker in normalized for marker in _SENSITIVE_ERROR_FIELD_MARKERS)



def _redact_sensitive_text(value: str) -> str:
    redacted = _QUOTED_SENSITIVE_TEXT_PATTERN.sub(
        lambda match: (
            f"{match.group(1)}{match.group(2)}{_REDACTED_TOOL_ERROR_VALUE}{match.group(4)}"
        ),
        value,
    )
    redacted = _HEADER_SENSITIVE_TEXT_PATTERN.sub(
        lambda match: f"{match.group(1)}{_REDACTED_TOOL_ERROR_VALUE}",
        redacted,
    )
    return _INLINE_SENSITIVE_TEXT_PATTERN.sub(
        lambda match: f"{match.group(1)}{_REDACTED_TOOL_ERROR_VALUE}",
        redacted,
    )



def redact_tool_error_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: (
                _REDACTED_TOOL_ERROR_VALUE
                if _is_sensitive_error_key(str(key))
                else redact_tool_error_value(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_tool_error_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_tool_error_value(item) for item in value)
    if isinstance(value, set):
        return {redact_tool_error_value(item) for item in value}
    if isinstance(value, str):
        return _redact_sensitive_text(value)
    return value



def _stringify_exception_message(error: BaseException) -> str:
    message = str(error).strip()
    return message or repr(error)


def build_tool_exception_details(
    *,
    error: BaseException,
    details: Mapping[str, Any] | None = None,
    diagnostic_context: Mapping[str, Any] | None = None,
    sanitizer: Callable[[Any], Any] | None = None,
) -> dict[str, Any]:
    sanitize = sanitizer or (lambda value: value)
    sanitized_details = sanitize(_normalize_details(details or {}))
    payload = (
        deepcopy(dict(sanitized_details))
        if isinstance(sanitized_details, Mapping)
        else _normalize_details(details or {})
    )
    payload["exceptionType"] = type(error).__name__
    payload["exceptionMessage"] = sanitize(_stringify_exception_message(error))
    payload["traceback"] = sanitize(
        "".join(traceback.format_exception(type(error), error, error.__traceback__))
    )
    sanitized_context = sanitize(_normalize_details(diagnostic_context or {}))
    payload["diagnosticContext"] = (
        deepcopy(dict(sanitized_context))
        if isinstance(sanitized_context, Mapping)
        else _normalize_details(diagnostic_context or {})
    )
    return payload


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
    "build_tool_exception_details",
    "redact_tool_error_value",
]
