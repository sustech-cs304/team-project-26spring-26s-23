from __future__ import annotations

from typing import Any

import httpx

from app.integrations.sustech.blackboard.api import BlackboardCourseCatalogAPI, parse_course_catalog_table


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



def test_search_course_catalog_quick_mode_skips_show_all_and_deep_pagination() -> None:
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
      <a href="/webapps/blackboard/execute/viewCatalog?type=Course&showAll=true">全部显示</a>
    </body></html>
    """
    page2_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/viewCatalog?type=Course&startIndex=20"
    show_all_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/viewCatalog?type=Course&showAll=true"
    page2_html = """
    <html><body>
      <table id="listContainer_datatable">
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_200_1">CS200</a></th>
            <td><span class="table-data-cell-value">数据结构</span></td>
            <td><span class="table-data-cell-value">Bob</span></td>
            <td><span class="table-data-cell-value">第二页课程</span></td>
          </tr>
        </tbody>
      </table>
    </body></html>
    """
    show_all_html = """
    <html><body>
      <table id="listContainer_datatable">
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_300_1">CS300</a></th>
            <td><span class="table-data-cell-value">算法设计</span></td>
            <td><span class="table-data-cell-value">Carol</span></td>
            <td><span class="table-data-cell-value">show-all 课程</span></td>
          </tr>
        </tbody>
      </table>
    </body></html>
    """

    fake_client = _FakeCatalogClient(
        first_page_html=page1_html,
        paged_html={
            page2_url: page2_html,
            show_all_url: show_all_html,
        },
    )

    api = BlackboardCourseCatalogAPI(fake_client)  # type: ignore[arg-type]
    rows = api.search_course_catalog("计算机", fetch_mode="quick", max_pages=5)

    _assert_equal([row.course_identifier for row in rows], ["CS100"], "quick mode should keep only initial page rows")
    _assert_equal(len(fake_client.requested_urls), 1, "quick mode should not follow next/show-all pages")
    assert page2_url not in fake_client.requested_urls
    assert show_all_url not in fake_client.requested_urls



def test_search_course_catalog_full_mode_follows_show_all_results() -> None:
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
      <a href="/webapps/blackboard/execute/viewCatalog?type=Course&showAll=true">全部显示</a>
    </body></html>
    """
    show_all_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/viewCatalog?type=Course&showAll=true"
    show_all_page2_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/viewCatalog?type=Course&showAll=true&startIndex=100"
    show_all_html = """
    <html><body>
      <table id="listContainer_datatable">
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_100_1">CS100</a></th>
            <td><span class="table-data-cell-value">计算机导论</span></td>
            <td><span class="table-data-cell-value">Alice</span></td>
            <td><span class="table-data-cell-value">重复记录</span></td>
          </tr>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_300_1">CS300</a></th>
            <td><span class="table-data-cell-value">算法设计</span></td>
            <td><span class="table-data-cell-value">Carol</span></td>
            <td><span class="table-data-cell-value">show-all 第一页新增</span></td>
          </tr>
        </tbody>
      </table>
      <a href="/webapps/blackboard/execute/viewCatalog?type=Course&showAll=true&startIndex=100">下一页</a>
    </body></html>
    """
    show_all_page2_html = """
    <html><body>
      <table id="listContainer_datatable">
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_400_1">CS400</a></th>
            <td><span class="table-data-cell-value">机器学习</span></td>
            <td><span class="table-data-cell-value">Dave</span></td>
            <td><span class="table-data-cell-value">show-all 第二页新增</span></td>
          </tr>
        </tbody>
      </table>
    </body></html>
    """

    fake_client = _FakeCatalogClient(
        first_page_html=page1_html,
        paged_html={
            show_all_url: show_all_html,
            show_all_page2_url: show_all_page2_html,
        },
    )

    api = BlackboardCourseCatalogAPI(fake_client)  # type: ignore[arg-type]
    rows = api.search_course_catalog("计算机", fetch_mode="full", max_pages=5)

    _assert_equal(
        [row.course_identifier for row in rows],
        ["CS100", "CS300", "CS400"],
        "full mode should merge show-all pagination results",
    )
    assert show_all_url in fake_client.requested_urls
    assert show_all_page2_url in fake_client.requested_urls



def test_search_course_catalog_max_pages_caps_pagination_depth() -> None:
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
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_200_1">CS200</a></th>
            <td><span class="table-data-cell-value">数据结构</span></td>
            <td><span class="table-data-cell-value">Bob</span></td>
            <td><span class="table-data-cell-value">第二页课程</span></td>
          </tr>
        </tbody>
      </table>
      <a href="/webapps/blackboard/execute/viewCatalog?type=Course&startIndex=40">下一页</a>
    </body></html>
    """
    page3_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/viewCatalog?type=Course&startIndex=40"
    page3_html = """
    <html><body>
      <table id="listContainer_datatable">
        <tbody>
          <tr>
            <th><a href="/webapps/blackboard/execute/launcher?type=Course&course_id=_300_1">CS300</a></th>
            <td><span class="table-data-cell-value">算法设计</span></td>
            <td><span class="table-data-cell-value">Carol</span></td>
            <td><span class="table-data-cell-value">第三页课程</span></td>
          </tr>
        </tbody>
      </table>
    </body></html>
    """

    fake_client = _FakeCatalogClient(
        first_page_html=page1_html,
        paged_html={
            page2_url: page2_html,
            page3_url: page3_html,
        },
    )

    api = BlackboardCourseCatalogAPI(fake_client)  # type: ignore[arg-type]
    rows = api.search_course_catalog("计算机", fetch_mode="full", max_pages=2)

    _assert_equal([row.course_identifier for row in rows], ["CS100", "CS200"], "max_pages should cap api pagination depth")
    assert page2_url in fake_client.requested_urls
    assert page3_url not in fake_client.requested_urls
