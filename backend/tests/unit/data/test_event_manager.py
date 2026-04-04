from pathlib import Path
from app.event_manager.data.db_manager import DatabaseManager
from app.event_manager.data.dto import CourseEvent


def test_course_event(tmp_path: Path):
    db_manager = DatabaseManager(tmp_path / "event_manager.db", reset_schema=True)
    event1 = CourseEvent(
        course_name="test class1",
        semester_id="2024春季",
        class_start=1,
        class_end=2,
        week_day=1,
        week_start=1,
        week_end=16,
        week_type=0,
        place="教室101",
        teacher="张老师",
    )
    assert db_manager.upsert_course_event(event1)
    assert event1.id is not None

    events = db_manager.get_all_course_events()
    assert len(events) == 1

    event2 = CourseEvent(
        course_name="test class2",
        semester_id="2024春季",
        class_start=1,
        class_end=2,
        week_day=1,
        week_start=1,
        week_end=16,
        week_type=0,
        place="教室201",
        teacher="李老师",
    )
    assert db_manager.upsert_course_event(event2)
    assert event2.id is not None

    events = db_manager.get_all_course_events()
    assert len(events) == 2

    db_manager.delete_course_event(event2.id)

    events = db_manager.get_all_course_events()
    assert len(events) == 1

    event2.week_end = 12
    assert not db_manager.upsert_course_event(event2)

    event1.week_day = 7
    assert db_manager.upsert_course_event(event1)
    events = db_manager.get_all_course_events()
    assert events[0].week_day == event1.week_day