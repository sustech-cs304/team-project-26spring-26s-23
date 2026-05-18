"""Database bootstrap and migration helpers for Copilot runtime persistence."""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from .base import Base

if TYPE_CHECKING:
    from app.desktop_runtime.config import DesktopRuntimeConfig

DEFAULT_CHAT_DATABASE_FILE_NAME = "copilot-chat.db"
DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS = 5.0
ENV_CHAT_DATABASE_PATH = "COPILOT_RUNTIME_CHAT_DATABASE_PATH"
ENV_DESKTOP_DATABASE_DIR = "COPILOT_DESKTOP_RUNTIME_DATABASE_DIR"


def resolve_chat_database_path(
    *,
    runtime_config: DesktopRuntimeConfig | None = None,
    db_path: str | Path | None = None,
    env: Mapping[str, str] | None = None,
) -> Path:
    """Resolve the SQLite database path for chat persistence."""

    env_map = os.environ if env is None else env
    if db_path is not None:
        candidate = Path(db_path)
    else:
        explicit_path = _normalize_optional_text(env_map.get(ENV_CHAT_DATABASE_PATH))
        if explicit_path is not None:
            candidate = Path(explicit_path)
        elif runtime_config is not None:
            candidate = runtime_config.database_dir / DEFAULT_CHAT_DATABASE_FILE_NAME
        else:
            configured_database_dir = _normalize_optional_text(
                env_map.get(ENV_DESKTOP_DATABASE_DIR)
            )
            if configured_database_dir is not None:
                candidate = (
                    Path(configured_database_dir) / DEFAULT_CHAT_DATABASE_FILE_NAME
                )
            else:
                from app.desktop_runtime.config import BACKEND_DIR

                candidate = BACKEND_DIR / "data" / DEFAULT_CHAT_DATABASE_FILE_NAME

    if not candidate.is_absolute():
        from app.desktop_runtime.config import BACKEND_DIR

        candidate = BACKEND_DIR / candidate
    resolved = candidate.resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


def build_sqlite_database_url(db_path: str | Path) -> str:
    resolved_db_path = Path(db_path).resolve()
    return f"sqlite:///{resolved_db_path.as_posix()}"


def get_default_alembic_ini_path() -> Path:
    return Path(__file__).resolve().parents[3] / "alembic.ini"


def create_alembic_config(
    *,
    db_path: str | Path,
    alembic_ini_path: str | Path | None = None,
) -> Config:
    ini_path = (
        Path(alembic_ini_path)
        if alembic_ini_path is not None
        else get_default_alembic_ini_path()
    )
    config = Config(str(ini_path))
    config.set_main_option("sqlalchemy.url", build_sqlite_database_url(db_path))
    config.attributes["configure_logger"] = False
    return config


def upgrade_database(
    *,
    db_path: str | Path,
    alembic_ini_path: str | Path | None = None,
    revision: str = "head",
) -> None:
    resolved_db_path = resolve_chat_database_path(db_path=db_path)
    config = create_alembic_config(
        db_path=resolved_db_path, alembic_ini_path=alembic_ini_path
    )
    command.upgrade(config, revision)


def create_sqlite_engine(*, db_path: str | Path, echo: bool = False) -> Engine:
    resolved_db_path = resolve_chat_database_path(db_path=db_path)
    engine = create_engine(
        build_sqlite_database_url(resolved_db_path),
        future=True,
        echo=echo,
        connect_args={
            "check_same_thread": False,
            "timeout": DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS,
        },
    )
    _install_sqlite_pragmas(engine)
    return engine


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, class_=Session)


@contextmanager
def session_scope(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def initialize_database(engine: Engine) -> None:
    """Open a connection so SQLite file creation and PRAGMA hooks occur eagerly."""

    with engine.begin() as connection:
        connection.execute(text("SELECT 1"))


def get_target_metadata():
    from . import models as _models  # noqa: F401

    return Base.metadata


def _install_sqlite_pragmas(engine: Engine) -> None:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection: Any, _connection_record: Any) -> None:
        if not isinstance(dbapi_connection, sqlite3.Connection):
            return
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.close()


def _normalize_optional_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


__all__ = [
    "DEFAULT_CHAT_DATABASE_FILE_NAME",
    "DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS",
    "ENV_CHAT_DATABASE_PATH",
    "ENV_DESKTOP_DATABASE_DIR",
    "build_sqlite_database_url",
    "create_alembic_config",
    "create_session_factory",
    "create_sqlite_engine",
    "get_default_alembic_ini_path",
    "get_target_metadata",
    "initialize_database",
    "resolve_chat_database_path",
    "session_scope",
    "upgrade_database",
]
