"""Protocol-based host capability abstractions for runtime-agnostic tools."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from app.tooling.contract import HostCapabilityRequirement

from .errors import MissingHostCapabilityError


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


@dataclass(frozen=True, slots=True)
class HostArtifact:
    """Host-owned artifact record returned by artifact persistence."""

    artifact_id: str
    uri: str | None = None
    name: str | None = None
    content_type: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_artifact_id = self.artifact_id.strip()
        if normalized_artifact_id == "":
            raise ValueError("artifact_id must be a non-empty string.")
        object.__setattr__(self, "artifact_id", normalized_artifact_id)
        object.__setattr__(self, "uri", _normalize_optional_text(self.uri))
        object.__setattr__(self, "name", _normalize_optional_text(self.name))
        object.__setattr__(self, "content_type", _normalize_optional_text(self.content_type))
        object.__setattr__(self, "metadata", _normalize_metadata(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "artifactId": self.artifact_id,
            "metadata": _normalize_metadata(self.metadata),
        }
        if self.uri is not None:
            payload["uri"] = self.uri
        if self.name is not None:
            payload["name"] = self.name
        if self.content_type is not None:
            payload["contentType"] = self.content_type
        return payload


@dataclass(frozen=True, slots=True)
class HostEvent:
    """Host event emitted by a tool without leaking runtime-specific transport details."""

    event_type: str
    message: str | None = None
    invocation_id: str | None = None
    occurred_at: datetime | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        normalized_event_type = self.event_type.strip()
        if normalized_event_type == "":
            raise ValueError("event_type must be a non-empty string.")
        object.__setattr__(self, "event_type", normalized_event_type)
        object.__setattr__(self, "message", _normalize_optional_text(self.message))
        object.__setattr__(
            self,
            "invocation_id",
            _normalize_optional_text(self.invocation_id),
        )
        if self.occurred_at is not None and (
            self.occurred_at.tzinfo is None or self.occurred_at.utcoffset() is None
        ):
            raise ValueError("occurred_at must be timezone-aware when provided.")
        object.__setattr__(self, "data", _normalize_metadata(self.data))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "eventType": self.event_type,
            "data": _normalize_metadata(self.data),
        }
        if self.message is not None:
            payload["message"] = self.message
        if self.invocation_id is not None:
            payload["invocationId"] = self.invocation_id
        if self.occurred_at is not None:
            payload["occurredAt"] = self.occurred_at.isoformat()
        return payload


class WorkspaceResolver(Protocol):
    """Resolve host workspace paths for tools that operate on local project files."""

    def resolve_workspace_path(self, *, relative_path: str | None = None) -> Path: ...


class ArtifactStore(Protocol):
    """Persist tool-produced artifacts through a host-owned store."""

    async def save_text(
        self,
        *,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact: ...

    async def save_bytes(
        self,
        *,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact: ...


class StateStore(Protocol):
    """Persist and retrieve structured tool state under host-controlled namespaces."""

    async def get(self, *, namespace: str, key: str) -> dict[str, Any] | None: ...

    async def put(self, *, namespace: str, key: str, value: Mapping[str, Any]) -> None: ...

    async def delete(self, *, namespace: str, key: str) -> None: ...


class SecretProvider(Protocol):
    """Resolve host-managed secrets without exposing storage internals."""

    async def get_secret(self, *, name: str) -> str | None: ...


class EventSink(Protocol):
    """Emit structured tool lifecycle or diagnostic events to the host."""

    def emit(self, event: HostEvent) -> None: ...


@dataclass(frozen=True, slots=True)
class ToolHostCapabilities:
    """Bound host capability handles available to a tool invocation."""

    workspace_resolver: WorkspaceResolver | None = None
    artifact_store: ArtifactStore | None = None
    state_store: StateStore | None = None
    secret_provider: SecretProvider | None = None
    event_sink: EventSink | None = None

    def available_capability_names(self) -> tuple[str, ...]:
        available: list[str] = []
        if self.workspace_resolver is not None:
            available.append("workspace_resolver")
        if self.artifact_store is not None:
            available.append("artifact_store")
        if self.state_store is not None:
            available.append("state_store")
        if self.secret_provider is not None:
            available.append("secret_provider")
        if self.event_sink is not None:
            available.append("event_sink")
        return tuple(available)

    def require_capability(self, capability: str) -> object:
        if capability == "workspace_resolver":
            if self.workspace_resolver is None:
                raise MissingHostCapabilityError(capability)
            return self.workspace_resolver
        if capability == "artifact_store":
            if self.artifact_store is None:
                raise MissingHostCapabilityError(capability)
            return self.artifact_store
        if capability == "state_store":
            if self.state_store is None:
                raise MissingHostCapabilityError(capability)
            return self.state_store
        if capability == "secret_provider":
            if self.secret_provider is None:
                raise MissingHostCapabilityError(capability)
            return self.secret_provider
        if capability == "event_sink":
            if self.event_sink is None:
                raise MissingHostCapabilityError(capability)
            return self.event_sink
        raise ValueError(f"Unknown host capability '{capability}'.")

    def assert_satisfies(
        self,
        requirements: Sequence[HostCapabilityRequirement],
    ) -> None:
        for requirement in requirements:
            if not requirement.required:
                continue
            self.require_capability(requirement.capability)


__all__ = [
    "ArtifactStore",
    "EventSink",
    "HostArtifact",
    "HostEvent",
    "SecretProvider",
    "StateStore",
    "ToolHostCapabilities",
    "WorkspaceResolver",
]
