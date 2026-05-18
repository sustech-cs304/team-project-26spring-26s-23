"""Helper utilities for localization and debug summaries in the tool registry."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from .constants import (
    BUILTIN_TOOL_LOCALES,
    DEFAULT_TOOL_CATALOG_LANGUAGE,
    MAX_TOOL_ARGUMENT_SUMMARY_LENGTH,
    MAX_TOOL_ARGUMENT_VALUE_LENGTH,
    MAX_TOOL_RESULT_SUMMARY_LENGTH,
    REDACTED_TOOL_ARGUMENT_VALUE,
    SENSITIVE_TOOL_ARGUMENT_KEYWORDS,
)


def normalize_tool_catalog_language(language: str | None) -> str:
    normalized = (language or "").strip().lower()
    if normalized.startswith("en"):
        return "en-US"
    return DEFAULT_TOOL_CATALOG_LANGUAGE


def resolve_builtin_tool_locale(tool_id: str, language: str | None) -> dict[str, str]:
    normalized_language = normalize_tool_catalog_language(language)
    localized_tools = BUILTIN_TOOL_LOCALES.get(normalized_language)
    if localized_tools is None:
        localized_tools = BUILTIN_TOOL_LOCALES[DEFAULT_TOOL_CATALOG_LANGUAGE]
    localized_fields = localized_tools.get(tool_id)
    if localized_fields is None:
        return {
            "displayName": tool_id,
            "description": "",
            "prompt": "",
        }
    return dict(localized_fields)


def summarize_tool_arguments(arguments: Mapping[str, Any] | None) -> str | None:
    if arguments is None:
        return None
    normalized = {str(key): value for key, value in arguments.items()}
    if not normalized:
        return None

    sanitized = _sanitize_tool_argument_value(normalized)
    try:
        summary = json.dumps(sanitized, ensure_ascii=False, sort_keys=True)
    except TypeError:
        summary = str(sanitized)
    return _truncate_tool_argument_text(
        summary,
        limit=MAX_TOOL_ARGUMENT_SUMMARY_LENGTH,
    )


def summarize_tool_result(result: Any) -> str | None:
    if result is None:
        return None
    try:
        summary = json.dumps(result, ensure_ascii=False, sort_keys=True)
    except TypeError:
        summary = str(result)
    return _truncate_tool_argument_text(summary, limit=MAX_TOOL_RESULT_SUMMARY_LENGTH)


def _sanitize_tool_argument_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for key, nested_value in value.items():
            normalized_key = str(key)
            if _is_sensitive_tool_argument_key(normalized_key):
                sanitized[normalized_key] = REDACTED_TOOL_ARGUMENT_VALUE
            else:
                sanitized[normalized_key] = _sanitize_tool_argument_value(nested_value)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_tool_argument_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_sanitize_tool_argument_value(item) for item in value)
    if isinstance(value, str):
        return _truncate_tool_argument_text(value, limit=MAX_TOOL_ARGUMENT_VALUE_LENGTH)
    return value


def _truncate_tool_argument_text(value: str, *, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: max(0, limit - 1)]}…"


def _is_sensitive_tool_argument_key(key: str) -> bool:
    normalized = key.strip().lower().replace("_", "").replace("-", "")
    return any(keyword in normalized for keyword in SENSITIVE_TOOL_ARGUMENT_KEYWORDS)
