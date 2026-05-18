"""Host capability abstractions for runtime-agnostic tools."""

from .errors import HostCapabilityOperationError, MissingHostCapabilityError
from .interfaces import (
    ArtifactStore,
    BrowserController,
    DatabaseResolver,
    EventSink,
    HostArtifact,
    HostBrowserPage,
    HostBrowserScreenshot,
    HostEvent,
    SecretProvider,
    StateStore,
    ToolHostCapabilities,
    WorkspaceResolver,
)

__all__ = [
    "ArtifactStore",
    "BrowserController",
    "DatabaseResolver",
    "EventSink",
    "HostArtifact",
    "HostBrowserPage",
    "HostBrowserScreenshot",
    "HostCapabilityOperationError",
    "HostEvent",
    "MissingHostCapabilityError",
    "SecretProvider",
    "StateStore",
    "ToolHostCapabilities",
    "WorkspaceResolver",
]
