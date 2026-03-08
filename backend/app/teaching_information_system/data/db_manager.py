"""TIS SQLite 数据库门面。"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from app.teaching_information_system.api.dto import (
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISGradeRecord,
    TISSelectedCourseRecord,
)

from .models import Base, TISCreditGPASummaryModel, TISCreditGPATermModel, TISCreditGPAYearModel, TISPersonalGrade, TISSelectedCourse
from .results import TISSyncStats
from .sync_operations import sync_credit_gpa, sync_personal_grades, sync_selected_courses


@dataclass(slots=True)
class TISDatabaseDescription:
    db_path: str
    exists: bool
    size_bytes: int


class TISDatabaseManager:
    """为 TIS 数据层提供最小可用的 SQLAlchemy/SQLite 门面。"""

    def __init__(self, db_path: str | Path | None = None, *, reset_schema: bool = False) -> None:
        backend_dir = Path(__file__).resolve().parents[3]
        self.db_path = Path(db_path) if db_path else backend_dir / "data" / "sustech_tis.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        if reset_schema and self.db_path.exists():
            self.db_path.unlink()

        self.engine = create_engine(f"sqlite:///{self.db_path.as_posix()}", future=True)
        self._enable_sqlite_foreign_keys()
        self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False, class_=Session)
        self.create_tables()

    def _enable_sqlite_foreign_keys(self) -> None:
        @event.listens_for(self.engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:  # type: ignore[no-untyped-def]
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON;")
            cursor.close()

    def create_tables(self) -> None:
        Base.metadata.create_all(self.engine)

    @contextmanager
    def session_scope(self) -> Iterator[Session]:
        session = self.SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def database_exists(self) -> bool:
        return self.db_path.exists()

    def describe(self) -> TISDatabaseDescription:
        exists = self.db_path.exists()
        return TISDatabaseDescription(
            db_path=self.db_path.as_posix(),
            exists=exists,
            size_bytes=self.db_path.stat().st_size if exists else 0,
        )

    def sync_personal_grades(self, owner_key: str, grade_records: list[TISGradeRecord]) -> TISSyncStats:
        with self.session_scope() as session:
            return sync_personal_grades(session, owner_key, grade_records)

    def sync_credit_gpa(
        self,
        owner_key: str,
        summary: TISCreditGPASummary,
        term_records: list[TISCreditGPATermRecord],
        year_records: list[TISCreditGPAYearRecord],
    ) -> dict[str, TISSyncStats]:
        with self.session_scope() as session:
            return sync_credit_gpa(session, owner_key, summary, term_records, year_records)

    def sync_selected_courses(
        self,
        owner_key: str,
        semester_id: str,
        course_records: list[TISSelectedCourseRecord],
    ) -> TISSyncStats:
        with self.session_scope() as session:
            return sync_selected_courses(session, owner_key, semester_id, course_records)

    def get_table_counts(self) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        with self.session_scope() as session:
            for name, model in {
                "personal_grades": TISPersonalGrade,
                "credit_gpa_summary": TISCreditGPASummaryModel,
                "credit_gpa_terms": TISCreditGPATermModel,
                "credit_gpa_years": TISCreditGPAYearModel,
                "selected_courses": TISSelectedCourse,
            }.items():
                total = len(session.execute(select(model)).scalars().all())
                active = len(session.execute(select(model).where(model.is_deleted.is_(False))).scalars().all())
                result[name] = {"total": total, "active": active}
        return result


__all__ = ["TISDatabaseDescription", "TISDatabaseManager"]
