"""Unified calendar query routes for the desktop runtime.

Serves calendar events directly from the Electron timeline.db,
the single source of truth shared by both frontend and backend.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.desktop_runtime.config import DesktopRuntimeConfig
from app.desktop_runtime.security import require_local_token
from app.timeline_db import resolve_timeline_db_path, query_timeline_events


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    config = getattr(request.app.state, "runtime_config", None)
    if not isinstance(config, DesktopRuntimeConfig):
        raise RuntimeError("Desktop runtime config is not available on app.state.runtime_config")
    return config


def build_calendar_router() -> APIRouter:
    router = APIRouter(prefix="/calendar", tags=["calendar"])

    @router.get("/events")
    def list_calendar_events(request: Request) -> dict[str, list[dict[str, Any]]]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)

        db_path = resolve_timeline_db_path(user_data_dir=runtime_config.user_data_dir)
        items = query_timeline_events(db_path)
        for item in items:
            item["is_all_day"] = bool(item.get("is_all_day"))
        return {"items": items}

    return router
