from __future__ import annotations

from pathlib import Path

from app.integrations.sustech.teaching_information_system.api.dto import (
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISGradeRecord,
    TISSelectedCourseRecord,
)
from app.integrations.sustech.teaching_information_system.data import (
    TISCreditGPASummaryModel,
    TISCreditGPATermModel,
    TISCreditGPAYearModel,
    TISDatabaseManager,
    TISPersonalGrade,
    TISSelectedCourse,
)


def _db_path(tmp_path: Path, name: str) -> Path:
    return tmp_path / f"{name}.db"


def _get_personal_grade_flags(
    manager: TISDatabaseManager,
    owner_key: str,
    course_name: str,
    course_code: str | None,
    term: str | None,
) -> tuple[bool, str | None]:
    session = manager.SessionLocal()
    try:
        row = (
            session.query(TISPersonalGrade)
            .filter(
                TISPersonalGrade.owner_key == owner_key,
                TISPersonalGrade.course_name == course_name,
                TISPersonalGrade.course_code == course_code,
                TISPersonalGrade.term == term,
            )
            .one_or_none()
        )
        if row is None:
            return False, None
        return bool(row.is_deleted), row.score
    finally:
        session.close()


def _count_selected_courses(manager: TISDatabaseManager, owner_key: str, semester_id: str) -> int:
    session = manager.SessionLocal()
    try:
        return (
            session.query(TISSelectedCourse)
            .filter(
                TISSelectedCourse.owner_key == owner_key,
                TISSelectedCourse.semester_id == semester_id,
                TISSelectedCourse.is_deleted.is_(False),
            )
            .count()
        )
    finally:
        session.close()


def test_tis_database_manager_creates_tables_and_reports_counts(tmp_path: Path) -> None:
    manager = TISDatabaseManager(_db_path(tmp_path, "tis_data_manager"), reset_schema=True)

    assert manager.database_exists() is True
    description = manager.describe()
    assert description.exists is True
    counts = manager.get_table_counts()
    assert counts["personal_grades"] == {"total": 0, "active": 0}
    assert counts["selected_courses"] == {"total": 0, "active": 0}


def test_sync_personal_grades_soft_delete_and_revive(tmp_path: Path) -> None:
    manager = TISDatabaseManager(_db_path(tmp_path, "tis_grades"), reset_schema=True)
    owner_key = "student_a"

    stats1 = manager.sync_personal_grades(
        owner_key,
        [
            TISGradeRecord(course_name="Course A", course_code="CS101", term="2025-20261", score="90"),
            TISGradeRecord(course_name="Course B", course_code="CS102", term="2025-20261", score="85"),
        ],
    )
    assert stats1.to_dict() == {"inserted": 2, "updated": 0, "deleted": 0, "skipped": 0, "unchanged": 0}

    stats2 = manager.sync_personal_grades(
        owner_key,
        [
            TISGradeRecord(course_name="Course A", course_code="CS101", term="2025-20261", score="95"),
        ],
    )
    assert stats2.to_dict() == {"inserted": 0, "updated": 1, "deleted": 1, "skipped": 0, "unchanged": 0}
    assert _get_personal_grade_flags(manager, owner_key, "Course A", "CS101", "2025-20261") == (False, "95")
    assert _get_personal_grade_flags(manager, owner_key, "Course B", "CS102", "2025-20261") == (True, "85")

    stats3 = manager.sync_personal_grades(
        owner_key,
        [
            TISGradeRecord(course_name="Course A", course_code="CS101", term="2025-20261", score="95"),
            TISGradeRecord(course_name="Course B", course_code="CS102", term="2025-20261", score="88"),
        ],
    )
    assert stats3.to_dict() == {"inserted": 0, "updated": 1, "deleted": 0, "skipped": 0, "unchanged": 1}
    assert _get_personal_grade_flags(manager, owner_key, "Course B", "CS102", "2025-20261") == (False, "88")


def test_sync_credit_gpa_persists_summary_terms_and_years(tmp_path: Path) -> None:
    manager = TISDatabaseManager(_db_path(tmp_path, "tis_credit_gpa"), reset_schema=True)
    owner_key = "student_gpa"

    stats = manager.sync_credit_gpa(
        owner_key,
        TISCreditGPASummary(average_credit_gpa=3.78, rank="7/100", raw={"PJXFJ": 3.78}),
        [
            TISCreditGPATermRecord(
                academic_year_term="2025秋季",
                academic_year="2025-2026",
                term_code="1",
                term_credit_gpa=3.78,
                year_credit_gpa=3.78,
                raw={"XNXQ": "2025秋季"},
            )
        ],
        [
            TISCreditGPAYearRecord(
                academic_year="2025-2026",
                year_credit_gpa=3.78,
                raw={"XN": "2025-2026"},
            )
        ],
    )

    assert stats["summary"].to_dict()["inserted"] == 1
    assert stats["terms"].to_dict()["inserted"] == 1
    assert stats["years"].to_dict()["inserted"] == 1

    session = manager.SessionLocal()
    try:
        assert session.query(TISCreditGPASummaryModel).filter(TISCreditGPASummaryModel.owner_key == owner_key).count() == 1
        assert session.query(TISCreditGPATermModel).filter(TISCreditGPATermModel.owner_key == owner_key).count() == 1
        assert session.query(TISCreditGPAYearModel).filter(TISCreditGPAYearModel.owner_key == owner_key).count() == 1
    finally:
        session.close()


def test_sync_selected_courses_scopes_soft_delete_by_semester(tmp_path: Path) -> None:
    manager = TISDatabaseManager(_db_path(tmp_path, "tis_selected_courses"), reset_schema=True)
    owner_key = "student_courses"
    semester_id = "2025-20261"

    stats1 = manager.sync_selected_courses(
        owner_key,
        semester_id,
        [
            TISSelectedCourseRecord(course_code="CS101", course_name="Course A", course_sequence_number="001", credits=3.0),
            TISSelectedCourseRecord(course_code="CS102", course_name="Course B", course_sequence_number="001", credits=2.0),
        ],
    )
    assert stats1.to_dict() == {"inserted": 2, "updated": 0, "deleted": 0, "skipped": 0, "unchanged": 0}
    assert _count_selected_courses(manager, owner_key, semester_id) == 2

    stats2 = manager.sync_selected_courses(
        owner_key,
        semester_id,
        [
            TISSelectedCourseRecord(course_code="CS101", course_name="Course A", course_sequence_number="001", credits=3.0),
        ],
    )
    assert stats2.to_dict() == {"inserted": 0, "updated": 0, "deleted": 1, "skipped": 0, "unchanged": 1}
    assert _count_selected_courses(manager, owner_key, semester_id) == 1
