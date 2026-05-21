"""TIS 共享文本与序列化工具。"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat(timespec="seconds")
        return (
            value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        )
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "to_dict"):
        return _jsonable(value.to_dict())
    return value


def _clean_text(value: Any, *, max_length: int | None = None) -> str:
    if value is None or isinstance(value, bool):
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    if max_length is not None and len(text) > max_length:
        return text[:max_length].rstrip()
    return text


def _normalize_mapping(value: dict[str, Any] | None) -> dict[str, Any]:
    if not value:
        return {}
    return {str(key): _jsonable(item) for key, item in value.items()}


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


__all__ = ["_clean_text", "_jsonable", "_normalize_mapping", "_utcnow_iso"]
