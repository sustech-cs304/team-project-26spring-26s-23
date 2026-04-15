"""Host capability requirement descriptors for tool contracts."""

from __future__ import annotations

from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, cast

HostCapabilityName = Literal[
    "workspace_resolver",
    "database_resolver",
    "artifact_store",
    "state_store",
    "secret_provider",
    "event_sink",
]

HOST_CAPABILITY_NAMES: tuple[HostCapabilityName, ...] = (
    "workspace_resolver",
    "database_resolver",
    "artifact_store",
    "state_store",
    "secret_provider",
    "event_sink",
)


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


def _normalize_capability_name(value: str) -> HostCapabilityName:
    normalized = value.strip()
    if normalized not in HOST_CAPABILITY_NAMES:
        raise ValueError(
            "Unknown host capability "
            f"'{value}'. Expected one of {', '.join(HOST_CAPABILITY_NAMES)}."
        )
    return cast(HostCapabilityName, normalized)


@dataclass(frozen=True, slots=True)
class HostCapabilityRequirement:
    """Declarative requirement for a host-provided capability."""

    capability: HostCapabilityName
    required: bool = True
    purpose: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "capability",
            _normalize_capability_name(self.capability),
        )
        object.__setattr__(self, "purpose", _normalize_optional_text(self.purpose))
        object.__setattr__(self, "metadata", _normalize_metadata(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "capability": self.capability,
            "required": self.required,
        }
        if self.purpose is not None:
            payload["purpose"] = self.purpose
        if self.metadata:
            payload["metadata"] = _normalize_metadata(self.metadata)
        return payload


__all__ = [
    "HOST_CAPABILITY_NAMES",
    "HostCapabilityName",
    "HostCapabilityRequirement",
]
