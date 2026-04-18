"""TIS 请求上下文。"""

from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import httpx

from ..shared import TISLogger, _clean_text
from .constants import _DEFAULT_TIS_BASE_URL, _DEFAULT_TIS_ENTRY_PATH


class TISAPIContext:
    """TIS 请求上下文，统一封装 headers、请求历史与日志。"""

    def __init__(
        self,
        client: httpx.Client,
        *,
        base_url: str = _DEFAULT_TIS_BASE_URL,
        logger: TISLogger | None = None,
        role_code: str | None = None,
    ) -> None:
        self.client = client
        self.base_url = str(base_url or _DEFAULT_TIS_BASE_URL).rstrip("/")
        self.logger = logger
        self.role_code = _clean_text(role_code) or None
        self.request_history: list[tuple[str, str, int, str]] = []

    def set_role_code(self, role_code: str | None) -> None:
        self.role_code = _clean_text(role_code) or None
        if self.role_code:
            self.client.headers["RoleCode"] = self.role_code
        elif "RoleCode" in self.client.headers:
            del self.client.headers["RoleCode"]

    def absolute_url(self, page_url: str, href: str) -> str:
        return urljoin(page_url, href)

    def get(self, url: str, *, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, label: str = "GET") -> httpx.Response:
        full_url = self._normalize_url(url)
        merged_headers = self._build_headers(headers)
        if self.logger is not None:
            self.logger.debug(
                "📤 发起 TIS GET 请求",
                context={"label": label, "url": full_url},
                payload={"params": params or {}, "header_keys": sorted(merged_headers.keys())},
            )
        response = self.client.get(full_url, params=params, headers=merged_headers)
        self._record_response(label, response)
        return response

    def post(
        self,
        url: str,
        *,
        data: dict[str, Any] | None = None,
        json_data: Any | None = None,
        headers: dict[str, str] | None = None,
        label: str = "POST",
    ) -> httpx.Response:
        full_url = self._normalize_url(url)
        merged_headers = self._build_headers(headers)
        if self.logger is not None:
            self.logger.debug(
                "📤 发起 TIS POST 请求",
                context={"label": label, "url": full_url},
                payload={
                    "data_keys": sorted((data or {}).keys()),
                    "has_json": json_data is not None,
                    "header_keys": sorted(merged_headers.keys()),
                },
            )
        response = self.client.post(full_url, data=data, json=json_data, headers=merged_headers)
        self._record_response(label, response)
        return response

    def _normalize_url(self, url: str) -> str:
        text = _clean_text(url)
        if text.startswith("http://") or text.startswith("https://"):
            return text
        if text.startswith("/"):
            return f"{self.base_url}{text}"
        return f"{self.base_url}/{text.lstrip('/')}"

    def _build_headers(self, extra_headers: dict[str, str] | None) -> dict[str, str]:
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": urljoin(self.base_url, _DEFAULT_TIS_ENTRY_PATH),
            "X-Requested-With": "XMLHttpRequest",
        }
        if self.role_code:
            headers["RoleCode"] = self.role_code
        if extra_headers:
            headers.update({str(key): str(value) for key, value in extra_headers.items()})
        return headers

    def _record_response(self, label: str, response: httpx.Response) -> None:
        self.request_history.append((label, str(response.request.method), int(response.status_code), str(response.url)))
        if self.logger is None:
            return
        context = {
            "label": label,
            "method": str(response.request.method),
            "status_code": int(response.status_code),
            "url": str(response.url),
        }
        if response.status_code >= 400:
            self.logger.warning("❌ TIS HTTP 响应异常", context=context)
        else:
            self.logger.debug("✅ TIS HTTP 响应完成", context=context)


__all__ = ["TISAPIContext"]
