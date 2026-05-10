"""Blackboard ICS → 统一日历同步桥接。

本模块提供唯一的外部接口：
    sync_blackboard_to_unified(blackboard_db, event_db) -> dict

调用方（例如 calendar_ics 用例）在 Blackboard ICS 同步完成后调用此函数，
即可将 Blackboard 侧的 CalendarEvent 同步至统一日历的 event_unified_calendar 表。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.event_manager.data.dto import UnifiedCalendarEvent
from app.integrations.sustech.blackboard.api.dto import CalendarEventDTO

if TYPE_CHECKING:
    from app.integrations.sustech.blackboard.data.db_manager import (
        DatabaseManager as BlackboardDatabaseManager,
    )
    from app.event_manager.data.db_manager import DatabaseManager as EventDatabaseManager

_SOURCE_BLACKBOARD = "bb"


def _map_bb_event_to_unified(bb_event: CalendarEventDTO) -> UnifiedCalendarEvent:
    """将 Blackboard CalendarEventDTO 映射为 UnifiedCalendarEvent DTO。"""
    metadata: dict[str, Any] = {}
    if bb_event.location:
        metadata["location"] = bb_event.location
    if bb_event.course_id:
        metadata["course_id"] = bb_event.course_id

    return UnifiedCalendarEvent(
        title=bb_event.title,
        start_time=bb_event.start_at,
        source=_SOURCE_BLACKBOARD,
        source_id=bb_event.uid,
        description=bb_event.description,
        end_time=bb_event.end_at,
        is_all_day=bb_event.all_day,
        status="not_started",
        metadata_payload=metadata if metadata else None,
    )


def sync_blackboard_to_unified(
    blackboard_db: BlackboardDatabaseManager,
    event_db: EventDatabaseManager,
) -> dict[str, int]:
    """将 Blackboard 全部活跃日历事件同步到统一日历。

    这是唯一的对外接口。调用时机：在 Blackboard ICS 同步完成后。

    Returns:
        {"inserted": N, "updated": N, "deleted": N}
    """
    bb_events = blackboard_db.list_all_calendar_events(include_deleted=False)

    unified_events = [_map_bb_event_to_unified(e) for e in bb_events]

    return event_db.sync_unified_calendar_events(_SOURCE_BLACKBOARD, unified_events)
