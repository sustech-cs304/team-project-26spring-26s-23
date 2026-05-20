from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Request

from app.desktop_runtime.config import DesktopRuntimeConfig
from app.desktop_runtime.security import require_local_token
from app.event_manager.data.db_manager import DatabaseManager, resolve_default_event_manager_db_path
from app.integrations.wakeup.api import WakeupCalendarICSParser


def _get_event_db_manager(request: Request | None = None) -> DatabaseManager:
    if request is not None:
        runtime_config = getattr(request.app.state, "runtime_config", None)
        if runtime_config is not None:
            database_dir: Path | None = getattr(runtime_config, "database_dir", None)
            if database_dir is not None:
                return DatabaseManager(resolve_default_event_manager_db_path(database_dir))
    return DatabaseManager()


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    config = getattr(request.app.state, "runtime_config", None)
    if not isinstance(config, DesktopRuntimeConfig):
        raise RuntimeError("Desktop runtime config is not available on app.state.runtime_config")
    return config


def build_wakeup_ui_router() -> APIRouter:
    router = APIRouter(prefix="/api/wakeup")

    @router.post("/import/ics")
    def import_ics(
        request: Request,
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        try:
            runtime_config = _get_runtime_config(request)
            require_local_token(request, runtime_config)

            ics_text = str(body.get("icsText") or "").strip() if isinstance(body, dict) else ""
            if not ics_text:
                raise ValueError("icsText is required")

            parser = WakeupCalendarICSParser()
            unified_events = parser.parse_to_unified_events(ics_text, source="wakeup")

            event_db = _get_event_db_manager(request)
            stats = event_db.sync_unified_calendar_events("wakeup", unified_events)

            return {
                "ok": True,
                "parsed": len(unified_events),
                "stats": stats,
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/parse/ics")
    def parse_ics(
        request: Request,
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        try:
            runtime_config = _get_runtime_config(request)
            require_local_token(request, runtime_config)

            ics_text = str(body.get("icsText") or "").strip() if isinstance(body, dict) else ""
            if not ics_text:
                raise ValueError("icsText is required")
            parser = WakeupCalendarICSParser()
            unified_events = parser.parse_to_unified_events(ics_text, source="wakeup")
            return {
                "ok": True,
                "parsed": len(unified_events),
                "events": [event.to_dict() for event in unified_events],
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    return router


__all__ = ["build_wakeup_ui_router"]

