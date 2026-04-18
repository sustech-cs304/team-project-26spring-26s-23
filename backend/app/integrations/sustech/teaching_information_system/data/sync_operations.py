"""TIS 数据层同步操作。"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Callable, TypeVar

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.integrations.sustech.teaching_information_system.api.dto import (
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISGradeRecord,
    TISSelectedCourseRecord,
)

from .models import (
    TISCreditGPASummaryModel,
    TISCreditGPATermModel,
    TISCreditGPAYearModel,
    TISPersonalGrade,
    TISSelectedCourse,
)
from .results import TISSyncStats, empty_sync_stats

ModelT = TypeVar("ModelT")


def _now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _raw_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _sync_by_key(
    session: Session,
    *,
    existing_stmt: Select[tuple[ModelT]],
    incoming: list[tuple[str, dict[str, Any]]],
    existing_key: Callable[[ModelT], str],
    build_model: Callable[[dict[str, Any]], ModelT],
) -> TISSyncStats:
    stats = empty_sync_stats()
    now = _now_utc()
    existing_rows = session.execute(existing_stmt).scalars().all()
    existing_map = {existing_key(row): row for row in existing_rows}
    incoming_keys = {key for key, _ in incoming}

    for key, payload in incoming:
        existing = existing_map.get(key)
        if existing is None:
            model = build_model(payload)
            setattr(model, "last_synced_at", now)
            setattr(model, "is_deleted", False)
            session.add(model)
            stats.inserted += 1
            continue

        changed = False
        for field_name, field_value in payload.items():
            if getattr(existing, field_name) != field_value:
                setattr(existing, field_name, field_value)
                changed = True
        if getattr(existing, "is_deleted", False):
            setattr(existing, "is_deleted", False)
            changed = True
        setattr(existing, "last_synced_at", now)
        if changed:
            stats.updated += 1
        else:
            stats.unchanged += 1

    for key, row in existing_map.items():
        if key in incoming_keys or getattr(row, "is_deleted", False):
            continue
        setattr(row, "is_deleted", True)
        setattr(row, "last_synced_at", now)
        stats.deleted += 1

    return stats


def sync_personal_grades(
    session: Session, owner_key: str, grade_records: list[TISGradeRecord]
) -> TISSyncStats:
    normalized_owner = str(owner_key).strip()
    incoming: list[tuple[str, dict[str, Any]]] = []
    for record in grade_records:
        key = "|".join(
            [
                normalized_owner,
                record.course_name,
                record.course_code or "",
                record.term or "",
            ]
        )
        incoming.append(
            (
                key,
                {
                    "owner_key": normalized_owner,
                    "course_name": record.course_name,
                    "course_code": record.course_code,
                    "term": record.term,
                    "score": record.score,
                    "credit": record.credit,
                    "raw_json": _raw_json(record.raw),
                },
            )
        )

    return _sync_by_key(
        session,
        existing_stmt=select(TISPersonalGrade).where(
            TISPersonalGrade.owner_key == normalized_owner
        ),
        incoming=incoming,
        existing_key=lambda row: (
            f"{row.owner_key}|{row.course_name}|{row.course_code or ''}|{row.term or ''}"
        ),
        build_model=lambda payload: TISPersonalGrade(**payload),
    )


def sync_credit_gpa(
    session: Session,
    owner_key: str,
    summary: TISCreditGPASummary,
    term_records: list[TISCreditGPATermRecord],
    year_records: list[TISCreditGPAYearRecord],
) -> dict[str, TISSyncStats]:
    normalized_owner = str(owner_key).strip()

    summary_stats = _sync_by_key(
        session,
        existing_stmt=select(TISCreditGPASummaryModel).where(
            TISCreditGPASummaryModel.owner_key == normalized_owner
        ),
        incoming=[
            (
                normalized_owner,
                {
                    "owner_key": normalized_owner,
                    "average_credit_gpa": summary.average_credit_gpa,
                    "rank": summary.rank,
                    "raw_json": _raw_json(summary.raw),
                },
            )
        ],
        existing_key=lambda row: row.owner_key,
        build_model=lambda payload: TISCreditGPASummaryModel(**payload),
    )

    term_stats = _sync_by_key(
        session,
        existing_stmt=select(TISCreditGPATermModel).where(
            TISCreditGPATermModel.owner_key == normalized_owner
        ),
        incoming=[
            (
                f"{normalized_owner}|{record.academic_year_term}",
                {
                    "owner_key": normalized_owner,
                    "academic_year_term": record.academic_year_term,
                    "academic_year": record.academic_year,
                    "term_code": record.term_code,
                    "term_credit_gpa": record.term_credit_gpa,
                    "year_credit_gpa": record.year_credit_gpa,
                    "raw_json": _raw_json(record.raw),
                },
            )
            for record in term_records
        ],
        existing_key=lambda row: f"{row.owner_key}|{row.academic_year_term}",
        build_model=lambda payload: TISCreditGPATermModel(**payload),
    )

    year_stats = _sync_by_key(
        session,
        existing_stmt=select(TISCreditGPAYearModel).where(
            TISCreditGPAYearModel.owner_key == normalized_owner
        ),
        incoming=[
            (
                f"{normalized_owner}|{record.academic_year}",
                {
                    "owner_key": normalized_owner,
                    "academic_year": record.academic_year,
                    "year_credit_gpa": record.year_credit_gpa,
                    "raw_json": _raw_json(record.raw),
                },
            )
            for record in year_records
        ],
        existing_key=lambda row: f"{row.owner_key}|{row.academic_year}",
        build_model=lambda payload: TISCreditGPAYearModel(**payload),
    )

    return {"summary": summary_stats, "terms": term_stats, "years": year_stats}


def sync_selected_courses(
    session: Session,
    owner_key: str,
    semester_id: str,
    course_records: list[TISSelectedCourseRecord],
) -> TISSyncStats:
    normalized_owner = str(owner_key).strip()
    normalized_semester = str(semester_id).strip()
    incoming: list[tuple[str, dict[str, Any]]] = []
    for record in course_records:
        key = "|".join(
            [
                normalized_owner,
                normalized_semester,
                record.course_code,
                record.course_sequence_number or "",
            ]
        )
        incoming.append(
            (
                key,
                {
                    "owner_key": normalized_owner,
                    "semester_id": normalized_semester,
                    "course_code": record.course_code,
                    "course_name": record.course_name,
                    "task_number": record.task_number,
                    "course_sequence_number": record.course_sequence_number,
                    "course_nature": record.course_nature,
                    "course_category": record.course_category,
                    "credits": record.credits,
                    "hours": record.hours,
                    "class_info": record.class_info,
                    "offering_department": record.offering_department,
                    "selection_category": record.selection_category,
                    "selection_coefficient": record.selection_coefficient,
                    "effective_flag": record.effective_flag,
                    "effective_status": record.effective_status,
                    "raw_json": _raw_json(record.raw),
                },
            )
        )

    return _sync_by_key(
        session,
        existing_stmt=select(TISSelectedCourse).where(
            TISSelectedCourse.owner_key == normalized_owner,
            TISSelectedCourse.semester_id == normalized_semester,
        ),
        incoming=incoming,
        existing_key=lambda row: (
            f"{row.owner_key}|{row.semester_id}|{row.course_code}|{row.course_sequence_number or ''}"
        ),
        build_model=lambda payload: TISSelectedCourse(**payload),
    )


__all__ = ["sync_credit_gpa", "sync_personal_grades", "sync_selected_courses"]
