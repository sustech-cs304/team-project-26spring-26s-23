"""sync_bridge unit tests — Blackboard → timeline.db sync."""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

from app.integrations.sustech.blackboard.api.dto import CalendarEventDTO
from app.event_manager.sync_bridge import sync_blackboard_to_unified
from app.timeline_db import query_timeline_events


def _make_bb_event_dto(**overrides) -> CalendarEventDTO:
    payload = {
        "uid": "ics_abc123",
        "raw_uid": "raw-uid-001@blackboard",
        "title": "CS304 Assignment",
        "description": "Submit by Friday",
        "location": "Teaching D 302",
        "course_id": "CS304_2024SP",
        "start_at": datetime(2026, 5, 10, 9, 0),
        "end_at": datetime(2026, 5, 10, 11, 0),
        "all_day": False,
    }
    payload.update(overrides)
    return CalendarEventDTO(**payload)


class TestSyncBridgeToTimeline:
    def test_sync_inserts_events(self, tmp_path: Path) -> None:
        os.environ["COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR"] = str(tmp_path)

        blackboard_db = MagicMock()
        blackboard_db.list_all_calendar_events.return_value = [
            _make_bb_event_dto(uid="evt_1", title="Event 1"),
            _make_bb_event_dto(uid="evt_2", title="Event 2"),
        ]

        try:
            stats = sync_blackboard_to_unified(blackboard_db)
            assert stats["inserted"] == 2

            events = query_timeline_events(tmp_path / "timeline.db")
            assert len(events) == 2
            titles = {e["title"] for e in events}
            assert "Event 1" in titles
            assert "Event 2" in titles
        finally:
            del os.environ["COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR"]

    def test_sync_removes_stale_events(self, tmp_path: Path) -> None:
        os.environ["COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR"] = str(tmp_path)

        blackboard_db = MagicMock()
        blackboard_db.list_all_calendar_events.return_value = [
            _make_bb_event_dto(uid="evt_1", title="Event 1"),
            _make_bb_event_dto(uid="evt_2", title="Event 2"),
        ]

        try:
            sync_blackboard_to_unified(blackboard_db)
            assert len(query_timeline_events(tmp_path / "timeline.db")) == 2

            # Second sync: evt_2 removed
            blackboard_db.list_all_calendar_events.return_value = [
                _make_bb_event_dto(uid="evt_1", title="Event 1 Updated"),
            ]
            stats = sync_blackboard_to_unified(blackboard_db)
            assert stats["updated"] == 1
            assert stats["deleted"] == 1

            events = query_timeline_events(tmp_path / "timeline.db")
            assert len(events) == 1
            assert events[0]["title"] == "Event 1 Updated"
        finally:
            del os.environ["COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR"]
