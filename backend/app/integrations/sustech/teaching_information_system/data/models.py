"""TIS 数据层 ORM 模型。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class TimestampSoftDeleteMixin:
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now_naive, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=_utc_now_naive,
        onupdate=_utc_now_naive,
        nullable=False,
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class TISPersonalGrade(TimestampSoftDeleteMixin, Base):
    __tablename__ = "tis_personal_grades"
    __table_args__ = (
        UniqueConstraint("owner_key", "course_name", "course_code", "term", name="uq_tis_personal_grade_owner_course_term"),
        Index("idx_tis_personal_grades_owner_deleted", "owner_key", "is_deleted"),
        Index("idx_tis_personal_grades_term", "term"),
    )

    owner_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    course_name: Mapped[str] = mapped_column(String(255), nullable=False)
    course_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    term: Mapped[str | None] = mapped_column(String(64), nullable=True)
    score: Mapped[str] = mapped_column(String(64), nullable=False)
    credit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class TISCreditGPASummaryModel(TimestampSoftDeleteMixin, Base):
    __tablename__ = "tis_credit_gpa_summary"
    __table_args__ = (
        UniqueConstraint("owner_key", name="uq_tis_credit_gpa_summary_owner"),
        Index("idx_tis_credit_gpa_summary_owner_deleted", "owner_key", "is_deleted"),
    )

    owner_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    average_credit_gpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    rank: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class TISCreditGPATermModel(TimestampSoftDeleteMixin, Base):
    __tablename__ = "tis_credit_gpa_terms"
    __table_args__ = (
        UniqueConstraint("owner_key", "academic_year_term", name="uq_tis_credit_gpa_term_owner_term"),
        Index("idx_tis_credit_gpa_terms_owner_deleted", "owner_key", "is_deleted"),
    )

    owner_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    academic_year_term: Mapped[str] = mapped_column(String(64), nullable=False)
    academic_year: Mapped[str | None] = mapped_column(String(32), nullable=True)
    term_code: Mapped[str | None] = mapped_column(String(8), nullable=True)
    term_credit_gpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    year_credit_gpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class TISCreditGPAYearModel(TimestampSoftDeleteMixin, Base):
    __tablename__ = "tis_credit_gpa_years"
    __table_args__ = (
        UniqueConstraint("owner_key", "academic_year", name="uq_tis_credit_gpa_year_owner_year"),
        Index("idx_tis_credit_gpa_years_owner_deleted", "owner_key", "is_deleted"),
    )

    owner_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    academic_year: Mapped[str] = mapped_column(String(32), nullable=False)
    year_credit_gpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class TISSelectedCourse(TimestampSoftDeleteMixin, Base):
    __tablename__ = "tis_selected_courses"
    __table_args__ = (
        UniqueConstraint(
            "owner_key",
            "semester_id",
            "course_code",
            "course_sequence_number",
            name="uq_tis_selected_course_owner_semester_course_seq",
        ),
        Index("idx_tis_selected_courses_owner_semester_deleted", "owner_key", "semester_id", "is_deleted"),
    )

    owner_key: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    semester_id: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    course_code: Mapped[str] = mapped_column(String(64), nullable=False)
    course_name: Mapped[str] = mapped_column(String(255), nullable=False)
    task_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    course_sequence_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    course_nature: Mapped[str | None] = mapped_column(String(64), nullable=True)
    course_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    credits: Mapped[float | None] = mapped_column(Float, nullable=True)
    hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    class_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    offering_department: Mapped[str | None] = mapped_column(String(128), nullable=True)
    selection_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    selection_coefficient: Mapped[float | None] = mapped_column(Float, nullable=True)
    effective_flag: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    effective_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)


__all__ = [
    "Base",
    "TISCreditGPASummaryModel",
    "TISCreditGPATermModel",
    "TISCreditGPAYearModel",
    "TISPersonalGrade",
    "TISSelectedCourse",
    "TimestampSoftDeleteMixin",
]
