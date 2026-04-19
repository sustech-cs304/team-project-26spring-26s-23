"""Shared dependency containers for Copilot runtime HTTP transport."""

from __future__ import annotations

from dataclasses import dataclass

from ..bridge import RuntimeBridge
from ..contracts import RuntimeScaffold
from ..protocol import RuntimeProtocolParser


@dataclass(frozen=True, slots=True)
class RuntimeTransportDependencies:
    scaffold: RuntimeScaffold
    runtime_bridge: RuntimeBridge
    parser: RuntimeProtocolParser


def build_runtime_transport_dependencies(
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> RuntimeTransportDependencies:
    return RuntimeTransportDependencies(
        scaffold=scaffold,
        runtime_bridge=runtime_bridge,
        parser=RuntimeProtocolParser(scaffold),
    )


__all__ = [
    "RuntimeTransportDependencies",
    "build_runtime_transport_dependencies",
]
