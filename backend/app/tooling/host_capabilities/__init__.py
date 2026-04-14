"""Host capability abstractions for runtime-agnostic tools."""

from .errors import MissingHostCapabilityError
from .interfaces import (
    ArtifactStore,
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
    "EventSink",
    "HostArtifact",
    "HostEvent",
    "MissingHostCapabilityError",
    "SecretProvider",
    "StateStore",
    "ToolHostCapabilities",
    "WorkspaceResolver",
]
