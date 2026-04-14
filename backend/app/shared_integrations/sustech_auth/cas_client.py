"""Shared SUSTech CAS authentication client."""

from typing import Any, Optional, Protocol
from urllib.parse import urlparse

import httpx


class CASLogger(Protocol):
    def info(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> Any: ...

    def warning(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> Any: ...

    def error(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> Any: ...


class CASClient:
    """Shared CAS client for SUSTech campus service integrations."""

    def __init__(self, logger: CASLogger | None = None):
        self.logger = logger
        self.cas_login_url = "https://cas.sustech.edu.cn/cas/login"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
        }
        self.client = httpx.Client(follow_redirects=True, timeout=30.0, headers=headers)

    def login(self, username: str, password: str, service_url: str) -> bool:
        """
        执行 CAS 登录

        Args:
            username: 学号/工号
            password: 密码
            service_url: 目标服务 URL

        Returns:
            是否登录成功
        """
        params = {"service": service_url}
        response = self.client.get(self.cas_login_url, params=params)

        execution = self._extract_execution(response.text)
        if not execution:
            if self.logger is not None:
                self.logger.error(
                    "❌ 无法获取 execution token",
                    payload={"service_url": service_url},
                )
            return False

        login_data = {
            "username": username,
            "password": password,
            "execution": execution,
            "_eventId": "submit",
            "geolocation": "",
            "submit": "登录",
        }

        response = self.client.post(
            self.cas_login_url,
            params=params,
            data=login_data,
        )

        service_domain = urlparse(service_url).netloc
        final_url = str(response.url)
        final_path = urlparse(final_url).path or "/"
        lowered_body = (response.text or "").lower()
        redirect_chain = [str(item.url) for item in response.history] + [final_url]
        has_login_form = 'name="username"' in lowered_body and 'name="password"' in lowered_body
        has_execution = 'name="execution"' in lowered_body
        hit_authentication_require = any("/authentication/require" in item for item in redirect_chain)
        hit_session_invalid = "/session/invalid" in final_path
        success = (
            service_domain in final_url
            and not has_login_form
            and not has_execution
            and not hit_authentication_require
            and not hit_session_invalid
        )

        if self.logger is not None:
            payload = {
                "redirect_url": final_url,
                "redirect_chain": redirect_chain,
                "final_path": final_path,
                "has_login_form": has_login_form,
                "has_execution": has_execution,
                "hit_authentication_require": hit_authentication_require,
                "hit_session_invalid": hit_session_invalid,
            }
            if success:
                self.logger.info("✅ CAS 登录成功", payload=payload)
            else:
                self.logger.warning("❌ CAS 登录失败", payload=payload)

        return success

    def _extract_execution(self, html: str) -> Optional[str]:
        """从 CAS 登录页面提取 execution token。"""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "html.parser")
        execution_input = soup.find("input", {"name": "execution"})
        if execution_input and isinstance(execution_input.get("value"), str):
            return str(execution_input["value"])
        return None

    def get_cookies(self) -> dict[str, str]:
        """获取当前 session 的 cookies。"""
        return dict(self.client.cookies)

    def close(self) -> None:
        """关闭 HTTP 客户端。"""
        self.client.close()


__all__ = ["CASClient", "CASLogger"]
