"""Unified tool protocol for runtime-agnostic tool implementations."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from app.tooling.host_capabilities import ToolHostCapabilities

from .context import ToolInvocationContext
from .metadata import ToolMetadata
from .results import ToolResultEnvelope


class ToolContract(Protocol):
    """Minimal tool shape shared by runtime adapters and future transports."""

    @property
    def metadata(self) -> ToolMetadata:
        pass

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        pass


__all__ = ["ToolContract"]
