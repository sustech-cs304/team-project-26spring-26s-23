"""桌面宿主使用的最小本地 HTTP 服务。"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.desktop_runtime.app_factory import create_app, main  # noqa: E402
from app.desktop_runtime.middlewares import (  # noqa: E402
    DesktopNullOriginMiddleware,
    DesktopRuntimeFailureEnvelopeMiddleware,
)

__all__ = [
    "BACKEND_DIR",
    "DesktopNullOriginMiddleware",
    "DesktopRuntimeFailureEnvelopeMiddleware",
    "create_app",
    "main",
]

if __name__ == "__main__":
    raise SystemExit(main())
