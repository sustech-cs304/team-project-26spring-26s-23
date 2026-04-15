from __future__ import annotations

import ast
from pathlib import Path
from typing import Any

import httpx

from app.core.auth.cas_client import CASClient as LegacyCASClient
from app.shared_integrations.sustech_auth import CASClient as SharedPackageCASClient
from app.shared_integrations.sustech_auth.cas_client import CASClient, CASLogger

BACKEND_ROOT = Path(__file__).resolve().parents[3]
APP_ROOT = BACKEND_ROOT / "app"
LEGACY_SHIM_PATH = APP_ROOT / "core" / "auth" / "cas_client.py"


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


def _find_legacy_core_auth_import_sites() -> list[str]:
    legacy_sites: list[str] = []

    for path in APP_ROOT.rglob("*.py"):
        if path == LEGACY_SHIM_PATH:
            continue

        module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(module):
            if isinstance(node, ast.ImportFrom):
                imported_module = node.module or ""
                imported_names = {alias.name for alias in node.names}
                if imported_module.endswith("core.auth.cas_client") and (
                    imported_names & {"CASClient", "CASLogger"} or "*" in imported_names
                ):
                    legacy_sites.append(path.relative_to(BACKEND_ROOT).as_posix())
                    break
                if imported_module.endswith("core.auth") and "cas_client" in imported_names:
                    legacy_sites.append(path.relative_to(BACKEND_ROOT).as_posix())
                    break
            elif isinstance(node, ast.Import):
                if any(alias.name.endswith("core.auth.cas_client") for alias in node.names):
                    legacy_sites.append(path.relative_to(BACKEND_ROOT).as_posix())
                    break

    return legacy_sites


def _find_shared_auth_package_root_import_sites() -> list[str]:
    noncanonical_sites: list[str] = []

    for path in APP_ROOT.rglob("*.py"):
        module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(module):
            if isinstance(node, ast.ImportFrom):
                imported_module = node.module or ""
                imported_names = {alias.name for alias in node.names}
                if imported_module.endswith("shared_integrations.sustech_auth") and (
                    imported_names & {"CASClient", "CASLogger"} or "*" in imported_names
                ):
                    noncanonical_sites.append(path.relative_to(BACKEND_ROOT).as_posix())
                    break
            elif isinstance(node, ast.Import):
                if any(alias.name.endswith("shared_integrations.sustech_auth") for alias in node.names):
                    noncanonical_sites.append(path.relative_to(BACKEND_ROOT).as_posix())
                    break

    return noncanonical_sites


def test_shared_package_re_exports_canonical_cas_client() -> None:
    assert SharedPackageCASClient is CASClient


def test_legacy_core_auth_shim_re_exports_shared_cas_client() -> None:
    assert LegacyCASClient is CASClient



def test_legacy_core_auth_shim_remains_thin_compat_module() -> None:
    module = ast.parse(LEGACY_SHIM_PATH.read_text(encoding="utf-8"), filename=str(LEGACY_SHIM_PATH))
    has_canonical_import = False

    for node in module.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            continue
        if isinstance(node, ast.ImportFrom):
            if node.module == "__future__":
                continue
            assert node.module == "app.shared_integrations.sustech_auth.cas_client"
            assert {alias.name for alias in node.names} == {"CASClient", "CASLogger"}
            has_canonical_import = True
            continue
        if isinstance(node, ast.Assign):
            assert all(isinstance(target, ast.Name) and target.id == "__all__" for target in node.targets)
            continue
        raise AssertionError(f"Unexpected top-level node in compat shim: {ast.dump(node)}")

    assert has_canonical_import is True
    assert not any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) for node in module.body)



def test_backend_app_code_uses_leaf_shared_auth_canonical_import_path() -> None:
    assert _find_shared_auth_package_root_import_sites() == []



def test_backend_app_code_does_not_import_legacy_core_auth_cas_shim() -> None:
    assert _find_legacy_core_auth_import_sites() == []



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
            {
                "service_url": "https://portal.sustech.edu.cn/home",
                "failure_reason": "execution_missing",
                "failure_message": "CAS 登录失败：无法获取登录页面令牌。",
            },
            None,
        )
    ]
    assert cas_client.last_login_failure_reason == "execution_missing"
    assert cas_client.last_login_failure_message == "CAS 登录失败：无法获取登录页面令牌。"



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
    assert logger.events[-1][2]["failure_reason"] == "login_failed"
    assert logger.events[-1][2]["failure_message"] == "CAS 登录失败"
    assert cas_client.last_login_failure_reason == "login_failed"
    assert cas_client.last_login_failure_message == "CAS 登录失败"



def test_login_returns_false_with_invalid_credential_markers_and_records_explicit_failure_message() -> None:
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
                <div class="errors">用户名或密码错误</div>
                <form>
                    <input name="username" />
                    <input name="password" />
                    <input name="execution" value="e1s2" />
                </form>
            </html>
            ''',
            request=httpx.Request("GET", "https://cas.sustech.edu.cn/cas/login"),
        ),
    )
    cas_client = _build_cas_client(fake_http_client, logger=logger)

    try:
        assert cas_client.login("123", "secret", "https://portal.sustech.edu.cn/home") is False
    finally:
        cas_client.close()

    assert cas_client.last_login_failure_reason == "invalid_credentials"
    assert cas_client.last_login_failure_message == "CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。"
    assert logger.events[-1][0] == "warning"
    assert logger.events[-1][1] == "❌ CAS 登录失败"
    assert logger.events[-1][2] is not None
    assert logger.events[-1][2]["failure_reason"] == "invalid_credentials"
    assert logger.events[-1][2]["failure_message"] == "CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。"
