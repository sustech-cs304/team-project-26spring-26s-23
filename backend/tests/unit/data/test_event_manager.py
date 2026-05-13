from datetime import UTC, datetime
from pathlib import Path

import pytest

import app.event_manager.data.db_manager as db_manager_module
from app.desktop_runtime.config import ENV_DATABASE_DIR
from app.event_manager.data.db_manager import (
    DatabaseManager,
    resolve_default_event_manager_db_path,
)
from app.event_manager.data.dto import CourseEvent, UnifiedCalendarEvent
from app.event_manager.data.models import CourseEventModel, UnifiedCalendarEventModel


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
    db_manager: db_manager_module.DatabaseManager, course_event_id: int
) -> CourseEventModel:
    session = db_manager.SessionLocal()
    try:
        course_event_model = session.get(CourseEventModel, course_event_id)
        assert course_event_model is not None
        return course_event_model
    finally:
        session.close()


_DEFAULT_RELATIVE_PATH = DatabaseManager.DEFAULT_DB_RELATIVE_PATH



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
        db_manager_module,
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
        db_manager_module,
        "_DEFAULT_REPO_EVENT_MANAGER_DB_PATH",
        tmp_path / "repo-default-data" / "sustech.db",
    )

    db_manager = DatabaseManager(reset_schema=True)
    db_manager.engine.dispose()

    assert db_manager.db_path == tmp_path / "repo-default-data" / "sustech.db"


def test_course_event(tmp_path: Path):
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
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
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
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
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
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
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
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
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
    old_event = _make_course_event()
    assert db_manager.upsert_course_event(old_event)

    assert db_manager.reschedule_course(old_event, 6, None)

    events = db_manager.get_all_course_events()
    assert len(events) == 1
    assert events[0].id == old_event.id
    assert 6 in events[0].week_canceled


def test_reschedule_course_creates_new_event_in_same_group(tmp_path: Path):
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
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
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )

    with pytest.raises(ValueError):
        db_manager.reschedule_course(old_event, old_week, new_event)


def test_delete_course_event_delete_group_soft_deletes_whole_group(tmp_path: Path):
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
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


def test_unified_calendar_event_dto_serialization() -> None:
    now = datetime(2026, 4, 29, 13, 0, tzinfo=UTC)
    dto = UnifiedCalendarEvent(
        title="Group Meeting",
        start_time=now,
        source="custom",
        source_id="team_01",
        status="in_progress",
        metadata_payload={"room": "302"},
    )

    serialized = dto.to_dict()
    assert serialized["title"] == "Group Meeting"
    assert serialized["source"] == "custom"
    assert serialized["status"] == "in_progress"
    assert serialized["metadata_payload"] == {"room": "302"}
    assert serialized["start_time"] == "2026-04-29T13:00:00Z"

    model_obj = UnifiedCalendarEventModel(
        title="Group Meeting",
        start_time=now,
        source="custom",
        source_id="team_01",
        status="in_progress",
        metadata_payload={"room": "302"},
    )

    restored_dto = UnifiedCalendarEvent.from_obj(model_obj)
    assert restored_dto.title == "Group Meeting"
    assert restored_dto.source == "custom"
    assert restored_dto.metadata_payload == {"room": "302"}
    assert restored_dto.start_time == now


def test_unified_calendar_allows_reinserting_source_after_soft_delete(tmp_path: Path) -> None:
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
    session = db_manager.SessionLocal()
    try:
        original = UnifiedCalendarEventModel(
            title="Blackboard Homework",
            start_time=datetime(2026, 4, 29, 13, 0),
            source="bb",
            source_id="assignment-1",
            is_deleted=False,
        )
        session.add(original)
        session.commit()
        session.refresh(original)

        original.is_deleted = True
        session.commit()

        replacement = UnifiedCalendarEventModel(
            title="Blackboard Homework Resynced",
            start_time=datetime(2026, 4, 30, 13, 0),
            source="bb",
            source_id="assignment-1",
            is_deleted=False,
        )
        session.add(replacement)
        session.commit()
        session.refresh(replacement)

        rows = (
            session.query(UnifiedCalendarEventModel)
            .filter(UnifiedCalendarEventModel.source == "bb")
            .filter(UnifiedCalendarEventModel.source_id == "assignment-1")
            .order_by(UnifiedCalendarEventModel.id.asc())
            .all()
        )
    finally:
        session.close()
        db_manager.engine.dispose()

    assert len(rows) == 2
    assert rows[0].is_deleted is True
    assert rows[1].is_deleted is False


# ── UnifiedCalendarEvent CRUD ────────────────────────────────────────

def _make_unified_event(**overrides) -> UnifiedCalendarEvent:
    payload = {
        "title": "Test Event",
        "start_time": datetime(2026, 5, 1, 10, 0),
        "source": "bb",
        "source_id": "bb_test_001",
        "description": "A test event",
        "end_time": datetime(2026, 5, 1, 12, 0),
        "is_all_day": False,
        "status": "not_started",
        "metadata_payload": {"location": "Room 101"},
    }
    payload.update(overrides)
    return UnifiedCalendarEvent(**payload)


def test_upsert_unified_calendar_event_insert(tmp_path: Path):
    """插入新统一日历事件。"""
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
    event = _make_unified_event()
    assert db_manager.upsert_unified_calendar_event(event)
    assert event.id is not None

    events = db_manager.list_unified_calendar_events()
    assert len(events) == 1
    assert events[0].title == "Test Event"
    assert events[0].source == "bb"
    assert events[0].source_id == "bb_test_001"
    db_manager.engine.dispose()


def test_upsert_unified_calendar_event_update(tmp_path: Path):
    """更新已有统一日历事件。"""
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
    event = _make_unified_event()
    assert db_manager.upsert_unified_calendar_event(event)

    event.title = "Updated Title"
    event.status = "completed"
    assert db_manager.upsert_unified_calendar_event(event)

    events = db_manager.list_unified_calendar_events()
    assert len(events) == 1
    assert events[0].title == "Updated Title"
    assert events[0].status == "completed"
    assert events[0].id == event.id
    db_manager.engine.dispose()


def test_sync_unified_calendar_events_inserts_and_deletes(tmp_path: Path):
    """同步一个 source 的事件列表，新事件插入，缺失事件软删除。"""
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )

    # 先插入两个已有事件
    event1 = _make_unified_event(source_id="keep_001", title="Keep Me")
    event2 = _make_unified_event(source_id="remove_001", title="Remove Me")
    db_manager.upsert_unified_calendar_event(event1)
    db_manager.upsert_unified_calendar_event(event2)
    assert len(db_manager.list_unified_calendar_events()) == 2

    # 同步：保留 keep_001，新增 new_001，remove_001 应被软删除
    synced = [
        _make_unified_event(source_id="keep_001", title="Keep Me Updated"),
        _make_unified_event(source_id="new_001", title="New Event"),
    ]
    stats = db_manager.sync_unified_calendar_events("bb", synced)
    assert stats["inserted"] == 1
    assert stats["updated"] == 1
    assert stats["deleted"] == 1

    active = db_manager.list_unified_calendar_events()
    assert len(active) == 2
    titles = {e.title for e in active}
    assert titles == {"Keep Me Updated", "New Event"}

    # 被删除的事件在 DB 中标记为 is_deleted
    session = db_manager.SessionLocal()
    try:
        removed = (
            session.query(UnifiedCalendarEventModel)
            .filter(UnifiedCalendarEventModel.source_id == "remove_001")
            .one()
        )
        assert removed.is_deleted is True
    finally:
        session.close()
        db_manager.engine.dispose()


def test_list_unified_calendar_events_by_source(tmp_path: Path):
    """按 source 过滤列出统一日历事件。"""
    db_manager = db_manager_module.DatabaseManager(
        tmp_path / "event_manager.db", reset_schema=True
    )
    db_manager.upsert_unified_calendar_event(
        _make_unified_event(source="bb", source_id="bb_1", title="BB Event")
    )
    db_manager.upsert_unified_calendar_event(
        _make_unified_event(source="custom", source_id="cu_1", title="Custom Event")
    )

    bb_events = db_manager.list_unified_calendar_events(source="bb")
    assert len(bb_events) == 1
    assert bb_events[0].source == "bb"

    all_events = db_manager.list_unified_calendar_events()
    assert len(all_events) == 2
    db_manager.engine.dispose()

