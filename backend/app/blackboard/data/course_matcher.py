"""过渡期课程归属匹配 helper。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.database.models import Course


def resolve_course_id_by_course_name(session: Session, course_name: str) -> str | None:
    """按旧逻辑解析公告课程名到 `course_id`。

    该逻辑目前仍属第 3 阶段保守保留的跨层推断遗留，
    仅从 [`DatabaseManager`](backend/app/core/database/db_manager.py) 主体中隔离，
    方便后续再迁移到更合适的 provider / matcher 层。
    """

    target = str(course_name or "").strip()
    if not target:
        return None

    direct = session.query(Course).filter(Course.name == target).one_or_none()
    if direct is not None:
        return direct.course_id

    fuzzy = session.query(Course).filter(Course.name.contains(target)).first()
    if fuzzy is not None:
        return fuzzy.course_id

    reverse_fuzzy = session.query(Course).filter(Course.name.is_not(None)).all()
    for course in reverse_fuzzy:
        if target in str(course.name):
            return course.course_id

    return None
