"""Shared SUSTech CAS authentication client."""

from collections.abc import Iterable, Mapping
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
    ) -> Any:
        pass

    def warning(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> Any:
        pass

    def error(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> Any:
        pass


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
        self.last_login_failure_reason: str | None = None
        self.last_login_failure_message: str | None = None

    def login(self, username: str, password: str, service_url: str) -> bool:
        """
        执行 CAS 登录。若当前 HTTP 会话已有目标服务有效 Cookie，则优先复用 Cookie，
        避免重新进入 CAS 人机验证流程。

        Args:
            username: 学号/工号
            password: 密码
            service_url: 目标服务 URL

        Returns:
            是否登录成功
        """
        self.last_login_failure_reason = None
        self.last_login_failure_message = None
        if self.has_service_session(service_url):
            if self.logger is not None:
                self.logger.info(
                    "✅ 已复用目标服务 Cookie 会话",
                    payload={"service_url": service_url},
                )
            return True

        params = {"service": service_url}
        response = self.client.get(self.cas_login_url, params=params)

        execution = self._extract_execution(response.text)
        if not execution:
            self.last_login_failure_reason = "execution_missing"
            self.last_login_failure_message = "CAS 登录失败：无法获取登录页面令牌。"
            if self.logger is not None:
                self.logger.error(
                    "❌ 无法获取 execution token",
                    payload={
                        "service_url": service_url,
                        "failure_reason": self.last_login_failure_reason,
                        "failure_message": self.last_login_failure_message,
                    },
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
        has_login_form = (
            'name="username"' in lowered_body and 'name="password"' in lowered_body
        )
        has_execution = 'name="execution"' in lowered_body
        hit_authentication_require = any(
            "/authentication/require" in item for item in redirect_chain
        )
        hit_session_invalid = "/session/invalid" in final_path
        invalid_credentials = self._contains_invalid_credential_markers(
            response.text or ""
        )
        human_verification_required = self._contains_human_verification_markers(
            response.text or ""
        )
        success = (
            service_domain in final_url
            and not has_login_form
            and not has_execution
            and not hit_authentication_require
            and not hit_session_invalid
        )
        if not success:
            if invalid_credentials:
                self.last_login_failure_reason = "invalid_credentials"
                self.last_login_failure_message = (
                    "CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。"
                )
            elif human_verification_required:
                self.last_login_failure_reason = "human_verification_required"
                self.last_login_failure_message = (
                    "CAS 登录需要人机验证，请在弹出的浏览器窗口中手动完成验证后重试。"
                )
            else:
                self.last_login_failure_reason = "login_failed"
                self.last_login_failure_message = "CAS 登录失败"

        if self.logger is not None:
            payload = {
                "redirect_url": final_url,
                "redirect_chain": redirect_chain,
                "final_path": final_path,
                "has_login_form": has_login_form,
                "has_execution": has_execution,
                "hit_authentication_require": hit_authentication_require,
                "hit_session_invalid": hit_session_invalid,
                "human_verification_required": human_verification_required,
            }
            if success:
                self.logger.info("✅ CAS 登录成功", payload=payload)
            else:
                payload["failure_reason"] = self.last_login_failure_reason
                payload["failure_message"] = self.last_login_failure_message
                self.logger.warning("❌ CAS 登录失败", payload=payload)

        return success

    def _contains_invalid_credential_markers(self, html: str) -> bool:
        lowered = str(html or "").lower()
        return any(
            marker in lowered
            for marker in (
                "用户名或密码",
                "用户名或者密码",
                "密码错误",
                "密码有误",
                "账号或密码",
                "incorrect username or password",
                "invalid username or password",
                "invalid credentials",
            )
        )

    def _contains_human_verification_markers(self, html: str) -> bool:
        lowered = str(html or "").lower()
        return any(
            marker in lowered
            for marker in (
                "captcha",
                "g-recaptcha-response",
                "captcha/api/check",
                "进行人机身份验证",
                "人机身份验证",
                "人机验证",
                "验证码",
                "blockpuzzle",
                "slider",
            )
        )

    def has_service_session(self, service_url: str) -> bool:
        """检查当前 Cookie 是否已经能访问目标服务，且不落回 CAS 登录页。"""
        self.last_login_failure_reason = None
        self.last_login_failure_message = None
        try:
            response = self.client.get(service_url)
        except httpx.HTTPError as exc:
            self.last_login_failure_reason = "session_probe_failed"
            self.last_login_failure_message = str(exc)
            return False
        return self._is_service_authenticated_response(response, service_url)

    def _is_service_authenticated_response(
        self, response: httpx.Response, service_url: str
    ) -> bool:
        service_domain = urlparse(service_url).netloc
        final_url = str(response.url)
        final_path = urlparse(final_url).path or "/"
        lowered_body = (response.text or "").lower()
        redirect_chain = [str(item.url) for item in response.history] + [final_url]
        has_login_form = (
            'name="username"' in lowered_body and 'name="password"' in lowered_body
        )
        has_execution = 'name="execution"' in lowered_body
        hit_authentication_require = any(
            "/authentication/require" in item for item in redirect_chain
        )
        hit_session_invalid = "/session/invalid" in final_path
        return (
            service_domain in final_url
            and not has_login_form
            and not has_execution
            and not hit_authentication_require
            and not hit_session_invalid
        )

    def import_cookies(
        self,
        cookies: Mapping[str, str] | Iterable[Mapping[str, Any]],
    ) -> None:
        """导入浏览器或持久化会话 Cookie 到当前 httpx 会话。"""
        if isinstance(cookies, Mapping):
            for name, value in cookies.items():
                normalized_name = str(name or "").strip()
                if normalized_name:
                    self.client.cookies.set(normalized_name, str(value or ""))
            return

        for cookie in cookies:
            if not isinstance(cookie, Mapping):
                continue
            name = str(cookie.get("name") or "").strip()
            value = str(cookie.get("value") or "")
            if not name:
                continue
            domain = str(cookie.get("domain") or "").strip() or None
            path = str(cookie.get("path") or "").strip() or "/"
            self.client.cookies.set(name, value, domain=domain, path=path)

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
