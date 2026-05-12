from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.desktop_runtime.config import ENV_DATABASE_DIR


from .dto import CourseEvent, UnifiedCalendarEvent
from .models import Base, CourseEventModel, UnifiedCalendarEventModel


_DEFAULT_EVENT_MANAGER_DB_RELATIVE_PATH = Path("event_manager") / "sustech.db"
_DEFAULT_REPO_EVENT_MANAGER_DB_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "sustech.db"
)


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def resolve_default_event_manager_db_path(
    database_dir: str | Path | None = None,
) -> Path:
    resolved_database_dir = _resolve_runtime_database_dir(database_dir)
    if resolved_database_dir is None:
        return _DEFAULT_REPO_EVENT_MANAGER_DB_PATH

    return resolved_database_dir / _DEFAULT_EVENT_MANAGER_DB_RELATIVE_PATH


def _resolve_runtime_database_dir(
    database_dir: str | Path | None = None,
) -> Path | None:
    if database_dir is not None:
        return Path(database_dir)

    configured_database_dir = str(os.environ.get(ENV_DATABASE_DIR) or "").strip()
    if configured_database_dir == "":
        return None

    return Path(configured_database_dir)


class DatabaseManager:
    """SQLite 数据库管理器"""

    DEFAULT_DB_RELATIVE_PATH = _DEFAULT_EVENT_MANAGER_DB_RELATIVE_PATH

    def __init__(
        self, db_path: str | Path | None = None, *, reset_schema: bool = False
    ) -> None:
        self.db_path = (
            Path(db_path)
            if db_path is not None
            else resolve_default_event_manager_db_path()
        )
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        if reset_schema and self.db_path.exists():
            self.db_path.unlink()

        self.engine = create_engine(f"sqlite:///{self.db_path.as_posix()}", future=True)
        self._enable_sqlite_foreign_keys()
        self.SessionLocal = sessionmaker(
            bind=self.engine, expire_on_commit=False, class_=Session
        )
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

    def upsert_course_event(self, course_event: CourseEvent) -> bool:
        now = _utc_now_naive()
        payload = course_event.to_dict()
        with self._session_scope() as session:
            course_event_id = course_event.id
            if course_event_id is not None:
                course_event_model = (
                    session.query(CourseEventModel)
                    .filter(CourseEventModel.id == course_event_id)
                    .one_or_none()
                )
                if course_event_model is None:
                    return False
                if course_event_model.is_deleted:
                    return False
                for key, value in payload.items():
                    if key == "id":
                        continue
                    setattr(course_event_model, key, value)
                course_event_model.updated_at = now
            else:
                course_event_model = CourseEventModel(
                    **payload, created_at=now, updated_at=now
                )
                session.add(course_event_model)
                session.flush()
                course_event.id = course_event_model.id

                if course_event.course_group_id is None:
                    course_event.course_group_id = course_event.id
                    course_event_model.course_group_id = course_event.id
            return True

    def reschedule_course(
        self, old_event: CourseEvent, old_week: int, new_event: CourseEvent | None
    ) -> bool:
        if old_event.id is None or (new_event is not None and new_event.id is not None):
            raise ValueError(
                "Old event must have an ID and new event must not have an ID."
            )
        old_event.week_canceled.append(old_week)
        if not self.upsert_course_event(old_event):
            return False
        if new_event is None:
            return True
        new_event.course_group_id = old_event.course_group_id
        return self.upsert_course_event(new_event)

    def delete_course_event(
        self, course_event_id: int, delete_group: bool = False
    ) -> bool:
        with self._session_scope() as session:
            course_event_model = (
                session.query(CourseEventModel)
                .filter(CourseEventModel.id == course_event_id)
                .filter(CourseEventModel.is_deleted.is_(False))
                .one_or_none()
            )
            if course_event_model is None:
                return False
            if not delete_group:
                course_event_model.is_deleted = True
                return True
            group_id = course_event_model.course_group_id
            course_event_models = (
                session.query(CourseEventModel)
                .filter(CourseEventModel.course_group_id == group_id)
                .filter(CourseEventModel.is_deleted.is_(False))
                .all()
            )
            for model in course_event_models:
                model.is_deleted = True
            return True

    def get_all_course_events(self) -> list[CourseEvent]:
        with self._session_scope() as session:
            course_event_models = (
                session.query(CourseEventModel)
                .filter(CourseEventModel.is_deleted.is_(False))
                .order_by(CourseEventModel.created_at.desc())
                .all()
            )
            return [CourseEvent.from_obj(model) for model in course_event_models]

    # ── UnifiedCalendarEvent ──────────────────────────────────────────

    @staticmethod
    def _unified_event_model_kwargs(event: UnifiedCalendarEvent) -> dict[str, Any]:
        """从 DTO 提取用于构造 UnifiedCalendarEventModel 的原始字段。"""
        return {
            "title": event.title,
            "description": event.description,
            "start_time": event.start_time,
            "end_time": event.end_time,
            "is_all_day": event.is_all_day,
            "source": event.source,
            "source_id": event.source_id,
            "status": event.status,
            "metadata_payload": event.metadata_payload,
        }

    @staticmethod
    def _apply_unified_event_payload(
        row: UnifiedCalendarEventModel, event: UnifiedCalendarEvent
    ) -> None:
        """将 DTO 的可变字段写入已有 model 行。"""
        row.title = event.title
        row.description = event.description
        row.start_time = event.start_time
        row.end_time = event.end_time
        row.is_all_day = event.is_all_day
        row.status = event.status
        row.metadata_payload = event.metadata_payload

    def upsert_unified_calendar_event(self, event: UnifiedCalendarEvent) -> bool:
        """按 (source, source_id) upsert。成功返回 True。"""
        now = _utc_now_naive()
        with self._session_scope() as session:
            existing = (
                session.query(UnifiedCalendarEventModel)
                .filter(
                    UnifiedCalendarEventModel.source == event.source,
                    UnifiedCalendarEventModel.source_id == event.source_id,
                    UnifiedCalendarEventModel.is_deleted.is_(False),
                )
                .one_or_none()
            )
            if existing is not None:
                self._apply_unified_event_payload(existing, event)
                existing.updated_at = now
            else:
                existing = UnifiedCalendarEventModel(
                    **self._unified_event_model_kwargs(event),
                    created_at=now,
                    updated_at=now,
                )
                session.add(existing)
                session.flush()
                event.id = existing.id
            return True

    def sync_unified_calendar_events(
        self, source: str, events: list[UnifiedCalendarEvent]
    ) -> dict[str, int]:
        """同步某个 source 的全部事件，并软删除不在列表中的旧事件。"""
        now = _utc_now_naive()
        incoming_ids = {e.source_id for e in events}
        stats: dict[str, int] = {"inserted": 0, "updated": 0, "deleted": 0}
        with self._session_scope() as session:
            existing_map = {
                row.source_id: row
                for row in session.query(UnifiedCalendarEventModel)
                .filter(
                    UnifiedCalendarEventModel.source == source,
                    UnifiedCalendarEventModel.is_deleted.is_(False),
                )
                .all()
            }
            for event in events:
                row = existing_map.get(event.source_id)
                if row is None:
                    session.add(
                        UnifiedCalendarEventModel(
                            **self._unified_event_model_kwargs(event),
                            created_at=now,
                            updated_at=now,
                        )
                    )
                    stats["inserted"] += 1
                else:
                    self._apply_unified_event_payload(row, event)
                    row.updated_at = now
                    stats["updated"] += 1

            for source_id, row in existing_map.items():
                if source_id not in incoming_ids:
                    row.is_deleted = True
                    row.updated_at = now
                    stats["deleted"] += 1

            return stats

    def list_unified_calendar_events(
        self, source: str | None = None
    ) -> list[UnifiedCalendarEvent]:
        """列出统一日历事件，可按 source 过滤。"""
        with self._session_scope() as session:
            query = session.query(UnifiedCalendarEventModel).filter(
                UnifiedCalendarEventModel.is_deleted.is_(False)
            )
            if source is not None:
                query = query.filter(UnifiedCalendarEventModel.source == source)
            rows = (
                query.order_by(UnifiedCalendarEventModel.start_time.asc()).all()
            )
            return [UnifiedCalendarEvent.from_obj(row) for row in rows]
