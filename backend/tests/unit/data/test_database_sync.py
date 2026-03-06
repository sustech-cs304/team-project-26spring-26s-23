from __future__ import annotations

from pathlib import Path

from app.core.database import Announcement, Course, DatabaseManager, Resource


def _db_path(tmp_path: Path, name: str) -> Path:
    return tmp_path / f"{name}.db"


def _get_resource_parent_id(manager: DatabaseManager, resource_id: str) -> str | None:
    session = manager.SessionLocal()
    try:
        row = session.query(Resource).filter(Resource.resource_id == resource_id).one_or_none()
        return row.parent_id if row is not None else None
    finally:
        session.close()


def _get_course_flags(manager: DatabaseManager, course_id: str) -> tuple[bool, str | None]:
    session = manager.SessionLocal()
    try:
        row = session.query(Course).filter(Course.course_id == course_id).one_or_none()
        if row is None:
            return False, None
        return bool(row.is_deleted), row.instructor
    finally:
        session.close()


def _get_announcement(manager: DatabaseManager, announcement_id: str) -> Announcement | None:
    session = manager.SessionLocal()
    try:
        return session.query(Announcement).filter(Announcement.announcement_id == announcement_id).one_or_none()
    finally:
        session.close()


def test_sync_resources_parent_id_missing_parent_is_null(tmp_path: Path) -> None:
    manager = DatabaseManager(_db_path(tmp_path, "test_fk_missing_parent"), reset_schema=True)
    course_id = "_fk_course_missing_parent"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "FK Regression Course Missing Parent",
                "url": None,
            }
        ]
    )

    stats = manager.sync_resources(
        course_id,
        [
            {
                "resource_id": "res_child_without_existing_parent",
                "title": "child-with-invalid-parent",
                "type": "link",
                "url": "bb://resource/_fk_course_missing_parent/res_child_without_existing_parent",
                "parent_id": "res_parent_not_exists",
            }
        ],
    )

    assert stats["inserted"] == 1
    assert _get_resource_parent_id(manager, "res_child_without_existing_parent") is None


def test_sync_resources_parent_child_relationship_preserved(tmp_path: Path) -> None:
    manager = DatabaseManager(_db_path(tmp_path, "test_fk_valid_parent"), reset_schema=True)
    course_id = "_fk_course_valid_parent"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "FK Regression Course Valid Parent",
                "url": None,
            }
        ]
    )

    stats = manager.sync_resources(
        course_id,
        [
            {
                "resource_id": "res_child_valid",
                "title": "child",
                "type": "link",
                "url": "bb://resource/_fk_course_valid_parent/res_child_valid",
                "parent_id": "res_parent_valid",
            },
            {
                "resource_id": "res_parent_valid",
                "title": "parent",
                "type": "folder",
                "url": "bb://resource/_fk_course_valid_parent/res_parent_valid",
                "parent_id": None,
            },
        ],
    )

    assert stats["inserted"] == 2
    assert _get_resource_parent_id(manager, "res_child_valid") == "res_parent_valid"


def test_sync_courses_soft_delete_and_revive_via_facade(tmp_path: Path) -> None:
    manager = DatabaseManager(_db_path(tmp_path, "test_courses_soft_delete_facade"), reset_schema=True)

    stats1 = manager.sync_courses(
        [
            {
                "course_id": "course_a",
                "name": "Course A Fall 2026",
                "instructor": "Teacher A",
                "url": None,
            },
            {
                "course_id": "course_b",
                "name": "Course B Fall 2026",
                "instructor": "Teacher B",
                "url": None,
            },
        ]
    )
    assert stats1 == {"inserted": 2, "updated": 0, "deleted": 0}

    stats2 = manager.sync_courses(
        [
            {
                "course_id": "course_a",
                "name": "Course A Fall 2026",
                "instructor": "Teacher A Updated",
                "url": None,
            }
        ]
    )
    assert stats2 == {"inserted": 0, "updated": 1, "deleted": 1}
    assert _get_course_flags(manager, "course_a") == (False, "Teacher A Updated")
    assert _get_course_flags(manager, "course_b") == (True, "Teacher B")
    assert manager.get_table_counts()["courses"] == {"total": 2, "active": 1}

    stats3 = manager.sync_courses(
        [
            {
                "course_id": "course_a",
                "name": "Course A Fall 2026",
                "instructor": "Teacher A Updated",
                "url": None,
            },
            {
                "course_id": "course_b",
                "name": "Course B Fall 2026",
                "instructor": "Teacher B Returned",
                "url": None,
            },
        ]
    )
    assert stats3 == {"inserted": 0, "updated": 2, "deleted": 0}
    assert _get_course_flags(manager, "course_b") == (False, "Teacher B Returned")
    assert manager.get_table_counts()["courses"] == {"total": 2, "active": 2}


def test_sync_announcements_upsert_only_and_course_name_resolution(tmp_path: Path) -> None:
    manager = DatabaseManager(_db_path(tmp_path, "test_announcements_upsert_only"), reset_schema=True)
    course_id = "course_ann"
    course_name = "Course Ann Fall 2026"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": course_name,
                "url": None,
            }
        ]
    )

    stats1 = manager.sync_announcements(
        [
            {
                "announcement_id": "ann_course_name_only",
                "course_name": course_name,
                "title": "Announcement One",
                "content": "Hello",
                "publish_time": "2026-10-01 10:00",
            },
            {
                "announcement_id": "ann_direct_course_id",
                "course_id": course_id,
                "title": "Announcement Two",
                "content": "World",
                "publish_time": "2026-10-02 10:00",
            },
        ]
    )
    assert stats1 == {"inserted": 2, "updated": 0, "deleted": 0}

    resolved = _get_announcement(manager, "ann_course_name_only")
    assert resolved is not None
    assert resolved.course_id == course_id
    assert resolved.is_deleted is False

    stats2 = manager.sync_announcements(
        [
            {
                "announcement_id": "ann_course_name_only",
                "course_name": course_name,
                "title": "Announcement One Updated",
                "content": "Hello Again",
                "publish_time": "2026-10-01 10:00",
            }
        ]
    )
    assert stats2 == {"inserted": 0, "updated": 1, "deleted": 0}

    updated = _get_announcement(manager, "ann_course_name_only")
    preserved = _get_announcement(manager, "ann_direct_course_id")
    assert updated is not None
    assert updated.title == "Announcement One Updated"
    assert updated.course_id == course_id
    assert preserved is not None
    assert preserved.is_deleted is False
    assert manager.get_table_counts()["announcements"] == {"total": 2, "active": 2}
