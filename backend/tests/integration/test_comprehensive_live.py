from __future__ import annotations

import json
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from app.blackboard.api import (
    BlackboardAPIContext,
    BlackboardAnnouncementAPI,
    BlackboardAssignmentAPI,
    BlackboardContentAPI,
    BlackboardCourseAPI,
    BlackboardGradeAPI,
)
from app.core.auth.cas_client import CASClient
from tests.helpers import require_live_credentials

pytestmark = pytest.mark.live


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def _sample_list(items: list[Any], limit: int = 3) -> list[Any]:
    return items[:limit]


def _jsonable(item: Any) -> Any:
    if hasattr(item, "to_dict"):
        return item.to_dict()
    return item


def _build_markdown_report(report: dict[str, Any]) -> str:
    lines: list[str] = []
    lines.append("# Blackboard 全面测试报告")
    lines.append("")
    lines.append(f"- 生成时间: {report.get('run_at', '')}")
    lines.append(f"- 测试状态: {report.get('status', '')}")
    lines.append(f"- 课程总数: {report.get('courses_total', 0)}")
    lines.append("")

    summary = report.get("summary", {})
    lines.append("## 总体统计")
    lines.append("")
    lines.append(f"- 已测试课程数: {summary.get('tested_courses', 0)}")
    lines.append(f"- 通过课程数: {summary.get('passed_courses', 0)}")
    lines.append(f"- 警告课程数: {summary.get('warn_courses', 0)}")
    lines.append(f"- 失败课程数: {summary.get('failed_courses', 0)}")
    lines.append("")

    all_grades = report.get("all_grades", {})
    lines.append("## 汇总成绩测试")
    lines.append("")
    lines.append(f"- 解析到课程数: {all_grades.get('total_courses', 0)}")
    lines.append(f"- 来源页面: {all_grades.get('source_url', '')}")
    lines.append("")

    all_announcements = report.get("all_announcements", {})
    lines.append("## 汇总公告测试")
    lines.append("")
    lines.append(f"- 公告数量: {all_announcements.get('count', 0)}")
    lines.append(f"- 预览条目: {len(all_announcements.get('sample', []))}")
    lines.append("")

    lines.append("## 逐课程详情")
    lines.append("")
    for course in report.get("course_results", []):
        lines.append(f"### {course.get('course_name', '')} ({course.get('course_id', '')})")
        lines.append("")
        lines.append(f"- 状态: {course.get('status', '')}")
        lines.append(f"- 课程内容数量: {course.get('contents_count', 0)}")
        lines.append(f"- 作业数量: {course.get('assignments_count', 0)}")
        lines.append(f"- 成绩分项数量: {course.get('grade_items_count', 0)}")
        lines.append(f"- 公告数量: {course.get('announcements_count', 0)}")
        lines.append(f"- 总评: {course.get('total_grade', '')}")

        errors = course.get("errors", [])
        if errors:
            lines.append("- 错误信息:")
            for err in errors:
                lines.append(f"  - {err}")
        lines.append("")

    return "\n".join(lines)


def test_comprehensive_live(tmp_path: Path) -> None:
    username, password = require_live_credentials()

    report: dict[str, Any] = {
        "run_at": _now_iso(),
        "status": "initializing",
        "courses_total": 0,
        "all_grades": {},
        "all_announcements": {},
        "course_results": [],
        "summary": {},
    }

    report_dir = tmp_path / "reports"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = report_dir / f"comprehensive_{timestamp}.json"
    md_path = report_dir / f"comprehensive_{timestamp}.md"

    cas_client = CASClient()
    try:
        bb_service_url = "https://bb.sustech.edu.cn/webapps/login/"
        assert cas_client.login(username, password, bb_service_url)

        context = BlackboardAPIContext(client=cas_client.client, debug_enabled=False)
        course_api = BlackboardCourseAPI(cas_client.client)
        assignment_api = BlackboardAssignmentAPI(context)
        grade_api = BlackboardGradeAPI(context)
        announcement_api = BlackboardAnnouncementAPI(context)
        content_api = BlackboardContentAPI(context)

        courses = course_api.get_courses()
        report["courses_total"] = len(courses)

        all_grades = grade_api.get_all_grades(fallback_course_loader=lambda: courses)
        all_grades_courses = all_grades.courses
        report["all_grades"] = {
            "source_url": _safe_str(all_grades.source_url),
            "total_courses": int(all_grades.total_courses),
            "course_order": list(all_grades.course_order),
            "sample": _sample_list([_jsonable(item) for item in all_grades_courses.values()], 3),
        }

        all_announcements = announcement_api.get_all_announcement_dtos(
            course_loader=lambda: [{"id": item.course_id, "name": item.name} for item in courses],
            course_announcement_loader=lambda course_id: [
                item.to_dict() for item in announcement_api.get_course_announcement_dtos(course_id)
            ],
        )
        report["all_announcements"] = {
            "count": len(all_announcements),
            "sample": _sample_list([_jsonable(item) for item in all_announcements], 5),
        }

        passed_courses = 0
        warn_courses = 0
        failed_courses = 0

        for course in courses:
            course_id = _safe_str(course.course_id)
            course_name = _safe_str(course.name)

            course_report: dict[str, Any] = {
                "course_id": course_id,
                "course_name": course_name,
                "status": "pass",
                "contents_count": 0,
                "contents_sample": [],
                "assignments_count": 0,
                "assignments_sample": [],
                "grade_items_count": 0,
                "total_grade": "",
                "grade_sample": [],
                "announcements_count": 0,
                "announcements_sample": [],
                "errors": [],
            }

            try:
                contents = content_api.get_course_content_dtos(course_id)
                course_report["contents_count"] = len(contents)
                course_report["contents_sample"] = _sample_list([_jsonable(item) for item in contents], 3)
            except Exception as ex:
                course_report["errors"].append(f"课程内容获取异常: {ex}")
                course_report["status"] = "warn"

            try:
                assignments = assignment_api.get_course_assignments(course_id)
                course_report["assignments_count"] = len(assignments)
                course_report["assignments_sample"] = _sample_list([_jsonable(item) for item in assignments], 3)
            except Exception as ex:
                course_report["errors"].append(f"作业列表获取异常: {ex}")
                course_report["status"] = "warn"

            try:
                grades = grade_api.get_course_grades(course_id)
                course_report["grade_items_count"] = len(grades.items)
                course_report["total_grade"] = _safe_str(grades.total_grade)
                course_report["grade_sample"] = _sample_list([_jsonable(item) for item in grades.items], 3)
            except Exception as ex:
                course_report["errors"].append(f"成绩详情获取异常: {ex}")
                course_report["status"] = "warn"

            try:
                announcements = announcement_api.get_course_announcement_dtos(course_id)
                course_report["announcements_count"] = len(announcements)
                course_report["announcements_sample"] = _sample_list([_jsonable(item) for item in announcements], 3)
            except Exception as ex:
                course_report["errors"].append(f"公告列表获取异常: {ex}")
                course_report["status"] = "warn"

            if course_id in all_grades_courses:
                list_grade = _safe_str(all_grades_courses[course_id].listed_grade)
                if list_grade and course_report["total_grade"] and list_grade != course_report["total_grade"]:
                    course_report["errors"].append(
                        f"汇总成绩与课程详情总评不一致: listed={list_grade}, detail={course_report['total_grade']}"
                    )
                    if course_report["status"] == "pass":
                        course_report["status"] = "warn"

            if course_report["status"] == "pass":
                passed_courses += 1
            elif course_report["status"] == "warn":
                warn_courses += 1
            else:
                failed_courses += 1

            report["course_results"].append(course_report)

        report["summary"] = {
            "tested_courses": len(report["course_results"]),
            "passed_courses": passed_courses,
            "warn_courses": warn_courses,
            "failed_courses": failed_courses,
        }
        report["status"] = "completed"
    except Exception as ex:
        report["status"] = "error"
        report["fatal_error"] = f"{type(ex).__name__}: {ex}"
        report["traceback"] = traceback.format_exc()
        raise
    finally:
        cas_client.close()
        report_dir.mkdir(parents=True, exist_ok=True)
        json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        md_path.write_text(_build_markdown_report(report), encoding="utf-8")

    assert report["status"] == "completed"
    assert json_path.exists()
    assert md_path.exists()
