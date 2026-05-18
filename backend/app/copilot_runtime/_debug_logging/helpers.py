"""Private lookup / sanitization helpers shared between debug_logging and summarizers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _payload_mapping(event: Any) -> Mapping[str, Any]:
    payload = _lookup_value(event, attr_name="payload", key_name="payload")
    if isinstance(payload, Mapping):
        return payload
    return {}


def _lookup_value(value: Any, *, attr_name: str, key_name: str) -> Any:
    if value is None:
        return None
    if hasattr(value, attr_name):
        return getattr(value, attr_name)
    if hasattr(value, key_name):
        return getattr(value, key_name)
    if isinstance(value, Mapping):
        return value.get(key_name)
    return None


def _lookup_mapping_value(value: Mapping[str, Any], key_name: str) -> Any:
    return value.get(key_name)


def _sanitize_value(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Mapping):
        return {
            str(key): _sanitize_value(nested_value)
            for key, nested_value in value.items()
        }
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_sanitize_value(item) for item in value]
    return str(value)
