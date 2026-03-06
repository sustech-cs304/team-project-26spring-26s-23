from __future__ import annotations

import hashlib
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse

from app.blackboard.shared.logging import BlackboardLogger

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app.blackboard.data.course_matcher import resolve_course_id_by_course_name as data_resolve_course_id_by_course_name
from app.blackboard.data.results import SyncStats
from app.blackboard.data.sync_operations import (
    get_calendar_subscription as data_get_calendar_subscription,
    list_calendar_events as data_list_calendar_events,
    sync_announcements as data_sync_announcements,
    sync_assignments as data_sync_assignments,
    sync_calendar_events as data_sync_calendar_events,
    sync_courses as data_sync_courses,
    sync_grades as data_sync_grades,
    sync_resources as data_sync_resources,
    upsert_calendar_subscription as data_upsert_calendar_subscription,
)
from app.blackboard.shared import extract_total_score, parse_loose_datetime, parse_score_metrics

from .models import (
    Announcement,
    Assignment,
    Base,
    CalendarEvent,
    CalendarSubscription,
    Course,
    Grade,
    Resource,
)

class DatabaseManager:
    """SQLite 数据库管理器（增强版）。"""

    def __init__(self, db_path: str | Path | None = None, *, reset_schema: bool = False) -> None:
        backend_dir = Path(__file__).resolve().parents[3]
        self.db_path = Path(db_path) if db_path else backend_dir / "data" / "sustech.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        if reset_schema and self.db_path.exists():
            self.db_path.unlink()

        self.engine = create_engine(f"sqlite:///{self.db_path.as_posix()}", future=True)
        self._enable_sqlite_foreign_keys()
        self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)
        self.create_tables()

    def _enable_sqlite_foreign_keys(self) -> None:
        """确保SQLite外键约束生效。"""

        @event.listens_for(self.engine, "connect")
        def _set_sqlite_pragma(dbapi_connection: Any, _connection_record: Any) -> None:
            if isinstance(dbapi_connection, sqlite3.Connection):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA foreign_keys=ON;")
                cursor.close()

    def create_tables(self) -> None:
        Base.metadata.create_all(self.engine)

    @contextmanager
    def _session_scope(self) -> Iterator[Session]:
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @staticmethod
    def _stable_id(prefix: str, *parts: Any) -> str:
        normalized = "|".join(str(p).strip() for p in parts if p is not None and str(p).strip())
        if not normalized:
            normalized = "<empty>"
        digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:20]
        return f"{prefix}_{digest}"

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if value is None:
            return None
        text = str(value).strip().replace("%", "")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    @staticmethod
    def _looks_like_url(value: str) -> bool:
        try:
            parsed = urlparse(value)
            return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
        except Exception:
            return False

    @classmethod
    def _normalize_url(cls, value: Any) -> str | None:
        text = str(value or "").strip()
        if not text:
            return None

        if text.startswith("bb://"):
            return text

        if cls._looks_like_url(text):
            return text

        return None

    @staticmethod
    def _extract_code(name: str) -> str | None:
        match = re.search(r"\b([A-Z]{2,}\d{2,}[A-Z]?)\b", name)
        return match.group(1) if match else None

    @staticmethod
    def _extract_term(name: str) -> str | None:
        match = re.search(r"\b(Spring|Summer|Fall|Winter)\s+\d{4}\b", name, re.IGNORECASE)
        return match.group(0) if match else None

    @staticmethod
    def _guess_resource_type_from_url(url: str) -> str:
        lower = url.lower()
        suffix_match = re.search(r"\.([a-z0-9]{1,8})(?:$|\?)", lower)
        if suffix_match:
            return suffix_match.group(1)
        return "link"

    def sync_courses(
        self,
        courses_data: list[dict[str, Any]],
        *,
        logger: BlackboardLogger | None = None,
    ) -> SyncStats:
        with self._session_scope() as session:
            return data_sync_courses(
                session,
                courses_data,
                extract_code=self._extract_code,
                extract_term=self._extract_term,
                logger=logger,
            )

    def sync_assignments(
        self,
        course_id: str,
        assignments_data: list[dict[str, Any]],
        *,
        logger: BlackboardLogger | None = None,
    ) -> SyncStats:
        with self._session_scope() as session:
            return data_sync_assignments(
                session,
                course_id,
                assignments_data,
                normalize_url=self._normalize_url,
                stable_id=self._stable_id,
                parse_total_score=extract_total_score,
                parse_datetime=lambda value: parse_loose_datetime(None if value is None else str(value)),
                guess_resource_type_from_url=self._guess_resource_type_from_url,
                logger=logger,
            )

    def sync_resources(
        self,
        course_id: str,
        resources_data: list[dict[str, Any]],
        *,
        logger: BlackboardLogger | None = None,
    ) -> SyncStats:
        with self._session_scope() as session:
            return data_sync_resources(
                session,
                course_id,
                resources_data,
                normalize_url=self._normalize_url,
                stable_id=self._stable_id,
                logger=logger,
            )

    def sync_grades(
        self,
        course_id: str,
        grades_data: list[dict[str, Any]],
        *,
        logger: BlackboardLogger | None = None,
    ) -> SyncStats:
        with self._session_scope() as session:
            return data_sync_grades(
                session,
                course_id,
                grades_data,
                stable_id=self._stable_id,
                parse_total_score=extract_total_score,
                parse_score_metrics=parse_score_metrics,
                parse_datetime=lambda value: parse_loose_datetime(None if value is None else str(value)),
                to_float=self._to_float,
                logger=logger,
            )

    def sync_announcements(
        self,
        announcements_data: list[dict[str, Any]],
        *,
        logger: BlackboardLogger | None = None,
    ) -> SyncStats:
        with self._session_scope() as session:
            return data_sync_announcements(
                session,
                announcements_data,
                normalize_url=self._normalize_url,
                parse_datetime=lambda value: parse_loose_datetime(None if value is None else str(value)),
                stable_id=self._stable_id,
                resolve_course_id_by_course_name=data_resolve_course_id_by_course_name,
                logger=logger,
            )

    def upsert_calendar_subscription(
        self,
        feed_url: str,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
        last_refreshed_at: datetime | None = None,
        last_error: str | None = None,
        is_active: bool = True,
    ) -> None:
        with self._session_scope() as session:
            data_upsert_calendar_subscription(
                session,
                feed_url,
                etag=etag,
                last_modified=last_modified,
                last_refreshed_at=last_refreshed_at,
                last_error=last_error,
                is_active=is_active,
            )

    def get_calendar_subscription(self, feed_url: str) -> dict[str, Any] | None:
        with self._session_scope() as session:
            return data_get_calendar_subscription(session, feed_url)

    def sync_calendar_events(
        self,
        feed_url: str,
        events_data: list[dict[str, Any]],
        *,
        logger: BlackboardLogger | None = None,
    ) -> SyncStats:
        with self._session_scope() as session:
            return data_sync_calendar_events(session, feed_url, events_data, logger=logger)

    def list_calendar_events(self, feed_url: str, *, include_deleted: bool = False) -> list[dict[str, Any]]:
        with self._session_scope() as session:
            return data_list_calendar_events(session, feed_url, include_deleted=include_deleted)

    def get_table_counts(self) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        with self._session_scope() as session:
            for name, model in {
                "courses": Course,
                "assignments": Assignment,
                "resources": Resource,
                "grades": Grade,
                "announcements": Announcement,
                "calendar_subscriptions": CalendarSubscription,
                "calendar_events": CalendarEvent,
            }.items():
                total = len(session.execute(select(model)).scalars().all())
                active = len(session.execute(select(model).where(model.is_deleted.is_(False))).scalars().all())
                result[name] = {"total": total, "active": active}
        return result
