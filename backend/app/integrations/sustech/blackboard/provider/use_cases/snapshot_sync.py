from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import re
import traceback
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Collection
from typing import Any, cast
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from app.integrations.sustech.blackboard.api import BlackboardAPIContext
from app.integrations.sustech.blackboard.api.announcements import (
    BlackboardAnnouncementAPI,
)
from app.integrations.sustech.blackboard.api.assignments import BlackboardAssignmentAPI
from app.integrations.sustech.blackboard.api.contents import BlackboardContentAPI
from app.integrations.sustech.blackboard.api.course_client import BlackboardCourseAPI
from app.integrations.sustech.blackboard.api.course_parser import BlackboardCourseParser
from app.integrations.sustech.blackboard.api.dto import (
    AnnouncementDTO,
    AssignmentDTO,
    CourseDTO,
    GradeDTO,
    ResourceDTO,
)
from app.integrations.sustech.blackboard.api.grades import BlackboardGradeAPI
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardCourseResourcesSyncReport,
    BlackboardSnapshotFetchResult,
    BlackboardSnapshotSyncReport,
    BlackboardSyncPayloads,
    ProgressCallback,
)
from app.integrations.sustech.blackboard.data import DatabaseManager
from app.integrations.sustech.blackboard.shared import (
    create_log_session,
    extract_blackboard_ids_from_url,
    split_score_text,
)
from app.integrations.sustech.blackboard.shared.logging import (
    BlackboardLogSession,
    BlackboardLogger,
)
from app.shared_integrations.sustech_auth.cas_client import CASClient

BLACKBOARD_LOGIN_SERVICE_URL = "https://bb.sustech.edu.cn/webapps/login/"
_SYNC_TABLES: tuple[str, ...] = (
    "courses",
    "assignments",
    "resources",
    "grades",
    "announcements",
)


@dataclass(slots=True)
class _SnapshotAPIs:
    course_api: BlackboardCourseAPI
    assignment_api: BlackboardAssignmentAPI
    content_api: BlackboardContentAPI
    grade_api: BlackboardGradeAPI
    announcement_api: BlackboardAnnouncementAPI


@dataclass(slots=True)
class _CourseResourceSelection:
    selected_courses: list[CourseDTO]
    assignments_by_course: dict[str, list[AssignmentDTO]]
    resources_by_course: dict[str, list[ResourceDTO]]
    processed_course_ids: list[str]
    missing_course_ids: list[str]
    failed_course_ids: list[str]


def _emit(progress: ProgressCallback | None, message: str) -> None:
    if progress is not None:
        progress(message)


def _stable_id(prefix: str, *parts: Any) -> str:
    normalized = "|".join(
        str(part).strip() for part in parts if part is not None and str(part).strip()
    )
    digest = hashlib.sha1(
        (normalized or "<empty>").encode("utf-8"), usedforsecurity=False
    ).hexdigest()[:20]
    return f"{prefix}_{digest}"


def _new_stats() -> dict[str, dict[str, int]]:
    return {
        "courses": {"inserted": 0, "updated": 0, "deleted": 0},
        "assignments": {"inserted": 0, "updated": 0, "deleted": 0},
        "resources": {"inserted": 0, "updated": 0, "deleted": 0},
        "grades": {"inserted": 0, "updated": 0, "deleted": 0},
        "announcements": {"inserted": 0, "updated": 0, "deleted": 0},
    }


def _merge_stats(target: dict[str, int], delta: dict[str, int]) -> None:
    for key in ("inserted", "updated", "deleted"):
        target[key] += int(delta.get(key, 0))


def _value(item: Any, *names: str) -> Any:
    if isinstance(item, dict):
        for name in names:
            value = item.get(name)
            if value is not None:
                return value
        return None

    for name in names:
        if hasattr(item, name):
            value = getattr(item, name)
            if value is not None:
                return value
    return None


def _text_value(item: Any, *names: str) -> str:
    return str(_value(item, *names) or "").strip()


def _jsonable_item(item: Any) -> Any:
    if hasattr(item, "to_dict"):
        return item.to_dict()
    return item


def _attachment_payloads(attachments: Any) -> list[dict[str, Any]]:
    if not isinstance(attachments, list):
        return []

    payloads: list[dict[str, Any]] = []
    for attachment in attachments:
        title = _text_value(attachment, "title", "name")
        url = _text_value(attachment, "url")
        if not title and not url:
            continue
        payloads.append(
            {
                "resource_id": _text_value(attachment, "resource_id") or None,
                "title": title,
                "name": title,
                "url": url or None,
                "type": _value(attachment, "type") or "file",
                "size": _value(attachment, "size"),
            }
        )
    return payloads


def _normalize_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


_RELATION_TITLE_STOP_TOKENS: set[str] = {
    "assignment",
    "assigment",
    "homework",
    "project",
    "lab",
    "released",
    "release",
    "submission",
    "submitting",
    "submit",
    "instructions",
    "instruction",
    "extended",
    "extension",
    "deadline",
    "ddl",
    "form",
    "information",
    "notice",
    "reminder",
    "exam",
    "midterm",
    "final",
    "course",
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "your",
    "you",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
    "been",
    "into",
    "onto",
    "here",
}


def _relation_title_tokens(value: Any) -> set[str]:
    normalized = _normalize_name(value)
    if not normalized:
        return set()
    return {
        token
        for token in re.split(r"[^0-9a-zA-Z\u4e00-\u9fff]+", normalized)
        if (len(token) >= 2 or token.isdigit())
        and token not in _RELATION_TITLE_STOP_TOKENS
    }


def _normalize_code(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().upper()


def _build_course_payloads(
    courses: list[Any],
) -> tuple[list[dict[str, Any]], set[str]]:
    course_payload: list[dict[str, Any]] = []
    valid_course_ids: set[str] = set()
    for course in courses:
        course_id = _text_value(course, "course_id", "id")
        if not course_id:
            continue

        valid_course_ids.add(course_id)
        is_active = _value(course, "is_active")
        course_payload.append(
            {
                "course_id": course_id,
                "name": _text_value(course, "name") or course_id,
                "code": _value(course, "code"),
                "instructor": _value(course, "instructor"),
                "term": _value(course, "term"),
                "url": _value(course, "url"),
                "total_grade": _value(course, "total_grade"),
                "listed_grade": _value(course, "listed_grade"),
                "is_active": is_active if is_active is not None else True,
            }
        )
    return course_payload, valid_course_ids


def _build_assignment_payloads(
    assignments_by_course: dict[str, list[Any]],
) -> dict[str, list[dict[str, Any]]]:
    def _has_value(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, list):
            return bool(value)
        return True

    def _assignment_row_score(
        row: dict[str, Any],
    ) -> tuple[int, int, int, int, int, int, str]:
        assignment_id = str(row.get("assignment_id") or "").strip()
        url = str(row.get("url") or "").strip().lower()
        source_page = str(row.get("source_page") or "").strip().lower()
        return (
            1 if _has_value(row.get("description_html")) else 0,
            1 if _has_value(row.get("description")) else 0,
            1 if _has_value(row.get("attachments")) else 0,
            1 if _has_value(row.get("submission_status")) else 0,
            1 if _has_value(row.get("due_date")) else 0,
            1 if "/webapps/assignment/" in url or "content_id=" in source_page else 0,
            assignment_id,
        )

    def _merge_attachment_payload_rows(
        *attachment_groups: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen_keys: set[tuple[str, str, str]] = set()
        for group in attachment_groups:
            for attachment in group:
                if not isinstance(attachment, dict):
                    continue
                title = str(
                    attachment.get("title") or attachment.get("name") or ""
                ).strip()
                url = str(attachment.get("url") or "").strip()
                resource_id = str(attachment.get("resource_id") or "").strip()
                dedupe_key = (resource_id, url, title)
                if dedupe_key == ("", "", "") or dedupe_key in seen_keys:
                    continue
                seen_keys.add(dedupe_key)
                merged.append(
                    {
                        **attachment,
                        "title": attachment.get("title") or title,
                        "name": attachment.get("name") or title,
                        "url": url or None,
                        "resource_id": resource_id or None,
                    }
                )
        return merged

    def _merge_relation_tokens(*values: Any) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for value in values:
            if not isinstance(value, list):
                continue
            for item in value:
                token = str(item or "").strip()
                if not token or token in seen:
                    continue
                seen.add(token)
                merged.append(token)
        return merged

    assignment_payloads: dict[str, list[dict[str, Any]]] = {}
    for course_id, items in assignments_by_course.items():
        payload: list[dict[str, Any]] = []
        for item in items:
            title = _text_value(item, "title")
            due_date = _text_value(item, "due_date")
            url = _text_value(item, "url")
            assignment_id = _text_value(item, "assignment_id")
            if not assignment_id:
                assignment_id = _stable_id("asg", course_id, url, title, due_date)
            score, total_score = split_score_text(_value(item, "score"))
            content_id_candidates, pk1_candidates = _extract_assignment_relation_tokens(
                item
            )
            payload.append(
                {
                    "assignment_id": assignment_id,
                    "title": title,
                    "due_date": due_date or None,
                    "status": _value(item, "status"),
                    "score": score,
                    "total_score": _value(item, "total_score") or total_score,
                    "url": url or None,
                    "summary": _value(item, "summary"),
                    "description": _value(item, "description"),
                    "description_html": _value(item, "description_html"),
                    "attachments": _attachment_payloads(_value(item, "attachments")),
                    "source_page": _value(item, "source_page"),
                    "submission_status": _value(item, "submission_status"),
                    "content_id_candidates": content_id_candidates,
                    "pk1_candidates": pk1_candidates,
                }
            )

        merged_by_title: dict[str, dict[str, Any]] = {}
        for row in payload:
            title_key = str(row.get("title") or "").strip()
            if not title_key:
                continue
            existing = merged_by_title.get(title_key)
            if existing is None:
                merged_by_title[title_key] = dict(row)
                continue

            preferred = (
                row
                if _assignment_row_score(row) > _assignment_row_score(existing)
                else existing
            )
            fallback = existing if preferred is row else row
            merged_row = dict(preferred)
            for field_name in (
                "due_date",
                "status",
                "score",
                "total_score",
                "url",
                "summary",
                "description",
                "description_html",
                "source_page",
                "submission_status",
            ):
                if not _has_value(merged_row.get(field_name)) and _has_value(
                    fallback.get(field_name)
                ):
                    merged_row[field_name] = fallback.get(field_name)

            merged_row["attachments"] = _merge_attachment_payload_rows(
                preferred.get("attachments", []),
                fallback.get("attachments", []),
            )
            merged_row["content_id_candidates"] = _merge_relation_tokens(
                preferred.get("content_id_candidates"),
                fallback.get("content_id_candidates"),
            )
            merged_row["pk1_candidates"] = _merge_relation_tokens(
                preferred.get("pk1_candidates"),
                fallback.get("pk1_candidates"),
            )
            merged_by_title[title_key] = merged_row

        assignment_payloads[course_id] = list(merged_by_title.values())
    return assignment_payloads


def _extract_assignment_relation_tokens(item: Any) -> tuple[list[str], list[str]]:
    content_ids: set[str] = set()
    pk1_ids: set[str] = set()

    for raw_value in (
        _text_value(item, "url"),
        _text_value(item, "source_page"),
    ):
        if not raw_value:
            continue
        ids = extract_blackboard_ids_from_url(
            raw_value,
            id_types=("content_id", "pk1"),
        )
        content_id = str(ids.get("content_id") or "").strip()
        pk1 = str(ids.get("pk1") or "").strip()
        if content_id:
            content_ids.add(content_id)
        if pk1:
            pk1_ids.add(pk1)

    return sorted(content_ids), sorted(pk1_ids)


def _collect_assignment_ids_by_course(
    assignment_payloads: dict[str, list[dict[str, Any]]],
) -> dict[str, set[str]]:
    return {
        course_id: {
            str(row.get("assignment_id") or "").strip()
            for row in rows
            if str(row.get("assignment_id") or "").strip()
        }
        for course_id, rows in assignment_payloads.items()
    }


def _build_resource_payloads(
    resources_by_course: dict[str, list[Any]],
) -> dict[str, list[dict[str, Any]]]:
    resource_payloads: dict[str, list[dict[str, Any]]] = {}
    for course_id, items in resources_by_course.items():
        payload: list[dict[str, Any]] = []
        for item in items:
            title = _text_value(item, "title", "name")
            url = _text_value(item, "url", "download_url")
            resource_id = _text_value(item, "resource_id")
            if not resource_id:
                resource_id = _stable_id("res", course_id, url, title)
            payload.append(
                {
                    "resource_id": resource_id,
                    "title": title,
                    "type": _value(item, "type"),
                    "size": _value(item, "size"),
                    "url": url or None,
                    "parent_id": _value(item, "parent_id"),
                    "source_page": _value(item, "source_page"),
                    "assignment_id": _value(item, "assignment_id"),
                    "local_path": _value(item, "local_path"),
                }
            )
        resource_payloads[course_id] = payload
    return resource_payloads


def _merge_assignment_attachment_resources(
    resource_payloads: dict[str, list[dict[str, Any]]],
    assignment_payloads: dict[str, list[dict[str, Any]]],
) -> None:
    for course_id, assignments in assignment_payloads.items():
        resource_payloads.setdefault(course_id, [])
        existing_keys = {
            (
                str(item.get("resource_id") or "").strip(),
                str(item.get("url") or "").strip(),
            )
            for item in resource_payloads[course_id]
        }

        for assignment in assignments:
            attachments = assignment.get("attachments", [])
            if not isinstance(attachments, list):
                continue

            for attachment in attachments:
                if not isinstance(attachment, dict):
                    continue

                title = str(
                    attachment.get("title") or attachment.get("name") or ""
                ).strip()
                url = str(attachment.get("url") or "").strip()
                resource_id = str(attachment.get("resource_id") or "").strip()
                if not resource_id:
                    resource_id = _stable_id("res", course_id, url, title)

                dedupe_key = (resource_id, url)
                if dedupe_key in existing_keys:
                    continue
                existing_keys.add(dedupe_key)

                resource_payloads[course_id].append(
                    {
                        "resource_id": resource_id,
                        "title": title,
                        "type": attachment.get("type", "file"),
                        "size": attachment.get("size"),
                        "url": url or None,
                        "parent_id": None,
                        "source_page": assignment.get("source_page"),
                        "assignment_id": assignment.get("assignment_id"),
                    }
                )


def _build_assignment_title_indexes(
    assignment_payloads: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, str]]:
    indexes: dict[str, dict[str, str]] = {}
    for course_id, assignments in assignment_payloads.items():
        title_index: dict[str, str] = {}
        for assignment in assignments:
            title = str(assignment.get("title") or "")
            assignment_id = str(assignment.get("assignment_id") or "")
            if title and assignment_id:
                title_index.setdefault(title, assignment_id)
        indexes[course_id] = title_index
    return indexes


def _resolve_grade_assignment_match(
    course_id: str,
    item_name: str,
    item: Any,
    assignment_title_indexes: dict[str, dict[str, str]],
) -> tuple[str | None, str]:
    assignment_id_match = _text_value(item, "assignment_id") or None
    if assignment_id_match:
        return assignment_id_match, "grade.assignment_id"
    return assignment_title_indexes.get(course_id, {}).get(
        item_name
    ), "assignment.title"


def _build_grade_payloads(
    grades_by_course: dict[str, list[Any]],
    assignment_payloads: dict[str, list[dict[str, Any]]],
    valid_assignment_ids_by_course: dict[str, set[str]],
    logger: BlackboardLogger | None = None,
) -> tuple[dict[str, list[dict[str, Any]]], int]:
    invalid_grade_assignment_refs = 0
    assignment_title_indexes = _build_assignment_title_indexes(assignment_payloads)
    grade_payloads: dict[str, list[dict[str, Any]]] = {}

    for course_id, items in grades_by_course.items():
        payload: list[dict[str, Any]] = []
        valid_assignment_ids = valid_assignment_ids_by_course.get(course_id, set())
        for item in items:
            item_name = _text_value(item, "item_name", "name")
            due_date = _text_value(item, "due_date")
            graded_date = _text_value(item, "graded_date")
            category = _text_value(item, "category")
            grade_id = _text_value(item, "grade_id")
            if not grade_id:
                grade_id = _stable_id(
                    "grd", course_id, item_name, due_date or graded_date, category
                )
            score, total_score = split_score_text(_value(item, "score"))

            assignment_id_match, assignment_match_source = (
                _resolve_grade_assignment_match(
                    course_id,
                    item_name,
                    item,
                    assignment_title_indexes,
                )
            )

            if assignment_id_match and assignment_id_match not in valid_assignment_ids:
                invalid_grade_assignment_refs += 1
                if logger is not None:
                    logger.warning(
                        "⚠ 检测到成绩引用不存在的 assignment_id",
                        context={"course_id": course_id},
                        payload={
                            "grade_id": grade_id or None,
                            "item_name": item_name,
                            "assignment_id": assignment_id_match,
                            "match_source": assignment_match_source,
                            "known_assignment_count": len(valid_assignment_ids),
                            "source_url": _value(item, "source_url"),
                        },
                    )

            payload.append(
                {
                    "grade_id": grade_id,
                    "item_name": item_name,
                    "score": score,
                    "total_score": _value(item, "total_score") or total_score,
                    "weight": _value(item, "weight"),
                    "category": category or None,
                    "grade_type": _value(item, "grade_type"),
                    "status": _value(item, "status"),
                    "due_date": due_date or None,
                    "graded_date": graded_date or None,
                    "source_url": _value(item, "source_url"),
                    "assignment_id": assignment_id_match,
                }
            )
        grade_payloads[course_id] = payload

    return grade_payloads, invalid_grade_assignment_refs


def _build_course_match_candidates(
    courses: list[Any],
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    course_name_candidates: dict[str, set[str]] = {}
    course_code_candidates: dict[str, set[str]] = {}

    for course in courses:
        course_id = _text_value(course, "course_id", "id")
        if not course_id:
            continue

        normalized_name = _normalize_name(_text_value(course, "name"))
        if normalized_name:
            course_name_candidates.setdefault(normalized_name, set()).add(course_id)

        explicit_code = _normalize_code(_value(course, "code"))
        if explicit_code:
            course_code_candidates.setdefault(explicit_code, set()).add(course_id)

    return course_name_candidates, course_code_candidates


def _resolve_announcement_course_id(
    item: Any,
    course_name_candidates: dict[str, set[str]],
    course_code_candidates: dict[str, set[str]],
    valid_course_ids: set[str],
) -> str | None:
    course_id = _text_value(item, "course_id") or None
    if not course_id:
        normalized_ann_name = _normalize_name(_text_value(item, "course_name"))
        if normalized_ann_name:
            exact_matches = course_name_candidates.get(normalized_ann_name, set())
            if len(exact_matches) == 1:
                course_id = next(iter(exact_matches))
            else:
                fuzzy_matches = {
                    cid
                    for name, course_ids in course_name_candidates.items()
                    if normalized_ann_name in name or name in normalized_ann_name
                    for cid in course_ids
                }
                if len(fuzzy_matches) == 1:
                    course_id = next(iter(fuzzy_matches))

    if not course_id:
        course_code = _normalize_code(_value(item, "course_code"))
        if course_code:
            code_matches = course_code_candidates.get(course_code, set())
            if len(code_matches) == 1:
                course_id = next(iter(code_matches))

    if course_id and course_id not in valid_course_ids:
        return None
    return course_id


def _build_announcements_payload(
    announcements: list[Any],
    courses: list[Any],
    valid_course_ids: set[str],
) -> list[dict[str, Any]]:
    course_name_candidates, course_code_candidates = _build_course_match_candidates(
        courses
    )
    announcements_payload: list[dict[str, Any]] = []

    for item in announcements:
        title = _text_value(item, "title")
        posted_at_text = _text_value(item, "publish_time", "posted_date")
        url = _text_value(item, "url")
        course_id = _resolve_announcement_course_id(
            item,
            course_name_candidates,
            course_code_candidates,
            valid_course_ids,
        )

        announcement_id = _text_value(item, "announcement_id")
        if not announcement_id:
            fallback = json.dumps(
                _jsonable_item(item), ensure_ascii=False, sort_keys=True, default=str
            )
            announcement_id = _stable_id(
                "ann", course_id, title, posted_at_text, url, fallback
            )

        announcements_payload.append(
            {
                "announcement_id": announcement_id,
                "course_id": course_id,
                "course_name": _value(item, "course_name"),
                "title": title,
                "content": _value(item, "content", "detail"),
                "content_html": _value(item, "content_html", "detail_html"),
                "author": _value(item, "author"),
                "publish_time": posted_at_text or None,
                "url": url or None,
                "source_page": _value(item, "source_page"),
                "linked_content_candidates": _value(item, "linked_content_candidates"),
            }
        )

    return announcements_payload


def _coerce_relation_token_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        token = str(item or "").strip()
        if not token or token in seen:
            continue
        seen.add(token)
        result.append(token)
    return result


def _normalize_path_tail(path_text: Any) -> str:
    raw = str(path_text or "").strip()
    if not raw:
        return ""
    segments = [segment.strip() for segment in raw.split("/") if segment.strip()]
    if not segments:
        return ""
    return _normalize_name(segments[-1])


def _build_assignment_relation_indexes(
    assignment_payloads: dict[str, list[dict[str, Any]]],
) -> tuple[
    dict[str, dict[str, list[dict[str, Any]]]],
    dict[str, dict[str, list[dict[str, Any]]]],
    dict[str, dict[str, list[dict[str, Any]]]],
    dict[str, dict[str, list[dict[str, Any]]]],
]:
    title_index_by_course: dict[str, dict[str, list[dict[str, Any]]]] = {}
    content_index_by_course: dict[str, dict[str, list[dict[str, Any]]]] = {}
    pk1_index_by_course: dict[str, dict[str, list[dict[str, Any]]]] = {}
    title_token_index_by_course: dict[str, dict[str, list[dict[str, Any]]]] = {}

    def _assignment_row_score(row: dict[str, Any]) -> tuple[int, int, int, int, int]:
        assignment_id = str(row.get("assignment_id") or "").strip()
        url = str(row.get("url") or "").strip().lower()
        source_page = str(row.get("source_page") or "").strip().lower()
        content_candidates = len(
            _coerce_relation_token_list(row.get("content_id_candidates"))
        )
        pk1_candidates = len(_coerce_relation_token_list(row.get("pk1_candidates")))
        return (
            1 if content_candidates > 0 else 0,
            1 if pk1_candidates > 0 else 0,
            1 if "/webapps/assignment/" in url else 0,
            1 if "content_id=" in url or "content_id=" in source_page else 0,
            1 if assignment_id and not assignment_id.startswith("asg_") else 0,
        )

    for course_id, rows in assignment_payloads.items():
        title_index: dict[str, list[dict[str, Any]]] = {}
        content_index: dict[str, list[dict[str, Any]]] = {}
        pk1_index: dict[str, list[dict[str, Any]]] = {}
        title_token_index: dict[str, list[dict[str, Any]]] = {}
        best_row_by_title: dict[str, dict[str, Any]] = {}
        for row in rows:
            normalized_title = _normalize_name(row.get("title"))
            if normalized_title:
                best_existing = best_row_by_title.get(normalized_title)
                if best_existing is None or _assignment_row_score(
                    row
                ) > _assignment_row_score(best_existing):
                    best_row_by_title[normalized_title] = row

            for content_id in _coerce_relation_token_list(
                row.get("content_id_candidates")
            ):
                content_index.setdefault(content_id, []).append(row)

            for pk1 in _coerce_relation_token_list(row.get("pk1_candidates")):
                pk1_index.setdefault(pk1, []).append(row)

        for normalized_title, best_row in best_row_by_title.items():
            title_index.setdefault(normalized_title, []).append(best_row)
            for token in _relation_title_tokens(best_row.get("title")):
                title_token_index.setdefault(token, []).append(best_row)

        title_index_by_course[course_id] = title_index
        content_index_by_course[course_id] = content_index
        pk1_index_by_course[course_id] = pk1_index
        title_token_index_by_course[course_id] = title_token_index

    return (
        title_index_by_course,
        content_index_by_course,
        pk1_index_by_course,
        title_token_index_by_course,
    )


def _serialize_relation_evidence(value: dict[str, Any]) -> dict[str, Any]:
    return json.loads(
        json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)
    )


def _try_single_key_match(
    candidate: dict[str, Any],
    key: str,
    index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    candidate_course_id: str,
) -> dict[str, Any] | None:
    """Try matching by a single ID key lookup.

    Returns matched_assignment dict if exactly one match, or None.
    """
    id_val = str(candidate.get(key) or "").strip()
    if not id_val:
        return None
    matches = index_by_course.get(candidate_course_id, {}).get(id_val, [])
    return matches[0] if len(matches) == 1 else None


def _try_path_tail_title_match(
    candidate: dict[str, Any],
    candidate_course_id: str,
    title_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
) -> tuple[dict[str, Any] | None, str, str]:
    """Try matching by path tail against title index.

    Returns (matched_assignment_or_none, link_source, confidence).
    """
    path_tail = _normalize_path_tail(candidate.get("path_text"))
    if not path_tail:
        return None, "", ""
    title_matches = title_index_by_course.get(candidate_course_id, {}).get(
        path_tail, []
    )
    if len(title_matches) != 1:
        return None, "", ""
    is_launch = bool(candidate.get("is_launch_link"))
    link_source = "ann_id_launch_link" if is_launch else "title_due_date_match"
    confidence = "high" if is_launch else "medium"
    return title_matches[0], link_source, confidence


def _try_token_path_match(
    candidate: dict[str, Any],
    candidate_course_id: str,
    title_token_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
) -> dict[str, Any] | None:
    """Try matching candidate by tokenizing its path tail.

    Returns matched_assignment dict or None.
    """
    path_tail = _normalize_path_tail(candidate.get("path_text"))
    if not path_tail:
        return None
    token_matches: dict[str, dict[str, Any]] = {}
    for token in _relation_title_tokens(path_tail):
        for token_match in title_token_index_by_course.get(candidate_course_id, {}).get(
            token, []
        ):
            assignment_id_key = str(token_match.get("assignment_id") or "").strip()
            if assignment_id_key:
                token_matches[assignment_id_key] = token_match
    if len(token_matches) == 1:
        return next(iter(token_matches.values()))
    return None


def _try_match_candidate_links(
    linked_candidates: list[dict[str, Any]],
    course_id: str,
    announcement_id: str,
    content_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    pk1_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    title_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    title_token_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    seen_assignment_ids: set[str],
) -> tuple[bool, list[dict[str, Any]]]:
    """Match announcement linked-content candidates to known assignments.

    Returns (matched_any, link_payloads).
    """
    matched_any = False
    link_payloads: list[dict[str, Any]] = []
    for candidate in linked_candidates:
        if not isinstance(candidate, dict):
            continue
        candidate_course_id = str(candidate.get("course_id") or course_id).strip()
        if not candidate_course_id:
            continue

        matched_assignment: dict[str, Any] | None = None
        link_source = ""
        confidence = "high"
        # Strategy: content_id match
        matched_assignment = _try_single_key_match(
            candidate, "content_id", content_index_by_course, candidate_course_id
        )
        if matched_assignment is not None:
            link_source = "content_id_match"

        # Strategy: pk1 match
        if matched_assignment is None:
            matched_assignment = _try_single_key_match(
                candidate, "pk1", pk1_index_by_course, candidate_course_id
            )
            if matched_assignment is not None:
                link_source = "content_id_match"

        # Strategy: title path tail match
        if matched_assignment is None:
            matched_assignment, link_source, confidence = _try_path_tail_title_match(
                candidate, candidate_course_id, title_index_by_course
            )

        # Strategy: title token match on path tail
        if matched_assignment is None:
            matched_assignment = _try_token_path_match(
                candidate, candidate_course_id, title_token_index_by_course
            )
            if matched_assignment is not None:
                link_source = "title_token_match"
                confidence = "medium"

        if matched_assignment is None:
            continue

        assignment_id = str(matched_assignment.get("assignment_id") or "").strip()
        if not assignment_id or assignment_id in seen_assignment_ids:
            continue

        seen_assignment_ids.add(assignment_id)
        matched_any = True
        link_payloads.append(
            {
                "announcement_id": announcement_id,
                "assignment_id": assignment_id,
                "course_id": candidate_course_id,
                "link_source": link_source or "ann_id_launch_link",
                "confidence": confidence,
                "evidence_json": _serialize_relation_evidence(
                    {
                        "candidate": candidate,
                        "matched_assignment": {
                            "assignment_id": assignment_id,
                            "title": matched_assignment.get("title"),
                            "url": matched_assignment.get("url"),
                            "source_page": matched_assignment.get("source_page"),
                            "content_id_candidates": matched_assignment.get(
                                "content_id_candidates"
                            ),
                            "pk1_candidates": matched_assignment.get("pk1_candidates"),
                        },
                    }
                ),
            }
        )
    return matched_any, link_payloads


def _try_exact_title_match(
    course_id: str,
    normalized_announcement_title: str,
    announcement_id: str,
    title_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    row: dict[str, Any],
) -> dict[str, Any] | None:
    """Try matching by exact announcement title match.

    Returns a link_payload dict if matched, or None.
    """
    title_matches = title_index_by_course.get(course_id, {}).get(
        normalized_announcement_title, []
    )
    if len(title_matches) != 1:
        return None
    matched_assignment = title_matches[0]
    assignment_id = str(matched_assignment.get("assignment_id") or "").strip()
    if not assignment_id:
        return None
    row["relation_type"] = "assignment_notice"
    row["relation_confidence"] = "medium"
    return {
        "announcement_id": announcement_id,
        "assignment_id": assignment_id,
        "course_id": course_id,
        "link_source": "announcement_title_exact_match",
        "confidence": "medium",
        "evidence_json": _serialize_relation_evidence(
            {
                "announcement_title": row.get("title"),
                "matched_assignment": {
                    "assignment_id": assignment_id,
                    "title": matched_assignment.get("title"),
                    "url": matched_assignment.get("url"),
                    "source_page": matched_assignment.get("source_page"),
                },
            }
        ),
    }


def _try_contains_title_match(
    course_id: str,
    normalized_announcement_title: str,
    announcement_id: str,
    title_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    row: dict[str, Any],
) -> dict[str, Any] | None:
    """Try matching by substring/contains announcement title match.

    Returns a link_payload dict if matched, or None.
    """
    contains_matches: dict[str, dict[str, Any]] = {}
    for assignment_title, title_rows in title_index_by_course.get(
        course_id, {}
    ).items():
        if not assignment_title:
            continue
        if (
            assignment_title in normalized_announcement_title
            or normalized_announcement_title in assignment_title
        ):
            for title_row in title_rows:
                assignment_id = str(title_row.get("assignment_id") or "").strip()
                if assignment_id:
                    contains_matches[assignment_id] = title_row
    if len(contains_matches) != 1:
        return None
    matched_assignment = next(iter(contains_matches.values()))
    assignment_id = str(matched_assignment.get("assignment_id") or "").strip()
    row["relation_type"] = "assignment_notice"
    row["relation_confidence"] = "medium"
    return {
        "announcement_id": announcement_id,
        "assignment_id": assignment_id,
        "course_id": course_id,
        "link_source": "announcement_title_contains_match",
        "confidence": "medium",
        "evidence_json": _serialize_relation_evidence(
            {
                "announcement_title": row.get("title"),
                "matched_assignment": {
                    "assignment_id": assignment_id,
                    "title": matched_assignment.get("title"),
                    "url": matched_assignment.get("url"),
                    "source_page": matched_assignment.get("source_page"),
                },
            }
        ),
    }


def _try_token_title_match(
    course_id: str,
    announcement_title_tokens: Collection[str],
    announcement_id: str,
    title_token_index_by_course: dict[str, dict[str, list[dict[str, Any]]]],
    row: dict[str, Any],
) -> dict[str, Any] | None:
    """Try matching by token-based announcement title matching.

    Returns a link_payload dict if matched, or None.
    """
    token_scores: dict[str, dict[str, Any]] = {}
    for token in announcement_title_tokens:
        for token_match in title_token_index_by_course.get(course_id, {}).get(
            token, []
        ):
            assignment_id = str(token_match.get("assignment_id") or "").strip()
            if not assignment_id:
                continue
            bucket: dict[str, Any] = token_scores.setdefault(
                assignment_id,
                {"row": token_match, "score": 0, "tokens": set()},
            )
            bucket["score"] = int(bucket["score"]) + 1
            cast_tokens = bucket.get("tokens")
            if isinstance(cast_tokens, set):
                cast_tokens.add(token)
    ranked = sorted(
        token_scores.items(),
        key=lambda item: (int(item[1]["score"]), len(item[1]["tokens"])),
        reverse=True,
    )
    if not ranked:
        return None
    best_assignment_id, best_payload = ranked[0]
    best_score = int(best_payload["score"])
    second_score = int(ranked[1][1]["score"]) if len(ranked) > 1 else -1
    if not (
        best_score > second_score
        and (best_score >= 2 or len(announcement_title_tokens) == 1)
    ):
        return None
    matched_assignment = cast(dict[str, Any], best_payload["row"])
    row["relation_type"] = "assignment_notice"
    row["relation_confidence"] = "medium"
    return {
        "announcement_id": announcement_id,
        "assignment_id": best_assignment_id,
        "course_id": course_id,
        "link_source": "announcement_title_token_match",
        "confidence": "medium",
        "evidence_json": _serialize_relation_evidence(
            {
                "announcement_title": row.get("title"),
                "matched_tokens": sorted(best_payload["tokens"]),
                "matched_assignment": {
                    "assignment_id": best_assignment_id,
                    "title": matched_assignment.get("title"),
                    "url": matched_assignment.get("url"),
                    "source_page": matched_assignment.get("source_page"),
                },
            }
        ),
    }


def _classify_announcements_and_build_links(
    announcements_payload: list[dict[str, Any]],
    assignment_payloads: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    (
        title_index_by_course,
        content_index_by_course,
        pk1_index_by_course,
        title_token_index_by_course,
    ) = _build_assignment_relation_indexes(assignment_payloads)
    link_payloads: list[dict[str, Any]] = []

    for row in announcements_payload:
        course_id = str(row.get("course_id") or "").strip()
        announcement_id = str(row.get("announcement_id") or "").strip()
        normalized_announcement_title = _normalize_name(row.get("title"))
        announcement_title_tokens = _relation_title_tokens(row.get("title"))
        raw_candidates = row.get("linked_content_candidates")
        linked_candidates = raw_candidates if isinstance(raw_candidates, list) else []

        seen_assignment_ids: set[str] = set()

        matched_any, candidate_payloads = _try_match_candidate_links(
            linked_candidates,
            course_id,
            announcement_id,
            content_index_by_course,
            pk1_index_by_course,
            title_index_by_course,
            title_token_index_by_course,
            seen_assignment_ids,
        )
        if matched_any:
            row["relation_type"] = "assignment_notice"
            row["relation_confidence"] = "high"
            link_payloads.extend(candidate_payloads)

        if matched_any:
            continue

        if course_id:
            link_payload = _try_exact_title_match(
                course_id,
                normalized_announcement_title,
                announcement_id,
                title_index_by_course,
                row,
            )
            if link_payload is not None:
                link_payloads.append(link_payload)
                continue

        if course_id and normalized_announcement_title:
            link_payload = _try_contains_title_match(
                course_id,
                normalized_announcement_title,
                announcement_id,
                title_index_by_course,
                row,
            )
            if link_payload is not None:
                link_payloads.append(link_payload)
                continue

        if course_id and announcement_title_tokens:
            link_payload = _try_token_title_match(
                course_id,
                announcement_title_tokens,
                announcement_id,
                title_token_index_by_course,
                row,
            )
            if link_payload is not None:
                link_payloads.append(link_payload)
                continue

        if linked_candidates:
            row["relation_type"] = "content_linked_announcement"
            row["relation_confidence"] = "high"
        elif course_id:
            row["relation_type"] = "plain_course_announcement"
            row["relation_confidence"] = "none"
        else:
            row["relation_type"] = "unknown"
            row["relation_confidence"] = "none"

    return link_payloads


def _extract_linked_content_candidates_from_stored_html(
    content_html: Any,
    *,
    page_url: str,
) -> list[dict[str, Any]]:
    html = str(content_html or "").strip()
    if not html:
        return []

    soup = BeautifulSoup(html, "html.parser")
    candidates: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for link in soup.select("a[href]"):
        href = str(link.get("href") or "").strip()
        if not href:
            continue
        absolute_url = urljoin(page_url, href)
        ids = extract_blackboard_ids_from_url(
            absolute_url,
            id_types=("ann_id", "course_id", "content_id", "pk1", "xid", "rid", "id"),
        )
        is_launch_link = "launchlink.jsp" in absolute_url.lower()
        if not (
            is_launch_link
            or ids.get("ann_id")
            or ids.get("content_id")
            or ids.get("pk1")
            or ids.get("xid")
            or ids.get("rid")
        ):
            continue

        path_text = str(link.get_text(" ", strip=True) or "").strip() or None
        key = "|".join(
            [
                absolute_url,
                str(ids.get("ann_id") or ""),
                str(ids.get("content_id") or ""),
                str(path_text or ""),
            ]
        )
        if key in seen_keys:
            continue
        seen_keys.add(key)
        candidates.append(
            {
                "url": absolute_url,
                "path_text": path_text,
                "ann_id": ids.get("ann_id"),
                "course_id": ids.get("course_id"),
                "content_id": ids.get("content_id"),
                "pk1": ids.get("pk1"),
                "xid": ids.get("xid"),
                "rid": ids.get("rid"),
                "source": ids.get("source"),
                "is_launch_link": is_launch_link,
            }
        )
    return candidates


def rebuild_announcement_assignment_links(
    db_manager: DatabaseManager,
    *,
    course_id: str | None = None,
    logger: BlackboardLogger | None = None,
) -> dict[str, Any]:
    from app.integrations.sustech.blackboard.data.models import (
        Announcement,
        Assignment,
        Course,
    )

    with db_manager._session_scope() as session:
        course_query = session.query(Course).filter(Course.is_deleted.is_(False))
        assignment_query = session.query(Assignment).filter(
            Assignment.is_deleted.is_(False)
        )
        announcement_query = session.query(Announcement).filter(
            Announcement.is_deleted.is_(False)
        )
        if course_id:
            course_query = course_query.filter(Course.course_id == course_id)
            assignment_query = assignment_query.filter(
                Assignment.course_id == course_id
            )
            announcement_query = announcement_query.filter(
                Announcement.course_id == course_id
            )

        courses = course_query.order_by(Course.name.asc()).all()
        assignments = assignment_query.order_by(Assignment.title.asc()).all()
        announcements = announcement_query.order_by(Announcement.posted_at.desc()).all()

    assignments_by_course: dict[str, list[Any]] = {}
    for assignment in assignments:
        assignments_by_course.setdefault(str(assignment.course_id), []).append(
            assignment
        )

    assignment_payloads = _build_assignment_payloads(assignments_by_course)
    announcement_input = [
        {
            "announcement_id": announcement.announcement_id,
            "course_id": announcement.course_id,
            "course_name": announcement.course_name,
            "title": announcement.title,
            "content": announcement.content,
            "content_html": announcement.content_html,
            "author": announcement.author,
            "publish_time": announcement.posted_at.isoformat()
            if announcement.posted_at is not None
            else None,
            "url": announcement.url,
            "source_page": announcement.source_page,
            "linked_content_candidates": _extract_linked_content_candidates_from_stored_html(
                announcement.content_html,
                page_url=str(
                    announcement.url
                    or announcement.source_page
                    or "https://bb.sustech.edu.cn/"
                ),
            ),
        }
        for announcement in announcements
    ]
    valid_course_ids = {
        str(course.course_id).strip()
        for course in courses
        if str(course.course_id).strip()
    }
    announcements_payload = _build_announcements_payload(
        announcement_input,
        list(courses),
        valid_course_ids,
    )
    link_payloads = _classify_announcements_and_build_links(
        announcements_payload,
        assignment_payloads,
    )
    sync_stats = db_manager.sync_announcements(
        announcements_payload,
        links_data=link_payloads,
        logger=logger,
    )
    return {
        "course_id": course_id,
        "courses": len(courses),
        "assignments": sum(len(rows) for rows in assignment_payloads.values()),
        "announcements": len(announcements_payload),
        "links": len(link_payloads),
        "sync_stats": sync_stats,
    }


def _log_sync_payload_summary(
    course_payload: list[dict[str, Any]],
    assignment_payloads: dict[str, list[dict[str, Any]]],
    resource_payloads: dict[str, list[dict[str, Any]]],
    grade_payloads: dict[str, list[dict[str, Any]]],
    announcements_payload: list[dict[str, Any]],
    invalid_grade_assignment_refs: int,
    logger: BlackboardLogger | None = None,
) -> None:
    if logger is None:
        return

    logger.info(
        "✅ Blackboard sync payloads 构建完成",
        payload={
            "courses": len(course_payload),
            "assignments": sum(len(rows) for rows in assignment_payloads.values()),
            "resources": sum(len(rows) for rows in resource_payloads.values()),
            "grades": sum(len(rows) for rows in grade_payloads.values()),
            "announcements": len(announcements_payload),
            "invalid_grade_assignment_refs": invalid_grade_assignment_refs,
        },
    )


def build_blackboard_sync_payloads(
    courses: list[Any],
    assignments_by_course: dict[str, list[Any]],
    resources_by_course: dict[str, list[Any]],
    grades_by_course: dict[str, list[Any]],
    announcements: list[Any],
    logger: BlackboardLogger | None = None,
    *,
    include_assignment_attachments_as_resources: bool = True,
) -> BlackboardSyncPayloads:
    course_payload, valid_course_ids = _build_course_payloads(courses)
    assignment_payloads = _build_assignment_payloads(assignments_by_course)
    valid_assignment_ids_by_course = _collect_assignment_ids_by_course(
        assignment_payloads
    )
    resource_payloads = _build_resource_payloads(resources_by_course)
    if include_assignment_attachments_as_resources:
        _merge_assignment_attachment_resources(resource_payloads, assignment_payloads)
    grade_payloads, invalid_grade_assignment_refs = _build_grade_payloads(
        grades_by_course,
        assignment_payloads,
        valid_assignment_ids_by_course,
        logger,
    )
    announcements_payload = _build_announcements_payload(
        announcements,
        courses,
        valid_course_ids,
    )
    announcement_assignment_link_payloads = _classify_announcements_and_build_links(
        announcements_payload,
        assignment_payloads,
    )
    _log_sync_payload_summary(
        course_payload,
        assignment_payloads,
        resource_payloads,
        grade_payloads,
        announcements_payload,
        invalid_grade_assignment_refs,
        logger,
    )

    return BlackboardSyncPayloads(
        course_payload=course_payload,
        assignment_payloads=assignment_payloads,
        resource_payloads=resource_payloads,
        grade_payloads=grade_payloads,
        announcements_payload=announcements_payload,
        announcement_assignment_link_payloads=announcement_assignment_link_payloads,
    )


def sync_blackboard_payloads(
    db_manager: DatabaseManager,
    payloads: BlackboardSyncPayloads,
    *,
    allow_assignment_attachment_resource_upsert: bool = True,
    logger: BlackboardLogger | None = None,
) -> dict[str, dict[str, int]]:
    stats = _new_stats()
    stats["courses"] = db_manager.sync_courses(
        payloads.course_payload,
        logger=None
        if logger is None
        else logger.child("provider.use_cases.snapshot_sync.data.courses"),
    )

    for course_id, rows in payloads.assignment_payloads.items():
        _merge_stats(
            stats["assignments"],
            db_manager.sync_assignments(
                course_id,
                rows,
                allow_attachment_resource_upsert=allow_assignment_attachment_resource_upsert,
                logger=None
                if logger is None
                else logger.child(
                    "provider.use_cases.snapshot_sync.data.assignments",
                    course_id=course_id,
                ),
            ),
        )

    for course_id, rows in payloads.resource_payloads.items():
        _merge_stats(
            stats["resources"],
            db_manager.sync_resources(
                course_id,
                rows,
                logger=None
                if logger is None
                else logger.child(
                    "provider.use_cases.snapshot_sync.data.resources",
                    course_id=course_id,
                ),
            ),
        )

    for course_id, rows in payloads.grade_payloads.items():
        _merge_stats(
            stats["grades"],
            db_manager.sync_grades(
                course_id,
                rows,
                logger=None
                if logger is None
                else logger.child(
                    "provider.use_cases.snapshot_sync.data.grades",
                    course_id=course_id,
                ),
            ),
        )

    stats["announcements"] = db_manager.sync_announcements(
        payloads.announcements_payload,
        links_data=payloads.announcement_assignment_link_payloads,
        logger=None
        if logger is None
        else logger.child("provider.use_cases.snapshot_sync.data.announcements"),
    )
    if logger is not None:
        logger.info("💾 Blackboard 数据落库完成", payload={"stats": stats})
    return stats


def calculate_expected_active_counts(
    payloads: BlackboardSyncPayloads,
) -> dict[str, int]:
    expected = {
        "courses": len(
            {
                str(item.get("course_id") or "").strip()
                for item in payloads.course_payload
                if str(item.get("course_id") or "").strip()
            }
        ),
        "assignments": 0,
        "resources": 0,
        "grades": 0,
        "announcements": 0,
    }

    assignment_ids: set[str] = set()
    resource_ids: set[str] = set()
    grade_ids: set[str] = set()
    announcement_ids: set[str] = set()

    for rows in payloads.assignment_payloads.values():
        for row in rows:
            assignment_id = str(row.get("assignment_id") or "").strip()
            if assignment_id:
                assignment_ids.add(assignment_id)

    for rows in payloads.resource_payloads.values():
        for row in rows:
            resource_id = str(row.get("resource_id") or "").strip()
            if resource_id:
                resource_ids.add(resource_id)

    for rows in payloads.grade_payloads.values():
        for row in rows:
            grade_id = str(row.get("grade_id") or "").strip()
            if grade_id:
                grade_ids.add(grade_id)

    for row in payloads.announcements_payload:
        announcement_id = str(row.get("announcement_id") or "").strip()
        if announcement_id:
            announcement_ids.add(announcement_id)

    expected["assignments"] = len(assignment_ids)
    expected["resources"] = len(resource_ids)
    expected["grades"] = len(grade_ids)
    expected["announcements"] = len(announcement_ids)
    return expected


def compare_active_counts(
    table_counts: dict[str, dict[str, int]],
    expected_active: dict[str, int],
) -> bool:
    return all(
        int(table_counts.get(table, {}).get("active", 0))
        == int(expected_active.get(table, 0))
        for table in _SYNC_TABLES
    )


def _normalize_requested_course_ids(course_ids: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_course_id in course_ids:
        course_id = str(raw_course_id or "").strip()
        if not course_id or course_id in seen:
            continue
        seen.add(course_id)
        normalized.append(course_id)
    if not normalized:
        raise ValueError("courseIds must contain at least one non-empty course id.")
    return normalized


def _normalize_blackboard_credentials(
    username: str,
    password: str,
    *,
    logger: BlackboardLogger,
) -> tuple[str, str]:
    normalized_username = str(username or "").strip()
    normalized_password = str(password or "").strip()
    if normalized_username and normalized_password:
        return normalized_username, normalized_password
    logger.error("❌ 缺少 CAS 用户名或密码")
    raise ValueError("缺少 CAS 用户名或密码")


def _login_cas_or_raise(
    cas_client: CASClient,
    username: str,
    password: str,
    *,
    logger: BlackboardLogger,
) -> None:
    if cas_client.login(username, password, BLACKBOARD_LOGIN_SERVICE_URL):
        return
    failure_message = (
        str(cas_client.last_login_failure_message or "CAS 登录失败").strip()
        or "CAS 登录失败"
    )
    logger.error(
        "❌ CAS 登录失败",
        payload={
            "failure_reason": cas_client.last_login_failure_reason,
            "failure_message": failure_message,
        },
    )
    raise RuntimeError(failure_message)


def _make_blackboard_api_context(
    log_session: BlackboardLogSession,
    cas_client: CASClient,
    *,
    use_case: str,
) -> BlackboardAPIContext:
    api_logger = log_session.make_logger(
        layer="api",
        source="api.context.blackboard",
        context={"use_case": use_case},
    )
    return BlackboardAPIContext(client=cas_client.client, logger=api_logger)


def _build_snapshot_apis(
    cas_client: CASClient,
    context: BlackboardAPIContext,
) -> _SnapshotAPIs:
    return _SnapshotAPIs(
        course_api=BlackboardCourseAPI(
            cas_client.client, parser=BlackboardCourseParser()
        ),
        assignment_api=BlackboardAssignmentAPI(context),
        content_api=BlackboardContentAPI(context),
        grade_api=BlackboardGradeAPI(context),
        announcement_api=BlackboardAnnouncementAPI(context),
    )


def _fetch_snapshot_courses(
    course_api: BlackboardCourseAPI,
    *,
    logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> list[CourseDTO]:
    _emit(progress, "抓取 Blackboard 基础实时数据")
    try:
        logger.info("▶ 开始抓取课程列表")
        courses = course_api.get_courses()
        logger.info("✅ 课程列表抓取成功", payload={"course_count": len(courses)})
        _emit(progress, f"✅ 课程列表抓取成功：{len(courses)} 门")
        return courses
    except Exception as ex:
        logger.exception("❌ 课程列表抓取失败", ex)
        _emit(progress, f"❌ 课程列表抓取失败：{ex}")
        _emit(progress, traceback.format_exc())
        return []


def _build_course_logger(
    base_logger: BlackboardLogger,
    *,
    source: str,
    course_id: str,
    course_name: str,
    course_index: int,
    total_courses: int,
) -> BlackboardLogger:
    return base_logger.child(
        source,
        course_id=course_id,
        course_name=course_name,
        course_index=course_index,
        total_courses=total_courses,
    )


def _normalize_parallel_workers(value: int | None) -> int:
    try:
        parsed = int(value or 1)
    except (TypeError, ValueError):
        return 1
    return max(1, min(6, parsed))


def _fetch_snapshot_course_assignments(
    course_id: str,
    assignment_api: BlackboardAssignmentAPI,
    *,
    course_logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> list[AssignmentDTO]:
    try:
        assignments = assignment_api.get_course_assignments(course_id)
        course_logger.info(
            "✅ 课程作业抓取完成",
            payload={"assignment_count": len(assignments)},
        )
        _emit(progress, f"  作业: {len(assignments)}")
        return assignments
    except Exception as ex:
        course_logger.exception("❌ 课程作业抓取失败", ex)
        _emit(progress, f"  作业抓取失败: {ex}")
        return []


def _fetch_snapshot_course_grades(
    course_id: str,
    grade_api: BlackboardGradeAPI,
    *,
    course_logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> list[GradeDTO]:
    try:
        grade_items = grade_api.get_course_grade_dtos(course_id)
        course_logger.info(
            "✅ 课程成绩抓取完成", payload={"grade_count": len(grade_items)}
        )
        _emit(progress, f"  成绩: {len(grade_items)}")
        return grade_items
    except Exception as ex:
        course_logger.exception("❌ 课程成绩抓取失败", ex)
        _emit(progress, f"  成绩抓取失败: {ex}")
        return []


def _fetch_single_snapshot_course_data(
    *,
    index: int,
    total_courses: int,
    course: CourseDTO,
    assignment_api: BlackboardAssignmentAPI,
    content_api: BlackboardContentAPI,
    grade_api: BlackboardGradeAPI,
    logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> tuple[int, str, list[AssignmentDTO], list[ResourceDTO], list[GradeDTO]]:
    course_id = str(course.course_id or "").strip()
    course_name = str(course.name or course_id).strip()
    course_logger = _build_course_logger(
        logger,
        source="provider.use_cases.snapshot_sync.course",
        course_id=course_id,
        course_name=course_name,
        course_index=index,
        total_courses=total_courses,
    )
    _emit(
        progress,
        f"▶ 处理课程 [{index}/{total_courses}]: {course_name} ({course_id})",
    )
    course_logger.info("▶ 开始抓取课程基础数据")
    assignments = _fetch_snapshot_course_assignments(
        course_id,
        assignment_api,
        course_logger=course_logger,
        progress=progress,
    )
    resources, _ = _fetch_resource_sync_resources(
        course_id,
        content_api,
        course_logger=course_logger,
        progress=progress,
    )
    grades = _fetch_snapshot_course_grades(
        course_id,
        grade_api,
        course_logger=course_logger,
        progress=progress,
    )
    return index, course_id, assignments, resources, grades


def _fetch_snapshot_course_data(
    courses: list[CourseDTO],
    assignment_api: BlackboardAssignmentAPI,
    content_api: BlackboardContentAPI,
    grade_api: BlackboardGradeAPI,
    *,
    parallel_workers: int,
    logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> tuple[
    dict[str, list[AssignmentDTO]],
    dict[str, list[ResourceDTO]],
    dict[str, list[GradeDTO]],
]:
    assignments_by_course: dict[str, list[AssignmentDTO]] = {}
    resources_by_course: dict[str, list[ResourceDTO]] = {}
    grades_by_course: dict[str, list[GradeDTO]] = {}
    total_courses = len(courses)
    normalized_parallel_workers = _normalize_parallel_workers(parallel_workers)
    valid_courses = [
        (index, course)
        for index, course in enumerate(courses, 1)
        if str(course.course_id or "").strip()
    ]

    if normalized_parallel_workers > 1 and len(valid_courses) > 1:
        logger.info(
            "▶ 启用课程数据并行抓取",
            payload={
                "parallel_workers": normalized_parallel_workers,
                "course_count": len(valid_courses),
            },
        )
        _emit(
            progress,
            f"▶ 使用 {normalized_parallel_workers} 个并行线程抓取课程作业、资源与成绩",
        )

        completed_results: list[
            tuple[int, str, list[AssignmentDTO], list[ResourceDTO], list[GradeDTO]]
        ] = []
        with ThreadPoolExecutor(
            max_workers=normalized_parallel_workers,
            thread_name_prefix="bb-snapshot-course",
        ) as executor:
            future_to_course = {
                executor.submit(
                    _fetch_single_snapshot_course_data,
                    index=index,
                    total_courses=total_courses,
                    course=course,
                    assignment_api=assignment_api,
                    content_api=content_api,
                    grade_api=grade_api,
                    logger=logger,
                    progress=progress,
                ): (index, str(course.course_id or "").strip())
                for index, course in valid_courses
            }

            for future in as_completed(future_to_course):
                index, course_id = future_to_course[future]
                try:
                    completed_results.append(future.result())
                except Exception as ex:
                    logger.exception(
                        "❌ 课程并行抓取失败",
                        ex,
                        payload={"course_id": course_id, "course_index": index},
                    )
                    _emit(
                        progress,
                        f"❌ 课程抓取失败 [{index}/{total_courses}] ({course_id}): {ex}",
                    )
                    completed_results.append((index, course_id, [], [], []))

        for index, course_id, assignments, resources, grades in sorted(
            completed_results, key=lambda item: item[0]
        ):
            assignments_by_course[course_id] = assignments
            resources_by_course[course_id] = resources
            grades_by_course[course_id] = grades
        return assignments_by_course, resources_by_course, grades_by_course

    for index, course in enumerate(courses, 1):
        course_id = str(course.course_id or "").strip()
        if not course_id:
            continue

        _, _, assignments, resources, grades = _fetch_single_snapshot_course_data(
            index=index,
            total_courses=total_courses,
            course=course,
            assignment_api=assignment_api,
            content_api=content_api,
            grade_api=grade_api,
            logger=logger,
            progress=progress,
        )
        assignments_by_course[course_id] = assignments
        resources_by_course[course_id] = resources
        grades_by_course[course_id] = grades

    return assignments_by_course, resources_by_course, grades_by_course


def _course_loader_payload(courses: list[CourseDTO]) -> list[dict[str, str | None]]:
    return [{"id": course.course_id, "name": course.name} for course in courses]


def _announcement_dedupe_key(
    announcement: AnnouncementDTO,
) -> tuple[str, str, str, str]:
    return (
        str(announcement.course_id or "").strip(),
        str(announcement.title or "").strip(),
        str(announcement.publish_time or "").strip(),
        str(announcement.url or "").strip(),
    )


def _announcement_sort_key(item: AnnouncementDTO) -> str:
    if item.publish_time_parsed is None:
        return ""
    return item.publish_time_parsed.isoformat()


def _fallback_snapshot_announcements(
    courses: list[CourseDTO],
    announcement_api: BlackboardAnnouncementAPI,
) -> list[AnnouncementDTO]:
    announcements: list[AnnouncementDTO] = []
    seen_announcement_keys: set[tuple[str, str, str, str]] = set()
    for course in courses:
        course_id = str(course.course_id or "").strip()
        if not course_id:
            continue
        for announcement in announcement_api.get_course_announcement_dtos(course_id):
            dedupe_key = _announcement_dedupe_key(announcement)
            if dedupe_key in seen_announcement_keys:
                continue
            seen_announcement_keys.add(dedupe_key)
            announcements.append(announcement)
    announcements.sort(key=_announcement_sort_key, reverse=True)
    return announcements


def _fetch_snapshot_announcements(
    courses: list[CourseDTO],
    announcement_api: BlackboardAnnouncementAPI,
    *,
    logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> list[AnnouncementDTO]:
    try:
        logger.info("▶ 开始抓取汇总公告")
        announcements = announcement_api.get_all_announcement_dtos(
            course_loader=lambda: _course_loader_payload(courses)
        )
        if not announcements:
            announcements = _fallback_snapshot_announcements(courses, announcement_api)
        logger.info(
            "✅ 汇总公告抓取成功",
            payload={"announcement_count": len(announcements)},
        )
        _emit(progress, f"✅ 汇总公告抓取成功：{len(announcements)} 条")
        return announcements
    except Exception as ex:
        logger.exception("❌ 汇总公告抓取失败", ex)
        _emit(progress, f"❌ 汇总公告抓取失败：{ex}")
        return []


def _log_snapshot_fetch_summary(
    logger: BlackboardLogger,
    courses: list[CourseDTO],
    assignments_by_course: dict[str, list[AssignmentDTO]],
    resources_by_course: dict[str, list[ResourceDTO]],
    grades_by_course: dict[str, list[GradeDTO]],
    announcements: list[AnnouncementDTO],
) -> None:
    logger.info(
        "✅ Blackboard 基础 snapshot 抓取完成",
        payload={
            "scraped_counts": {
                "courses": len(courses),
                "assignments": sum(
                    len(rows) for rows in assignments_by_course.values()
                ),
                "resources": sum(len(rows) for rows in resources_by_course.values()),
                "grades": sum(len(rows) for rows in grades_by_course.values()),
                "announcements": len(announcements),
            }
        },
    )


def _filter_courses_for_current_term(
    courses: list[CourseDTO],
    *,
    logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> list[CourseDTO]:
    parser = BlackboardCourseParser()
    current_term = parser.current_term_label()
    filtered = [course for course in courses if parser.is_current_term(course.term)]
    logger.info(
        "✅ 已按当前学期筛选 Blackboard 课程",
        payload={
            "current_term": current_term,
            "total_courses": len(courses),
            "selected_courses": len(filtered),
        },
    )
    _emit(
        progress,
        f"✅ 已按当前学期筛选课程：{len(filtered)}/{len(courses)} 门（当前学期：{current_term}）",
    )
    return filtered


def fetch_blackboard_snapshot(
    username: str,
    password: str,
    *,
    current_term_only: bool = False,
    parallel_workers: int = 1,
    progress: ProgressCallback | None = None,
    enable_console_logging: bool = False,
    _log_session: BlackboardLogSession | None = None,
) -> BlackboardSnapshotFetchResult:
    log_session = _log_session or create_log_session(console=enable_console_logging)
    normalized_parallel_workers = _normalize_parallel_workers(parallel_workers)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.snapshot_sync",
        context={
            "parallel_workers": normalized_parallel_workers,
            "current_term_only": current_term_only,
        },
    )
    normalized_username, normalized_password = _normalize_blackboard_credentials(
        username,
        password,
        logger=logger,
    )
    cas_client = CASClient(logger=logger.child("provider.use_cases.snapshot_sync.cas"))
    try:
        _emit(progress, "使用 CASClient 认证")
        logger.info("▶ 开始 Blackboard 基础 snapshot 抓取")
        _login_cas_or_raise(
            cas_client,
            normalized_username,
            normalized_password,
            logger=logger,
        )
        context = _make_blackboard_api_context(
            log_session,
            cas_client,
            use_case="snapshot_sync",
        )
        snapshot_apis = _build_snapshot_apis(cas_client, context)
        courses = _fetch_snapshot_courses(
            snapshot_apis.course_api,
            logger=logger,
            progress=progress,
        )
        if current_term_only:
            courses = _filter_courses_for_current_term(
                courses,
                logger=logger,
                progress=progress,
            )
        assignments_by_course, resources_by_course, grades_by_course = (
            _fetch_snapshot_course_data(
                courses,
                snapshot_apis.assignment_api,
                snapshot_apis.content_api,
                snapshot_apis.grade_api,
                parallel_workers=normalized_parallel_workers,
                logger=logger,
                progress=progress,
            )
        )
        announcements = _fetch_snapshot_announcements(
            courses,
            snapshot_apis.announcement_api,
            logger=logger,
            progress=progress,
        )
        _log_snapshot_fetch_summary(
            logger,
            courses,
            assignments_by_course,
            resources_by_course,
            grades_by_course,
            announcements,
        )
        return BlackboardSnapshotFetchResult(
            courses=courses,
            assignments_by_course=assignments_by_course,
            resources_by_course=resources_by_course,
            grades_by_course=grades_by_course,
            announcements=announcements,
            logs=log_session.snapshot(),
        )
    except Exception as ex:
        logger.exception("Blackboard 基础 snapshot 抓取异常", ex)
        raise
    finally:
        logger.debug("ℹ 关闭 CASClient")
        cas_client.close()


def run_blackboard_snapshot_sync(
    username: str,
    password: str,
    *,
    db_path: str | Path | None = None,
    reset_schema: bool = False,
    verify_second_sync: bool = True,
    current_term_only: bool = False,
    parallel_workers: int = 1,
    progress: ProgressCallback | None = None,
    enable_console_logging: bool = False,
) -> BlackboardSnapshotSyncReport:
    log_session = create_log_session(console=enable_console_logging)
    normalized_parallel_workers = _normalize_parallel_workers(parallel_workers)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.snapshot_sync.run",
        context={
            "verify_second_sync": verify_second_sync,
            "current_term_only": current_term_only,
            "parallel_workers": normalized_parallel_workers,
        },
    )
    snapshot = fetch_blackboard_snapshot(
        username,
        password,
        current_term_only=current_term_only,
        parallel_workers=normalized_parallel_workers,
        progress=progress,
        _log_session=log_session,
    )
    logger.info("▶ 开始构建 Blackboard 基础 sync payloads")
    payloads = build_blackboard_sync_payloads(
        snapshot.courses,
        snapshot.assignments_by_course,
        snapshot.resources_by_course,
        snapshot.grades_by_course,
        snapshot.announcements,
        logger=logger.child("provider.use_cases.snapshot_sync.payloads"),
        include_assignment_attachments_as_resources=False,
    )

    db_manager = DatabaseManager(db_path, reset_schema=reset_schema)
    _emit(progress, f"▶ 同步数据库: {db_manager.db_path.resolve().as_posix()}")
    logger.info(
        "▶ 开始同步数据库", payload={"db_path": db_manager.db_path.resolve().as_posix()}
    )
    first_sync_stats = sync_blackboard_payloads(
        db_manager,
        payloads,
        allow_assignment_attachment_resource_upsert=False,
        logger=logger,
    )
    table_counts = db_manager.get_table_counts()
    expected_active_counts = calculate_expected_active_counts(payloads)
    integrity_ok = compare_active_counts(table_counts, expected_active_counts)
    logger.info(
        "💾 首次同步完成",
        payload={
            "first_sync_stats": first_sync_stats,
            "table_counts": table_counts,
            "expected_active_counts": expected_active_counts,
            "integrity_ok": integrity_ok,
        },
    )

    second_sync_stats: dict[str, dict[str, int]] | None = None
    if verify_second_sync:
        _emit(progress, "▶ 开始执行第二次同步验证")
        logger.info("▶ 开始执行第二次同步验证")
        second_sync_stats = sync_blackboard_payloads(
            db_manager,
            payloads,
            allow_assignment_attachment_resource_upsert=False,
            logger=logger.child("provider.use_cases.snapshot_sync.second_sync"),
        )
        _emit(progress, "💾 第二次同步验证完成")
        logger.info(
            "💾 第二次同步验证完成", payload={"second_sync_stats": second_sync_stats}
        )

    return BlackboardSnapshotSyncReport(
        db_path=db_manager.db_path.resolve(),
        snapshot=snapshot,
        payloads=payloads,
        first_sync_stats=first_sync_stats,
        second_sync_stats=second_sync_stats,
        table_counts=table_counts,
        expected_active_counts=expected_active_counts,
        integrity_ok=integrity_ok,
        logs=log_session.snapshot(),
    )


def _fetch_available_course_map(
    course_api: BlackboardCourseAPI,
    *,
    logger: BlackboardLogger,
) -> dict[str, CourseDTO]:
    logger.info("▶ 开始抓取课程列表用于资源同步")
    available_courses = course_api.get_courses()
    return {
        str(course.course_id or "").strip(): course
        for course in available_courses
        if str(course.course_id or "").strip()
    }


def _fetch_resource_sync_assignments(
    course_id: str,
    assignment_api: BlackboardAssignmentAPI,
    *,
    course_logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> tuple[list[AssignmentDTO], bool]:
    try:
        assignments = assignment_api.get_course_assignments(course_id)
        course_logger.info(
            "✅ 课程作业附件源抓取完成",
            payload={"assignment_count": len(assignments)},
        )
        _emit(progress, f"  作业附件源: {len(assignments)}")
        return assignments, False
    except Exception as ex:
        course_logger.exception("❌ 课程作业附件源抓取失败", ex)
        _emit(progress, f"  作业附件源抓取失败: {ex}")
        return [], True


def _fetch_resource_sync_resources(
    course_id: str,
    content_api: BlackboardContentAPI,
    *,
    course_logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> tuple[list[ResourceDTO], bool]:
    try:
        resources = content_api.get_course_content_dtos(course_id)
        course_logger.info(
            "✅ 课程资源抓取完成", payload={"resource_count": len(resources)}
        )
        _emit(progress, f"  资源: {len(resources)}")
        return resources, False
    except Exception as ex:
        course_logger.exception("❌ 课程资源抓取失败", ex)
        _emit(progress, f"  资源抓取失败: {ex}")
        return [], True


def _select_course_resource_sync_targets(
    requested_course_ids: list[str],
    available_course_map: dict[str, CourseDTO],
    assignment_api: BlackboardAssignmentAPI,
    content_api: BlackboardContentAPI,
    *,
    logger: BlackboardLogger,
    progress: ProgressCallback | None,
) -> _CourseResourceSelection:
    selected_courses: list[CourseDTO] = []
    assignments_by_course: dict[str, list[AssignmentDTO]] = {}
    resources_by_course: dict[str, list[ResourceDTO]] = {}
    processed_course_ids: list[str] = []
    missing_course_ids: list[str] = []
    failed_course_ids: list[str] = []
    total_courses = len(requested_course_ids)

    for index, course_id in enumerate(requested_course_ids, 1):
        course = available_course_map.get(course_id)
        if course is None:
            missing_course_ids.append(course_id)
            logger.warning(
                "⚠ 请求课程不存在于 Blackboard 课程列表",
                payload={"course_id": course_id},
            )
            _emit(
                progress,
                f"⚠ 跳过不存在课程 [{index}/{total_courses}]: {course_id}",
            )
            continue

        course_name = str(course.name or course_id).strip()
        course_logger = _build_course_logger(
            logger,
            source="provider.use_cases.course_resources_sync.course",
            course_id=course_id,
            course_name=course_name,
            course_index=index,
            total_courses=total_courses,
        )
        _emit(
            progress,
            f"▶ 抓取课程资源 [{index}/{total_courses}]: {course_name} ({course_id})",
        )
        assignments, assignment_fetch_failed = _fetch_resource_sync_assignments(
            course_id,
            assignment_api,
            course_logger=course_logger,
            progress=progress,
        )
        resources, resource_fetch_failed = _fetch_resource_sync_resources(
            course_id,
            content_api,
            course_logger=course_logger,
            progress=progress,
        )
        if assignment_fetch_failed or resource_fetch_failed:
            failed_course_ids.append(course_id)
            course_logger.warning(
                "⚠ 课程资源同步前置抓取未完成，已跳过本课程落库",
                payload={
                    "assignment_fetch_failed": assignment_fetch_failed,
                    "resource_fetch_failed": resource_fetch_failed,
                },
            )
            continue

        assignments_by_course[course_id] = assignments
        resources_by_course[course_id] = resources
        processed_course_ids.append(course_id)
        selected_courses.append(course)

    return _CourseResourceSelection(
        selected_courses=selected_courses,
        assignments_by_course=assignments_by_course,
        resources_by_course=resources_by_course,
        processed_course_ids=processed_course_ids,
        missing_course_ids=missing_course_ids,
        failed_course_ids=failed_course_ids,
    )


def _sync_course_resource_courses(
    db_manager: DatabaseManager,
    payloads: BlackboardSyncPayloads,
    *,
    logger: BlackboardLogger,
) -> dict[str, int]:
    if not payloads.course_payload:
        return {"inserted": 0, "updated": 0, "deleted": 0}
    return db_manager.sync_courses(
        payloads.course_payload,
        allow_soft_delete=False,
        logger=logger.child("provider.use_cases.course_resources_sync.data.courses"),
    )


def _sync_course_resource_payloads(
    db_manager: DatabaseManager,
    payloads: BlackboardSyncPayloads,
    *,
    logger: BlackboardLogger,
) -> dict[str, int]:
    resource_sync_stats = {"inserted": 0, "updated": 0, "deleted": 0}
    for course_id, rows in payloads.resource_payloads.items():
        _merge_stats(
            resource_sync_stats,
            db_manager.sync_resources(
                course_id,
                rows,
                logger=logger.child(
                    "provider.use_cases.course_resources_sync.data.resources",
                    course_id=course_id,
                ),
            ),
        )
    return resource_sync_stats


def run_blackboard_course_resources_sync(
    username: str,
    password: str,
    *,
    course_ids: list[str],
    db_path: str | Path | None = None,
    reset_schema: bool = False,
    progress: ProgressCallback | None = None,
    enable_console_logging: bool = False,
) -> BlackboardCourseResourcesSyncReport:
    normalized_course_ids = _normalize_requested_course_ids(course_ids)
    log_session = create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.course_resources_sync.run",
        context={"requested_course_count": len(normalized_course_ids)},
    )
    normalized_username, normalized_password = _normalize_blackboard_credentials(
        username,
        password,
        logger=logger,
    )
    cas_client = CASClient(
        logger=logger.child("provider.use_cases.course_resources_sync.cas")
    )
    try:
        _emit(progress, "使用 CASClient 认证")
        logger.info(
            "▶ 开始 Blackboard 课程资源同步",
            payload={"requested_course_ids": normalized_course_ids},
        )
        _login_cas_or_raise(
            cas_client,
            normalized_username,
            normalized_password,
            logger=logger,
        )
        context = _make_blackboard_api_context(
            log_session,
            cas_client,
            use_case="course_resources_sync",
        )
        course_api = BlackboardCourseAPI(
            cas_client.client, parser=BlackboardCourseParser()
        )
        assignment_api = BlackboardAssignmentAPI(context)
        content_api = BlackboardContentAPI(context)
        available_course_map = _fetch_available_course_map(course_api, logger=logger)
        selection = _select_course_resource_sync_targets(
            normalized_course_ids,
            available_course_map,
            assignment_api,
            content_api,
            logger=logger,
            progress=progress,
        )
        payloads = build_blackboard_sync_payloads(
            selection.selected_courses,
            selection.assignments_by_course,
            selection.resources_by_course,
            {},
            [],
            logger=logger.child("provider.use_cases.course_resources_sync.payloads"),
            include_assignment_attachments_as_resources=True,
        )
        db_manager = DatabaseManager(db_path, reset_schema=reset_schema)
        _emit(progress, f"▶ 同步数据库: {db_manager.db_path.resolve().as_posix()}")
        logger.info(
            "▶ 开始同步课程资源数据库",
            payload={
                "db_path": db_manager.db_path.resolve().as_posix(),
                "processed_course_ids": selection.processed_course_ids,
                "missing_course_ids": selection.missing_course_ids,
                "failed_course_ids": selection.failed_course_ids,
            },
        )
        course_sync_stats = _sync_course_resource_courses(
            db_manager,
            payloads,
            logger=logger,
        )
        resource_sync_stats = _sync_course_resource_payloads(
            db_manager,
            payloads,
            logger=logger,
        )
        table_counts = db_manager.get_table_counts()
        logger.info(
            "💾 课程资源同步完成",
            payload={
                "requested_course_ids": normalized_course_ids,
                "processed_course_ids": selection.processed_course_ids,
                "missing_course_ids": selection.missing_course_ids,
                "failed_course_ids": selection.failed_course_ids,
                "scraped_counts": {
                    "courses": len(selection.processed_course_ids),
                    "resources": sum(
                        len(rows) for rows in payloads.resource_payloads.values()
                    ),
                },
                "sync_stats": {
                    "courses": course_sync_stats,
                    "resources": resource_sync_stats,
                },
            },
        )
        return BlackboardCourseResourcesSyncReport(
            db_path=db_manager.db_path.resolve(),
            requested_course_ids=normalized_course_ids,
            processed_course_ids=selection.processed_course_ids,
            missing_course_ids=selection.missing_course_ids,
            failed_course_ids=selection.failed_course_ids,
            resource_payloads_by_course=payloads.resource_payloads,
            sync_stats={
                "courses": course_sync_stats,
                "resources": resource_sync_stats,
            },
            table_counts=table_counts,
            logs=log_session.snapshot(),
        )
    except Exception as ex:
        logger.exception("Blackboard 课程资源同步异常", ex)
        raise
    finally:
        logger.debug("ℹ 关闭 CASClient")
        cas_client.close()
