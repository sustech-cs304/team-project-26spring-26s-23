"""sync_bridge 单元测试。"""

from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

from app.integrations.sustech.blackboard.api.dto import CalendarEventDTO
from app.event_manager.data.db_manager import DatabaseManager as EventDatabaseManager
from app.event_manager.sync_bridge import (
    _map_bb_event_to_unified,
    sync_blackboard_to_unified,
)


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


class TestMapBBEventToUnified:
    def test_basic_mapping(self) -> None:
        bb = _make_bb_event_dto()
        result = _map_bb_event_to_unified(bb)

        assert result.title == "CS304 Assignment"
        assert result.source == "bb"
        assert result.source_id == "ics_abc123"
        assert result.start_time == datetime(2026, 5, 10, 9, 0)
        assert result.end_time == datetime(2026, 5, 10, 11, 0)
        assert result.is_all_day is False
        assert result.description == "Submit by Friday"
        assert result.status == "not_started"

    def test_metadata_payload_includes_location_and_course_id(self) -> None:
        bb = _make_bb_event_dto()
        result = _map_bb_event_to_unified(bb)

        assert result.metadata_payload is not None
        assert result.metadata_payload["location"] == "Teaching D 302"
        assert result.metadata_payload["course_id"] == "CS304_2024SP"

    def test_metadata_payload_none_when_no_location_or_course(self) -> None:
        bb = _make_bb_event_dto(location=None, course_id=None)
        result = _map_bb_event_to_unified(bb)

        assert result.metadata_payload is None

    def test_all_day_mapping(self) -> None:
        bb = _make_bb_event_dto(all_day=True, end_at=None)
        result = _map_bb_event_to_unified(bb)

        assert result.is_all_day is True
        assert result.end_time is None

    def test_missing_description_becomes_none(self) -> None:
        bb = _make_bb_event_dto(description=None)
        result = _map_bb_event_to_unified(bb)

        assert result.description is None

    def test_missing_end_at_becomes_none(self) -> None:
        bb = _make_bb_event_dto(end_at=None)
        result = _map_bb_event_to_unified(bb)

        assert result.end_time is None


class TestSyncBlackboardToUnified:
    def test_sync_inserts_and_updates(self, tmp_path: Path) -> None:
        blackboard_db = MagicMock()
        blackboard_db.list_all_calendar_events.return_value = [
            _make_bb_event_dto(uid="evt_1", title="Event 1"),
            _make_bb_event_dto(uid="evt_2", title="Event 2"),
        ]

        event_db = EventDatabaseManager(
            tmp_path / "sync_test.db", reset_schema=True
        )

        try:
            stats = sync_blackboard_to_unified(blackboard_db, event_db)

            assert stats["inserted"] == 2
            assert stats["updated"] == 0
            assert stats["deleted"] == 0

            events = event_db.list_unified_calendar_events(source="bb")
            assert len(events) == 2
            titles = {e.title for e in events}
            assert titles == {"Event 1", "Event 2"}
        finally:
            event_db.engine.dispose()

    def test_sync_deletes_stale_events(self, tmp_path: Path) -> None:
        blackboard_db = MagicMock()
        blackboard_db.list_all_calendar_events.return_value = [
            _make_bb_event_dto(uid="evt_1", title="Only Event"),
        ]

        event_db = EventDatabaseManager(
            tmp_path / "sync_test.db", reset_schema=True
        )

        try:
            # First sync: two events
            blackboard_db.list_all_calendar_events.return_value = [
                _make_bb_event_dto(uid="evt_1", title="Event 1"),
                _make_bb_event_dto(uid="evt_2", title="Event 2"),
            ]
            sync_blackboard_to_unified(blackboard_db, event_db)
            assert len(event_db.list_unified_calendar_events(source="bb")) == 2

            # Second sync: evt_2 removed from Blackboard
            blackboard_db.list_all_calendar_events.return_value = [
                _make_bb_event_dto(uid="evt_1", title="Event 1 Updated"),
            ]
            stats = sync_blackboard_to_unified(blackboard_db, event_db)

            assert stats["inserted"] == 0
            assert stats["updated"] == 1
            assert stats["deleted"] == 1

            active = event_db.list_unified_calendar_events(source="bb")
            assert len(active) == 1
            assert active[0].title == "Event 1 Updated"
        finally:
            event_db.engine.dispose()

    def test_sync_empty_blackboard_clears_unified(self, tmp_path: Path) -> None:
        blackboard_db = MagicMock()
        blackboard_db.list_all_calendar_events.return_value = [
            _make_bb_event_dto(uid="evt_1", title="Event 1"),
        ]

        event_db = EventDatabaseManager(
            tmp_path / "sync_test.db", reset_schema=True
        )

        try:
            sync_blackboard_to_unified(blackboard_db, event_db)
            assert len(event_db.list_unified_calendar_events(source="bb")) == 1

            # Now Blackboard has no events
            blackboard_db.list_all_calendar_events.return_value = []
            stats = sync_blackboard_to_unified(blackboard_db, event_db)

            assert stats["deleted"] == 1
            assert len(event_db.list_unified_calendar_events(source="bb")) == 0
        finally:
            event_db.engine.dispose()
