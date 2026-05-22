"""Unified calendar query routes for the desktop runtime (MOCK)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from pathlib import Path

from fastapi import APIRouter, Request

from app.desktop_runtime.config import DesktopRuntimeConfig
from app.desktop_runtime.security import require_local_token
from app.event_manager.data.db_manager import (
    DatabaseManager as EventDatabaseManager,
    resolve_default_event_manager_db_path,
)
from app.event_manager.data.dto import UnifiedCalendarEvent


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    config = getattr(request.app.state, "runtime_config", None)
    if not isinstance(config, DesktopRuntimeConfig):
        raise RuntimeError("Desktop runtime config is not available on app.state.runtime_config")
    return config

def _is_calendar_initialized(runtime_config: DesktopRuntimeConfig) -> bool:
    marker_file = Path(runtime_config.database_dir) / ".calendar_initialized"
    return marker_file.exists()

def build_calendar_router() -> APIRouter:
    router = APIRouter(prefix="/calendar", tags=["calendar"])

    @router.get("/events")
    def list_calendar_events(request: Request) -> dict[str, list[dict[str, Any]]]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)

        db = EventDatabaseManager(
            resolve_default_event_manager_db_path(runtime_config.database_dir)
        )
        items = db.list_unified_calendar_events()
        if items or _is_calendar_initialized(runtime_config):
            return {
                "items": [event.to_dict() for event in items]
            }
        now = _utc_now()
        mock_events = [
            UnifiedCalendarEvent(
                id=1,
                title="DSAA Assignment 6",
                description="Implement red-black tree operations.",
                start_time=now + timedelta(days=2),
                end_time=now + timedelta(days=3),
                source="bb",
                source_id="bb_hw_001",
                is_all_day=True,
                status="not_started",
                metadata_payload={"link": "https://bb.cuhk.edu.cn/dsaa/ass6"}
            ),
            UnifiedCalendarEvent(
                id=2,
                title="SWE Group Meeting",
                description="Sync up on project progress.",
                start_time=now + timedelta(hours=2),
                end_time=now + timedelta(hours=3),
                source="custom",
                source_id="custom_001",
                is_all_day=False,
                status="in_progress",
                metadata_payload=None
            ),
            UnifiedCalendarEvent(
                id=3,
                title="Database Systems Lab",
                description="SQL Query Optimization Lab",
                start_time=now - timedelta(days=1, hours=2),
                end_time=now - timedelta(days=1, hours=1),
                source="course",
                source_id="course_dba_001",
                is_all_day=False,
                status="completed",
                metadata_payload={"location": "Teaching D 302"}
            )
        ]
        
        return {
            "items": [event.to_dict() for event in mock_events]
        }

    return router
