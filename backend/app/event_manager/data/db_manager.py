from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator


from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker


from .dto import CourseEvent
from .models import Base, CourseEventModel


class DatabaseManager:
    """SQLite 数据库管理器"""

    def __init__(
        self, db_path: str | Path | None = None, *, reset_schema: bool = False
    ) -> None:
        backend_dir = Path(__file__).resolve().parents[3]
        self.db_path = Path(db_path) if db_path else backend_dir / "data" / "sustech.db"
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
        now = datetime.utcnow()
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
