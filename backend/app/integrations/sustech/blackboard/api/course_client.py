"""Blackboard 课程抓取 facade / client。"""

from __future__ import annotations

from typing import Callable

import httpx

from app.integrations.sustech.blackboard.api.course_parser import BlackboardCourseParser
from app.integrations.sustech.blackboard.api.dto import CourseDTO
from app.integrations.sustech.blackboard.api.fetch_helpers import extract_xml_contents
from app.integrations.sustech.blackboard.shared import DEFAULT_BLACKBOARD_BASE_URL

ResponseLogger = Callable[[str, httpx.Response], None]


class BlackboardCourseAPI:
    """封装课程列表抓取请求，并委托解析器完成 HTML 解析。"""

    def __init__(
        self,
        client: httpx.Client,
        *,
        base_url: str = DEFAULT_BLACKBOARD_BASE_URL,
        response_logger: ResponseLogger | None = None,
        parser: BlackboardCourseParser | None = None,
    ) -> None:
        self.client = client
        self.base_url = base_url
        self.response_logger = response_logger
        self.parser = parser or BlackboardCourseParser(base_url=base_url)

    def get_courses(self) -> list[CourseDTO]:
        """通过 Ajax 课程模块抓取课程列表。"""
        tabs_url = f"{self.base_url}/webapps/portal/execute/tabs/tabAction"
        post_data = {
            "action": "refreshAjaxModule",
            "modId": "_22_1",
            "tabId": "_2_1",
            "tab_tab_group_id": "_2_1",
        }

        response = self.client.post(tabs_url, data=post_data)
        if self.response_logger is not None:
            self.response_logger("POST-refreshAjaxModule-_22_1", response)
        response.raise_for_status()

        html_to_parse = extract_xml_contents(response.text)
        if html_to_parse is None:
            html_to_parse = response.text

        return self.parser.parse_courses_html(html_to_parse)
