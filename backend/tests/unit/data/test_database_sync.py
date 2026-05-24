from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from app.integrations.sustech.blackboard.data import (
    Announcement,
    AnnouncementAssignmentLink,
    Assignment,
    Course,
    DatabaseManager,
    Resource,
)


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


def _get_announcement_assignment_link(
    manager: DatabaseManager,
    announcement_id: str,
    assignment_id: str,
) -> AnnouncementAssignmentLink | None:
    session = manager.SessionLocal()
    try:
        return (
            session.query(AnnouncementAssignmentLink)
            .filter(
                AnnouncementAssignmentLink.announcement_id == announcement_id,
                AnnouncementAssignmentLink.assignment_id == assignment_id,
            )
            .one_or_none()
        )
    finally:
        session.close()


def _table_columns(db_path: Path, table_name: str) -> set[str]:
    with sqlite3.connect(str(db_path)) as connection:
        rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row[1]) for row in rows}


def _get_active_assignments_by_title(manager: DatabaseManager, title: str) -> list[Assignment]:
    session = manager.SessionLocal()
    try:
        return (
            session.query(Assignment)
            .filter(Assignment.title == title, Assignment.is_deleted.is_(False))
            .order_by(Assignment.assignment_id.asc())
            .all()
        )
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


def test_sync_courses_preserves_naive_utc_timestamps(tmp_path: Path) -> None:
    manager = DatabaseManager(_db_path(tmp_path, "test_courses_naive_utc"), reset_schema=True)
    course_id = "course_ts"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "Course Timestamp Regression",
                "url": None,
            }
        ]
    )

    session = manager.SessionLocal()
    try:
        inserted = session.query(Course).filter(Course.course_id == course_id).one()
        created_at = inserted.created_at
        updated_at = inserted.updated_at
        last_synced_at = inserted.last_synced_at
    finally:
        session.close()

    assert created_at.tzinfo is None
    assert updated_at.tzinfo is None
    assert last_synced_at is not None
    assert last_synced_at.tzinfo is None
    assert created_at == updated_at

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "Course Timestamp Regression",
                "instructor": "Teacher Timestamp",
                "url": None,
            }
        ]
    )

    session = manager.SessionLocal()
    try:
        updated = session.query(Course).filter(Course.course_id == course_id).one()
        assert updated.created_at == created_at
        assert updated.updated_at.tzinfo is None
        assert updated.updated_at >= updated_at
        assert updated.last_synced_at is not None
        assert updated.last_synced_at.tzinfo is None
        assert updated.last_synced_at >= last_synced_at
    finally:
        session.close()


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


def test_sync_announcements_persists_relation_fields_and_links(tmp_path: Path) -> None:
    manager = DatabaseManager(_db_path(tmp_path, "test_announcements_relation_links"), reset_schema=True)
    course_id = "course_relation"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "Computer Organization Spring 2026",
                "url": None,
            }
        ]
    )
    manager.sync_assignments(
        course_id,
        [
            {
                "assignment_id": "asg_homework_2",
                "title": "Homework 2",
                "url": f"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id={course_id}&content_id=_596747_1",
                "source_page": f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}#contentListItem:_596747_1",
            }
        ],
    )

    stats = manager.sync_announcements(
        [
            {
                "announcement_id": "ann_hw2_release",
                "course_id": course_id,
                "title": "Lab assignment 2 released",
                "content": "Please open Homework 2 from Blackboard.",
                "relation_type": "assignment_notice",
                "relation_confidence": "high",
                "publish_time": "2026-04-19 16:48",
            }
        ],
        links_data=[
            {
                "announcement_id": "ann_hw2_release",
                "assignment_id": "asg_homework_2",
                "course_id": course_id,
                "link_source": "ann_id_launch_link",
                "confidence": "high",
                "evidence_json": {"ann_id": "_43635_1", "path_text": "/Homework/Homework 2"},
            }
        ],
    )

    assert stats == {"inserted": 1, "updated": 0, "deleted": 0}
    announcement = _get_announcement(manager, "ann_hw2_release")
    assert announcement is not None
    assert announcement.relation_type == "assignment_notice"
    assert announcement.relation_confidence == "high"

    link = _get_announcement_assignment_link(
        manager,
        "ann_hw2_release",
        "asg_homework_2",
    )
    assert link is not None
    assert link.is_deleted is False
    assert link.link_source == "ann_id_launch_link"
    assert link.confidence == "high"
    assert '"ann_id": "_43635_1"' in str(link.evidence_json)

    manager.sync_announcements(
        [
            {
                "announcement_id": "ann_hw2_release",
                "course_id": course_id,
                "title": "Lab assignment 2 released",
                "content": "Please open Homework 2 from Blackboard.",
                "relation_type": "content_linked_announcement",
                "relation_confidence": "high",
                "publish_time": "2026-04-19 16:48",
            }
        ],
        links_data=[],
    )
    link_after = _get_announcement_assignment_link(
        manager,
        "ann_hw2_release",
        "asg_homework_2",
    )
    assert link_after is not None
    assert link_after.is_deleted is True


def test_sync_assignments_merges_same_assignment_id_rows_and_preserves_richer_fields(tmp_path: Path) -> None:
    """同一 assignment_id 的多条镜像记录应合并字段，保留最丰富的信息。"""
    manager = DatabaseManager(_db_path(tmp_path, "test_assignments_same_id_merge"), reset_schema=True)
    course_id = "course_assign_merge"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "Assignment Merge Course",
                "url": None,
            }
        ]
    )

    stats = manager.sync_assignments(
        course_id,
        [
            {
                "assignment_id": "asg_homework_1",
                "title": "Homework 1",
                "url": f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}#contentListItem:_1",
                "summary": "fragment summary",
                "attachments": [
                    {
                        "name": "spec.pdf",
                        "url": "https://bb.sustech.edu.cn/bbcswebdav/xid-spec",
                    }
                ],
            },
            {
                "assignment_id": "asg_homework_1",
                "title": "Homework 1",
                "url": f"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id={course_id}&content_id=_1",
                "description_html": "<p>Detailed instructions</p>",
                "due_date": "2026-05-01",
                "submission_status": "Submitted",
            },
        ],
    )

    assert stats == {"inserted": 1, "updated": 0, "deleted": 0}
    active_rows = _get_active_assignments_by_title(manager, "Homework 1")
    assert len(active_rows) == 1
    merged = active_rows[0]
    assert merged.description_html == "<p>Detailed instructions</p>"
    assert merged.due_date == "2026-05-01"
    assert merged.submission_status == "Submitted"
    assert "spec.pdf" in str(merged.attachments_json)


def test_sync_assignments_keeps_distinct_assignments_with_same_title(tmp_path: Path) -> None:
    """同一门课中标题相同但 assignment_id 不同的作业应保留为独立记录。"""
    manager = DatabaseManager(_db_path(tmp_path, "test_assignments_same_title_distinct"), reset_schema=True)
    course_id = "course_assign_distinct"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "Distinct Assignment Course",
                "url": None,
            }
        ]
    )

    stats = manager.sync_assignments(
        course_id,
        [
            {
                "assignment_id": "asg_homework_1_week3",
                "title": "Homework 1",
                "url": f"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id={course_id}&content_id=_100",
                "due_date": "2026-03-15",
                "status": "Submitted",
            },
            {
                "assignment_id": "asg_homework_1_week5",
                "title": "Homework 1",
                "url": f"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id={course_id}&content_id=_200",
                "due_date": "2026-04-01",
                "status": "Not Submitted",
            },
        ],
    )

    assert stats == {"inserted": 2, "updated": 0, "deleted": 0}
    active_rows = _get_active_assignments_by_title(manager, "Homework 1")
    assert len(active_rows) == 2


def test_sync_assignments_persists_start_and_end_time_fields(tmp_path: Path) -> None:
    """assignment 的开始/结束时间应随同步结果写入数据库。"""
    manager = DatabaseManager(_db_path(tmp_path, "test_assignments_start_end_persist"), reset_schema=True)
    course_id = "course_assign_time"

    manager.sync_courses(
        [
            {
                "course_id": course_id,
                "name": "Assignment Time Course",
                "url": None,
            }
        ]
    )

    stats = manager.sync_assignments(
        course_id,
        [
            {
                "assignment_id": "asg_time_window",
                "title": "Timed Homework",
                "url": f"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id={course_id}&content_id=_300",
                "start_time": "2026-05-01 08:00:00",
                "end_time": "2026-05-03 23:59:00",
                "status": "Not Submitted",
            }
        ],
    )

    assert stats == {"inserted": 1, "updated": 0, "deleted": 0}
    rows = _get_active_assignments_by_title(manager, "Timed Homework")
    assert len(rows) == 1
    persisted = rows[0]
    assert persisted.start_time == datetime(2026, 5, 1, 8, 0, 0)
    assert persisted.end_time == datetime(2026, 5, 3, 23, 59, 0)


def test_database_manager_adds_missing_html_columns_for_legacy_blackboard_db(tmp_path: Path) -> None:
    db_path = _db_path(tmp_path, "test_legacy_blackboard_schema_upgrade")

    with sqlite3.connect(str(db_path)) as connection:
        connection.executescript(
            """
            CREATE TABLE courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                last_synced_at DATETIME NULL,
                is_deleted BOOLEAN NOT NULL DEFAULT 0,
                course_id VARCHAR(128) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                code VARCHAR(64) NULL,
                instructor VARCHAR(255) NULL,
                term VARCHAR(64) NULL,
                url TEXT NULL,
                total_grade VARCHAR(128) NULL,
                listed_grade VARCHAR(128) NULL,
                total_assignments INTEGER NOT NULL DEFAULT 0,
                total_resources INTEGER NOT NULL DEFAULT 0,
                total_announcements INTEGER NOT NULL DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT 1
            );

            CREATE TABLE assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                last_synced_at DATETIME NULL,
                is_deleted BOOLEAN NOT NULL DEFAULT 0,
                course_id VARCHAR(128) NOT NULL,
                assignment_id VARCHAR(128) NOT NULL UNIQUE,
                title VARCHAR(512) NOT NULL,
                url TEXT NOT NULL,
                description TEXT NULL,
                summary TEXT NULL,
                source_page TEXT NULL,
                attachments_json TEXT NULL,
                due_date VARCHAR(128) NULL,
                due_date_parsed DATETIME NULL,
                posted_date VARCHAR(128) NULL,
                status VARCHAR(128) NULL,
                submission_status VARCHAR(128) NULL,
                score VARCHAR(64) NULL,
                total_score VARCHAR(64) NULL
            );

            CREATE TABLE announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL,
                last_synced_at DATETIME NULL,
                is_deleted BOOLEAN NOT NULL DEFAULT 0,
                course_id VARCHAR(128) NULL,
                announcement_id VARCHAR(128) NOT NULL UNIQUE,
                course_name VARCHAR(255) NULL,
                title VARCHAR(512) NOT NULL,
                content TEXT NULL,
                author VARCHAR(255) NULL,
                posted_at DATETIME NULL,
                url TEXT NULL,
                source_page TEXT NULL
            );
            """
        )

    manager = DatabaseManager(db_path, reset_schema=False)

    assert "description_html" in _table_columns(manager.db_path, "assignments")
    assert "start_time" in _table_columns(manager.db_path, "assignments")
    assert "end_time" in _table_columns(manager.db_path, "assignments")
    assert "content_html" in _table_columns(manager.db_path, "announcements")
    assert "relation_type" in _table_columns(manager.db_path, "announcements")
    assert "relation_confidence" in _table_columns(manager.db_path, "announcements")
    assert "announcement_assignment_links" in {
        row[0]
        for row in sqlite3.connect(str(manager.db_path))
        .execute("SELECT name FROM sqlite_master WHERE type='table'")
        .fetchall()
    }
    assert "resource_download_bindings" in {
        row[0]
        for row in sqlite3.connect(str(manager.db_path))
        .execute("SELECT name FROM sqlite_master WHERE type='table'")
        .fetchall()
    }
    assert "resource_download_directory_preferences" in {
        row[0]
        for row in sqlite3.connect(str(manager.db_path))
        .execute("SELECT name FROM sqlite_master WHERE type='table'")
        .fetchall()
    }
