from __future__ import annotations

from pathlib import Path

import pytest

from app.desktop_runtime.config import ENV_DATABASE_DIR
from app.integrations.sustech.teaching_information_system.data.db_manager import (
    resolve_default_tis_db_path,
)


_DEFAULT_RELATIVE_PATH = Path("teaching_information_system") / "sustech_tis.db"


def test_resolve_default_tis_db_path_prefers_explicit_database_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ENV_DATABASE_DIR, str(tmp_path / "env-db"))

    resolved = resolve_default_tis_db_path(tmp_path / "explicit-db")

    assert resolved == (tmp_path / "explicit-db" / _DEFAULT_RELATIVE_PATH)


def test_resolve_default_tis_db_path_uses_runtime_database_dir_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    runtime_database_dir = tmp_path / "runtime-db"
    monkeypatch.setenv(ENV_DATABASE_DIR, str(runtime_database_dir))

    resolved = resolve_default_tis_db_path()

    assert resolved == (runtime_database_dir / _DEFAULT_RELATIVE_PATH)


def test_resolve_default_tis_db_path_requires_runtime_database_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(ENV_DATABASE_DIR, raising=False)

    with pytest.raises(RuntimeError, match="desktop runtime database directory"):
        resolve_default_tis_db_path()
