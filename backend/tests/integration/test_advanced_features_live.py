from __future__ import annotations

from typing import Any

import pytest

from app.integrations.sustech.blackboard.api import (
    BlackboardAPIContext,
    BlackboardAnnouncementAPI,
    BlackboardAssignmentAPI,
    BlackboardCourseAPI,
    BlackboardGradeAPI,
)
from app.shared_integrations.sustech_auth.cas_client import CASClient
from tests.helpers import require_live_credentials

pytestmark = pytest.mark.live


def _check_assignments(api: BlackboardAssignmentAPI, course_id: str) -> dict[str, Any]:
    assignments = api.get_course_assignments(course_id)
    sample_assignment = assignments[0] if assignments else None
    assignment_details: dict[str, Any] = {}

    if sample_assignment and sample_assignment.url:
        assignment_details = api.get_assignment_details(str(sample_assignment.url)).to_dict()

    return {
        "ok": True,
        "count": len(assignments),
        "sample": sample_assignment.to_dict() if sample_assignment else {},
        "details": assignment_details,
    }


def _check_grades(api: BlackboardGradeAPI, course_id: str) -> dict[str, Any]:
    grades = api.get_course_grades(course_id)
    return {
        "ok": True,
        "total_grade": str(grades.total_grade or ""),
        "item_count": len(grades.items),
        "stats": grades.stats,
    }


def _check_announcements(api: BlackboardAnnouncementAPI, course_id: str) -> dict[str, Any]:
    announcements = api.get_course_announcement_dtos(course_id)
    return {
        "ok": True,
        "count": len(announcements),
        "sample": announcements[0].to_dict() if announcements else {},
    }


def test_advanced_features_live() -> None:
    username, password = require_live_credentials()

    cas_client = CASClient()
    try:
        bb_service_url = "https://bb.sustech.edu.cn/webapps/login/"
        assert cas_client.login(username, password, bb_service_url)

        context = BlackboardAPIContext(client=cas_client.client, debug_enabled=False)
        course_api = BlackboardCourseAPI(cas_client.client)
        assignment_api = BlackboardAssignmentAPI(context)
        grade_api = BlackboardGradeAPI(context)
        announcement_api = BlackboardAnnouncementAPI(context)

        courses = course_api.get_courses()
        if not courses:
            pytest.skip("当前账号未返回课程，跳过高级功能 live 校验")

        course = courses[0]
        course_id = str(course.course_id or "")
        assert course_id

        assignment_result = _check_assignments(assignment_api, course_id)
        grade_result = _check_grades(grade_api, course_id)
        announcement_result = _check_announcements(announcement_api, course_id)
    finally:
        cas_client.close()

    assert assignment_result["ok"]
    assert grade_result["ok"]
    assert announcement_result["ok"]
