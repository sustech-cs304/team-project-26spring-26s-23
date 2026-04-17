"""Stable domain error model for file tool protocol operations."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, cast

FileToolErrorCode = Literal[
    "invalid_request",
    "path_out_of_bounds",
    "file_not_found",
    "not_found",
    "not_unique",
    "occurrence_mismatch",
    "not_a_file",
    "not_a_directory",
    "binary_unsupported",
    "invalid_pattern",
    "invalid_regex",
    "too_large",
    "encoding_error",
    "permission_denied",
    "already_exists",
    "hash_mismatch",
    "vision_required",
    "invalid_pages",
    "page_range_required",
]

FILE_TOOL_ERROR_CODES: tuple[FileToolErrorCode, ...] = (
    "invalid_request",
    "path_out_of_bounds",
    "file_not_found",
    "not_found",
    "not_unique",
    "occurrence_mismatch",
    "not_a_file",
    "not_a_directory",
    "binary_unsupported",
    "invalid_pattern",
    "invalid_regex",
    "too_large",
    "encoding_error",
    "permission_denied",
    "already_exists",
    "hash_mismatch",
    "vision_required",
    "invalid_pages",
    "page_range_required",
)

_RETRYABLE_FILE_TOOL_ERROR_CODES = frozenset[FileToolErrorCode]()


def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_details(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


def _normalize_error_code(value: str) -> FileToolErrorCode:
    normalized = value.strip()
    if normalized not in FILE_TOOL_ERROR_CODES:
        raise ValueError(
            "Unknown file tool error code "
            f"'{value}'. Expected one of {', '.join(FILE_TOOL_ERROR_CODES)}."
        )
    return cast(FileToolErrorCode, normalized)


@dataclass(frozen=True, slots=True)
class FileToolError(RuntimeError):
    """Stable error payload for file tool failures."""

    code: FileToolErrorCode
    message: str
    retryable: bool | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        RuntimeError.__init__(self, self.message)
        object.__setattr__(self, "code", _normalize_error_code(self.code))
        object.__setattr__(
            self,
            "message",
            _require_non_empty_text(self.message, field_name="message"),
        )
        resolved_retryable = self.retryable
        if resolved_retryable is None:
            resolved_retryable = self.code in _RETRYABLE_FILE_TOOL_ERROR_CODES
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
    "FILE_TOOL_ERROR_CODES",
    "FileToolError",
    "FileToolErrorCode",
]
