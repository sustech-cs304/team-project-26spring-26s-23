"""Blackboard 数据层中的课程归属匹配 helper。"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.integrations.sustech.blackboard.data.models import Course


def resolve_course_id_by_course_name(session: Session, course_name: str) -> str | None:
    """按现有公告同步回退规则，将课程名解析为 `course_id`。

    该函数是 [`backend/app/integrations/sustech/blackboard/data`](backend/app/integrations/sustech/blackboard/data) 中的
    细粒度数据层 helper，由 [`DatabaseManager`](backend/app/integrations/sustech/blackboard/data/db_manager.py)
    在公告记录缺少 `course_id` 时调用，负责基于已入库课程名称做精确/模糊匹配。
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
