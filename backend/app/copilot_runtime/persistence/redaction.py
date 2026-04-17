"""Minimal secret redaction helpers for persisted chat payloads."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

DEFAULT_REDACTION_VERSION = 1
REDACTED_VALUE = "[redacted]"
_SENSITIVE_KEY_NAMES = frozenset(
    {
        "apikey",
        "accesskey",
        "access_token",
        "accesstoken",
        "auth",
        "auth_token",
        "authtoken",
        "authorization",
        "bearer",
        "bearer_token",
        "bearertoken",
        "cookie",
        "id_token",
        "idtoken",
        "password",
        "refresh_token",
        "refreshtoken",
        "secret",
        "secretkey",
        "session_cookie",
        "session_secret",
        "session_token",
        "sessionid",
    }
)


@dataclass(frozen=True, slots=True)
class RedactionResult:
    value: dict[str, Any]
    is_redacted: bool
    redaction_version: int = DEFAULT_REDACTION_VERSION


def redact_payload(payload: Mapping[str, Any] | None) -> RedactionResult:
    normalized_payload = dict(payload or {})
    redacted_value, is_redacted = _redact_value(normalized_payload)
    return RedactionResult(
        value=redacted_value if isinstance(redacted_value, dict) else {},
        is_redacted=is_redacted,
    )



def _redact_value(value: Any) -> tuple[Any, bool]:
    if isinstance(value, Mapping):
        redacted_mapping: dict[str, Any] = {}
        was_redacted = False
        for key, nested_value in value.items():
            normalized_key = str(key)
            if _is_sensitive_key(normalized_key):
                redacted_mapping[normalized_key] = REDACTED_VALUE
                was_redacted = True
                continue
            redacted_nested_value, nested_redacted = _redact_value(nested_value)
            redacted_mapping[normalized_key] = redacted_nested_value
            was_redacted = was_redacted or nested_redacted
        return redacted_mapping, was_redacted
    if isinstance(value, list):
        redacted_items: list[Any] = []
        was_redacted = False
        for item in value:
            redacted_item, item_redacted = _redact_value(item)
            redacted_items.append(redacted_item)
            was_redacted = was_redacted or item_redacted
        return redacted_items, was_redacted
    if isinstance(value, tuple):
        redacted_items: list[Any] = []
        was_redacted = False
        for item in value:
            redacted_item, item_redacted = _redact_value(item)
            redacted_items.append(redacted_item)
            was_redacted = was_redacted or item_redacted
        return tuple(redacted_items), was_redacted
    return value, False



def _is_sensitive_key(key: str) -> bool:
    normalized_key = key.strip().lower()
    if normalized_key == "":
        return False
    canonical_key = normalized_key.replace("-", "_")
    compact_key = "".join(character for character in canonical_key if character.isalnum())
    return canonical_key in _SENSITIVE_KEY_NAMES or compact_key in _SENSITIVE_KEY_NAMES


__all__ = [
    "DEFAULT_REDACTION_VERSION",
    "REDACTED_VALUE",
    "RedactionResult",
    "redact_payload",
]
