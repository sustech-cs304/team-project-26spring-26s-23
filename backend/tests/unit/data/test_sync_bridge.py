"""sync_bridge unit tests — Blackboard → timeline.db sync."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.integrations.sustech.blackboard.api.dto import CalendarEventDTO
from app.event_manager.sync_bridge import (
    sync_blackboard_assignments_to_unified,
    sync_blackboard_to_unified,
)
from app.timeline_db import insert_timeline_event, query_timeline_events


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


class TestSyncBlackboardAssignmentsToTimeline:
    def test_assignment_sync_inserts_valid_rows_skips_duplicates_and_preserves_ics(
        self,
        tmp_path: Path,
    ) -> None:
        blackboard_db_path = tmp_path / "blackboard.db"
        timeline_db_path = tmp_path / "timeline.db"
        _setup_assignment_db(blackboard_db_path)
        _insert_assignment_row(
            blackboard_db_path,
            assignment_id="asg-completed",
            title="Submitted Homework",
            start_time="2026-05-01T08:00:00",
            end_time="2026-05-03T23:59:00",
            submission_status="Submitted",
            status="Submitted",
            score="95",
        )
        _insert_assignment_row(
            blackboard_db_path,
            assignment_id="asg-open",
            title="Open Homework",
            start_time="2026-05-04T08:00:00",
            end_time="2026-05-06T23:59:00",
            submission_status="Not Submitted",
            status="Open",
            score=None,
        )
        _insert_assignment_row(
            blackboard_db_path,
            assignment_id="asg-existing",
            title="Existing Homework",
            start_time="2026-05-07T08:00:00",
            end_time="2026-05-08T23:59:00",
            submission_status="Submitted",
            status="Submitted",
            score="100",
        )
        _insert_assignment_row(
            blackboard_db_path,
            assignment_id="asg-invalid-time",
            title="Invalid Time Homework",
            start_time=None,
            end_time="2026-05-10T23:59:00",
            submission_status="Submitted",
            status="Submitted",
            score="88",
        )

        insert_timeline_event(
            timeline_db_path,
            source="bb",
            source_id="ics-event-1",
            title="Existing Blackboard ICS Event",
            start_time="2026-05-01T10:00:00",
            end_time="2026-05-01T11:00:00",
        )
        insert_timeline_event(
            timeline_db_path,
            source="bb",
            source_id="assignment:asg-existing",
            title="Existing Assignment Event",
            start_time="2026-05-07T08:00:00",
            end_time="2026-05-08T23:59:00",
        )

        stats = sync_blackboard_assignments_to_unified(
            SimpleNamespace(db_path=blackboard_db_path),
            timeline_db_path=timeline_db_path,
        )

        assert stats == {
            "inserted": 2,
            "skipped_existing": 1,
            "skipped_invalid_time": 1,
            "skipped_too_old": 0,
            "skipped_missing_identity": 0,
        }
        events = query_timeline_events(timeline_db_path, source="bb")
        by_source_id = {event["source_id"]: event for event in events}

        assert "ics-event-1" in by_source_id
        assert by_source_id["ics-event-1"]["title"] == "Existing Blackboard ICS Event"
        assert by_source_id["assignment:asg-completed"]["status"] == "completed"
        assert by_source_id["assignment:asg-completed"]["progress"] == 100
        assert by_source_id["assignment:asg-open"]["status"] == "in_progress"
        assert by_source_id["assignment:asg-open"]["progress"] == 50
        assert "assignment:asg-invalid-time" not in by_source_id
        assert len(events) == 4


    def test_assignment_sync_inserts_strong_due_only_assignment_as_deadline_window(
        self,
        tmp_path: Path,
    ) -> None:
        blackboard_db_path = tmp_path / "blackboard.db"
        timeline_db_path = tmp_path / "timeline.db"
        _setup_assignment_db(blackboard_db_path)
        _insert_assignment_row(
            blackboard_db_path,
            assignment_id="asg-due-only",
            title="Real Blackboard Assignment With Only Due Date",
            start_time=None,
            end_time="2026-06-03T23:59:00",
            submission_status="Not Submitted",
            status="Open",
            score=None,
            url=(
                "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment"
                "?content_id=asg-due-only&course_id=course-1&mode=view"
            ),
        )

        stats = sync_blackboard_assignments_to_unified(
            SimpleNamespace(db_path=blackboard_db_path),
            timeline_db_path=timeline_db_path,
        )

        assert stats == {
            "inserted": 1,
            "skipped_existing": 0,
            "skipped_invalid_time": 0,
            "skipped_too_old": 0,
            "skipped_missing_identity": 0,
        }
        events = query_timeline_events(timeline_db_path, source="bb")
        assert len(events) == 1
        assert events[0]["source_id"] == "assignment:asg-due-only"
        assert events[0]["start_time"] == "2026-06-03T22:59:00"
        assert events[0]["end_time"] == "2026-06-03T23:59:00"

    def test_assignment_sync_skips_assignments_older_than_three_months(
        self,
        tmp_path: Path,
    ) -> None:
        blackboard_db_path = tmp_path / "blackboard.db"
        timeline_db_path = tmp_path / "timeline.db"
        _setup_assignment_db(blackboard_db_path)
        _insert_assignment_row(
            blackboard_db_path,
            assignment_id="asg-old",
            title="Old Blackboard Assignment",
            start_time="2000-01-01T08:00:00",
            end_time="2000-01-02T23:59:00",
            submission_status="Submitted",
            status="Submitted",
            score="100",
            url=(
                "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment"
                "?content_id=asg-old&course_id=course-1&mode=view"
            ),
        )

        stats = sync_blackboard_assignments_to_unified(
            SimpleNamespace(db_path=blackboard_db_path),
            timeline_db_path=timeline_db_path,
        )

        assert stats == {
            "inserted": 0,
            "skipped_existing": 0,
            "skipped_invalid_time": 0,
            "skipped_too_old": 1,
            "skipped_missing_identity": 0,
        }
        assert query_timeline_events(timeline_db_path, source="bb") == []


def _setup_assignment_db(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """CREATE TABLE assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id TEXT NOT NULL,
                assignment_id TEXT NOT NULL,
                title TEXT NOT NULL,
                url TEXT,
                description TEXT,
                summary TEXT,
                source_page TEXT,
                start_time TEXT,
                end_time TEXT,
                due_date TEXT,
                due_date_parsed TEXT,
                posted_date TEXT,
                status TEXT,
                submission_status TEXT,
                score TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0
            )"""
        )
        conn.commit()


def _insert_assignment_row(
    db_path: Path,
    *,
    assignment_id: str,
    title: str,
    start_time: str | None,
    end_time: str | None,
    submission_status: str,
    status: str,
    score: str | None,
    url: str | None = None,
) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute(
            """INSERT INTO assignments (
                course_id,
                assignment_id,
                title,
                url,
                description,
                summary,
                source_page,
                start_time,
                end_time,
                due_date,
                due_date_parsed,
                posted_date,
                status,
                submission_status,
                score,
                is_deleted
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (
                "course-1",
                assignment_id,
                title,
                url or f"https://bb.sustech.edu.cn/{assignment_id}",
                f"{title} description",
                f"{title} summary",
                "https://bb.sustech.edu.cn/course-1/assignments",
                start_time,
                end_time,
                end_time,
                end_time,
                "2026-04-30T08:00:00",
                status,
                submission_status,
                score,
            ),
        )
        conn.commit()
