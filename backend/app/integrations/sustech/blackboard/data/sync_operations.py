"""Blackboard 数据层同步操作集合。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Callable

from app.integrations.sustech.blackboard.shared.logging import BlackboardLogger

from sqlalchemy.orm import Session

from app.integrations.sustech.blackboard.data.models import (
    Announcement,
    Assignment,
    CalendarEvent,
    CalendarSubscription,
    Course,
    Grade,
    Resource,
)

from .results import SyncStats, empty_sync_stats
from .sync_support import refresh_course_stats, sync_records, upsert_assignment_attachments


def sync_courses(
    session: Session,
    courses_data: list[dict[str, Any]],
    *,
    extract_code: Callable[[str], str | None],
    extract_term: Callable[[str], str | None],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    for item in courses_data:
        course_id = str(item.get("course_id") or item.get("id") or "").strip()
        if not course_id:
            continue

        name = str(item.get("name") or item.get("course_name") or "").strip() or course_id
        code = str(item.get("code") or "").strip() or extract_code(name)
        term = str(item.get("term") or "").strip() or extract_term(name)

        normalized.append(
            {
                "course_id": course_id,
                "name": name,
                "code": code or None,
                "instructor": item.get("instructor"),
                "term": term or None,
                "url": item.get("url"),
                "total_grade": item.get("total_grade"),
                "listed_grade": item.get("listed_grade"),
                "is_active": bool(item.get("is_active", True)),
            }
        )

    return sync_records(
        session,
        model=Course,
        unique_field="course_id",
        records=normalized,
        logger=logger,
    )


def sync_assignments(
    session: Session,
    course_id: str,
    assignments_data: list[dict[str, Any]],
    *,
    normalize_url: Callable[[Any], str | None],
    stable_id: Callable[..., str],
    parse_total_score: Callable[[Any], str | None],
    parse_datetime: Callable[[Any], datetime | None],
    guess_resource_type_from_url: Callable[[str], str],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    attachments_by_assignment_id: dict[str, tuple[str | None, list[dict[str, Any]]]] = {}
    for item in assignments_data:
        title = str(item.get("title") or "").strip()
        if not title:
            continue

        item_url = normalize_url(item.get("url"))
        assignment_id = str(item.get("assignment_id") or "").strip()
        due_date = str(item.get("due_date") or "").strip()

        if not assignment_id:
            if item_url:
                assignment_id = stable_id("asg", course_id, item_url)
            else:
                assignment_id = stable_id("asg", course_id, title, due_date)

        if not item_url:
            item_url = f"bb://assignment/{course_id}/{assignment_id}"

        score = item.get("score")
        total_score = item.get("total_score") or parse_total_score(score)

        attachments = item.get("attachments")
        attachments_json = None
        if isinstance(attachments, list):
            attachments_json = json.dumps(attachments, ensure_ascii=False)

        normalized.append(
            {
                "course_id": course_id,
                "assignment_id": assignment_id,
                "title": title,
                "url": item_url,
                "description": item.get("description"),
                "summary": item.get("summary"),
                "source_page": item.get("source_page"),
                "attachments_json": attachments_json,
                "due_date": due_date or None,
                "due_date_parsed": parse_datetime(due_date),
                "posted_date": item.get("posted_date"),
                "status": item.get("status"),
                "submission_status": item.get("submission_status") or item.get("status"),
                "score": None if score is None else str(score),
                "total_score": None if total_score is None else str(total_score),
            }
        )

        if isinstance(attachments, list) and attachments:
            parsed_attachments = [row for row in attachments if isinstance(row, dict)]
            if parsed_attachments:
                attachments_by_assignment_id[assignment_id] = (
                    str(item.get("source_page") or "").strip() or None,
                    parsed_attachments,
                )

    stats = sync_records(
        session,
        model=Assignment,
        unique_field="assignment_id",
        records=normalized,
        scope_filter={"course_id": course_id},
        logger=logger,
    )
    for assignment_id, (source_page, attachments) in attachments_by_assignment_id.items():
        upsert_assignment_attachments(
            session,
            course_id=course_id,
            assignment_id=assignment_id,
            source_page=source_page,
            attachments=attachments,
            normalize_url=normalize_url,
            stable_id=stable_id,
            guess_resource_type_from_url=guess_resource_type_from_url,
        )

    refresh_course_stats(session, course_id)
    return stats


def sync_resources(
    session: Session,
    course_id: str,
    resources_data: list[dict[str, Any]],
    *,
    normalize_url: Callable[[Any], str | None],
    stable_id: Callable[..., str],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    requested_parent_map: dict[str, str] = {}
    for item in resources_data:
        title = str(item.get("title") or item.get("name") or "").strip()
        if not title:
            continue

        item_url = normalize_url(item.get("download_url") or item.get("url"))
        resource_id = str(item.get("resource_id") or "").strip()

        if not resource_id:
            resource_id = stable_id("res", course_id, item_url, title)

        if not item_url:
            item_url = f"bb://resource/{course_id}/{resource_id}"

        parent_id_raw = item.get("parent_id")
        parent_id = str(parent_id_raw).strip() if parent_id_raw else None
        if parent_id == resource_id:
            parent_id = None

        if parent_id:
            requested_parent_map[resource_id] = parent_id

        normalized.append(
            {
                "course_id": course_id,
                "assignment_id": item.get("assignment_id"),
                "resource_id": resource_id,
                "title": title,
                "type": item.get("type"),
                "size": item.get("size"),
                "url": item_url,
                "source_page": item.get("source_page"),
                "local_path": item.get("local_path"),
                "is_downloaded": bool(item.get("is_downloaded", False)),
                "download_failed": bool(item.get("download_failed", False)),
                "parent_id": None,
            }
        )

    stats = sync_records(
        session,
        model=Resource,
        unique_field="resource_id",
        records=normalized,
        scope_filter={"course_id": course_id},
        logger=logger,
    )

    session.flush()

    if requested_parent_map:
        resource_ids = list(requested_parent_map.keys())
        existing_resources = session.query(Resource).filter(Resource.resource_id.in_(resource_ids)).all()
        existing_by_id = {item.resource_id: item for item in existing_resources}

        parent_ids = {pid for pid in requested_parent_map.values() if pid}
        existing_parent_ids: set[str] = set()
        if parent_ids:
            existing_parent_ids = {
                item.resource_id
                for item in session.query(Resource)
                .filter(
                    Resource.course_id == course_id,
                    Resource.resource_id.in_(parent_ids),
                )
                .all()
            }

        resolved_parent_count = 0
        dropped_parent_count = 0
        for child_id, parent_id in requested_parent_map.items():
            child = existing_by_id.get(child_id)
            if child is None:
                continue
            if parent_id in existing_parent_ids:
                child.parent_id = parent_id
                resolved_parent_count += 1
            else:
                child.parent_id = None
                dropped_parent_count += 1

        if dropped_parent_count and logger is not None:
            logger.warning(
                "🗑 丢弃无效资源父节点引用",
                context={"course_id": course_id},
                payload={
                    "dropped_parent_count": dropped_parent_count,
                    "resolved_parent_count": resolved_parent_count,
                },
            )

    session.flush()
    with session.no_autoflush:
        refresh_course_stats(session, course_id)
    return stats


def sync_grades(
    session: Session,
    course_id: str,
    grades_data: list[dict[str, Any]],
    *,
    stable_id: Callable[..., str],
    parse_total_score: Callable[[Any], str | None],
    parse_score_metrics: Callable[[Any], tuple[float | None, float | None, float | None]],
    parse_datetime: Callable[[Any], datetime | None],
    to_float: Callable[[Any], float | None],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    existing_assignment_ids = {
        str(row[0]).strip()
        for row in session.query(Assignment.assignment_id)
        .filter(Assignment.course_id == course_id, Assignment.is_deleted.is_(False))
        .all()
        if row[0]
    }
    for item in grades_data:
        item_name = str(item.get("item_name") or item.get("name") or "").strip()
        if not item_name:
            continue

        due_date = str(item.get("due_date") or "").strip()
        graded_date = str(item.get("graded_date") or "").strip()
        category = str(item.get("category") or "").strip() or None
        grade_type = str(item.get("grade_type") or "").strip() or category
        grade_id = str(item.get("grade_id") or "").strip()

        if not grade_id:
            grade_id = stable_id("grd", course_id, item_name, due_date or graded_date, category or "")

        score = item.get("score")
        total_score = item.get("total_score") or parse_total_score(score)
        score_numeric, max_score, percentage = parse_score_metrics(score)
        if total_score and max_score is None:
            try:
                max_score = float(str(total_score).strip())
            except ValueError:
                max_score = None

        assignment_id = str(item.get("assignment_id") or "").strip() or None
        if assignment_id and assignment_id not in existing_assignment_ids:
            if logger is not None:
                logger.warning(
                    "⚠ 成绩写库前发现不存在的 assignment_id，已降级为空关联",
                    context={"course_id": course_id},
                    payload={
                        "grade_id": grade_id,
                        "item_name": item_name,
                        "assignment_id": assignment_id,
                        "known_assignment_count": len(existing_assignment_ids),
                        "source_url": item.get("source_url"),
                    },
                )
            assignment_id = None

        normalized.append(
            {
                "course_id": course_id,
                "assignment_id": assignment_id,
                "grade_id": grade_id,
                "item_name": item_name,
                "score": None if score is None else str(score),
                "total_score": None if total_score is None else str(total_score),
                "score_numeric": score_numeric,
                "max_score": max_score,
                "percentage": percentage,
                "status": item.get("status"),
                "grade_type": grade_type,
                "category": category,
                "due_date": due_date or None,
                "due_date_parsed": parse_datetime(due_date),
                "graded_date": graded_date or None,
                "graded_at": parse_datetime(graded_date),
                "weight": to_float(item.get("weight")),
                "is_counted": bool(item.get("is_counted", True)),
                "source_url": item.get("source_url"),
            }
        )

    return sync_records(
        session,
        model=Grade,
        unique_field="grade_id",
        records=normalized,
        scope_filter={"course_id": course_id},
        logger=logger,
    )


def sync_announcements(
    session: Session,
    announcements_data: list[dict[str, Any]],
    *,
    normalize_url: Callable[[Any], str | None],
    parse_datetime: Callable[[Any], datetime | None],
    stable_id: Callable[..., str],
    resolve_course_id_by_course_name: Callable[[Session, str], str | None],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    for item in announcements_data:
        course_id_raw = item.get("course_id")
        course_id = str(course_id_raw).strip() if course_id_raw else None
        course_name = str(item.get("course_name") or "").strip() or None
        title = str(item.get("title") or "").strip()
        if not title:
            continue

        posted_text = str(item.get("publish_time") or item.get("posted_date") or "").strip()
        url = normalize_url(item.get("url"))
        announcement_id = str(item.get("announcement_id") or "").strip()

        if not announcement_id:
            fallback = json.dumps(item, ensure_ascii=False, sort_keys=True)
            announcement_id = stable_id("ann", course_id, title, posted_text, url, fallback)

        normalized.append(
            {
                "course_id": course_id,
                "announcement_id": announcement_id,
                "course_name": course_name,
                "title": title,
                "content": item.get("content") or item.get("detail"),
                "author": item.get("author"),
                "posted_at": parse_datetime(posted_text),
                "url": url or None,
                "source_page": item.get("source_page"),
            }
        )

    for row in normalized:
        if row.get("course_id"):
            continue
        resolved = resolve_course_id_by_course_name(session, str(row.get("course_name") or ""))
        if resolved:
            row["course_id"] = resolved

    stats = sync_records(
        session,
        model=Announcement,
        unique_field="announcement_id",
        records=normalized,
        allow_soft_delete=False,
        logger=logger,
    )

    touched_course_ids = {
        str(item.get("course_id") or "").strip()
        for item in normalized
        if str(item.get("course_id") or "").strip()
    }
    for cid in touched_course_ids:
        refresh_course_stats(session, cid)

    return stats


def upsert_calendar_subscription(
    session: Session,
    feed_url: str,
    *,
    etag: str | None = None,
    last_modified: str | None = None,
    last_refreshed_at: datetime | None = None,
    last_error: str | None = None,
    is_active: bool = True,
) -> None:
    normalized_feed_url = str(feed_url or "").strip()
    if not normalized_feed_url:
        return

    now = datetime.utcnow()
    row = session.query(CalendarSubscription).filter(CalendarSubscription.feed_url == normalized_feed_url).one_or_none()

    if row is None:
        session.add(
            CalendarSubscription(
                feed_url=normalized_feed_url,
                etag=etag,
                last_modified=last_modified,
                last_refreshed_at=last_refreshed_at,
                last_error=last_error,
                is_active=is_active,
                created_at=now,
                updated_at=now,
                is_deleted=False,
            )
        )
        return

    row.etag = etag
    row.last_modified = last_modified
    row.last_refreshed_at = last_refreshed_at
    row.last_error = last_error
    row.is_active = is_active
    row.is_deleted = False
    row.updated_at = now
    row.last_synced_at = now


def get_calendar_subscription(session: Session, feed_url: str) -> dict[str, Any] | None:
    normalized_feed_url = str(feed_url or "").strip()
    if not normalized_feed_url:
        return None

    row = session.query(CalendarSubscription).filter(CalendarSubscription.feed_url == normalized_feed_url).one_or_none()
    if row is None:
        return None

    return {
        "feed_url": row.feed_url,
        "etag": row.etag,
        "last_modified": row.last_modified,
        "last_refreshed_at": row.last_refreshed_at,
        "last_error": row.last_error,
        "is_active": row.is_active,
        "is_deleted": row.is_deleted,
    }


def sync_calendar_events(
    session: Session,
    feed_url: str,
    events_data: list[dict[str, Any]],
    *,
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized_feed_url = str(feed_url or "").strip()
    if not normalized_feed_url:
        return empty_sync_stats()

    normalized: list[dict[str, Any]] = []
    for item in events_data:
        uid = str(item.get("uid") or "").strip()
        title = str(item.get("title") or "").strip()
        start_at = item.get("start_at")
        if not uid or not title or start_at is None:
            continue

        normalized.append(
            {
                "feed_url": normalized_feed_url,
                "uid": uid,
                "raw_uid": str(item.get("raw_uid") or "").strip() or None,
                "title": title,
                "description": item.get("description"),
                "location": item.get("location"),
                "course_id": item.get("course_id"),
                "start_at": start_at,
                "end_at": item.get("end_at"),
                "all_day": bool(item.get("all_day", False)),
            }
        )

    now = datetime.utcnow()
    subscription = session.query(CalendarSubscription).filter(CalendarSubscription.feed_url == normalized_feed_url).one_or_none()
    if subscription is None:
        session.add(
            CalendarSubscription(
                feed_url=normalized_feed_url,
                is_active=True,
                created_at=now,
                updated_at=now,
                is_deleted=False,
            )
        )

    existing = session.query(CalendarEvent).filter(CalendarEvent.feed_url == normalized_feed_url).all()
    existing_map = {item.uid: item for item in existing}
    incoming_map = {row["uid"]: row for row in normalized}

    stats = empty_sync_stats()

    for uid, payload in incoming_map.items():
        row = existing_map.get(uid)
        if row is None:
            session.add(
                CalendarEvent(
                    **payload,
                    done=False,
                    created_at=now,
                    updated_at=now,
                    last_synced_at=now,
                    is_deleted=False,
                )
            )
            stats["inserted"] += 1
            continue

        preserved_done = bool(row.done)
        for key, value in payload.items():
            setattr(row, key, value)
        row.done = preserved_done
        row.is_deleted = False
        row.updated_at = now
        row.last_synced_at = now
        stats["updated"] += 1

    incoming_uids = set(incoming_map.keys())
    for uid, row in existing_map.items():
        if uid in incoming_uids or row.is_deleted:
            continue
        row.is_deleted = True
        row.updated_at = now
        row.last_synced_at = now
        stats["deleted"] += 1

    if logger is not None:
        logger.info(
            "✅ 日历事件同步完成",
            context={"feed_url": normalized_feed_url},
            payload={"stats": dict(stats), "incoming_count": len(normalized)},
        )
    return stats


def list_calendar_events(
    session: Session,
    feed_url: str,
    *,
    include_deleted: bool = False,
) -> list[dict[str, Any]]:
    normalized_feed_url = str(feed_url or "").strip()
    if not normalized_feed_url:
        return []

    query = session.query(CalendarEvent).filter(CalendarEvent.feed_url == normalized_feed_url)
    if not include_deleted:
        query = query.filter(CalendarEvent.is_deleted.is_(False))

    rows = query.order_by(CalendarEvent.start_at.asc()).all()
    return [
        {
            "uid": row.uid,
            "raw_uid": row.raw_uid,
            "title": row.title,
            "description": row.description,
            "location": row.location,
            "course_id": row.course_id,
            "start_at": row.start_at,
            "end_at": row.end_at,
            "all_day": row.all_day,
            "done": row.done,
            "is_deleted": row.is_deleted,
            "last_synced_at": row.last_synced_at,
        }
        for row in rows
    ]

