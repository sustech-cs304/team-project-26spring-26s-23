"""桌面运行时 HTTP 服务入口层。"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .config import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    LOCAL_TOKEN_HEADER_NAME,
    DesktopRuntimeConfig,
    build_runtime_argument_parser,
    parse_runtime_config,
)

def create_app(config: DesktopRuntimeConfig | None = None) -> Any:
    from .server import create_app as _create_app

    return _create_app(config)


def main(argv: Sequence[str] | None = None) -> int:
    from .server import main as _main

    return _main(argv)


__all__ = [
    "DEFAULT_HOST",
    "DEFAULT_PORT",
    "LOCAL_TOKEN_HEADER_NAME",
    "DesktopRuntimeConfig",
    "build_runtime_argument_parser",
    "parse_runtime_config",
    "create_app",
    "main",
]
