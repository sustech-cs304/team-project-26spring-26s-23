"""Blackboard 数据层通用同步支持函数。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from app.blackboard.shared.logging import BlackboardLogger

from sqlalchemy.orm import Session

from app.core.database.models import Announcement, Assignment, Course, Resource

from .results import SyncStats, empty_sync_stats


def warn_unknown_fields(
    record: dict[str, Any],
    model_fields: set[str],
    context: str,
    *,
    logger: BlackboardLogger | None = None,
) -> None:
    unknown = sorted(k for k in record.keys() if k not in model_fields)
    if unknown and logger is not None:
        logger.warning(
            "⚠ 存在未落库字段",
            context={"record": context},
            payload={"unknown_fields": unknown},
        )


def sync_records(
    session: Session,
    *,
    model: type[Any],
    unique_field: str,
    records: list[dict[str, Any]],
    scope_filter: dict[str, Any] | None = None,
    allow_soft_delete: bool = True,
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    stats = empty_sync_stats()
    now = datetime.utcnow()

    query = session.query(model)
    if scope_filter:
        for field, value in scope_filter.items():
            query = query.filter(getattr(model, field) == value)

    existing = query.all()
    existing_map = {str(getattr(item, unique_field)): item for item in existing}

    model_fields = {column.name for column in model.__table__.columns}
    latest_records: dict[str, dict[str, Any]] = {}

    for record in records:
        unique_value = str(record.get(unique_field, "")).strip()
        if not unique_value:
            continue
        warn_unknown_fields(record, model_fields, f"{model.__tablename__}.{unique_value}", logger=logger)
        latest_records[unique_value] = record

    incoming_ids = set(latest_records.keys())

    for unique_value, record in latest_records.items():
        data = {k: v for k, v in record.items() if k in model_fields and k != "id"}
        if "last_synced_at" in model_fields:
            data["last_synced_at"] = now

        existing_item = existing_map.get(unique_value)
        if existing_item is None:
            session.add(model(**data, created_at=now, updated_at=now, is_deleted=False))
            stats["inserted"] += 1
            continue

        for key, value in data.items():
            setattr(existing_item, key, value)

        existing_item.is_deleted = False
        existing_item.updated_at = now
        stats["updated"] += 1

    if allow_soft_delete:
        for existing_key, existing_item in existing_map.items():
            if existing_key not in incoming_ids and not existing_item.is_deleted:
                existing_item.is_deleted = True
                existing_item.updated_at = now
                if hasattr(existing_item, "last_synced_at"):
                    setattr(existing_item, "last_synced_at", now)
                stats["deleted"] += 1

    return stats


def refresh_course_stats(session: Session, course_id: str) -> None:
    course = session.query(Course).filter(Course.course_id == course_id).one_or_none()
    if course is None:
        return

    course.total_assignments = session.query(Assignment).filter(
        Assignment.course_id == course_id,
        Assignment.is_deleted.is_(False),
    ).count()
    course.total_resources = session.query(Resource).filter(
        Resource.course_id == course_id,
        Resource.is_deleted.is_(False),
    ).count()
    course.total_announcements = session.query(Announcement).filter(
        Announcement.course_id == course_id,
        Announcement.is_deleted.is_(False),
    ).count()
    course.last_synced_at = datetime.utcnow()


def upsert_assignment_attachments(
    session: Session,
    *,
    course_id: str,
    assignment_id: str,
    source_page: str | None,
    attachments: list[dict[str, Any]],
    normalize_url: Callable[[Any], str | None],
    stable_id: Callable[..., str],
    guess_resource_type_from_url: Callable[[str], str],
) -> None:
    now = datetime.utcnow()
    for att in attachments:
        name = str(att.get("name") or "").strip()
        url = normalize_url(att.get("url"))
        if not name or not url:
            continue

        resource_id = stable_id("res", course_id, assignment_id, url)
        resource = session.query(Resource).filter(Resource.resource_id == resource_id).one_or_none()
        payload = {
            "course_id": course_id,
            "assignment_id": assignment_id,
            "resource_id": resource_id,
            "title": name,
            "type": guess_resource_type_from_url(url),
            "size": str(att.get("size") or "").strip() or None,
            "url": url,
            "source_page": source_page,
            "is_downloaded": False,
            "download_failed": False,
            "parent_id": None,
            "is_deleted": False,
            "last_synced_at": now,
        }

        if resource is None:
            session.add(Resource(**payload, created_at=now, updated_at=now))
            continue

        for key, value in payload.items():
            setattr(resource, key, value)
        resource.updated_at = now
