"""FastAPI router for the Copilot runtime thread/run bridge."""

from __future__ import annotations

from .transport.http_handlers import (
    build_router,
)

__all__ = ["build_router"]
