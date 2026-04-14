"""Structured result envelopes for runtime-agnostic tool contracts."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from .errors import NormalizedToolError

StructuredResultStatus = Literal["success", "error"]
STRUCTURED_RESULT_STATUSES: tuple[StructuredResultStatus, ...] = ("success", "error")


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


def _normalize_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


def _normalize_status(value: str) -> StructuredResultStatus:
    normalized = value.strip()
    if normalized not in STRUCTURED_RESULT_STATUSES:
        raise ValueError(
            "Unknown structured result status "
            f"'{value}'. Expected one of {', '.join(STRUCTURED_RESULT_STATUSES)}."
        )
    return cast(StructuredResultStatus, normalized)


@dataclass(frozen=True, slots=True)
class ToolArtifactReference:
    """Artifact reference emitted in a tool result envelope."""

    artifact_id: str
    name: str | None = None
    content_type: str | None = None
    uri: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "artifact_id",
            _require_non_empty_text(self.artifact_id, field_name="artifact_id"),
        )
        object.__setattr__(self, "name", _normalize_optional_text(self.name))
        object.__setattr__(
            self,
            "content_type",
            _normalize_optional_text(self.content_type),
        )
        object.__setattr__(self, "uri", _normalize_optional_text(self.uri))
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "artifactId": self.artifact_id,
            "metadata": _normalize_mapping(self.metadata),
        }
        if self.name is not None:
            payload["name"] = self.name
        if self.content_type is not None:
            payload["contentType"] = self.content_type
        if self.uri is not None:
            payload["uri"] = self.uri
        return payload


@dataclass(frozen=True, slots=True)
class ToolResultEnvelope:
    """Stable success/error envelope for tool invocation results."""

    status: StructuredResultStatus
    output: dict[str, Any] | None = None
    error: NormalizedToolError | None = None
    artifacts: tuple[ToolArtifactReference, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_status = _normalize_status(self.status)
        if normalized_status == "success" and self.error is not None:
            raise ValueError("Successful tool results cannot include an error payload.")
        if normalized_status == "error" and self.error is None:
            raise ValueError("Error tool results must include an error payload.")
        object.__setattr__(self, "status", normalized_status)
        if self.output is not None:
            object.__setattr__(self, "output", _normalize_mapping(self.output))
        object.__setattr__(self, "artifacts", tuple(self.artifacts))
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    @classmethod
    def success(
        cls,
        *,
        output: Mapping[str, Any] | None = None,
        artifacts: Sequence[ToolArtifactReference] = (),
        metadata: Mapping[str, Any] | None = None,
    ) -> "ToolResultEnvelope":
        return cls(
            status="success",
            output=None if output is None else _normalize_mapping(output),
            artifacts=tuple(artifacts),
            metadata=_normalize_mapping(metadata or {}),
        )

    @classmethod
    def failure(
        cls,
        *,
        error: NormalizedToolError,
        output: Mapping[str, Any] | None = None,
        artifacts: Sequence[ToolArtifactReference] = (),
        metadata: Mapping[str, Any] | None = None,
    ) -> "ToolResultEnvelope":
        return cls(
            status="error",
            error=error,
            output=None if output is None else _normalize_mapping(output),
            artifacts=tuple(artifacts),
            metadata=_normalize_mapping(metadata or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": self.status,
            "artifacts": [artifact.to_dict() for artifact in self.artifacts],
            "metadata": _normalize_mapping(self.metadata),
        }
        if self.output is not None:
            payload["output"] = _normalize_mapping(self.output)
        if self.error is not None:
            payload["error"] = self.error.to_dict()
        return payload


__all__ = [
    "STRUCTURED_RESULT_STATUSES",
    "StructuredResultStatus",
    "ToolArtifactReference",
    "ToolResultEnvelope",
]
