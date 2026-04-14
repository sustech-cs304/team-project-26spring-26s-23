from __future__ import annotations

from typing import Any

import httpx

from app.core.auth.cas_client import CASClient as LegacyCASClient
from app.shared_integrations.sustech_auth.cas_client import CASClient, CASLogger


class _RecordingLogger:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict[str, Any] | None, dict[str, Any] | None]] = []

    def info(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        self.events.append(("info", message, payload, context))

    def warning(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        self.events.append(("warning", message, payload, context))

    def error(
        self,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        context: dict[str, Any] | None = None,
    ) -> None:
        self.events.append(("error", message, payload, context))


class _FakeHTTPClient:
    def __init__(self, *, get_response: httpx.Response, post_response: httpx.Response) -> None:
        self._get_response = get_response
        self._post_response = post_response
        self.cookies = httpx.Cookies({"CASTGC": "cookie-value"})
        self.closed = False

    def get(self, url: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        return self._get_response

    def post(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
    ) -> httpx.Response:
        return self._post_response

    def close(self) -> None:
        self.closed = True


def _build_cas_client(fake_http_client: _FakeHTTPClient, logger: CASLogger | None = None) -> CASClient:
    cas_client = CASClient(logger=logger)
    cas_client.client.close()
    cas_client.client = fake_http_client  # type: ignore[assignment]
    return cas_client


def test_legacy_core_auth_shim_re_exports_shared_cas_client() -> None:
    assert LegacyCASClient is CASClient


def test_extract_execution_returns_hidden_input_value() -> None:
    cas_client = CASClient()
    try:
        assert cas_client._extract_execution('<input name="execution" value="e1s1" />') == "e1s1"
    finally:
        cas_client.close()


def test_login_returns_false_when_execution_token_is_missing() -> None:
    logger = _RecordingLogger()
    fake_http_client = _FakeHTTPClient(
        get_response=httpx.Response(
            200,
            text="<html><body>missing token</body></html>",
            request=httpx.Request("GET", "https://cas.sustech.edu.cn/cas/login"),
        ),
        post_response=httpx.Response(
            200,
            text="<html><body>unused</body></html>",
            request=httpx.Request("POST", "https://portal.sustech.edu.cn/home"),
        ),
    )
    cas_client = _build_cas_client(fake_http_client, logger=logger)

    try:
        assert cas_client.login("123", "secret", "https://portal.sustech.edu.cn/home") is False
    finally:
        cas_client.close()

    assert logger.events == [
        (
            "error",
            "❌ 无法获取 execution token",
            {"service_url": "https://portal.sustech.edu.cn/home"},
            None,
        )
    ]


def test_login_accepts_generic_service_domain_without_blackboard_specific_assumptions() -> None:
    logger = _RecordingLogger()
    fake_http_client = _FakeHTTPClient(
        get_response=httpx.Response(
            200,
            text='<html><input name="execution" value="e1s1" /></html>',
            request=httpx.Request("GET", "https://cas.sustech.edu.cn/cas/login"),
        ),
        post_response=httpx.Response(
            200,
            text="<html><body>portal ready</body></html>",
            request=httpx.Request("GET", "https://portal.sustech.edu.cn/home"),
        ),
    )
    cas_client = _build_cas_client(fake_http_client, logger=logger)

    try:
        assert cas_client.login("123", "secret", "https://portal.sustech.edu.cn/home") is True
        assert cas_client.get_cookies() == {"CASTGC": "cookie-value"}
    finally:
        cas_client.close()

    assert logger.events[-1][0] == "info"
    assert logger.events[-1][1] == "✅ CAS 登录成功"
    assert logger.events[-1][2] is not None
    assert logger.events[-1][2]["redirect_url"] == "https://portal.sustech.edu.cn/home"


def test_login_returns_false_when_final_page_still_contains_login_markers() -> None:
    logger = _RecordingLogger()
    fake_http_client = _FakeHTTPClient(
        get_response=httpx.Response(
            200,
            text='<html><input name="execution" value="e1s1" /></html>',
            request=httpx.Request("GET", "https://cas.sustech.edu.cn/cas/login"),
        ),
        post_response=httpx.Response(
            200,
            text='''
            <html>
                <form>
                    <input name="username" />
                    <input name="password" />
                    <input name="execution" value="e1s2" />
                </form>
            </html>
            ''',
            request=httpx.Request("GET", "https://portal.sustech.edu.cn/home"),
        ),
    )
    cas_client = _build_cas_client(fake_http_client, logger=logger)

    try:
        assert cas_client.login("123", "secret", "https://portal.sustech.edu.cn/home") is False
    finally:
        cas_client.close()

    assert logger.events[-1][0] == "warning"
    assert logger.events[-1][1] == "❌ CAS 登录失败"
    assert logger.events[-1][2] is not None
    assert logger.events[-1][2]["has_login_form"] is True
    assert logger.events[-1][2]["has_execution"] is True
