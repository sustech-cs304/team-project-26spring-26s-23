"""Unified calendar query routes for the desktop runtime (MOCK)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Request

from app.event_manager.data.dto import UnifiedCalendarEvent

from ..config import DesktopRuntimeConfig
from ..security import require_local_token


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    return request.app.state.runtime_config  # type: ignore[return-value]


def build_calendar_router() -> APIRouter:
    router = APIRouter(prefix="/calendar", tags=["calendar"])

    @router.get("/events")
    def list_calendar_events(request: Request) -> dict[str, list[dict[str, Any]]]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)

        # TODO: Replace with real database queries once the persistence layer is ready.
        # This is mock data for the frontend to start developing the UI.
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
