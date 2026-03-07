from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""


class TimestampSoftDeleteMixin:
    """Common columns for all tables."""

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class Course(TimestampSoftDeleteMixin, Base):
    __tablename__ = "courses"
    __table_args__ = (
        Index("idx_courses_active_deleted", "is_active", "is_deleted"),
        Index("idx_courses_last_synced_at", "last_synced_at"),
    )

    course_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    instructor: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    term: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    total_grade: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    listed_grade: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    total_assignments: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_resources: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_announcements: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    assignments: Mapped[list[Assignment]] = relationship(back_populates="course", cascade="all, delete-orphan")
    resources: Mapped[list[Resource]] = relationship(back_populates="course", cascade="all, delete-orphan")
    grades: Mapped[list[Grade]] = relationship(back_populates="course", cascade="all, delete-orphan")
    announcements: Mapped[list[Announcement]] = relationship(back_populates="course", cascade="all, delete-orphan")


class Assignment(TimestampSoftDeleteMixin, Base):
    __tablename__ = "assignments"
    __table_args__ = (
        Index("idx_assignments_due_date_parsed", "due_date_parsed"),
        Index("idx_assignments_status", "status"),
        Index("idx_assignments_last_synced_at", "last_synced_at"),
    )

    course_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignment_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)

    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_page: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    attachments_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    due_date: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    due_date_parsed: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    posted_date: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    status: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    submission_status: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    score: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    total_score: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    course: Mapped[Course] = relationship(back_populates="assignments")


class Resource(TimestampSoftDeleteMixin, Base):
    __tablename__ = "resources"
    __table_args__ = (
        Index("idx_resources_assignment", "assignment_id"),
        Index("idx_resources_type", "type"),
        Index("idx_resources_downloaded", "is_downloaded"),
        Index("idx_resources_parent_id", "parent_id"),
    )

    course_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignment_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        ForeignKey("assignments.assignment_id", ondelete="SET NULL"),
        nullable=True,
    )
    resource_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    type: Mapped[Optional[str]] = mapped_column("type", String(64), nullable=True)
    size: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False)

    source_page: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    local_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_downloaded: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    download_failed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # 以业务ID建立父子层级（修复字符串resource_id与整型id错位问题）
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        ForeignKey("resources.resource_id", ondelete="SET NULL"),
        nullable=True,
    )

    course: Mapped[Course] = relationship(back_populates="resources")
    parent: Mapped[Optional[Resource]] = relationship(
        "Resource",
        remote_side="Resource.resource_id",
        back_populates="children",
        foreign_keys=[parent_id],
    )
    children: Mapped[list[Resource]] = relationship("Resource", back_populates="parent")


class Grade(TimestampSoftDeleteMixin, Base):
    __tablename__ = "grades"
    __table_args__ = (
        Index("idx_grades_assignment", "assignment_id"),
        Index("idx_grades_type", "grade_type"),
        Index("idx_grades_numeric", "score_numeric"),
        Index("idx_grades_due_date_parsed", "due_date_parsed"),
    )

    course_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignment_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        ForeignKey("assignments.assignment_id", ondelete="SET NULL"),
        nullable=True,
    )

    grade_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(512), nullable=False)

    score: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    total_score: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    score_numeric: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    percentage: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    status: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    grade_type: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    due_date: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    due_date_parsed: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    graded_date: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    graded_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_counted: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    course: Mapped[Course] = relationship(back_populates="grades")


class Announcement(TimestampSoftDeleteMixin, Base):
    __tablename__ = "announcements"
    __table_args__ = (
        Index("idx_announcements_posted_at", "posted_at"),
    )

    course_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        ForeignKey("courses.course_id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    announcement_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)

    course_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_page: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    course: Mapped[Optional[Course]] = relationship(back_populates="announcements")


class CalendarSubscription(TimestampSoftDeleteMixin, Base):
    __tablename__ = "calendar_subscriptions"
    __table_args__ = (
        Index("idx_calendar_subscriptions_active_deleted", "is_active", "is_deleted"),
        Index("idx_calendar_subscriptions_last_refreshed", "last_refreshed_at"),
    )

    feed_url: Mapped[str] = mapped_column(String(1024), unique=True, nullable=False, index=True)
    etag: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    last_modified: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    last_refreshed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    events: Mapped[list[CalendarEvent]] = relationship(
        "CalendarEvent",
        back_populates="subscription",
        cascade="all, delete-orphan",
    )


class CalendarEvent(TimestampSoftDeleteMixin, Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        UniqueConstraint("uid", name="uq_calendar_events_uid"),
        Index("idx_calendar_events_feed_deleted", "feed_url", "is_deleted"),
        Index("idx_calendar_events_start_at", "start_at"),
        Index("idx_calendar_events_end_at", "end_at"),
    )

    feed_url: Mapped[str] = mapped_column(
        String(1024),
        ForeignKey("calendar_subscriptions.feed_url", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uid: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    raw_uid: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    course_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    end_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    subscription: Mapped[CalendarSubscription] = relationship("CalendarSubscription", back_populates="events")
