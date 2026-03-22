from __future__ import annotations

from typing import Any

import httpx

from app.blackboard.api import (
    BlackboardAPIContext,
    BlackboardAnnouncementAPI,
    BlackboardAssignmentAPI,
    BlackboardContentAPI,
    BlackboardGradeAPI,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class _FakeBlackboardClient:
    def __init__(
        self,
        *,
        get_map: dict[str, str] | None = None,
        post_map: dict[tuple[str, tuple[tuple[str, str], ...]], str] | None = None,
    ) -> None:
        self.get_map = get_map or {}
        self.post_map = post_map or {}
        self.calls: list[tuple[str, str]] = []

    def get(self, url: Any, *, params: Any | None = None) -> httpx.Response:
        full_url = str(httpx.URL(str(url), params=params)) if params else str(url)
        self.calls.append(("GET", full_url))
        text = self.get_map.get(full_url)
        status_code = 200 if text is not None else 404
        return httpx.Response(
            status_code=status_code,
            text=text or "not found",
            request=httpx.Request("GET", full_url),
        )

    def post(self, url: Any, *, data: Any | None = None) -> httpx.Response:
        full_url = str(url)
        normalized = tuple(sorted((str(k), str(v)) for k, v in dict(data or {}).items()))
        self.calls.append(("POST", full_url))
        text = self.post_map.get((full_url, normalized))
        status_code = 200 if text is not None else 404
        return httpx.Response(
            status_code=status_code,
            text=text or "not found",
            request=httpx.Request("POST", full_url),
        )


def _build_context(client: _FakeBlackboardClient) -> BlackboardAPIContext:
    return BlackboardAPIContext(client=client, debug_enabled=False)


def test_assignment_api_returns_dtos() -> None:
    course_id = "_123_1"
    grades_url = (
        f"https://bb.sustech.edu.cn/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}"
        "&stream_name=mygrades&is_stream=false"
    )
    detail_url = "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id=_123_1&content_id=_555_1"
    grades_html = f"""
    <div class="sortable_item_row row" id="row_1">
      <div class="cell gradable"><a href="{detail_url}">Assignment 1 Due: 2026-03-20 23:59</a></div>
      <div class="cell activity">Due: 2026-03-20 23:59</div>
      <div class="cell status">Submitted</div>
      <div class="cell grade">18/20</div>
      <a href="/bbcswebdav/xid-attachment1">spec.pdf</a>
    </div>
    """
    detail_html = """
    <html><body>
      <h1>Assignment 1</h1>
      <div class="vtbegenerated">Read the instructions</div>
      <a href="/bbcswebdav/xid-attachment1">spec.pdf</a>
      <a href="/bbcswebdav/xid-attachment2">template.docx</a>
    </body></html>
    """

    client = _FakeBlackboardClient(get_map={grades_url: grades_html, detail_url: detail_html})
    api = BlackboardAssignmentAPI(_build_context(client))
    items = api.get_course_assignments(course_id)
    _assert_equal(len(items), 1, "assignment dto count")
    _assert_equal(items[0].title, "Assignment 1", "assignment dto title")
    _assert_equal(len(items[0].attachments), 2, "assignment dto attachments dedup+merge")

    details = api.get_assignment_details(detail_url)
    _assert_equal(details.title, "Assignment 1", "assignment detail title")
    _assert_equal(len(details.attachments), 2, "assignment detail attachments")


def test_grade_api_returns_typed_statistics() -> None:
    course_id = "_123_1"
    grades_url = (
        f"https://bb.sustech.edu.cn/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}"
        "&stream_name=mygrades&is_stream=false"
    )
    all_grades_url = "https://bb.sustech.edu.cn/webapps/gradebook/do/student/viewGrades"
    grades_html = """
    <div class="sortable_item_row row" id="row_1">
      <div class="cell gradable"><a href="/webapps/grade?content_id=_1">Assignment 1</a></div>
      <div class="cell activity">Due: 2026-03-18 23:59</div>
      <div class="cell status">Graded</div>
      <div class="cell grade">18/20</div>
    </div>
    <div class="sortable_item_row row" id="row_2">
      <div class="cell gradable">Course Grade</div>
      <div class="cell grade">90%</div>
    </div>
    """
    all_grades_html = f"""
    <div id="contentPanel">
      <a href="/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}">Software Engineering (90%)</a>
    </div>
    """

    client = _FakeBlackboardClient(get_map={grades_url: grades_html, all_grades_url: all_grades_html})
    api = BlackboardGradeAPI(_build_context(client))
    course_grades = api.get_course_grades(course_id)
    _assert_equal(course_grades.total_grade, "90%", "grade total")
    _assert_equal(course_grades.stats.get("graded_items"), 2, "grade graded_items")

    all_grades = api.get_all_grades()
    _assert_equal(all_grades.total_courses, 1, "all grades total courses")
    _assert_true(course_id in all_grades.courses, "all grades should contain course")
    _assert_equal(all_grades.courses[course_id].total_grade, "90%", "all grades total grade")


def test_announcement_api_returns_typed_cross_course_merge() -> None:
    page_url = "https://bb.sustech.edu.cn/webapps/portal/execute/defaultTab"
    announcement_html = """
    <ul class="announcementList">
      <li id="announcement_1" data-course-id="_123_1">
        <h3>Midterm Notice</h3>
        <div class="details">Posted on 2026-03-08 10:00</div>
        <div class="announcementInfo"><p><span>Posted to:</span> Software Engineering</p></div>
        <div class="vtbegenerated">Exam room updated</div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(get_map={page_url: announcement_html})
    api = BlackboardAnnouncementAPI(_build_context(client))
    merged = api.get_all_announcement_dtos(
        course_loader=lambda: [{"id": "_123_1", "name": "Software Engineering"}]
    )
    _assert_equal(len(merged), 1, "announcement merged count")
    _assert_equal(merged[0].course_id, "_123_1", "announcement merged course_id")
    _assert_equal(merged[0].title, "Midterm Notice", "announcement merged title")


def test_content_api_returns_typed_sidebar_and_hierarchy() -> None:
    course_id = "_123_1"
    list_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    subfolder_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}&content_id=_folder_1"
    launcher_url = f"https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id={course_id}"

    sidebar_html = f"""
    <div id="courseMenuPalette_contents">
      <ul>
        <li class="separator"><span>课程内容</span></li>
        <li><a href="/webapps/blackboard/content/listContent.jsp?course_id={course_id}">Course Home</a></li>
      </ul>
    </div>
    <div id="contentPanel">
      <a href="/webapps/blackboard/content/listContent.jsp?course_id={course_id}&content_id=_folder_1">Week 1</a>
    </div>
    """
    subfolder_html = """
    <div id="contentPanel">
      <a href="/bbcswebdav/xid-file_1">lecture1.pdf</a>
    </div>
    """

    client = _FakeBlackboardClient(
        get_map={
            list_url: sidebar_html,
            launcher_url: sidebar_html,
            subfolder_url: subfolder_html,
        }
    )
    context = _build_context(client)
    api = BlackboardContentAPI(context)
    grouped = api.get_course_sidebar(course_id)
    _assert_true("课程内容" in grouped, "sidebar group should exist")

    resources = api.get_course_content_dtos(course_id)
    _assert_equal(len(resources), 2, "content resources should include folder and file")
    folder = next(item for item in resources if item.type == "folder")
    child = next(item for item in resources if item.type != "folder")
    _assert_true(child.parent_id == folder.resource_id, "child resource should link to folder")
    _assert_true(len(context.request_history) >= 3, "context should record request history")
