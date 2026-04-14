from __future__ import annotations

import hashlib
import json
import re
import traceback
from pathlib import Path
from typing import Any

from app.blackboard.api import BlackboardAPIContext
from app.blackboard.api.announcements import BlackboardAnnouncementAPI
from app.blackboard.api.assignments import BlackboardAssignmentAPI
from app.blackboard.api.contents import BlackboardContentAPI
from app.blackboard.api.course_client import BlackboardCourseAPI
from app.blackboard.api.course_parser import BlackboardCourseParser
from app.blackboard.api.dto import AnnouncementDTO, AssignmentDTO, CourseDTO, GradeDTO, ResourceDTO
from app.blackboard.api.grades import BlackboardGradeAPI
from app.blackboard.provider.results import (
    BlackboardSnapshotFetchResult,
    BlackboardSnapshotSyncReport,
    BlackboardSyncPayloads,
    ProgressCallback,
)
from app.blackboard.data import DatabaseManager
from app.blackboard.shared import create_log_session, split_score_text
from app.blackboard.shared.logging import BlackboardLogSession, BlackboardLogger
from app.shared_integrations.sustech_auth.cas_client import CASClient

BLACKBOARD_LOGIN_SERVICE_URL = "https://bb.sustech.edu.cn/webapps/login/"
_SYNC_TABLES: tuple[str, ...] = (
    "courses",
    "assignments",
    "resources",
    "grades",
    "announcements",
)


def _emit(progress: ProgressCallback | None, message: str) -> None:
    if progress is not None:
        progress(message)


def _stable_id(prefix: str, *parts: Any) -> str:
    normalized = "|".join(str(part).strip() for part in parts if part is not None and str(part).strip())
    digest = hashlib.sha1((normalized or "<empty>").encode("utf-8")).hexdigest()[:20]
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



def build_blackboard_sync_payloads(
    courses: list[Any],
    assignments_by_course: dict[str, list[Any]],
    resources_by_course: dict[str, list[Any]],
    grades_by_course: dict[str, list[Any]],
    announcements: list[Any],
    logger: BlackboardLogger | None = None,
) -> BlackboardSyncPayloads:
    course_payload: list[dict[str, Any]] = []
    valid_course_ids: set[str] = set()
    for course in courses:
        course_id = _text_value(course, "course_id", "id")
        if not course_id:
            continue

        valid_course_ids.add(course_id)
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
                "is_active": _value(course, "is_active") if _value(course, "is_active") is not None else True,
            }
        )

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
                    "attachments": _attachment_payloads(_value(item, "attachments")),
                    "source_page": _value(item, "source_page"),
                    "submission_status": _value(item, "submission_status"),
                }
            )
        assignment_payloads[course_id] = payload

    valid_assignment_ids_by_course = {
        course_id: {
            str(row.get("assignment_id") or "").strip()
            for row in rows
            if str(row.get("assignment_id") or "").strip()
        }
        for course_id, rows in assignment_payloads.items()
    }

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

                title = str(attachment.get("title") or attachment.get("name") or "").strip()
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

    invalid_grade_assignment_refs = 0
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
                grade_id = _stable_id("grd", course_id, item_name, due_date or graded_date, category)
            score, total_score = split_score_text(_value(item, "score"))

            assignment_id_match = _text_value(item, "assignment_id") or None
            assignment_match_source = "grade.assignment_id" if assignment_id_match else "assignment.title"
            if not assignment_id_match and course_id in assignment_payloads:
                for assignment in assignment_payloads[course_id]:
                    if assignment["title"] == item_name:
                        assignment_id_match = assignment["assignment_id"]
                        assignment_match_source = "assignment.title"
                        break

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

    course_name_candidates: dict[str, set[str]] = {}
    course_code_candidates: dict[str, set[str]] = {}

    def _normalize_name(value: Any) -> str:
        return re.sub(r"\s+", " ", str(value or "")).strip().lower()

    def _normalize_code(value: Any) -> str:
        return re.sub(r"\s+", "", str(value or "")).strip().upper()

    for course in courses:
        course_id = _text_value(course, "course_id", "id")
        if not course_id:
            continue

        course_name = _text_value(course, "name")
        normalized_name = _normalize_name(course_name)
        if normalized_name:
            course_name_candidates.setdefault(normalized_name, set()).add(course_id)

        explicit_code = _normalize_code(_value(course, "code"))
        if explicit_code:
            course_code_candidates.setdefault(explicit_code, set()).add(course_id)

    announcements_payload: list[dict[str, Any]] = []
    for item in announcements:
        title = _text_value(item, "title")
        posted_at_text = _text_value(item, "publish_time", "posted_date")
        url = _text_value(item, "url")
        course_id = _text_value(item, "course_id") or None

        if not course_id:
            ann_course_name = _text_value(item, "course_name")
            normalized_ann_name = _normalize_name(ann_course_name)
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
            course_id = None

        announcement_id = _text_value(item, "announcement_id")
        if not announcement_id:
            fallback = json.dumps(_jsonable_item(item), ensure_ascii=False, sort_keys=True, default=str)
            announcement_id = _stable_id("ann", course_id, title, posted_at_text, url, fallback)

        announcements_payload.append(
            {
                "announcement_id": announcement_id,
                "course_id": course_id,
                "course_name": _value(item, "course_name"),
                "title": title,
                "content": _value(item, "content", "detail"),
                "author": _value(item, "author"),
                "publish_time": posted_at_text or None,
                "url": url or None,
                "source_page": _value(item, "source_page"),
            }
        )

    if logger is not None:
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

    return BlackboardSyncPayloads(
        course_payload=course_payload,
        assignment_payloads=assignment_payloads,
        resource_payloads=resource_payloads,
        grade_payloads=grade_payloads,
        announcements_payload=announcements_payload,
    )


def sync_blackboard_payloads(
    db_manager: DatabaseManager,
    payloads: BlackboardSyncPayloads,
    *,
    logger: BlackboardLogger | None = None,
) -> dict[str, dict[str, int]]:
    stats = _new_stats()
    stats["courses"] = db_manager.sync_courses(
        payloads.course_payload,
        logger=None if logger is None else logger.child("provider.use_cases.snapshot_sync.data.courses"),
    )

    for course_id, rows in payloads.assignment_payloads.items():
        _merge_stats(
            stats["assignments"],
            db_manager.sync_assignments(
                course_id,
                rows,
                logger=None if logger is None else logger.child(
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
                logger=None if logger is None else logger.child(
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
                logger=None if logger is None else logger.child(
                    "provider.use_cases.snapshot_sync.data.grades",
                    course_id=course_id,
                ),
            ),
        )

    stats["announcements"] = db_manager.sync_announcements(
        payloads.announcements_payload,
        logger=None if logger is None else logger.child("provider.use_cases.snapshot_sync.data.announcements"),
    )
    if logger is not None:
        logger.info("💾 Blackboard 数据落库完成", payload={"stats": stats})
    return stats


def calculate_expected_active_counts(payloads: BlackboardSyncPayloads) -> dict[str, int]:
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
        int(table_counts.get(table, {}).get("active", 0)) == int(expected_active.get(table, 0))
        for table in _SYNC_TABLES
    )


def fetch_blackboard_snapshot(
    username: str,
    password: str,
    *,
    resource_course_limit: int = 3,
    progress: ProgressCallback | None = None,
    enable_console_logging: bool = False,
    _log_session: BlackboardLogSession | None = None,
) -> BlackboardSnapshotFetchResult:
    normalized_username = str(username or "").strip()
    normalized_password = str(password or "").strip()
    normalized_resource_course_limit = max(int(resource_course_limit), 0)
    log_session = _log_session or create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.snapshot_sync",
        context={"resource_course_limit": normalized_resource_course_limit},
    )

    if not normalized_username or not normalized_password:
        logger.error("❌ 缺少 CAS 用户名或密码")
        raise ValueError("缺少 CAS 用户名或密码")

    api_logger = log_session.make_logger(
        layer="api",
        source="api.context.blackboard",
        context={"use_case": "snapshot_sync"},
    )
    cas_client = CASClient(logger=logger.child("provider.use_cases.snapshot_sync.cas"))
    try:
        _emit(progress, "使用 CASClient 认证")
        logger.info("▶ 开始 Blackboard snapshot 抓取")
        if not cas_client.login(normalized_username, normalized_password, BLACKBOARD_LOGIN_SERVICE_URL):
            logger.error("❌ CAS 登录失败")
            raise RuntimeError("CAS 登录失败")

        context = BlackboardAPIContext(client=cas_client.client, logger=api_logger)
        course_api = BlackboardCourseAPI(cas_client.client, parser=BlackboardCourseParser())
        assignment_api = BlackboardAssignmentAPI(context)
        grade_api = BlackboardGradeAPI(context)
        content_api = BlackboardContentAPI(context)
        announcement_api = BlackboardAnnouncementAPI(context)

        courses: list[CourseDTO] = []
        assignments_by_course: dict[str, list[AssignmentDTO]] = {}
        resources_by_course: dict[str, list[ResourceDTO]] = {}
        grades_by_course: dict[str, list[GradeDTO]] = {}
        announcements: list[AnnouncementDTO] = []

        _emit(progress, "抓取 Blackboard 实时数据")
        try:
            logger.info("▶ 开始抓取课程列表")
            courses = course_api.get_courses()
            logger.info("✅ 课程列表抓取成功", payload={"course_count": len(courses)})
            _emit(progress, f"✅ 课程列表抓取成功：{len(courses)} 门")
        except Exception as ex:
            logger.exception("❌ 课程列表抓取失败", ex)
            _emit(progress, f"❌ 课程列表抓取失败：{ex}")
            _emit(progress, traceback.format_exc())

        for index, course in enumerate(courses, 1):
            course_id = str(course.course_id or "").strip()
            course_name = str(course.name or course_id).strip()
            if not course_id:
                continue

            course_logger = logger.child(
                "provider.use_cases.snapshot_sync.course",
                course_id=course_id,
                course_name=course_name,
                course_index=index,
                total_courses=len(courses),
            )
            _emit(progress, f"▶ 处理课程 [{index}/{len(courses)}]: {course_name} ({course_id})")
            course_logger.info("▶ 开始抓取课程下游数据")

            try:
                assignments = assignment_api.get_course_assignments(course_id)
                assignments_by_course[course_id] = assignments
                course_logger.info("✅ 课程作业抓取完成", payload={"assignment_count": len(assignments)})
                _emit(progress, f"  作业: {len(assignments)}")
            except Exception as ex:
                assignments_by_course[course_id] = []
                course_logger.exception("❌ 课程作业抓取失败", ex)
                _emit(progress, f"  作业抓取失败: {ex}")

            try:
                grade_items = grade_api.get_course_grade_dtos(course_id)
                grades_by_course[course_id] = grade_items
                course_logger.info("✅ 课程成绩抓取完成", payload={"grade_count": len(grade_items)})
                _emit(progress, f"  成绩: {len(grade_items)}")
            except Exception as ex:
                grades_by_course[course_id] = []
                course_logger.exception("❌ 课程成绩抓取失败", ex)
                _emit(progress, f"  成绩抓取失败: {ex}")

            if index <= normalized_resource_course_limit:
                try:
                    resources = content_api.get_course_content_dtos(course_id)
                    resources_by_course[course_id] = resources
                    course_logger.info(
                        "✅ 课程资源抓取完成",
                        payload={
                            "resource_count": len(resources),
                            "resource_course_limit": normalized_resource_course_limit,
                        },
                    )
                    _emit(progress, f"  资源: {len(resources)} (前{normalized_resource_course_limit}门课程策略)")
                except Exception as ex:
                    resources_by_course[course_id] = []
                    course_logger.exception("课程资源抓取失败", ex)
                    _emit(progress, f"  资源抓取失败: {ex}")
            else:
                course_logger.debug("🏳 跳过课程资源抓取", payload={"resource_course_limit": normalized_resource_course_limit})

        try:
            logger.info("▶ 开始抓取汇总公告")
            announcements = announcement_api.get_all_announcement_dtos(
                course_loader=lambda: [
                    {"id": course.course_id, "name": course.name}
                    for course in courses
                ]
            )
            if not announcements:
                seen_announcement_keys: set[tuple[str, str, str, str]] = set()
                for course in courses:
                    course_id = str(course.course_id or "").strip()
                    if not course_id:
                        continue
                    for announcement in announcement_api.get_course_announcement_dtos(course_id):
                        dedupe_key = (
                            str(announcement.course_id or "").strip(),
                            str(announcement.title or "").strip(),
                            str(announcement.publish_time or "").strip(),
                            str(announcement.url or "").strip(),
                        )
                        if dedupe_key in seen_announcement_keys:
                            continue
                        seen_announcement_keys.add(dedupe_key)
                        announcements.append(announcement)
                announcements.sort(
                    key=lambda item: item.publish_time_parsed.isoformat() if item.publish_time_parsed else "",
                    reverse=True,
                )
            logger.info("✅ 汇总公告抓取成功", payload={"announcement_count": len(announcements)})
            _emit(progress, f"✅ 汇总公告抓取成功：{len(announcements)} 条")
        except Exception as ex:
            announcements = []
            logger.exception("❌ 汇总公告抓取失败", ex)
            _emit(progress, f"❌ 汇总公告抓取失败：{ex}")

        logger.info(
            "✅ Blackboard snapshot 抓取完成",
            payload={
                "scraped_counts": {
                    "courses": len(courses),
                    "assignments": sum(len(rows) for rows in assignments_by_course.values()),
                    "resources": sum(len(rows) for rows in resources_by_course.values()),
                    "grades": sum(len(rows) for rows in grades_by_course.values()),
                    "announcements": len(announcements),
                }
            },
        )
        return BlackboardSnapshotFetchResult(
            courses=courses,
            assignments_by_course=assignments_by_course,
            resources_by_course=resources_by_course,
            grades_by_course=grades_by_course,
            announcements=announcements,
            resource_course_limit=normalized_resource_course_limit,
            logs=log_session.snapshot(),
        )
    except Exception as ex:
        logger.exception("Blackboard snapshot 抓取异常", ex)
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
    resource_course_limit: int = 3,
    verify_second_sync: bool = True,
    progress: ProgressCallback | None = None,
    enable_console_logging: bool = False,
) -> BlackboardSnapshotSyncReport:
    log_session = create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.snapshot_sync.run",
        context={
            "resource_course_limit": resource_course_limit,
            "verify_second_sync": verify_second_sync,
        },
    )
    snapshot = fetch_blackboard_snapshot(
        username,
        password,
        resource_course_limit=resource_course_limit,
        progress=progress,
        _log_session=log_session,
    )
    logger.info("▶ 开始构建 Blackboard sync payloads")
    payloads = build_blackboard_sync_payloads(
        snapshot.courses,
        snapshot.assignments_by_course,
        snapshot.resources_by_course,
        snapshot.grades_by_course,
        snapshot.announcements,
        logger=logger.child("provider.use_cases.snapshot_sync.payloads"),
    )

    db_manager = DatabaseManager(db_path, reset_schema=reset_schema)
    _emit(progress, f"▶ 同步数据库: {db_manager.db_path.resolve().as_posix()}")
    logger.info("▶ 开始同步数据库", payload={"db_path": db_manager.db_path.resolve().as_posix()})
    first_sync_stats = sync_blackboard_payloads(db_manager, payloads, logger=logger)
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
        logger.info("▶ 开始执行第二次同步验证")
        second_sync_stats = sync_blackboard_payloads(db_manager, payloads, logger=logger.child("provider.use_cases.snapshot_sync.second_sync"))
        logger.info("💾 第二次同步验证完成", payload={"second_sync_stats": second_sync_stats})

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
