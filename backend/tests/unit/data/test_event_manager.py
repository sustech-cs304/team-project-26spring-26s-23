from pathlib import Path

import pytest

from app.desktop_runtime.config import ENV_DATABASE_DIR
from app.event_manager.data import db_manager as event_db_manager
from app.event_manager.data.db_manager import (
    DatabaseManager,
    resolve_default_event_manager_db_path,
)
from app.event_manager.data.dto import CourseEvent


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


_DEFAULT_RELATIVE_PATH = Path("event_manager") / "sustech.db"



def test_resolve_default_event_manager_db_path_prefers_explicit_database_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_DATABASE_DIR, str(tmp_path / "env-db"))

    resolved = resolve_default_event_manager_db_path(tmp_path / "explicit-db")

    assert resolved == tmp_path / "explicit-db" / _DEFAULT_RELATIVE_PATH



def test_resolve_default_event_manager_db_path_uses_runtime_database_dir_env(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_database_dir = tmp_path / "runtime-db"
    monkeypatch.setenv(ENV_DATABASE_DIR, str(runtime_database_dir))

    resolved = resolve_default_event_manager_db_path()

    assert resolved == runtime_database_dir / _DEFAULT_RELATIVE_PATH



def test_resolve_default_event_manager_db_path_falls_back_to_repo_relative_default(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv(ENV_DATABASE_DIR, raising=False)
    monkeypatch.setattr(
        event_db_manager,
        "_DEFAULT_REPO_EVENT_MANAGER_DB_PATH",
        tmp_path / "repo-default-data" / "sustech.db",
    )

    resolved = resolve_default_event_manager_db_path()

    assert resolved == tmp_path / "repo-default-data" / "sustech.db"


def test_database_manager_uses_repo_relative_default_when_runtime_database_dir_env_missing(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv(ENV_DATABASE_DIR, raising=False)
    monkeypatch.setattr(
        event_db_manager,
        "_DEFAULT_REPO_EVENT_MANAGER_DB_PATH",
        tmp_path / "repo-default-data" / "sustech.db",
    )

    db_manager = DatabaseManager(reset_schema=True)
    db_manager.engine.dispose()

    assert db_manager.db_path == tmp_path / "repo-default-data" / "sustech.db"



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
