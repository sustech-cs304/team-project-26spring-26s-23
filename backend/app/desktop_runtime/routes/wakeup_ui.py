from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Request

from app.desktop_runtime.config import DesktopRuntimeConfig
from app.desktop_runtime.security import require_local_token
from app.integrations.wakeup.api import WakeupCalendarICSParser
from app.timeline_db import resolve_timeline_db_path, sync_timeline_events


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    config = getattr(request.app.state, "runtime_config", None)
    if not isinstance(config, DesktopRuntimeConfig):
        raise RuntimeError("Desktop runtime config is not available on app.state.runtime_config")
    return config


def _unified_event_to_timeline_row(event: Any) -> dict[str, Any]:
    return {
        "source_id": event.source_id,
        "title": event.title,
        "start_time": event.start_time.isoformat() if hasattr(event.start_time, "isoformat") else str(event.start_time),
        "end_time": event.end_time.isoformat() if event.end_time and hasattr(event.end_time, "isoformat") else str(event.end_time) if event.end_time else None,
        "description": event.description,
        "is_all_day": event.is_all_day,
        "location": None,
        "status": event.status,
        "metadata_payload": event.metadata_payload,
    }


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

            db_path = resolve_timeline_db_path(user_data_dir=runtime_config.user_data_dir)
            timeline_rows = [_unified_event_to_timeline_row(e) for e in unified_events]
            stats = sync_timeline_events(db_path, "wakeup", timeline_rows)

            marker_file = Path(runtime_config.database_dir) / ".calendar_initialized"
            marker_file.touch(exist_ok=True)
            return {"ok": True, "parsed": len(unified_events), "stats": stats}
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
            return {"ok": True, "parsed": len(unified_events), "events": [e.to_dict() for e in unified_events]}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    return router


__all__ = ["build_wakeup_ui_router"]
