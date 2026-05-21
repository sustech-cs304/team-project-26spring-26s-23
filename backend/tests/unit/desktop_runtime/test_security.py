from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig, DesktopRuntimePaths
from app.desktop_runtime.middlewares import DesktopNullOriginMiddleware
from app.desktop_runtime.security import (
    apply_cors_headers,
    is_cors_preflight_request,
    is_desktop_null_origin,
    is_loopback_client_request,
    is_packaged_electron_request,
    require_local_token,
)

_VALID_TOKEN = "test-token-123"
_WRONG_TOKEN = "wrong-token"

_ELECTRON_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) CanDue/1.0.0 Electron/35.1.4 Safari/537.36"
)
_ELECTRON_UA_UPPERCASE = _ELECTRON_UA.replace("Electron", "ELECTRON")
_BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _make_request(
    method: str = "GET",
    path: str = "/",
    headers: dict[str, str] | None = None,
    client: tuple[str, int] | None = None,
) -> Request:
    raw_headers: list[tuple[bytes, bytes]] = []
    if headers:
        for k, v in headers.items():
            raw_headers.append((k.lower().encode(), v.encode()))
    scope: dict = {
        "type": "http",
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": raw_headers,
        "server": ("127.0.0.1", 8765),
        "root_path": "",
    }
    if client is not None:
        scope["client"] = client
    return Request(scope)


def _make_config(*, local_token: str | None = None) -> DesktopRuntimeConfig:
    user_data_dir = Path("/tmp/test-user-data")
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host="127.0.0.1",
        port=8765,
        local_token=local_token,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=runtime_root_dir / "config",
            logs_dir=runtime_root_dir / "logs",
            database_dir=runtime_root_dir / "database",
            state_dir=runtime_root_dir / "state",
            debug_log_database_file=runtime_root_dir / "database" / "copilot-debug-log.db",
            copilot_settings_file=runtime_root_dir / "config" / "copilot-settings.json",
            host_log_file=runtime_root_dir / "logs" / "electron-host.log",
            backend_stdout_log_file=runtime_root_dir / "logs" / "backend.stdout.log",
            backend_stderr_log_file=runtime_root_dir / "logs" / "backend.stderr.log",
            runtime_snapshot_file=runtime_root_dir / "state" / "runtime-snapshot.json",
            last_failure_file=runtime_root_dir / "state" / "last-failure.json",
        ),
        app_mode="desktop",
        environment="test",
    )


# ---------------------------------------------------------------------------
# require_local_token
# ---------------------------------------------------------------------------


class TestRequireLocalToken:
    def test_passes_when_token_not_configured(self) -> None:
        request = _make_request()
        config = _make_config(local_token=None)
        require_local_token(request, config)

    def test_passes_with_valid_token_in_header(self) -> None:
        request = _make_request(headers={LOCAL_TOKEN_HEADER_NAME: _VALID_TOKEN})
        config = _make_config(local_token=_VALID_TOKEN)
        require_local_token(request, config)

    def test_raises_401_when_token_header_missing_and_token_configured(self) -> None:
        request = _make_request()
        config = _make_config(local_token=_VALID_TOKEN)
        with pytest.raises(HTTPException) as exc_info:
            require_local_token(request, config)
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["code"] == "invalid_local_token"

    def test_raises_401_with_wrong_token(self) -> None:
        request = _make_request(headers={LOCAL_TOKEN_HEADER_NAME: _WRONG_TOKEN})
        config = _make_config(local_token=_VALID_TOKEN)
        with pytest.raises(HTTPException) as exc_info:
            require_local_token(request, config)
        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["code"] == "invalid_local_token"

    def test_does_not_read_token_from_query_params(self) -> None:
        request = _make_request(
            path="/?X-Local-Token=some-token",
            headers={LOCAL_TOKEN_HEADER_NAME: _VALID_TOKEN},
        )
        config = _make_config(local_token=_VALID_TOKEN)
        require_local_token(request, config)


# ---------------------------------------------------------------------------
# is_cors_preflight_request
# ---------------------------------------------------------------------------


class TestIsCorsPreflightRequest:
    def test_true_for_options_with_origin_and_request_method(self) -> None:
        request = _make_request(
            method="OPTIONS",
            headers={
                "origin": "http://localhost:5173",
                "access-control-request-method": "POST",
            },
        )
        assert is_cors_preflight_request(request) is True

    def test_false_for_get_with_origin(self) -> None:
        request = _make_request(
            method="GET",
            headers={"origin": "http://localhost:5173"},
        )
        assert is_cors_preflight_request(request) is False

    def test_false_for_options_without_origin(self) -> None:
        request = _make_request(
            method="OPTIONS",
            headers={"access-control-request-method": "POST"},
        )
        assert is_cors_preflight_request(request) is False

    def test_false_for_options_without_request_method_header(self) -> None:
        request = _make_request(
            method="OPTIONS",
            headers={"origin": "http://localhost:5173"},
        )
        assert is_cors_preflight_request(request) is False

    def test_false_for_post_with_origin_and_request_method(self) -> None:
        request = _make_request(
            method="POST",
            headers={
                "origin": "http://localhost:5173",
                "access-control-request-method": "POST",
            },
        )
        assert is_cors_preflight_request(request) is False


# ---------------------------------------------------------------------------
# is_desktop_null_origin
# ---------------------------------------------------------------------------


class TestIsDesktopNullOrigin:
    def test_true_for_string_null(self) -> None:
        assert is_desktop_null_origin("null") is True

    def test_false_for_file_origin(self) -> None:
        assert is_desktop_null_origin("file://") is False

    def test_false_for_app_origin(self) -> None:
        assert is_desktop_null_origin("app://") is False

    def test_false_for_none(self) -> None:
        assert is_desktop_null_origin(None) is False

    def test_false_for_empty_string(self) -> None:
        assert is_desktop_null_origin("") is False

    def test_false_for_http_localhost_origin(self) -> None:
        assert is_desktop_null_origin("http://localhost:5173") is False


# ---------------------------------------------------------------------------
# is_loopback_client_request
# ---------------------------------------------------------------------------


class TestIsLoopbackClientRequest:
    def test_true_for_127_0_0_1(self) -> None:
        request = _make_request(client=("127.0.0.1", 50000))
        assert is_loopback_client_request(request) is True

    def test_true_for_localhost(self) -> None:
        request = _make_request(client=("localhost", 50000))
        assert is_loopback_client_request(request) is True

    def test_true_for_ipv6_loopback(self) -> None:
        request = _make_request(client=("::1", 50000))
        assert is_loopback_client_request(request) is True

    def test_true_for_ipv6_loopback_bracketed(self) -> None:
        request = _make_request(client=("[::1]", 50000))
        assert is_loopback_client_request(request) is True

    def test_false_for_non_loopback(self) -> None:
        request = _make_request(client=("192.168.1.1", 50000))
        assert is_loopback_client_request(request) is False

    def test_false_for_public_ip(self) -> None:
        request = _make_request(client=("203.0.113.10", 50000))
        assert is_loopback_client_request(request) is False

    def test_false_when_no_client_in_scope(self) -> None:
        request = _make_request(client=None)
        assert is_loopback_client_request(request) is False

    def test_true_for_127_0_0_2(self) -> None:
        request = _make_request(client=("127.0.0.2", 50000))
        assert is_loopback_client_request(request) is True


# ---------------------------------------------------------------------------
# is_packaged_electron_request
# ---------------------------------------------------------------------------


class TestIsPackagedElectronRequest:
    def test_true_when_user_agent_contains_electron(self) -> None:
        request = _make_request(headers={"user-agent": _ELECTRON_UA})
        assert is_packaged_electron_request(request) is True

    def test_true_when_electron_is_uppercase(self) -> None:
        request = _make_request(headers={"user-agent": _ELECTRON_UA_UPPERCASE})
        assert is_packaged_electron_request(request) is True

    def test_false_for_browser_user_agent(self) -> None:
        request = _make_request(headers={"user-agent": _BROWSER_UA})
        assert is_packaged_electron_request(request) is False

    def test_false_when_user_agent_header_missing(self) -> None:
        request = _make_request()
        assert is_packaged_electron_request(request) is False

    def test_false_when_user_agent_has_electron_substring_only(self) -> None:
        request = _make_request(headers={"user-agent": "SomeElectronApp/1.0"})
        assert is_packaged_electron_request(request) is False


# ---------------------------------------------------------------------------
# apply_cors_headers
# ---------------------------------------------------------------------------


class TestApplyCorsHeaders:
    def test_sets_origin_for_non_preflight(self) -> None:
        response = Response()
        apply_cors_headers(
            response,
            origin="http://localhost:5173",
            requested_headers=None,
            is_preflight_request=False,
        )
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert "Access-Control-Allow-Methods" not in response.headers
        assert "Access-Control-Allow-Headers" not in response.headers
        assert "Access-Control-Max-Age" not in response.headers
        assert response.headers["Vary"] == "Origin"

    def test_sets_all_headers_for_preflight(self) -> None:
        response = Response()
        apply_cors_headers(
            response,
            origin="http://localhost:5173",
            requested_headers="content-type, authorization",
            is_preflight_request=True,
        )
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert "POST" in response.headers["Access-Control-Allow-Methods"]
        assert response.headers["Access-Control-Allow-Headers"] == "content-type, authorization"
        assert response.headers["Access-Control-Max-Age"] == "600"
        assert (
            response.headers["Vary"]
            == "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
        )

    def test_preflight_uses_star_for_null_requested_headers(self) -> None:
        response = Response()
        apply_cors_headers(
            response,
            origin="null",
            requested_headers=None,
            is_preflight_request=True,
        )
        assert response.headers["Access-Control-Allow-Origin"] == "null"
        assert response.headers["Access-Control-Allow-Headers"] == "*"

    def test_preserves_existing_vary_header_with_dedup(self) -> None:
        response = Response()
        response.headers["Vary"] = "Accept-Encoding, Origin, Accept-Encoding"
        apply_cors_headers(
            response,
            origin="http://localhost:5173",
            requested_headers="content-type",
            is_preflight_request=True,
        )
        assert response.headers["Vary"] == (
            "Accept-Encoding, Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
        )

    def test_does_not_duplicate_origin_in_non_preflight_vary(self) -> None:
        response = Response()
        response.headers["Vary"] = "Origin"
        apply_cors_headers(
            response,
            origin="http://localhost:5173",
            requested_headers=None,
            is_preflight_request=False,
        )
        assert response.headers["Vary"] == "Origin"


# ---------------------------------------------------------------------------
# DesktopNullOriginMiddleware.dispatch
# ---------------------------------------------------------------------------


class TestDesktopNullOriginMiddlewareDispatch:
    @staticmethod
    def _middleware() -> DesktopNullOriginMiddleware:
        return DesktopNullOriginMiddleware(app=lambda scope, receive, send: None)  # type: ignore[arg-type]

    @staticmethod
    def _call_next(response: Response | None = None) -> object:
        resp = response if response is not None else Response("ok")

        async def _fn(_request: Request) -> Response:
            return resp

        return _fn

    def test_passes_through_when_no_origin_header(self) -> None:
        middleware = self._middleware()
        request = _make_request(client=("127.0.0.1", 50000))
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 200
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_passes_through_when_non_null_origin(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={"origin": "http://localhost:5173"},
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 200
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_allows_null_origin_electron_loopback_preflight(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            method="OPTIONS",
            headers={
                "origin": "null",
                "user-agent": _ELECTRON_UA,
                "access-control-request-method": "POST",
                "access-control-request-headers": "content-type",
            },
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "null"
        assert "POST" in response.headers["Access-Control-Allow-Methods"]
        assert response.headers["Access-Control-Max-Age"] == "600"

    def test_allows_null_origin_electron_loopback_non_preflight(self) -> None:
        middleware = self._middleware()
        custom_response = Response("custom body", status_code=201)
        request = _make_request(
            method="POST",
            path="/api/test",
            headers={
                "origin": "null",
                "user-agent": _ELECTRON_UA,
            },
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next(custom_response)

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 201
        assert response.headers["Access-Control-Allow-Origin"] == "null"
        assert "Access-Control-Allow-Methods" not in response.headers

    def test_allows_null_origin_electron_localhost(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={
                "origin": "null",
                "user-agent": _ELECTRON_UA,
            },
            client=("localhost", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "null"

    def test_allows_null_origin_electron_ipv6_loopback(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={
                "origin": "null",
                "user-agent": _ELECTRON_UA,
            },
            client=("::1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == "null"

    def test_rejects_null_origin_non_electron_user_agent(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={
                "origin": "null",
                "user-agent": _BROWSER_UA,
            },
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 400
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_rejects_null_origin_electron_non_loopback_client(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={
                "origin": "null",
                "user-agent": _ELECTRON_UA,
            },
            client=("203.0.113.10", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 400
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_rejects_null_origin_no_user_agent_loopback(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={"origin": "null"},
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 400
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_rejects_null_origin_preflight_non_electron(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            method="OPTIONS",
            headers={
                "origin": "null",
                "user-agent": _BROWSER_UA,
                "access-control-request-method": "POST",
            },
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 400
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_require_local_token_not_invoked_by_middleware(self) -> None:
        middleware = self._middleware()
        request = _make_request(
            headers={
                "origin": "null",
                "user-agent": _ELECTRON_UA,
            },
            client=("127.0.0.1", 50000),
        )
        call_next = self._call_next()

        response = asyncio.run(middleware.dispatch(request, call_next))

        assert response.status_code == 200
