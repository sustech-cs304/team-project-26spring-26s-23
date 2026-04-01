"""事件(Event) 数据层 ORM 模型。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint
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
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class CourseEventModel(TimestampSoftDeleteMixin, Base):
    __tablename__ = "event_course"

    # course_id: Mapped[int]  TODO: Foreign key TISSelectedCourse
    course_name: Mapped[str] = mapped_column(String(255), nullable=False)
    semester_id: Mapped[str] = mapped_column(String(32), nullable=False)
    class_start: Mapped[int] = mapped_column(Integer, nullable=False)
    class_end: Mapped[int] = mapped_column(Integer, nullable=False)
    week_day: Mapped[int] = mapped_column(Integer, nullable=False)
    week_start: Mapped[int] = mapped_column(Integer, nullable=False)
    week_end: Mapped[int] = mapped_column(Integer, nullable=False)
    week_type: Mapped[int] = mapped_column(Integer, nullable=False)

    place: Mapped[str] = mapped_column(String(255), nullable=True)
    teacher: Mapped[str] = mapped_column(String(255), nullable=True)