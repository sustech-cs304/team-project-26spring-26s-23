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
    HostBrowserSnapshot,
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
    "HostBrowserSnapshot",
    "HostCapabilityOperationError",
    "HostEvent",
    "MissingHostCapabilityError",
    "SecretProvider",
    "StateStore",
    "ToolHostCapabilities",
    "WorkspaceResolver",
]
