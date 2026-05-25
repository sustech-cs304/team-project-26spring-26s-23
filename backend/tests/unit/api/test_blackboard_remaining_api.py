from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from app.integrations.sustech.blackboard.api import (
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
    _assert_equal(items[0].description_html, "Read the instructions", "assignment dto html from detail page")

    details = api.get_assignment_details(detail_url)
    _assert_equal(details.title, "Assignment 1", "assignment detail title")
    _assert_equal(len(details.attachments), 2, "assignment detail attachments")
    _assert_equal(details.description_html, "Read the instructions", "assignment detail html")


def test_assignment_api_extracts_embedded_html_from_list_content_items() -> None:
    course_id = "_123_1"
    list_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    list_html = """
    <ul id="content_listContainer">
      <li id="contentListItem:_618374_1" class="clearfix liItem read">
        <div class="item clearfix" id="_618374_1">
          <h3><span style="color:#000000;">Homework 1</span></h3>
        </div>
        <div class="details">
          <div class="contextItemDetailsHeaders clearfix">
            <div class="detailsValue u_floatThis-left">
              <ul class="attachments clearfix">
                <li><a href="/bbcswebdav/xid-attachment1">hw1_question.pdf</a></li>
              </ul>
            </div>
          </div>
          <div class="vtbegenerated">
            <div class="vtbegenerated_div">The submission site: <a href="http://172.18.34.161:81/">http://172.18.34.161:81/</a></div>
            <div class="vtbegenerated_div"><strong>Remember to change your password</strong> after your first login.</div>
          </div>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(get_map={list_url: list_html})
    api = BlackboardAssignmentAPI(_build_context(client))

    items = api.get_course_assignments(course_id)
    _assert_equal(len(items), 1, "list content assignment count")
    _assert_equal(items[0].title, "Homework 1", "list content assignment title")
    _assert_equal(
        items[0].url,
        f"{list_url}#contentListItem:_618374_1",
        "list content assignment should use container fragment url",
    )
    _assert_true(bool(items[0].description_html), "list content assignment should keep embedded html")
    _assert_true(
        "Remember to change your password" in str(items[0].description_html),
        "list content assignment html should include embedded rich text",
    )
    _assert_equal(len(items[0].attachments), 1, "list content assignment attachments")


def test_assignment_api_preserves_list_content_description_when_detail_page_is_empty() -> None:
    course_id = "_123_1"
    list_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    detail_url = (
        "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment"
        f"?course_id={course_id}&content_id=_618374_1"
    )
    list_html = f"""
    <ul id="content_listContainer">
      <li id="contentListItem:_618374_1" class="clearfix liItem read">
        <div class="item clearfix" id="_618374_1">
          <h3><a href="{detail_url}"><span style="color:#000000;">Homework 1</span></a></h3>
        </div>
        <div class="details">
          <div class="contextItemDetailsHeaders clearfix">
            <div class="detailsValue u_floatThis-left">
              <ul class="attachments clearfix">
                <li><a href="/bbcswebdav/xid-attachment1">hw1_question.pdf</a></li>
              </ul>
            </div>
          </div>
          <div class="vtbegenerated">
            <div class="vtbegenerated_div">The submission site is available now.</div>
            <div class="vtbegenerated_div"><strong>Remember to change your password</strong> after your first login.</div>
          </div>
        </div>
      </li>
    </ul>
    """
    detail_html = """
    <html><body>
      <h1>Homework 1</h1>
    </body></html>
    """

    client = _FakeBlackboardClient(get_map={list_url: list_html, detail_url: detail_html})
    api = BlackboardAssignmentAPI(_build_context(client))

    items = api.get_course_assignments(course_id)
    _assert_equal(len(items), 1, "list content assignment count with detail page")
    _assert_true(bool(items[0].description_html), "list content description_html should survive empty detail page")
    _assert_true(
        "Remember to change your password" in str(items[0].description_html),
        "list content rich text should be used as description_html fallback",
    )
    _assert_true(
        "The submission site is available now." in str(items[0].description),
        "list content plain description should be used as detail fallback",
    )
    _assert_equal(len(items[0].attachments), 1, "list content attachments should be preserved when detail page is empty")


def test_assignment_api_extracts_start_and_end_time_labels() -> None:
    course_id = "_123_1"
    detail_url = (
        "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment"
        f"?course_id={course_id}&content_id=_777_1"
    )
    detail_html = """
    <html><body>
      <h1>Timed Assignment</h1>
      <div class="vtbegenerated">Read the timed instructions.</div>
      <dl>
        <dt>Available from:</dt><dd>2026-05-01 08:00</dd>
        <dt>Due:</dt><dd>2026-05-03 23:59</dd>
      </dl>
    </body></html>
    """

    client = _FakeBlackboardClient(get_map={detail_url: detail_html})
    api = BlackboardAssignmentAPI(_build_context(client))

    details = api.get_assignment_details(detail_url)
    _assert_equal(details.start_time, datetime(2026, 5, 1, 8, 0), "assignment start time")
    _assert_equal(details.end_time, datetime(2026, 5, 3, 23, 59), "assignment end time")


def test_assignment_api_ignores_download_noise_links_in_attachment_scope() -> None:
    course_id = "_123_1"
    detail_url = f"https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id={course_id}&content_id=_555_1"
    detail_html = """
    <html><body>
      <h1>Assignment 1</h1>
      <div class="vtbegenerated">Read the instructions</div>
      <a href="/bbcswebdav/xid-attachment1">spec.pdf</a>
      <a href="/webapps/blackboard/content/contentWrapper.jsp?content_id=_555_1&amp;displayName=Linked+File&amp;attachment=true&amp;course_id=_123_1&amp;href=https%3A%2F%2Fexample.com%2Fdownload">linked-file.pdf</a>
      <a href="https://example.com/download">download</a>
    </body></html>
    """

    client = _FakeBlackboardClient(get_map={detail_url: detail_html})
    api = BlackboardAssignmentAPI(_build_context(client))

    details = api.get_assignment_details(detail_url)
    _assert_equal(len(details.attachments), 2, "detail scope should keep real file links and skip plain download noise")
    _assert_equal([item.name for item in details.attachments], ["spec.pdf", "linked-file.pdf"], "download noise should not be treated as attachment")


def test_assignment_api_still_parses_list_content_fallback_after_mygrades_rows() -> None:
    course_id = "_123_1"
    grades_url = (
        f"https://bb.sustech.edu.cn/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}"
        "&stream_name=mygrades&is_stream=false"
    )
    detail_url = (
        "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment"
        f"?course_id={course_id}&content_id=_555_1"
    )
    list_url = (
        f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    )
    grades_html = f"""
    <div class="sortable_item_row row" id="row_1">
      <div class="cell gradable"><a href="{detail_url}">Assignment 1 Due: 2026-03-20 23:59</a></div>
      <div class="cell activity">Due: 2026-03-20 23:59</div>
      <div class="cell status">Submitted</div>
      <div class="cell grade">18/20</div>
    </div>
    """
    detail_html = """
    <html><body>
      <h1>Assignment 1</h1>
      <div class="vtbegenerated">Read the instructions</div>
    </body></html>
    """
    list_html = """
    <ul id="content_listContainer">
      <li id="contentListItem:_618374_1" class="clearfix liItem read">
        <div class="item clearfix" id="_618374_1">
          <h3><span style="color:#000000;">Homework 2</span></h3>
        </div>
        <div class="details">
          <div class="vtbegenerated">
            <div class="vtbegenerated_div">Submission portal is now available.</div>
          </div>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(
        get_map={
            grades_url: grades_html,
            detail_url: detail_html,
            list_url: list_html,
        }
    )
    api = BlackboardAssignmentAPI(_build_context(client))

    items = api.get_course_assignments(course_id)
    _assert_equal(len(items), 2, "later list content page should still contribute fallback assignments")
    fallback_item = next(item for item in items if item.title == "Homework 2")
    _assert_equal(
        fallback_item.url,
        f"{list_url}#contentListItem:_618374_1",
        "list content fallback should not be skipped after mygrades rows",
    )
    _assert_true(
        bool(fallback_item.description_html),
        "list content fallback assignment should retain embedded html when parsed after mygrades",
    )


def test_assignment_api_ignores_announcement_like_content_items_in_assignment_fallback() -> None:
    course_id = "_8012_1"
    list_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    list_html = """
    <ul id="content_listContainer">
      <li id="contentListItem:_43284_1" class="clearfix liItem read">
        <div class="item clearfix" id="_43284_1">
          <h3><span>Milestone 1 released</span></h3>
        </div>
        <div class="details">
          <div class="vtbegenerated">
            <p>Posted on: Monday, March 9, 2026 1:53:17 PM CST</p>
            <p>Please check Project -> Proposal for details.</p>
            <p>Due: May 22, 2026 2:44:54 PM</p>
          </div>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(get_map={list_url: list_html})
    api = BlackboardAssignmentAPI(_build_context(client))

    items = api.get_course_assignments(course_id)
    _assert_equal(
        items,
        [],
        "announcement/release notices should not be parsed as assignment fallback rows",
    )


def test_assignment_api_discovers_nested_content_id_pages_for_assignment_fallbacks() -> None:
    course_id = "_123_1"
    grades_url = (
        f"https://bb.sustech.edu.cn/webapps/bb-mygrades-BBLEARN/myGrades?course_id={course_id}"
        "&stream_name=mygrades&is_stream=false"
    )
    detail_url = (
        "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment"
        f"?course_id={course_id}&content_id=_555_1"
    )
    root_list_url = (
        f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    )
    nested_content_url = (
        f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}&content_id=_618374_1"
    )
    grades_html = f"""
    <div class="sortable_item_row row" id="row_1">
      <div class="cell gradable"><a href="{detail_url}">Assignment 1 Due: 2026-03-20 23:59</a></div>
      <div class="cell activity">Due: 2026-03-20 23:59</div>
      <div class="cell status">Submitted</div>
      <div class="cell grade">18/20</div>
    </div>
    """
    detail_html = """
    <html><body>
      <h1>Assignment 1</h1>
      <div class="vtbegenerated">Read the instructions</div>
    </body></html>
    """
    root_list_html = f"""
    <div id="courseMenuPalette_contents">
      <ul>
        <li><a href="/webapps/blackboard/content/listContent.jsp?course_id={course_id}&content_id=_618374_1">Homework</a></li>
      </ul>
    </div>
    """
    nested_content_html = """
    <ul id="content_listContainer">
      <li id="contentListItem:_618374_1" class="clearfix liItem read">
        <div class="item clearfix" id="_618374_1">
          <h3><span style="color:#000000;">Homework 2</span></h3>
        </div>
        <div class="details">
          <div class="vtbegenerated">
            <div class="vtbegenerated_div">Submission portal is now available.</div>
          </div>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(
        get_map={
            grades_url: grades_html,
            detail_url: detail_html,
            root_list_url: root_list_html,
            nested_content_url: nested_content_html,
        }
    )
    api = BlackboardAssignmentAPI(_build_context(client))

    items = api.get_course_assignments(course_id)
    _assert_equal(
        len(items),
        2,
        "nested content pages with content_id should be discovered and parsed as assignments",
    )
    fallback_item = next(item for item in items if item.title == "Homework 2")
    _assert_equal(
        fallback_item.assignment_id,
        "_618374_1",
        "nested content assignment should keep content_id as stable assignment id",
    )
    _assert_equal(
        fallback_item.url,
        f"{nested_content_url}#contentListItem:_618374_1",
        "nested content assignment should preserve content page url and fragment",
    )
    _assert_equal(
        fallback_item.source_page,
        nested_content_url,
        "nested content assignment should preserve originating content page for relation matching",
    )


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
    _assert_equal(merged[0].detail_html, "Exam room updated", "announcement merged html")


def test_announcement_api_extracts_launch_link_candidates_from_assignment_notice() -> None:
    page_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/announcement?method=search&context=mybb"
    html = """
    <ul class="announcementList">
      <li id="_43635_1" data-course-id="_8132_1">
        <h3 class="item">Lab assignment 2 released</h3>
        <div class="details">
          <p>Posted on 2026-04-19 16:48</p>
          <div class="vtbegenerated">
            <p>Please open the homework entry here:</p>
            <a href="/webapps/blackboard/content/launchLink.jsp?ann_id=_43635_1&course_id=_8132_1&mode=view">/Homework/Homework 2</a>
          </div>
        </div>
        <div class="announcementInfo">
          <p><span>Posted to:</span> Computer Organization Spring 2026</p>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(get_map={page_url: html})
    api = BlackboardAnnouncementAPI(_build_context(client))
    merged = api.get_all_announcement_dtos(
        course_loader=lambda: [{"id": "_8132_1", "name": "Computer Organization Spring 2026"}]
    )

    _assert_equal(len(merged), 1, "assignment notice should remain an announcement")
    _assert_equal(merged[0].announcement_id, "_43635_1", "announcement should keep Blackboard ann_id")
    _assert_equal(
        len(merged[0].linked_content_candidates),
        1,
        "assignment notice should expose one launch link candidate",
    )
    candidate = merged[0].linked_content_candidates[0]
    _assert_equal(candidate.get("ann_id"), "_43635_1", "launch link should expose ann_id")
    _assert_equal(candidate.get("course_id"), "_8132_1", "launch link should expose course_id")
    _assert_equal(candidate.get("path_text"), "/Homework/Homework 2", "launch link should keep content path text")
    _assert_true(bool(candidate.get("is_launch_link")), "launch link candidate should be marked explicitly")


def test_announcement_api_ignores_course_content_items_inside_announcement_like_wrappers() -> None:
    page_url = "https://bb.sustech.edu.cn/webapps/blackboard/execute/announcement?method=search&context=mybb"
    html = """
    <div id="announcements-module">
      <ul>
        <li id="contentListItem:_622694_1" class="clearfix liItem read">
          <div class="item clearfix" id="_622694_1">
            <h3><span style="color:#000000;">lab_assignment2</span></h3>
          </div>
          <div class="details">
            <div class="vtbegenerated">
              <div class="vtbegenerated_div">第二次实验作业已发布在头歌平台（ <a href="www.educoder.net">www.educoder.net</a> ）的“计算机组成原理2026春”课程中。</div>
              <div class="vtbegenerated_div"><strong>提醒：</strong>请在该作业的DDL（2026年4月21日晚23:59）之前完成所有题目的提交和评测。</div>
            </div>
          </div>
        </li>
      </ul>
    </div>
    """

    client = _FakeBlackboardClient(get_map={page_url: html})
    api = BlackboardAnnouncementAPI(_build_context(client))
    merged = api.get_all_announcement_dtos(
        course_loader=lambda: [{"id": "_123_1", "name": "Computer Organization Spring 2026"}]
    )
    _assert_equal(len(merged), 0, "course content assignment should not be parsed as announcement")


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
      <a href="/webapps/blackboard/content/listContent.jsp?course_id={course_id}&content_id=_cancel_1">Cancel</a>
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
    _assert_equal(folder.title, "Week 1", "content resources should filter Cancel folder noise")
    _assert_true(child.parent_id == folder.resource_id, "child resource should link to folder")
    _assert_true(len(context.request_history) >= 3, "context should record request history")


def test_content_api_groups_inline_attachment_blocks_under_logical_folders() -> None:
    course_id = "_123_1"
    list_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    launcher_url = f"https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id={course_id}"

    inline_html = f"""
    <div id="courseMenuPalette_contents">
      <ul>
        <li><a href="/webapps/blackboard/content/listContent.jsp?course_id={course_id}">Course Home</a></li>
      </ul>
    </div>
    <ul id="content_listContainer">
      <li id="contentListItem:_588326_1" class="clearfix liItem read">
        <div class="item clearfix" id="_588326_1">
          <h3><span style="color:#000000;">Slides</span></h3>
        </div>
        <div class="details">
          <div class="contextItemDetailsHeaders clearfix">
            <div class="detailsValue u_floatThis-left">
              <ul class="attachments clearfix">
                <li><a href="/bbcswebdav/xid-slide-1">01 Course Information.pdf</a> (<span>1.04 MB</span>)</li>
              </ul>
            </div>
          </div>
        </div>
      </li>
      <li id="contentListItem:_588327_1" class="clearfix liItem read">
        <div class="item clearfix" id="_588327_1">
          <h3><span style="color:#000000;">Videos</span></h3>
        </div>
        <div class="details">
          <div class="contextItemDetailsHeaders clearfix">
            <div class="detailsValue u_floatThis-left">
              <ul class="attachments clearfix">
                <li><a href="/bbcswebdav/xid-video-1">lec01.mp4</a> (<span>113.292 MB</span>)</li>
              </ul>
            </div>
          </div>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(
        get_map={
            list_url: inline_html,
            launcher_url: inline_html,
        }
    )
    api = BlackboardContentAPI(_build_context(client))

    resources = api.get_course_content_dtos(course_id)
    _assert_equal(len(resources), 4, "inline attachment page should yield 2 folders and 2 files")

    folders = {item.title: item for item in resources if item.type == "folder"}
    _assert_true("Slides" in folders, "inline attachments should create Slides folder")
    _assert_true("Videos" in folders, "inline attachments should create Videos folder")
    _assert_equal(folders["Slides"].resource_id, "_588326_1", "Slides folder should reuse content item id")
    _assert_equal(folders["Videos"].resource_id, "_588327_1", "Videos folder should reuse content item id")

    slide = next(item for item in resources if item.title == "01 Course Information.pdf")
    video = next(item for item in resources if item.title == "lec01.mp4")
    _assert_true(slide.parent_id == folders["Slides"].resource_id, "slide should attach under Slides folder")
    _assert_true(video.parent_id == folders["Videos"].resource_id, "video should attach under Videos folder")


def test_content_api_keeps_distinct_inline_folder_ids_when_page_url_has_content_id() -> None:
    course_id = "_8012_1"
    home_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    launcher_url = f"https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id={course_id}"
    labs_url = f"{home_url}&content_id=_588341_1"

    home_html = f"""
    <div id="courseMenuPalette_contents">
      <ul>
        <li><a href="/webapps/blackboard/content/listContent.jsp?course_id={course_id}&content_id=_588341_1">Labs</a></li>
      </ul>
    </div>
    """
    labs_html = """
    <ul id="content_listContainer">
      <li id="contentListItem:_588371_1" class="clearfix liItem read">
        <div class="item clearfix" id="_588371_1">
          <h3><span style="color:#000000;">Week 1</span></h3>
        </div>
        <div class="details">
          <div class="contextItemDetailsHeaders clearfix">
            <div class="detailsValue u_floatThis-left">
              <ul class="attachments clearfix">
                <li><a href="/bbcswebdav/pid-588371-dt-content-rid-19091455_1/xid-19091455_1">github-classroom.pdf</a></li>
              </ul>
            </div>
          </div>
        </div>
      </li>
      <li id="contentListItem:_588372_1" class="clearfix liItem read">
        <div class="item clearfix" id="_588372_1">
          <h3><span style="color:#000000;">Week 2</span></h3>
        </div>
        <div class="details">
          <div class="contextItemDetailsHeaders clearfix">
            <div class="detailsValue u_floatThis-left">
              <ul class="attachments clearfix">
                <li><a href="/bbcswebdav/pid-588372-dt-content-rid-19121932_1/xid-19121932_1">Tutorial2-Teedy Setup.pdf</a></li>
              </ul>
            </div>
          </div>
        </div>
      </li>
    </ul>
    """

    client = _FakeBlackboardClient(
        get_map={
            home_url: home_html,
            launcher_url: home_html,
            labs_url: labs_html,
        }
    )
    api = BlackboardContentAPI(_build_context(client))

    resources = api.get_course_content_dtos(course_id)
    _assert_equal(len(resources), 5, "content page with page-level content_id should keep page container plus two inline folders and two files")

    folders = {item.title: item for item in resources if item.type == "folder"}
    _assert_true("Labs" in folders, "seed-discovered page container should remain present")
    _assert_equal(folders["Week 1"].resource_id, "_588371_1", "Week 1 folder should keep contentListItem id")
    _assert_equal(folders["Week 2"].resource_id, "_588372_1", "Week 2 folder should keep contentListItem id")
    _assert_true(folders["Week 1"].parent_id == folders["Labs"].resource_id, "Week 1 folder should remain under Labs container")
    _assert_true(folders["Week 2"].parent_id == folders["Labs"].resource_id, "Week 2 folder should remain under Labs container")

    week1_file = next(item for item in resources if item.title == "github-classroom.pdf")
    week2_file = next(item for item in resources if item.title == "Tutorial2-Teedy Setup.pdf")
    _assert_true(week1_file.parent_id == "_588371_1", "Week 1 file should stay under Week 1 folder")
    _assert_true(week2_file.parent_id == "_588372_1", "Week 2 file should stay under Week 2 folder")
