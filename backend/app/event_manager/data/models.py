"""事件(Event) 数据层 ORM 模型。"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Integer, PickleType, String, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class TimestampSoftDeleteMixin:
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utc_now_naive, nullable=False
    )
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

    week_canceled: Mapped[list[int]] = mapped_column(PickleType, nullable=False)
    course_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    place: Mapped[str | None] = mapped_column(String(255), nullable=True)
    teacher: Mapped[str | None] = mapped_column(String(255), nullable=True)

class UnifiedCalendarEventModel(TimestampSoftDeleteMixin, Base):
    """
    统一的日历事件模型，所有的外部数据（例如 BlackBoard、WakeUp 课程源等）拉取下来后，
    均会转换为这个标准的事件条目进行存储，日历直接操作这张表以展示。
    """
    __tablename__ = "event_unified_calendar"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    
    start_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    # 来源标识：'all' | 'bb' | 'course' | 'custom'
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    # 源数据中的唯一ID，用于避免相同数据重复创建
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    
    # 任务状态类型："not_started", "in_progress", "completed" (这和图三的状态是对应的)
    status: Mapped[str] = mapped_column(String(32), default="not_started", nullable=False)
    
    # 存储不同数据源专属的其他元信息，例如黑板的 deadline 超链接、课程地点等，以便保持灵活性
    metadata_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
