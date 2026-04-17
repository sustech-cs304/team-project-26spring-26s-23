from __future__ import annotations

from typing import Any

from app.integrations.sustech.blackboard.api import (
    BlackboardAnnouncementAPI,
    BlackboardAssignmentAPI,
    BlackboardContentAPI,
    BlackboardCourseAPI,
    BlackboardGradeAPI,
)

from .reporting import jsonable, now_iso, sample_items


def build_initial_report() -> dict[str, Any]:
    return {
        "run_at": now_iso(),
        "status": "initializing",
        "courses_total": 0,
        "all_grades": {},
        "all_announcements": {},
        "course_results": [],
        "summary": {},
    }


def populate_comprehensive_report(
    report: dict[str, Any],
    *,
    course_api: BlackboardCourseAPI,
    assignment_api: BlackboardAssignmentAPI,
    grade_api: BlackboardGradeAPI,
    announcement_api: BlackboardAnnouncementAPI,
    content_api: BlackboardContentAPI,
) -> None:
    courses = course_api.get_courses()
    report["courses_total"] = len(courses)

    all_grades = grade_api.get_all_grades(fallback_course_loader=lambda: courses)
    all_grades_courses = all_grades.courses
    report["all_grades"] = {
        "source_url": _safe_str(all_grades.source_url),
        "total_courses": int(all_grades.total_courses),
        "course_order": list(all_grades.course_order),
        "sample": sample_items([jsonable(item) for item in all_grades_courses.values()], 3),
    }

    all_announcements = announcement_api.get_all_announcement_dtos(
        course_loader=lambda: [{"id": item.course_id, "name": item.name} for item in courses],
        course_announcement_loader=lambda course_id: [
            item.to_dict() for item in announcement_api.get_course_announcement_dtos(course_id)
        ],
    )
    report["all_announcements"] = {
        "count": len(all_announcements),
        "sample": sample_items([jsonable(item) for item in all_announcements], 5),
    }

    course_results = [
        _build_course_report(
            course=course,
            assignment_api=assignment_api,
            grade_api=grade_api,
            announcement_api=announcement_api,
            content_api=content_api,
            all_grades_courses=all_grades_courses,
        )
        for course in courses
    ]
    report["course_results"] = course_results
    report["summary"] = _summarize_course_results(course_results)
    report["status"] = "completed"



def build_markdown_report(report: dict[str, Any]) -> str:
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



def _build_course_report(
    *,
    course: Any,
    assignment_api: BlackboardAssignmentAPI,
    grade_api: BlackboardGradeAPI,
    announcement_api: BlackboardAnnouncementAPI,
    content_api: BlackboardContentAPI,
    all_grades_courses: dict[str, Any],
) -> dict[str, Any]:
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
        course_report["contents_sample"] = sample_items([jsonable(item) for item in contents], 3)
    except Exception as ex:
        _append_warning(course_report, f"课程内容获取异常: {ex}")

    try:
        assignments = assignment_api.get_course_assignments(course_id)
        course_report["assignments_count"] = len(assignments)
        course_report["assignments_sample"] = sample_items([jsonable(item) for item in assignments], 3)
    except Exception as ex:
        _append_warning(course_report, f"作业列表获取异常: {ex}")

    try:
        grades = grade_api.get_course_grades(course_id)
        course_report["grade_items_count"] = len(grades.items)
        course_report["total_grade"] = _safe_str(grades.total_grade)
        course_report["grade_sample"] = sample_items([jsonable(item) for item in grades.items], 3)
    except Exception as ex:
        _append_warning(course_report, f"成绩详情获取异常: {ex}")

    try:
        announcements = announcement_api.get_course_announcement_dtos(course_id)
        course_report["announcements_count"] = len(announcements)
        course_report["announcements_sample"] = sample_items([jsonable(item) for item in announcements], 3)
    except Exception as ex:
        _append_warning(course_report, f"公告列表获取异常: {ex}")

    if course_id in all_grades_courses:
        list_grade = _safe_str(all_grades_courses[course_id].listed_grade)
        if list_grade and course_report["total_grade"] and list_grade != course_report["total_grade"]:
            _append_warning(
                course_report,
                f"汇总成绩与课程详情总评不一致: listed={list_grade}, detail={course_report['total_grade']}",
            )

    return course_report



def _summarize_course_results(course_results: list[dict[str, Any]]) -> dict[str, int]:
    passed_courses = sum(1 for course in course_results if course.get("status") == "pass")
    warn_courses = sum(1 for course in course_results if course.get("status") == "warn")
    failed_courses = len(course_results) - passed_courses - warn_courses
    return {
        "tested_courses": len(course_results),
        "passed_courses": passed_courses,
        "warn_courses": warn_courses,
        "failed_courses": failed_courses,
    }



def _append_warning(course_report: dict[str, Any], message: str) -> None:
    course_report["errors"].append(message)
    if course_report["status"] == "pass":
        course_report["status"] = "warn"



def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)
