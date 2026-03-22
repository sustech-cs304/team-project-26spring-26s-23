from __future__ import annotations

from typing import Any

import httpx

from app.blackboard.api import BlackboardCourseCatalogAPI, parse_course_catalog_table


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


class _FakeCatalogClient:
    """仅用于离线测试课程目录分页逻辑的最小客户端。"""

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


def test_parse_course_catalog_table_with_course_id_link() -> None:
    html = """
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
          <td>CS101</td>
          <td><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_98765_1">Computer Science Intro</a></td>
          <td>Alice</td>
          <td>Foundations of computing</td>
        </tr>
      </tbody>
    </table>
    """

    rows = parse_course_catalog_table(html)

    _assert_equal(len(rows), 1, "rows length")
    _assert_equal(rows[0].course_identifier, "CS101", "course_identifier")
    _assert_equal(rows[0].course_name, "Computer Science Intro", "course_name")
    _assert_equal(rows[0].instructor, "Alice", "instructor")
    _assert_equal(rows[0].description, "Foundations of computing", "description")
    _assert_equal(rows[0].course_id, "_98765_1", "course_id")


def test_parse_course_catalog_table_without_link_course_id_empty() -> None:
    html = """
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
          <td>MA201</td>
          <td>Advanced Mathematics</td>
          <td>Bob</td>
          <td>No direct course link in this row</td>
        </tr>
      </tbody>
    </table>
    """

    rows = parse_course_catalog_table(html)

    _assert_equal(len(rows), 1, "rows length")
    _assert_equal(rows[0].course_identifier, "MA201", "course_identifier")
    _assert_equal(rows[0].course_name, "Advanced Mathematics", "course_name")
    _assert_equal(rows[0].instructor, "Bob", "instructor")
    _assert_equal(rows[0].description, "No direct course link in this row", "description")
    _assert_equal(rows[0].course_id, None, "course_id")


def test_parse_course_catalog_table_extracts_pure_values_with_labels() -> None:
    html = """
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
          <th>
            <a onclick="window.location='/webapps/blackboard/execute/launcher?type=Course&course_id=_305_1'; return false;">CS305</a>
          </th>
          <td>
            <span class="table-data-cell-label">课程名称:</span>
            <span class="table-data-cell-value">数据库系统</span>
          </td>
          <td>
            <span class="table-data-cell-label">教师:</span>
            <span class="table-data-cell-value">张老师</span>
          </td>
          <td>
            <span class="table-data-cell-label">描述:</span>
            <span class="table-data-cell-value">关系模型与SQL</span>
          </td>
        </tr>
      </tbody>
    </table>
    """

    rows = parse_course_catalog_table(html)

    _assert_equal(len(rows), 1, "rows length")
    _assert_equal(rows[0].course_identifier, "CS305", "course_identifier pure")
    _assert_equal(rows[0].course_name, "数据库系统", "course_name pure")
    _assert_equal(rows[0].instructor, "张老师", "instructor pure")
    _assert_equal(rows[0].description, "关系模型与SQL", "description pure")
    _assert_equal(rows[0].course_id, "_305_1", "course_id from onclick")


def test_search_course_catalog_merges_pages_and_dedupes() -> None:
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

    fake_client = _FakeCatalogClient(
        first_page_html=page1_html,
        paged_html={
            page2_url: page2_html,
        },
    )

    api = BlackboardCourseCatalogAPI(fake_client)  # type: ignore[arg-type]
    rows = api.search_course_catalog("计算机")

    _assert_equal(len(rows), 2, "merged rows length")
    _assert_equal(rows[0].course_identifier, "CS100", "page1 row keep")
    _assert_equal(rows[1].course_identifier, "CS200", "page2 row merged")
    _assert_equal(rows[1].course_name, "数据结构", "page2 course_name")
