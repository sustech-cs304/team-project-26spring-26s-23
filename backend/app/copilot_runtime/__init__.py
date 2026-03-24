"""Minimal public surface for the Copilot runtime scaffold."""

from .contracts import INFO_METHOD, RuntimeScaffold, build_runtime_scaffold
from .router import build_router

__all__ = [
    "INFO_METHOD",
    "RuntimeScaffold",
    "build_router",
    "build_runtime_scaffold",
]
