"""Minimal public surface for the Copilot runtime scaffold."""

from .contracts import AGENT_CONNECT_METHOD, INFO_METHOD, RuntimeScaffold, build_runtime_scaffold
from .router import build_router

__all__ = [
    "AGENT_CONNECT_METHOD",
    "INFO_METHOD",
    "RuntimeScaffold",
    "build_router",
    "build_runtime_scaffold",
]
