from datetime import datetime
from pathlib import Path

import pytest

import app.event_manager.data.db_manager as db_manager_module
from app.event_manager.data.db_manager import DatabaseManager
from app.event_manager.data.dto import CourseEvent
from app.event_manager.data.models import CourseEventModel


def _make_course_event(**overrides) -> CourseEvent:
    payload = {
        "course_name": "test class",
        "semester_id": "2024春季",
        "class_start": 1,
        "class_end": 2,
        "week_day": 1,
        "week_start": 1,
        "week_end": 16,
        "week_type": 0,
        "place": "教室101",
        "teacher": "张老师",
    }
    payload.update(overrides)
    return CourseEvent(**payload)


def _get_course_event_model(
    db_manager: DatabaseManager, course_event_id: int
) -> CourseEventModel:
    session = db_manager.SessionLocal()
    try:
        course_event_model = session.get(CourseEventModel, course_event_id)
        assert course_event_model is not None
        return course_event_model
    finally:
        session.close()


def test_course_event(tmp_path: Path):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    event1 = _make_course_event()
    assert db_manager.upsert_course_event(event1)
    assert event1.id is not None

    events = db_manager.get_all_course_events()
    assert len(events) == 1

    event2 = _make_course_event(
        course_name="test class2",
        place="教室201",
        teacher="李老师",
    )
    assert db_manager.upsert_course_event(event2)
    assert event2.id is not None

    events = db_manager.get_all_course_events()
    assert len(events) == 2

    assert db_manager.delete_course_event(event2.id)

    events = db_manager.get_all_course_events()
    assert len(events) == 1

    event2.week_end = 12
    assert not db_manager.upsert_course_event(event2)

    event1.week_day = 7
    assert db_manager.upsert_course_event(event1)
    events = db_manager.get_all_course_events()
    assert events[0].week_day == event1.week_day


def test_upsert_course_event_backfills_course_group_id(tmp_path: Path):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    event = _make_course_event(course_group_id=None)

    assert db_manager.upsert_course_event(event)

    assert event.id is not None
    assert event.course_group_id == event.id

    persisted_event = db_manager.get_all_course_events()[0]
    assert persisted_event.id == event.id
    assert persisted_event.course_group_id == event.id


def test_upsert_course_event_uses_naive_utc_timestamps_on_insert(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    expected_now = datetime(2026, 4, 19, 17, 0, 0, 123456)
    monkeypatch.setattr(db_manager_module, "_utc_now_naive", lambda: expected_now)

    event = _make_course_event(course_group_id=42)
    assert db_manager.upsert_course_event(event)

    assert event.id is not None
    persisted_event = _get_course_event_model(db_manager, event.id)
    assert persisted_event.created_at == expected_now
    assert persisted_event.updated_at == expected_now
    assert persisted_event.created_at.tzinfo is None
    assert persisted_event.updated_at.tzinfo is None


def test_upsert_course_event_uses_naive_utc_timestamps_on_update(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    created_at = datetime(2026, 4, 19, 17, 0, 0, 123456)
    updated_at = datetime(2026, 4, 19, 17, 5, 0, 654321)
    monkeypatch.setattr(db_manager_module, "_utc_now_naive", lambda: created_at)

    event = _make_course_event()
    assert db_manager.upsert_course_event(event)

    monkeypatch.setattr(db_manager_module, "_utc_now_naive", lambda: updated_at)
    event.week_day = 7
    assert db_manager.upsert_course_event(event)

    assert event.id is not None
    persisted_event = _get_course_event_model(db_manager, event.id)
    assert persisted_event.created_at == created_at
    assert persisted_event.updated_at == updated_at
    assert persisted_event.created_at.tzinfo is None
    assert persisted_event.updated_at.tzinfo is None


def test_reschedule_course_can_cancel_single_week_only(tmp_path: Path):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    old_event = _make_course_event()
    assert db_manager.upsert_course_event(old_event)

    assert db_manager.reschedule_course(old_event, 6, None)

    events = db_manager.get_all_course_events()
    assert len(events) == 1
    assert events[0].id == old_event.id
    assert 6 in events[0].week_canceled


def test_reschedule_course_creates_new_event_in_same_group(tmp_path: Path):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    old_event = _make_course_event()
    assert db_manager.upsert_course_event(old_event)

    new_event = _make_course_event(
        week_day=3,
        class_start=3,
        class_end=4,
        week_start=8,
        week_end=8,
        week_type=2,
        place="教室202",
        teacher="王老师",
    )

    assert new_event.id is None
    assert db_manager.reschedule_course(old_event, 8, new_event)

    events = sorted(db_manager.get_all_course_events(), key=lambda event: event.id or 0)
    assert len(events) == 2

    persisted_old_event = next(event for event in events if event.id == old_event.id)
    persisted_new_event = next(event for event in events if event.id == new_event.id)

    assert 8 in persisted_old_event.week_canceled
    assert persisted_new_event.course_group_id == persisted_old_event.course_group_id
    assert persisted_new_event.course_group_id == old_event.course_group_id


@pytest.mark.parametrize(
    ("old_event", "old_week", "new_event"),
    [
        (_make_course_event(), 4, None),
        (
            _make_course_event(id=1, course_group_id=1),
            4,
            _make_course_event(id=99),
        ),
    ],
)
def test_reschedule_course_rejects_invalid_arguments(
    tmp_path: Path,
    old_event: CourseEvent,
    old_week: int,
    new_event: CourseEvent | None,
):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)

    with pytest.raises(ValueError):
        db_manager.reschedule_course(old_event, old_week, new_event)


def test_delete_course_event_delete_group_soft_deletes_whole_group(tmp_path: Path):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    event1 = _make_course_event()
    assert db_manager.upsert_course_event(event1)

    event2 = _make_course_event(
        week_day=3,
        class_start=5,
        class_end=6,
        week_start=9,
        week_end=9,
        week_type=2,
        course_group_id=event1.course_group_id,
        place="教室303",
        teacher="赵老师",
    )
    assert db_manager.upsert_course_event(event2)

    assert event1.course_group_id == event2.course_group_id
    assert event1.id is not None
    assert db_manager.delete_course_event(event1.id, delete_group=True)
    assert db_manager.get_all_course_events() == []
    assert not db_manager.delete_course_event(event1.id, delete_group=True)
