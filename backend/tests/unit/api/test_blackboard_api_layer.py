from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from app.blackboard.api import (
    BlackboardCalendarICSParser,
    BlackboardCourseAPI,
    BlackboardCourseCatalogAPI,
    BlackboardCourseParser,
    extract_xml_contents,
)
from app.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription_from_text,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


class _FakeCourseAjaxClient:
    def __init__(self, response_text: str) -> None:
        self.response_text = response_text
        self.post_calls: list[tuple[str, dict[str, Any]]] = []

    def post(self, url: str, data: dict[str, Any] | None = None) -> httpx.Response:
        full_url = str(url)
        self.post_calls.append((full_url, dict(data or {})))
        return httpx.Response(
            status_code=200,
            text=self.response_text,
            request=httpx.Request("POST", full_url),
        )


class _FakeCatalogClient:
    def __init__(self, first_page_html: str, paged_html: dict[str, str]) -> None:
        self.first_page_html = first_page_html
        self.paged_html = paged_html
        self.requested_urls: list[str] = []

    def get(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        if params is not None:
            full_url = str(httpx.URL(url, params=params))
            self.requested_urls.append(full_url)
            return httpx.Response(
                status_code=200,
                text=self.first_page_html,
                request=httpx.Request("GET", full_url),
            )

        full_url = str(url)
        self.requested_urls.append(full_url)
        html = self.paged_html.get(full_url)
        status = 200 if html is not None else 404
        return httpx.Response(
            status_code=status,
            text=html or "not found",
            request=httpx.Request("GET", full_url),
        )


def _course_ajax_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8"?>
<contents><![CDATA[
<h3 class="termHeading">Spring 2026</h3>
<div id="termCourses__1">
  <ul>
    <li>
      <a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_100_1">CS100 Computer Science Intro</a>
      <span>Instructor: Alice</span>
    </li>
    <li>
      <a href="/webapps/blackboard/content/listContent.jsp?course_id=_200_1">MA201 Advanced Mathematics</a>
      <span>Teacher: Bob</span>
    </li>
    <li><a href="#ignore">Ignore</a></li>
  </ul>
</div>
]]></contents>
"""


def test_blackboard_course_api_parses_ajax_module_to_dto() -> None:
    xml_text = _course_ajax_xml()
    inner_html = extract_xml_contents(xml_text)
    if inner_html is None:
        raise AssertionError("extract_xml_contents should return ajax html")

    parser = BlackboardCourseParser()
    parser_rows = parser.parse_courses_html(inner_html)
    _assert_equal(len(parser_rows), 2, "parser rows length")
    _assert_equal(parser_rows[0].course_id, "_100_1", "parser first course_id")
    _assert_equal(parser_rows[0].term, "Spring 2026", "parser first term")
    _assert_equal(parser_rows[1].instructor, "Bob", "parser second instructor")

    api = BlackboardCourseAPI(_FakeCourseAjaxClient(xml_text))  # type: ignore[arg-type]
    courses = api.get_courses()
    _assert_equal(len(courses), 2, "api rows length")
    _assert_equal(courses[0].name, "CS100 Computer Science Intro", "api first name")
    _assert_equal(courses[1].course_id, "_200_1", "api second course_id")


def test_blackboard_course_catalog_api_returns_dto_with_pagination() -> None:
    page1_html = """
    <html><body>
      <table id="listContainer_datatable">
        <thead>
          <tr>
            <th>Course ID</th>
            <th>Course Name</th>
            <th>Instructor</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_100_1">CS100</a></th>
            <td><span class="table-data-cell-value">计算机导论</span></td>
            <td><span class="table-data-cell-value">Alice</span></td>
            <td><span class="table-data-cell-value">第一页课程</span></td>
          </tr>
        </tbody>
      </table>
      <a href="/webapps/blackboard/execute/viewCatalog?type=Course&startIndex=20">下一页</a>
    </body></html>
    """

    page2_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/viewCatalog?type=Course&startIndex=20"
    page2_html = """
    <html><body>
      <table id="listContainer_datatable">
        <thead>
          <tr>
            <th>Course ID</th>
            <th>Course Name</th>
            <th>Instructor</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_100_1">CS100</a></th>
            <td><span class="table-data-cell-value">计算机导论</span></td>
            <td><span class="table-data-cell-value">Alice</span></td>
            <td><span class="table-data-cell-value">重复记录</span></td>
          </tr>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_200_1">CS200</a></th>
            <td><span class="table-data-cell-value">数据结构</span></td>
            <td><span class="table-data-cell-value">Bob</span></td>
            <td><span class="table-data-cell-value">第二页新增</span></td>
          </tr>
        </tbody>
      </table>
    </body></html>
    """

    api = BlackboardCourseCatalogAPI(
        _FakeCatalogClient(page1_html, {page2_url: page2_html})  # type: ignore[arg-type]
    )
    rows = api.search_course_catalog("计算机")

    _assert_equal(len(rows), 2, "catalog dto rows length")
    _assert_equal(rows[0].course_identifier, "CS100", "catalog first identifier")
    _assert_equal(rows[1].course_name, "数据结构", "catalog second course_name")


def test_calendar_ics_parser_and_provider_use_case_return_typed_events(tmp_path: Path) -> None:
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:20260306T042022Z-_blackboard.platform.gradebook2.GradableItem-_407181_1@bbapps7
SUMMARY:Assignment 0: Declaration Form
DTSTART:20260315T155900Z
DTEND:20260315T155900Z
DESCRIPTION:courseId:_407181_1
END:VEVENT
END:VCALENDAR
"""

    parser = BlackboardCalendarICSParser()
    events = parser.parse_events(ics_text)
    _assert_equal(len(events), 1, "ics dto rows length")
    _assert_equal(events[0].course_id, "_407181_1", "ics dto course_id")

    db_path = tmp_path / "test_blackboard_api_layer_ics.db"
    result = refresh_calendar_ics_subscription_from_text(
        "https://example.local/api-layer.ics",
        ics_text,
        db_path=db_path,
        reset_schema=True,
    )
    _assert_equal(result.active_event_count, 1, "ics synced active count")
    _assert_equal(result.active_events[0].title, "Assignment 0: Declaration Form", "ics synced title")
    _assert_equal(
        result.active_events[0].start_at,
        datetime(2026, 3, 15, 15, 59, 0, tzinfo=UTC).replace(tzinfo=None),
        "ics synced start_at",
    )
