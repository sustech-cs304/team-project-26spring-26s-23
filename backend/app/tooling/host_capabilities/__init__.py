"""Host capability abstractions for runtime-agnostic tools."""

from .errors import HostCapabilityOperationError, MissingHostCapabilityError
from .interfaces import (
    ArtifactStore,
    DatabaseResolver,
    EventSink,
    HostArtifact,
    HostEvent,
    SecretProvider,
    StateStore,
    ToolHostCapabilities,
    WorkspaceResolver,
)

__all__ = [
    "ArtifactStore",
    "DatabaseResolver",
    "EventSink",
    "HostArtifact",
    "HostCapabilityOperationError",
    "HostEvent",
    "MissingHostCapabilityError",
    "SecretProvider",
    "StateStore",
    "ToolHostCapabilities",
    "WorkspaceResolver",
]
