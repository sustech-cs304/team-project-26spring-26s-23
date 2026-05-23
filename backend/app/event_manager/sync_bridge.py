"""Blackboard ICS → timeline.db 同步桥接。

调用方（例如 calendar_ics 用例）在 Blackboard ICS 同步完成后调用此函数，
即可将 Blackboard 侧的 CalendarEvent 同步至 Electron timeline.db。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.timeline_db import resolve_timeline_db_path, sync_timeline_events

if TYPE_CHECKING:
    from app.integrations.sustech.blackboard.data.db_manager import (
        DatabaseManager as BlackboardDatabaseManager,
    )

_SOURCE_BLACKBOARD = "bb"


def _map_bb_event_to_timeline_row(bb_event: Any) -> dict[str, Any]:
    """将 Blackboard CalendarEventDTO 映射为 timeline_events 行。"""
    metadata: dict[str, Any] = {}
    if bb_event.location:
        metadata["location"] = bb_event.location
    if bb_event.course_id:
        metadata["course_id"] = bb_event.course_id

    return {
        "source_id": bb_event.uid,
        "title": bb_event.title,
        "start_time": bb_event.start_at.isoformat() if hasattr(bb_event.start_at, "isoformat") else str(bb_event.start_at),
        "end_time": bb_event.end_at.isoformat() if bb_event.end_at and hasattr(bb_event.end_at, "isoformat") else str(bb_event.end_at) if bb_event.end_at else None,
        "description": bb_event.description,
        "is_all_day": bb_event.all_day,
        "location": bb_event.location,
        "status": "completed" if bb_event.done else "not_started",
        "metadata_payload": metadata if metadata else None,
    }


def sync_blackboard_to_unified(
    blackboard_db: BlackboardDatabaseManager,
) -> dict[str, int]:
    """将 Blackboard 全部活跃日历事件同步到 timeline.db。

    Returns:
        {"inserted": N, "updated": N, "deleted": N}
    """
    bb_events = blackboard_db.list_all_calendar_events(include_deleted=False)
    timeline_rows = [_map_bb_event_to_timeline_row(e) for e in bb_events]
    db_path = resolve_timeline_db_path()
    return sync_timeline_events(db_path, _SOURCE_BLACKBOARD, timeline_rows)
