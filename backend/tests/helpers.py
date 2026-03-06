from __future__ import annotations

import os
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = TESTS_DIR.parent


def require_live_credentials() -> tuple[str, str]:
    username = os.getenv("SUSTECH_USERNAME")
    password = os.getenv("SUSTECH_PASSWORD")
    if not username or not password:
        pytest.skip("缺少环境变量 SUSTECH_USERNAME / SUSTECH_PASSWORD")
    return username, password
