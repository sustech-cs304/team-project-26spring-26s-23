"""Blackboard API 层共享上下文与显式抓取状态。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol
from urllib.parse import urljoin

import httpx

from app.blackboard.shared import extract_blackboard_ids_from_url, extract_course_id_from_url
from app.blackboard.shared.logging import BlackboardLogger, LogLevel


class BlackboardHTTPClient(Protocol):
    """最小 Blackboard HTTP client 协议。"""

    def get(self, url: Any, *, params: Any | None = None) -> httpx.Response: ...

    def post(self, url: Any, *, data: Any | None = None) -> httpx.Response: ...


ResponseLogger = callable


@dataclass(slots=True)
class BlackboardAPIContext:
    """供 Blackboard API fetcher / parser / facade 共享的显式上下文对象。"""

    client: BlackboardHTTPClient
    base_url: str = "https://bb.sustech.edu.cn"
    response_logger: Any | None = None
    debug_enabled: bool = True
    request_history: list[tuple[str, str, int, str]] = field(default_factory=list)
    logger: BlackboardLogger | None = None

    def get(self, url: str, *, label: str = "GET") -> httpx.Response:
        """执行 GET 请求并记录最小调试状态。"""
        if self.logger is not None:
            self.logger.debug("📤 发起 Blackboard GET 请求", context={"label": label, "url": url})
        response = self.client.get(url)
        self._record_response(label, response)
        return response

    def post(self, url: str, *, data: dict[str, Any] | None = None, label: str = "POST") -> httpx.Response:
        """执行 POST 请求并记录最小调试状态。"""
        if self.logger is not None:
            self.logger.debug(
                "📤 发起 Blackboard POST 请求",
                context={"label": label, "url": url},
                payload={"data_keys": sorted((data or {}).keys())},
            )
        response = self.client.post(url, data=data)
        self._record_response(label, response)
        return response

    def log(
        self,
        message: str,
        *,
        level: LogLevel = "debug",
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        """统一调试输出入口。"""
        if not self.debug_enabled or self.logger is None:
            return
        if level == "info":
            self.logger.info(message, payload=payload, context=context)
            return
        if level == "warning":
            self.logger.warning(message, payload=payload, context=context)
            return
        if level == "error":
            self.logger.error(message, payload=payload, context=context)
            return
        self.logger.debug(message, payload=payload, context=context)

    def absolute_url(self, page_url: str, href: str) -> str:
        """基于页面 URL 解析相对链接。"""
        return urljoin(page_url, href)

    def extract_ids(
        self,
        url: str,
        *,
        id_types: tuple[str, ...] | None = None,
    ) -> dict[str, str | None]:
        """统一提取 Blackboard URL 中的各类 ID。"""
        return extract_blackboard_ids_from_url(url, id_types=id_types, base_url=self.base_url)

    def extract_course_id(self, url: str) -> str:
        """从 URL 中提取课程 ID。"""
        return extract_course_id_from_url(url) or ""

    def _record_response(self, label: str, response: httpx.Response) -> None:
        self.request_history.append(
            (
                label,
                str(response.request.method),
                response.status_code,
                str(response.url),
            )
        )
        if self.logger is not None:
            request_context = {
                "label": label,
                "method": str(response.request.method),
                "status_code": response.status_code,
                "url": str(response.url),
            }
            if response.status_code >= 400:
                self.logger.warning("❌ Blackboard HTTP 响应异常", context=request_context)
            else:
                self.logger.debug("✅ Blackboard HTTP 响应完成", context=request_context)
        if self.response_logger is not None:
            self.response_logger(label, response)
