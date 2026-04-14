from __future__ import annotations

from typing import Any

import httpx

from app.integrations.sustech.blackboard.api import BlackboardAPIContext, BlackboardContentAPI


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class _FakeSidebarClient:
    """仅用于离线测试课程 sidebar 抓取逻辑。"""

    def __init__(
        self,
        url_to_html: dict[str, str] | None = None,
        fail_urls: set[str] | None = None,
    ) -> None:
        self.url_to_html = url_to_html or {}
        self.fail_urls = fail_urls or set()
        self.requested_urls: list[str] = []

    def get(self, url: str, params: dict[str, Any] | None = None) -> httpx.Response:
        full_url = str(httpx.URL(url, params=params)) if params else str(url)
        self.requested_urls.append(full_url)

        if full_url in self.fail_urls:
            raise RuntimeError(f"mock request failed: {full_url}")

        html = self.url_to_html.get(full_url, "")
        status_code = 200 if full_url in self.url_to_html else 404
        return httpx.Response(
            status_code=status_code,
            text=html,
            request=httpx.Request("GET", full_url),
        )


def test_parse_course_sidebar_extract_groups_and_links() -> None:
    html = """
    <div id="courseMenuPalette_contents">
      <ul>
        <li class="separator"><span>课程内容</span></li>
        <li><a href="/webapps/blackboard/content/listContent.jsp?course_id=_123_1&content_id=_111_1">Week 1</a></li>
        <li><a href="/webapps/blackboard/content/listContent.jsp?course_id=_123_1&content_id=_222_1#section">课程资源</a></li>
        <li class="separator">工具</li>
        <li><a href="/webapps/blackboard/execute/announcement?method=search&course_id=_123_1">公告</a></li>
      </ul>
    </div>
    """

    with httpx.Client() as client:
        api = BlackboardContentAPI(BlackboardAPIContext(client=client, debug_enabled=False))
        grouped = api.parse_course_sidebar(
            html,
            "https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id=_123_1",
            course_id="_123_1",
        )

    _assert_true("课程内容" in grouped, "应提取到课程内容分组")
    links = grouped["课程内容"]
    _assert_equal(len(links), 2, "课程内容分组链接数量")
    _assert_equal(links[0]["title"], "Week 1", "第一个链接标题")
    _assert_true(
        links[0]["url"].startswith("https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp"),
        "相对链接应被绝对化",
    )
    _assert_true("#" not in links[1]["url"], "sidebar seed URL 应去除 fragment")

    _assert_true("工具" not in grouped, "噪声分组不应进入结果")


def test_get_course_sidebar_returns_empty_when_request_fails() -> None:
    course_id = "_321_1"
    list_content_url = f"https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id={course_id}"
    launcher_url = f"https://bb.sustech.edu.cn/webapps/blackboard/execute/launcher?type=Course&id={course_id}"

    fake_client = _FakeSidebarClient(
        fail_urls={list_content_url, launcher_url},
    )
    api = BlackboardContentAPI(BlackboardAPIContext(client=fake_client, debug_enabled=False))  # type: ignore[arg-type]

    grouped = api.get_course_sidebar(course_id)
    _assert_equal(grouped, {}, "请求失败时应回退为空结果")


def test_parse_course_sidebar_empty_or_missing_root_returns_empty() -> None:
    with httpx.Client() as client:
        api = BlackboardContentAPI(BlackboardAPIContext(client=client, debug_enabled=False))
        grouped_empty_html = api.parse_course_sidebar(
            "",
            "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_1_1",
            course_id="_1_1",
        )
        grouped_no_root = api.parse_course_sidebar(
            "<html><body><div id='contentPanel'>no sidebar</div></body></html>",
            "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_1_1",
            course_id="_1_1",
        )

    _assert_equal(grouped_empty_html, {}, "空HTML应返回空结果")
    _assert_equal(grouped_no_root, {}, "缺少sidebar根节点应返回空结果")
