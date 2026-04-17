"""桌面运行时路由集合。"""

from .diagnostics import build_diagnostics_router
from .history import build_history_router

__all__ = ["build_diagnostics_router", "build_history_router"]
