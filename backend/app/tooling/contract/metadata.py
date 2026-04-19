"""Metadata models for runtime-agnostic tool contracts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from .requirements import HostCapabilityRequirement
from .schema import ToolSchema


def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_annotations(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


def _normalize_tags(tags: Sequence[str]) -> tuple[str, ...]:
    normalized_tags: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        normalized_tag = tag.strip()
        if normalized_tag == "" or normalized_tag in seen:
            continue
        seen.add(normalized_tag)
        normalized_tags.append(normalized_tag)
    return tuple(normalized_tags)


def _normalize_capability_requirements(
    requirements: Sequence[HostCapabilityRequirement],
) -> tuple[HostCapabilityRequirement, ...]:
    normalized_requirements = tuple(requirements)
    seen_capabilities: set[str] = set()
    for requirement in normalized_requirements:
        if requirement.capability in seen_capabilities:
            raise ValueError(
                "Duplicate host capability requirement "
                f"'{requirement.capability}' is not allowed."
            )
        seen_capabilities.add(requirement.capability)
    return normalized_requirements


@dataclass(frozen=True, slots=True)
class ToolMetadata:
    """Stable metadata surface shared by runtime and future adapters."""

    tool_id: str
    display_name: str | None = None
    description: str | None = None
    kind: str = "operation"
    version: str = "1"
    input_schema: ToolSchema = field(default_factory=ToolSchema)
    output_schema: ToolSchema | None = None
    capability_requirements: tuple[HostCapabilityRequirement, ...] = ()
    tags: tuple[str, ...] = ()
    annotations: dict[str, Any] = field(default_factory=dict)
    idempotent: bool | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "tool_id",
            _require_non_empty_text(self.tool_id, field_name="tool_id"),
        )
        object.__setattr__(
            self,
            "display_name",
            _normalize_optional_text(self.display_name),
        )
        object.__setattr__(
            self,
            "description",
            _normalize_optional_text(self.description),
        )
        object.__setattr__(
            self,
            "kind",
            _require_non_empty_text(self.kind, field_name="kind"),
        )
        object.__setattr__(
            self,
            "version",
            _require_non_empty_text(self.version, field_name="version"),
        )
        object.__setattr__(
            self,
            "capability_requirements",
            _normalize_capability_requirements(self.capability_requirements),
        )
        object.__setattr__(self, "tags", _normalize_tags(self.tags))
        object.__setattr__(
            self, "annotations", _normalize_annotations(self.annotations)
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "toolId": self.tool_id,
            "kind": self.kind,
            "version": self.version,
            "inputSchema": self.input_schema.to_dict(),
            "capabilityRequirements": [
                requirement.to_dict() for requirement in self.capability_requirements
            ],
            "tags": list(self.tags),
            "annotations": _normalize_annotations(self.annotations),
        }
        if self.display_name is not None:
            payload["displayName"] = self.display_name
        if self.description is not None:
            payload["description"] = self.description
        if self.output_schema is not None:
            payload["outputSchema"] = self.output_schema.to_dict()
        if self.idempotent is not None:
            payload["idempotent"] = self.idempotent
        return payload


__all__ = ["ToolMetadata"]
