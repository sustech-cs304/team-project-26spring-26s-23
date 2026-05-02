"""Blackboard 数据层同步操作集合。"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Callable

from app.integrations.sustech.blackboard.shared.logging import BlackboardLogger

from sqlalchemy.orm import Session

from app.integrations.sustech.blackboard.data.models import (
    AnnouncementAssignmentLink,
    Announcement,
    Assignment,
    CalendarEvent,
    CalendarSubscription,
    Course,
    Grade,
    Resource,
    utc_now_naive,
)

from .results import SyncStats, empty_sync_stats
from .sync_support import (
    refresh_course_stats,
    sync_records,
    upsert_assignment_attachments,
)

AssignmentAttachmentBatch = tuple[str | None, list[dict[str, Any]]]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_assignment_id(
    course_id: str,
    title: str,
    assignment_id: str,
    due_date: str,
    item_url: str | None,
    *,
    stable_id: Callable[..., str],
) -> str:
    if assignment_id:
        return assignment_id
    if item_url:
        return stable_id("asg", course_id, item_url)
    return stable_id("asg", course_id, title, due_date)


def _has_meaningful_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def _assignment_title_key(title: Any) -> str:
    return _text(title)


def _assignment_record_score(row: dict[str, Any]) -> tuple[int, int, int, int, int, int, int, int, str]:
    assignment_id = _text(row.get("assignment_id"))
    url = _text(row.get("url")).lower()
    source_page = _text(row.get("source_page")).lower()
    return (
        1 if _has_meaningful_value(row.get("description_html")) else 0,
        1 if _has_meaningful_value(row.get("description")) else 0,
        1 if _has_meaningful_value(row.get("attachments_json")) else 0,
        1 if _has_meaningful_value(row.get("submission_status")) else 0,
        1 if _has_meaningful_value(row.get("status")) else 0,
        1 if _has_meaningful_value(row.get("due_date")) else 0,
        1 if "/webapps/assignment/" in url else 0,
        1 if "content_id=" in url or "content_id=" in source_page else 0,
        assignment_id,
    )


def _deserialize_assignment_attachments_json(value: Any) -> list[dict[str, Any]]:
    text = _text(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    return [row for row in parsed if isinstance(row, dict)]


def _merge_assignment_attachment_rows(
    *attachment_groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str, str]] = set()
    for group in attachment_groups:
        for row in group:
            if not isinstance(row, dict):
                continue
            url = _text(row.get("url"))
            name = _text(row.get("name") or row.get("title"))
            resource_id = _text(row.get("resource_id"))
            dedupe_key = (resource_id, url, name)
            if dedupe_key == ("", "", "") or dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            merged.append(
                {
                    "resource_id": resource_id or None,
                    "name": name,
                    "title": _text(row.get("title")) or name,
                    "url": url or None,
                    "type": row.get("type"),
                    "size": row.get("size"),
                }
            )
    return merged


def _merge_assignment_records_by_title(
    normalized: list[dict[str, Any]],
    attachments_by_assignment_id: dict[str, AssignmentAttachmentBatch],
) -> tuple[list[dict[str, Any]], dict[str, AssignmentAttachmentBatch]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in normalized:
        title_key = _assignment_title_key(record.get("title"))
        if not title_key:
            continue
        grouped.setdefault(title_key, []).append(record)

    merged_records: list[dict[str, Any]] = []
    merged_attachments_by_assignment_id: dict[str, AssignmentAttachmentBatch] = {}

    for rows in grouped.values():
        best_row = max(rows, key=_assignment_record_score)
        merged_row = dict(best_row)
        merged_attachment_rows = _merge_assignment_attachment_rows(
            _deserialize_assignment_attachments_json(best_row.get("attachments_json"))
        )
        merged_attachment_source_page = _text(best_row.get("source_page")) or None

        for row in rows:
            if row is best_row:
                continue
            for field_name in (
                "url",
                "description",
                "description_html",
                "summary",
                "source_page",
                "due_date",
                "due_date_parsed",
                "posted_date",
                "status",
                "submission_status",
                "score",
                "total_score",
            ):
                if not _has_meaningful_value(merged_row.get(field_name)) and _has_meaningful_value(row.get(field_name)):
                    merged_row[field_name] = row.get(field_name)

            merged_attachment_rows = _merge_assignment_attachment_rows(
                merged_attachment_rows,
                _deserialize_assignment_attachments_json(row.get("attachments_json")),
            )

            source_page, attachment_rows = attachments_by_assignment_id.get(
                _text(row.get("assignment_id")),
                (None, []),
            )
            if source_page and not merged_attachment_source_page:
                merged_attachment_source_page = source_page
            merged_attachment_rows = _merge_assignment_attachment_rows(
                merged_attachment_rows,
                attachment_rows,
            )

        best_source_page, best_attachment_rows = attachments_by_assignment_id.get(
            _text(best_row.get("assignment_id")),
            (None, []),
        )
        if best_source_page and not merged_attachment_source_page:
            merged_attachment_source_page = best_source_page
        merged_attachment_rows = _merge_assignment_attachment_rows(
            merged_attachment_rows,
            best_attachment_rows,
        )

        merged_row["attachments_json"] = (
            json.dumps(merged_attachment_rows, ensure_ascii=False)
            if merged_attachment_rows
            else None
        )
        merged_records.append(merged_row)

        canonical_assignment_id = _text(merged_row.get("assignment_id"))
        if canonical_assignment_id and merged_attachment_rows:
            merged_attachments_by_assignment_id[canonical_assignment_id] = (
                merged_attachment_source_page or _text(merged_row.get("source_page")) or None,
                merged_attachment_rows,
            )

    return merged_records, merged_attachments_by_assignment_id


def _normalize_assignment_attachments(
    attachments: Any,
) -> tuple[str | None, list[dict[str, Any]]]:
    if not isinstance(attachments, list):
        return None, []
    return json.dumps(attachments, ensure_ascii=False), [
        row for row in attachments if isinstance(row, dict)
    ]


def _normalize_assignment_record(
    course_id: str,
    item: dict[str, Any],
    *,
    normalize_url: Callable[[Any], str | None],
    stable_id: Callable[..., str],
    parse_total_score: Callable[[Any], str | None],
    parse_datetime: Callable[[Any], datetime | None],
) -> tuple[dict[str, Any] | None, AssignmentAttachmentBatch | None]:
    title = _text(item.get("title"))
    if not title:
        return None, None

    item_url = normalize_url(item.get("url"))
    due_date = _text(item.get("due_date"))
    assignment_id = _normalize_assignment_id(
        course_id,
        title,
        _text(item.get("assignment_id")),
        due_date,
        item_url,
        stable_id=stable_id,
    )
    if not item_url:
        item_url = f"bb://assignment/{course_id}/{assignment_id}"

    score = item.get("score")
    total_score = item.get("total_score") or parse_total_score(score)
    attachments_json, parsed_attachments = _normalize_assignment_attachments(
        item.get("attachments")
    )
    source_page = _text(item.get("source_page")) or None

    normalized_record = {
        "course_id": course_id,
        "assignment_id": assignment_id,
        "title": title,
        "url": item_url,
        "description": item.get("description"),
        "description_html": item.get("description_html"),
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
    if not parsed_attachments:
        return normalized_record, None
    return normalized_record, (source_page, parsed_attachments)


def _upsert_assignment_attachment_resources(
    session: Session,
    course_id: str,
    attachments_by_assignment_id: dict[str, AssignmentAttachmentBatch],
    *,
    normalize_url: Callable[[Any], str | None],
    stable_id: Callable[..., str],
    guess_resource_type_from_url: Callable[[str], str],
    allow_attachment_resource_upsert: bool,
) -> None:
    if not allow_attachment_resource_upsert:
        return

    for assignment_id, (
        source_page,
        attachments,
    ) in attachments_by_assignment_id.items():
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


def _normalize_resource_parent_id(parent_id_raw: Any, resource_id: str) -> str | None:
    parent_id = _text(parent_id_raw) or None
    if parent_id == resource_id:
        return None
    return parent_id


def _normalize_resource_record(
    course_id: str,
    item: dict[str, Any],
    *,
    normalize_url: Callable[[Any], str | None],
    stable_id: Callable[..., str],
) -> tuple[dict[str, Any] | None, tuple[str, str] | None]:
    title = _text(item.get("title") or item.get("name"))
    if not title:
        return None, None

    item_url = normalize_url(item.get("download_url") or item.get("url"))
    resource_id = _text(item.get("resource_id")) or stable_id(
        "res", course_id, item_url, title
    )
    if not item_url:
        item_url = f"bb://resource/{course_id}/{resource_id}"

    parent_id = _normalize_resource_parent_id(item.get("parent_id"), resource_id)
    normalized_record = {
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
    if parent_id is None:
        return normalized_record, None
    return normalized_record, (resource_id, parent_id)


def _load_resource_map(
    session: Session, resource_ids: list[str]
) -> dict[str, Resource]:
    if not resource_ids:
        return {}
    existing_resources = (
        session.query(Resource).filter(Resource.resource_id.in_(resource_ids)).all()
    )
    return {item.resource_id: item for item in existing_resources}


def _load_existing_parent_resource_ids(
    session: Session,
    course_id: str,
    parent_ids: set[str],
) -> set[str]:
    if not parent_ids:
        return set()
    return {
        item.resource_id
        for item in session.query(Resource)
        .filter(
            Resource.course_id == course_id,
            Resource.resource_id.in_(parent_ids),
        )
        .all()
    }


def _apply_resource_parent_updates(
    existing_by_id: dict[str, Resource],
    requested_parent_map: dict[str, str],
    existing_parent_ids: set[str],
) -> tuple[int, int]:
    resolved_parent_count = 0
    dropped_parent_count = 0
    for child_id, parent_id in requested_parent_map.items():
        child = existing_by_id.get(child_id)
        if child is None:
            continue
        if parent_id in existing_parent_ids:
            child.parent_id = parent_id
            resolved_parent_count += 1
            continue
        child.parent_id = None
        dropped_parent_count += 1
    return resolved_parent_count, dropped_parent_count


def _log_dropped_resource_parents(
    logger: BlackboardLogger | None,
    *,
    course_id: str,
    dropped_parent_count: int,
    resolved_parent_count: int,
) -> None:
    if not dropped_parent_count or logger is None:
        return
    logger.warning(
        "🗑 丢弃无效资源父节点引用",
        context={"course_id": course_id},
        payload={
            "dropped_parent_count": dropped_parent_count,
            "resolved_parent_count": resolved_parent_count,
        },
    )


def _load_existing_assignment_ids(session: Session, course_id: str) -> set[str]:
    return {
        str(row[0]).strip()
        for row in session.query(Assignment.assignment_id)
        .filter(Assignment.course_id == course_id, Assignment.is_deleted.is_(False))
        .all()
        if row[0]
    }


def _normalize_grade_id(
    course_id: str,
    item_name: str,
    grade_id: str,
    due_date: str,
    graded_date: str,
    category: str | None,
    *,
    stable_id: Callable[..., str],
) -> str:
    if grade_id:
        return grade_id
    return stable_id(
        "grd", course_id, item_name, due_date or graded_date, category or ""
    )


def _derive_max_score(total_score: Any, max_score: float | None) -> float | None:
    if not total_score or max_score is not None:
        return max_score
    try:
        return float(_text(total_score))
    except ValueError:
        return None


def _normalize_grade_assignment_id(
    course_id: str,
    item: dict[str, Any],
    *,
    grade_id: str,
    item_name: str,
    existing_assignment_ids: set[str],
    logger: BlackboardLogger | None,
) -> str | None:
    assignment_id = _text(item.get("assignment_id")) or None
    if not assignment_id or assignment_id in existing_assignment_ids:
        return assignment_id
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
    return None


def _normalize_grade_record(
    course_id: str,
    item: dict[str, Any],
    *,
    stable_id: Callable[..., str],
    parse_total_score: Callable[[Any], str | None],
    parse_score_metrics: Callable[
        [Any], tuple[float | None, float | None, float | None]
    ],
    parse_datetime: Callable[[Any], datetime | None],
    to_float: Callable[[Any], float | None],
    existing_assignment_ids: set[str],
    logger: BlackboardLogger | None,
) -> dict[str, Any] | None:
    item_name = _text(item.get("item_name") or item.get("name"))
    if not item_name:
        return None

    due_date = _text(item.get("due_date"))
    graded_date = _text(item.get("graded_date"))
    category = _text(item.get("category")) or None
    grade_type = _text(item.get("grade_type")) or category
    grade_id = _normalize_grade_id(
        course_id,
        item_name,
        _text(item.get("grade_id")),
        due_date,
        graded_date,
        category,
        stable_id=stable_id,
    )

    score = item.get("score")
    total_score = item.get("total_score") or parse_total_score(score)
    score_numeric, max_score, percentage = parse_score_metrics(score)
    assignment_id = _normalize_grade_assignment_id(
        course_id,
        item,
        grade_id=grade_id,
        item_name=item_name,
        existing_assignment_ids=existing_assignment_ids,
        logger=logger,
    )

    return {
        "course_id": course_id,
        "assignment_id": assignment_id,
        "grade_id": grade_id,
        "item_name": item_name,
        "score": None if score is None else str(score),
        "total_score": None if total_score is None else str(total_score),
        "score_numeric": score_numeric,
        "max_score": _derive_max_score(total_score, max_score),
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


def _normalize_announcement_record(
    item: dict[str, Any],
    *,
    normalize_url: Callable[[Any], str | None],
    parse_datetime: Callable[[Any], datetime | None],
    stable_id: Callable[..., str],
) -> dict[str, Any] | None:
    title = _text(item.get("title"))
    if not title:
        return None

    course_id = _text(item.get("course_id")) or None
    course_name = _text(item.get("course_name")) or None
    posted_text = _text(item.get("publish_time") or item.get("posted_date"))
    url = normalize_url(item.get("url"))
    announcement_id = _text(item.get("announcement_id"))
    if not announcement_id:
        fallback = json.dumps(item, ensure_ascii=False, sort_keys=True)
        announcement_id = stable_id("ann", course_id, title, posted_text, url, fallback)

    return {
        "course_id": course_id,
        "announcement_id": announcement_id,
        "course_name": course_name,
        "title": title,
        "content": item.get("content") or item.get("detail"),
        "content_html": item.get("content_html") or item.get("detail_html"),
        "relation_type": _text(item.get("relation_type")) or None,
        "relation_confidence": _text(item.get("relation_confidence")) or None,
        "author": item.get("author"),
        "posted_at": parse_datetime(posted_text),
        "url": url or None,
        "source_page": item.get("source_page"),
    }


def _normalize_announcement_assignment_link_record(
    item: dict[str, Any],
) -> dict[str, Any] | None:
    announcement_id = _text(item.get("announcement_id"))
    assignment_id = _text(item.get("assignment_id"))
    course_id = _text(item.get("course_id"))
    if not announcement_id or not assignment_id or not course_id:
        return None

    evidence_value = item.get("evidence_json")
    if evidence_value is None:
        evidence_json = None
    elif isinstance(evidence_value, str):
        evidence_json = evidence_value.strip() or None
    else:
        evidence_json = json.dumps(
            evidence_value,
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )

    return {
        "announcement_id": announcement_id,
        "assignment_id": assignment_id,
        "course_id": course_id,
        "link_source": _text(item.get("link_source")) or "content_id_match",
        "confidence": _text(item.get("confidence")) or "medium",
        "evidence_json": evidence_json,
    }


def _sync_announcement_assignment_links(
    session: Session,
    touched_course_ids: set[str],
    links_data: list[dict[str, Any]],
    *,
    logger: BlackboardLogger | None,
) -> None:
    if not touched_course_ids:
        return

    now = utc_now_naive()
    existing_rows = (
        session.query(AnnouncementAssignmentLink)
        .filter(AnnouncementAssignmentLink.course_id.in_(touched_course_ids))
        .all()
    )
    existing_map = {
        (str(row.announcement_id), str(row.assignment_id)): row for row in existing_rows
    }
    existing_announcement_ids = {
        str(row[0]).strip()
        for row in session.query(Announcement.announcement_id)
        .filter(
            Announcement.course_id.in_(touched_course_ids),
            Announcement.is_deleted.is_(False),
        )
        .all()
        if row[0]
    }
    existing_assignment_ids = {
        str(row[0]).strip()
        for row in session.query(Assignment.assignment_id)
        .filter(
            Assignment.course_id.in_(touched_course_ids),
            Assignment.is_deleted.is_(False),
        )
        .all()
        if row[0]
    }

    incoming_keys: set[tuple[str, str]] = set()
    for raw_item in links_data:
        normalized = _normalize_announcement_assignment_link_record(raw_item)
        if normalized is None:
            continue

        announcement_id = str(normalized["announcement_id"])
        assignment_id = str(normalized["assignment_id"])
        if (
            announcement_id not in existing_announcement_ids
            or assignment_id not in existing_assignment_ids
        ):
            if logger is not None:
                logger.warning(
                    "⚠ 跳过无法落库的公告-作业关联",
                    payload=normalized,
                )
            continue

        key = (announcement_id, assignment_id)
        incoming_keys.add(key)
        row = existing_map.get(key)
        if row is None:
            session.add(
                AnnouncementAssignmentLink(
                    **normalized,
                    created_at=now,
                    updated_at=now,
                    last_synced_at=now,
                    is_deleted=False,
                )
            )
            continue

        for field_name, value in normalized.items():
            setattr(row, field_name, value)
        row.updated_at = now
        row.last_synced_at = now
        row.is_deleted = False

    for key, row in existing_map.items():
        if key in incoming_keys or row.is_deleted:
            continue
        row.is_deleted = True
        row.updated_at = now
        row.last_synced_at = now


def _resolve_announcement_course_ids(
    session: Session,
    normalized: list[dict[str, Any]],
    *,
    resolve_course_id_by_course_name: Callable[[Session, str], str | None],
) -> None:
    for row in normalized:
        if row.get("course_id"):
            continue
        resolved = resolve_course_id_by_course_name(
            session, str(row.get("course_name") or "")
        )
        if resolved:
            row["course_id"] = resolved


def _refresh_announcement_course_stats(
    session: Session,
    normalized: list[dict[str, Any]],
) -> None:
    touched_course_ids = {
        _text(item.get("course_id"))
        for item in normalized
        if _text(item.get("course_id"))
    }
    for course_id in touched_course_ids:
        refresh_course_stats(session, course_id)


def sync_courses(
    session: Session,
    courses_data: list[dict[str, Any]],
    *,
    extract_code: Callable[[str], str | None],
    extract_term: Callable[[str], str | None],
    allow_soft_delete: bool = True,
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    for item in courses_data:
        course_id = str(item.get("course_id") or item.get("id") or "").strip()
        if not course_id:
            continue

        name = (
            str(item.get("name") or item.get("course_name") or "").strip() or course_id
        )
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
        allow_soft_delete=allow_soft_delete,
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
    allow_attachment_resource_upsert: bool = True,
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    attachments_by_assignment_id: dict[str, AssignmentAttachmentBatch] = {}
    for item in assignments_data:
        normalized_record, attachment_batch = _normalize_assignment_record(
            course_id,
            item,
            normalize_url=normalize_url,
            stable_id=stable_id,
            parse_total_score=parse_total_score,
            parse_datetime=parse_datetime,
        )
        if normalized_record is None:
            continue
        normalized.append(normalized_record)
        if attachment_batch is not None:
            attachments_by_assignment_id[str(normalized_record["assignment_id"])] = (
                attachment_batch
            )

    normalized, attachments_by_assignment_id = _merge_assignment_records_by_title(
        normalized,
        attachments_by_assignment_id,
    )

    stats = sync_records(
        session,
        model=Assignment,
        unique_field="assignment_id",
        records=normalized,
        scope_filter={"course_id": course_id},
        logger=logger,
    )
    _upsert_assignment_attachment_resources(
        session,
        course_id,
        attachments_by_assignment_id,
        normalize_url=normalize_url,
        stable_id=stable_id,
        guess_resource_type_from_url=guess_resource_type_from_url,
        allow_attachment_resource_upsert=allow_attachment_resource_upsert,
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
        normalized_record, parent_request = _normalize_resource_record(
            course_id,
            item,
            normalize_url=normalize_url,
            stable_id=stable_id,
        )
        if normalized_record is None:
            continue
        normalized.append(normalized_record)
        if parent_request is not None:
            child_id, parent_id = parent_request
            requested_parent_map[child_id] = parent_id

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
        existing_by_id = _load_resource_map(session, list(requested_parent_map.keys()))
        existing_parent_ids = _load_existing_parent_resource_ids(
            session,
            course_id,
            {parent_id for parent_id in requested_parent_map.values() if parent_id},
        )
        resolved_parent_count, dropped_parent_count = _apply_resource_parent_updates(
            existing_by_id,
            requested_parent_map,
            existing_parent_ids,
        )
        _log_dropped_resource_parents(
            logger,
            course_id=course_id,
            dropped_parent_count=dropped_parent_count,
            resolved_parent_count=resolved_parent_count,
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
    parse_score_metrics: Callable[
        [Any], tuple[float | None, float | None, float | None]
    ],
    parse_datetime: Callable[[Any], datetime | None],
    to_float: Callable[[Any], float | None],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    existing_assignment_ids = _load_existing_assignment_ids(session, course_id)
    for item in grades_data:
        normalized_record = _normalize_grade_record(
            course_id,
            item,
            stable_id=stable_id,
            parse_total_score=parse_total_score,
            parse_score_metrics=parse_score_metrics,
            parse_datetime=parse_datetime,
            to_float=to_float,
            existing_assignment_ids=existing_assignment_ids,
            logger=logger,
        )
        if normalized_record is not None:
            normalized.append(normalized_record)

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
    links_data: list[dict[str, Any]] | None = None,
    normalize_url: Callable[[Any], str | None],
    parse_datetime: Callable[[Any], datetime | None],
    stable_id: Callable[..., str],
    resolve_course_id_by_course_name: Callable[[Session, str], str | None],
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized: list[dict[str, Any]] = []
    for item in announcements_data:
        normalized_record = _normalize_announcement_record(
            item,
            normalize_url=normalize_url,
            parse_datetime=parse_datetime,
            stable_id=stable_id,
        )
        if normalized_record is not None:
            normalized.append(normalized_record)

    _resolve_announcement_course_ids(
        session,
        normalized,
        resolve_course_id_by_course_name=resolve_course_id_by_course_name,
    )
    stats = sync_records(
        session,
        model=Announcement,
        unique_field="announcement_id",
        records=normalized,
        allow_soft_delete=False,
        logger=logger,
    )
    session.flush()
    touched_course_ids = {
        _text(item.get("course_id"))
        for item in normalized
        if _text(item.get("course_id"))
    }
    _sync_announcement_assignment_links(
        session,
        touched_course_ids,
        links_data or [],
        logger=logger,
    )
    _refresh_announcement_course_stats(session, normalized)
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

    now = utc_now_naive()
    row = (
        session.query(CalendarSubscription)
        .filter(CalendarSubscription.feed_url == normalized_feed_url)
        .one_or_none()
    )

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

    row = (
        session.query(CalendarSubscription)
        .filter(CalendarSubscription.feed_url == normalized_feed_url)
        .one_or_none()
    )
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


def _normalize_calendar_event_record(
    feed_url: str,
    item: dict[str, Any],
) -> dict[str, Any] | None:
    uid = _text(item.get("uid"))
    title = _text(item.get("title"))
    start_at = item.get("start_at")
    if not uid or not title or start_at is None:
        return None
    return {
        "feed_url": feed_url,
        "uid": uid,
        "raw_uid": _text(item.get("raw_uid")) or None,
        "title": title,
        "description": item.get("description"),
        "location": item.get("location"),
        "course_id": item.get("course_id"),
        "start_at": start_at,
        "end_at": item.get("end_at"),
        "all_day": bool(item.get("all_day", False)),
    }


def _ensure_calendar_subscription(
    session: Session,
    feed_url: str,
    now: datetime,
) -> None:
    subscription = (
        session.query(CalendarSubscription)
        .filter(CalendarSubscription.feed_url == feed_url)
        .one_or_none()
    )
    if subscription is not None:
        return
    session.add(
        CalendarSubscription(
            feed_url=feed_url,
            is_active=True,
            created_at=now,
            updated_at=now,
            is_deleted=False,
        )
    )


def _load_calendar_event_map(
    session: Session,
    feed_url: str,
) -> dict[str, CalendarEvent]:
    existing = (
        session.query(CalendarEvent).filter(CalendarEvent.feed_url == feed_url).all()
    )
    return {item.uid: item for item in existing}


def _insert_calendar_event(
    session: Session,
    payload: dict[str, Any],
    now: datetime,
) -> None:
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


def _update_calendar_event(
    row: CalendarEvent,
    payload: dict[str, Any],
    now: datetime,
) -> None:
    preserved_done = bool(row.done)
    for key, value in payload.items():
        setattr(row, key, value)
    row.done = preserved_done
    row.is_deleted = False
    row.updated_at = now
    row.last_synced_at = now


def _soft_delete_missing_calendar_events(
    existing_map: dict[str, CalendarEvent],
    incoming_uids: set[str],
    now: datetime,
) -> int:
    deleted = 0
    for uid, row in existing_map.items():
        if uid in incoming_uids or row.is_deleted:
            continue
        row.is_deleted = True
        row.updated_at = now
        row.last_synced_at = now
        deleted += 1
    return deleted


def _sync_calendar_event_rows(
    session: Session,
    existing_map: dict[str, CalendarEvent],
    incoming_map: dict[str, dict[str, Any]],
    now: datetime,
) -> SyncStats:
    stats = empty_sync_stats()
    for uid, payload in incoming_map.items():
        row = existing_map.get(uid)
        if row is None:
            _insert_calendar_event(session, payload, now)
            stats["inserted"] += 1
            continue
        _update_calendar_event(row, payload, now)
        stats["updated"] += 1
    stats["deleted"] = _soft_delete_missing_calendar_events(
        existing_map,
        set(incoming_map),
        now,
    )
    return stats


def _log_calendar_event_sync(
    logger: BlackboardLogger | None,
    *,
    feed_url: str,
    stats: SyncStats,
    incoming_count: int,
) -> None:
    if logger is None:
        return
    logger.info(
        "✅ 日历事件同步完成",
        context={"feed_url": feed_url},
        payload={"stats": dict(stats), "incoming_count": incoming_count},
    )


def sync_calendar_events(
    session: Session,
    feed_url: str,
    events_data: list[dict[str, Any]],
    *,
    logger: BlackboardLogger | None = None,
) -> SyncStats:
    normalized_feed_url = _text(feed_url)
    if not normalized_feed_url:
        return empty_sync_stats()

    normalized = [
        payload
        for item in events_data
        if (payload := _normalize_calendar_event_record(normalized_feed_url, item))
        is not None
    ]
    now = utc_now_naive()
    _ensure_calendar_subscription(session, normalized_feed_url, now)
    existing_map = _load_calendar_event_map(session, normalized_feed_url)
    incoming_map = {row["uid"]: row for row in normalized}
    stats = _sync_calendar_event_rows(session, existing_map, incoming_map, now)
    _log_calendar_event_sync(
        logger,
        feed_url=normalized_feed_url,
        stats=stats,
        incoming_count=len(normalized),
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

    query = session.query(CalendarEvent).filter(
        CalendarEvent.feed_url == normalized_feed_url
    )
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
