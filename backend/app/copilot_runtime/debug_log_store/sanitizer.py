"""Sanitization rules for persisted runtime debug log summaries."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .contracts import SanitizedPayload

_DEFAULT_MASK = "***REDACTED***"


@dataclass(frozen=True, slots=True)
class Sanitizer:
    """Redact sensitive keys and aggressively truncate stored summaries."""

    max_string_length: int = 240
    max_collection_items: int = 20
    max_depth: int = 4
    mask: str = _DEFAULT_MASK
    sensitive_keys: frozenset[str] = frozenset(
        {
            "authorization",
            "token",
            "access_token",
            "refresh_token",
            "api_key",
            "apikey",
            "secret",
            "password",
            "passwd",
            "cookie",
            "set-cookie",
            "session",
            "sessionid",
        }
    )

    def sanitize_summary(self, payload: Mapping[str, Any] | None) -> SanitizedPayload:
        if payload is None:
            return SanitizedPayload(content={})

        redacted_keys: set[str] = set()
        dropped_fields: set[str] = set()
        truncated = False
        content: dict[str, Any] = {}
        for key, value in payload.items():
            normalized_key = str(key)
            if self._is_sensitive_key(normalized_key):
                redacted_keys.add(normalized_key)
                content[normalized_key] = self.mask
                continue
            sanitized_value, value_truncated, value_dropped_fields = self._sanitize_value(
                value,
                depth=0,
                field_path=normalized_key,
            )
            content[normalized_key] = sanitized_value
            truncated = truncated or value_truncated
            dropped_fields.update(value_dropped_fields)

        return SanitizedPayload(
            content=content,
            truncated=truncated,
            redacted_keys=tuple(sorted(redacted_keys)),
            dropped_fields=tuple(sorted(dropped_fields)),
        )

    def sanitize_stack(self, stack: str | None) -> tuple[str | None, bool]:
        if stack is None:
            return None, False
        if len(stack) <= self.max_string_length:
            return stack, False
        return f"{stack[: self.max_string_length]}…", True

    def _sanitize_value(
        self,
        value: Any,
        *,
        depth: int,
        field_path: str,
    ) -> tuple[Any, bool, set[str]]:
        if depth > self.max_depth:
            return "<truncated-depth>", True, {field_path}

        if value is None or isinstance(value, bool | int | float):
            return value, False, set()

        if isinstance(value, str):
            if len(value) <= self.max_string_length:
                return value, False, set()
            return f"{value[: self.max_string_length]}…", True, {field_path}

        if isinstance(value, Mapping):
            result: dict[str, Any] = {}
            truncated = False
            dropped_fields: set[str] = set()
            items = list(value.items())
            limited_items = items[: self.max_collection_items]
            if len(items) > self.max_collection_items:
                truncated = True
                dropped_fields.add(field_path)
            for nested_key, nested_value in limited_items:
                normalized_key = str(nested_key)
                nested_path = f"{field_path}.{normalized_key}"
                if self._is_sensitive_key(normalized_key):
                    result[normalized_key] = self.mask
                    continue
                sanitized_value, nested_truncated, nested_dropped = self._sanitize_value(
                    nested_value,
                    depth=depth + 1,
                    field_path=nested_path,
                )
                result[normalized_key] = sanitized_value
                truncated = truncated or nested_truncated
                dropped_fields.update(nested_dropped)
            return result, truncated, dropped_fields

        if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
            items = list(value)
            limited_items = items[: self.max_collection_items]
            result_list: list[Any] = []
            truncated = len(items) > self.max_collection_items
            dropped_fields: set[str] = {field_path} if truncated else set()
            for index, item in enumerate(limited_items):
                sanitized_value, nested_truncated, nested_dropped = self._sanitize_value(
                    item,
                    depth=depth + 1,
                    field_path=f"{field_path}[{index}]",
                )
                result_list.append(sanitized_value)
                truncated = truncated or nested_truncated
                dropped_fields.update(nested_dropped)
            return result_list, truncated, dropped_fields

        text = repr(value)
        if len(text) <= self.max_string_length:
            return text, False, set()
        return f"{text[: self.max_string_length]}…", True, {field_path}

    def _is_sensitive_key(self, key: str) -> bool:
        normalized = key.strip().lower().replace("_", "-")
        return normalized in self.sensitive_keys
