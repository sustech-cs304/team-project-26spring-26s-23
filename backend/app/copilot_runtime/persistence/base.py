"""SQLAlchemy base metadata for Copilot runtime persistence."""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Declarative base for Copilot runtime persistence models."""


__all__ = ["Base"]
