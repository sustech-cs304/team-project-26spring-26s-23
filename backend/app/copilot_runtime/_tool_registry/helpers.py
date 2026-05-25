"""Helper utilities for localization and debug summaries in the tool registry."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from .constants import (
    BUILTIN_TOOL_LOCALES,
    FILE_TOOL_READ_ID,
    DEFAULT_TOOL_CATALOG_LANGUAGE,
    MAX_TOOL_ARGUMENT_SUMMARY_LENGTH,
    MAX_TOOL_ARGUMENT_VALUE_LENGTH,
    MAX_TOOL_RESULT_SUMMARY_LENGTH,
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


def summarize_tool_arguments(arguments: Mapping[Any, Any] | None) -> str | None:
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


def summarize_tool_result(result: Any, *, tool_id: str | None = None) -> str | None:
    if result is None:
        return None
    sanitized = sanitize_tool_result_for_summary(result, tool_id=tool_id)
    try:
        summary = json.dumps(sanitized, ensure_ascii=False, sort_keys=True)
    except TypeError:
        summary = str(sanitized)
    return _truncate_tool_argument_text(summary, limit=MAX_TOOL_RESULT_SUMMARY_LENGTH)


def sanitize_tool_result_for_summary(result: Any, *, tool_id: str | None = None) -> Any:
    if tool_id != FILE_TOOL_READ_ID and _extract_read_image_data(result) is None:
        return result
    image_data = _extract_read_image_data(result)
    if image_data is None:
        return result
    sanitized = _copy_without_inline_image_base64(result)
    sanitized_image_data = _extract_read_image_data(sanitized)
    if isinstance(sanitized_image_data, Mapping):
        content = sanitized_image_data.get("content")
        if isinstance(content, dict):
            image_payload = content.get("image")
            if isinstance(image_payload, dict):
                image_payload["inlineDataOmitted"] = True
    return sanitized


def _extract_read_image_data(result: Any) -> Mapping[Any, Any] | None:
    if not isinstance(result, Mapping):
        return None
    output = result.get("output")
    if isinstance(output, Mapping):
        data = output.get("data")
        if isinstance(data, Mapping) and data.get("kind") == "image":
            return data
    if result.get("kind") == "image":
        return result
    return None


def _copy_without_inline_image_base64(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: _copy_without_inline_image_base64(nested_value)
            for key, nested_value in value.items()
            if key != "dataBase64"
        }
    if isinstance(value, list):
        return [_copy_without_inline_image_base64(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_copy_without_inline_image_base64(item) for item in value)
    return value


def _sanitize_tool_argument_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            str(key): _sanitize_tool_argument_value(nested_value)
            for key, nested_value in value.items()
        }
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


