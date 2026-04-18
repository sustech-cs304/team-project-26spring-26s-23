"""Runtime-agnostic schema descriptors for tool contracts."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any


def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_schema(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


@dataclass(frozen=True, slots=True)
class ToolSchema:
    """Transport-agnostic schema descriptor for tool IO."""

    format: str = "json-schema"
    schema: dict[str, Any] = field(default_factory=dict)
    schema_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "format",
            _require_non_empty_text(self.format, field_name="format"),
        )
        object.__setattr__(self, "schema", _normalize_schema(self.schema))
        if self.schema_id is not None:
            normalized_schema_id = self.schema_id.strip()
            object.__setattr__(
                self,
                "schema_id",
                normalized_schema_id or None,
            )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "format": self.format,
            "schema": _normalize_schema(self.schema),
        }
        if self.schema_id is not None:
            payload["schemaId"] = self.schema_id
        return payload


__all__ = ["ToolSchema"]
