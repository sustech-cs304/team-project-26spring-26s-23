from __future__ import annotations

from unittest.mock import MagicMock

import httpx

from app.integrations.sustech.teaching_information_system.api.context import TISAPIContext
from app.integrations.sustech.teaching_information_system.api.constants import (
    _DEFAULT_TIS_BASE_URL,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

def _make_mock_client(
    *,
    get_response: httpx.Response | None = None,
    post_response: httpx.Response | None = None,
) -> MagicMock:
    client = MagicMock(spec=httpx.Client)
    client.headers = {}
    if get_response is not None:
        client.get.return_value = get_response
    if post_response is not None:
        client.post.return_value = post_response
    return client


def _make_mock_response(
    *,
    url: str = "https://tis.sustech.edu.cn/test",
    method: str = "GET",
    status_code: int = 200,
) -> MagicMock:
    response = MagicMock(spec=httpx.Response)
    response.url = httpx.URL(url)
    response.request.method = method
    response.status_code = status_code
    return response


# ---------------------------------------------------------------------------
# TISAPIContext initialization
# ---------------------------------------------------------------------------


class TestTISAPIContextInit:
    def test_default_base_url(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        assert ctx.base_url == _DEFAULT_TIS_BASE_URL
        assert ctx.role_code is None

    def test_custom_base_url(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, base_url="https://custom.example.edu.cn")
        assert ctx.base_url == "https://custom.example.edu.cn"

    def test_base_url_trailing_slash_removed(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, base_url="https://tis.sustech.edu.cn/")
        assert ctx.base_url == "https://tis.sustech.edu.cn"

    def test_role_code_set_via_init(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, role_code="STUDENT")
        assert ctx.role_code == "STUDENT"

    def test_empty_role_code_becomes_none(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, role_code="")
        assert ctx.role_code is None

    def test_whitespace_role_code_becomes_none(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, role_code="   ")
        assert ctx.role_code is None

    def test_request_history_starts_empty(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        assert ctx.request_history == []


# ---------------------------------------------------------------------------
# set_role_code
# ---------------------------------------------------------------------------


class TestSetRoleCode:
    def test_sets_role_code(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        ctx.set_role_code("TEACHER")
        assert ctx.role_code == "TEACHER"

    def test_sets_header_on_client(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        ctx.set_role_code("STUDENT")
        assert client.headers["RoleCode"] == "STUDENT"

    def test_updates_header_when_changed(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        ctx.set_role_code("STUDENT")
        ctx.set_role_code("TEACHER")
        assert client.headers["RoleCode"] == "TEACHER"

    def test_removes_header_when_cleared(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        ctx.set_role_code("STUDENT")
        assert "RoleCode" in client.headers
        ctx.set_role_code(None)
        assert "RoleCode" not in client.headers

    def test_removes_header_with_empty_string(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        ctx.set_role_code("STUDENT")
        ctx.set_role_code("")
        assert "RoleCode" not in client.headers

    def test_noop_when_clearing_without_existing_header(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        ctx.set_role_code(None)
        assert "RoleCode" not in client.headers


# ---------------------------------------------------------------------------
# absolute_url
# ---------------------------------------------------------------------------


class TestAbsoluteUrl:
    def test_absolute_url(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, base_url="https://tis.sustech.edu.cn")
        result = ctx.absolute_url(
            "https://tis.sustech.edu.cn/page", "/subpage"
        )
        assert result == "https://tis.sustech.edu.cn/subpage"

    def test_relative_href(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        result = ctx.absolute_url("https://tis.sustech.edu.cn/student_index", "profile")
        assert result == "https://tis.sustech.edu.cn/profile"

    def test_root_relative_href(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        result = ctx.absolute_url(
            "https://tis.sustech.edu.cn/student_index", "/api/data"
        )
        assert result == "https://tis.sustech.edu.cn/api/data"


# ---------------------------------------------------------------------------
# get
# ---------------------------------------------------------------------------


class TestGet:
    def test_get_returns_response(self) -> None:
        response = _make_mock_response()
        client = _make_mock_client(get_response=response)
        ctx = TISAPIContext(client)
        result = ctx.get("https://tis.sustech.edu.cn/test")
        assert result is response

    def test_get_calls_client_get(self) -> None:
        response = _make_mock_response()
        client = _make_mock_client(get_response=response)
        ctx = TISAPIContext(client)
        ctx.get("https://tis.sustech.edu.cn/test", params={"key": "val"})
        client.get.assert_called_once()
        call_kwargs = client.get.call_args[1]
        assert call_kwargs["params"] == {"key": "val"}

    def test_get_records_request_history(self) -> None:
        response = _make_mock_response()
        client = _make_mock_client(get_response=response)
        ctx = TISAPIContext(client)
        ctx.get("https://tis.sustech.edu.cn/test")
        assert len(ctx.request_history) == 1
        assert ctx.request_history[0][0] == "GET"

    def test_get_normalizes_relative_url(self) -> None:
        response = _make_mock_response()
        client = _make_mock_client(get_response=response)
        ctx = TISAPIContext(client)
        ctx.get("/test/path")
        called_url = str(client.get.call_args[0][0])
        assert called_url == "https://tis.sustech.edu.cn/test/path"

    def test_get_merges_custom_headers(self) -> None:
        response = _make_mock_response()
        client = _make_mock_client(get_response=response)
        ctx = TISAPIContext(client, role_code="STUDENT")
        ctx.get("/test", headers={"X-Custom": "value"})
        call_headers = client.get.call_args[1]["headers"]
        assert call_headers["X-Custom"] == "value"
        assert call_headers.get("RoleCode") == "STUDENT"

    def test_get_with_logger_does_not_raise(self) -> None:
        response = _make_mock_response()
        client = _make_mock_client(get_response=response)
        mock_logger = MagicMock()
        ctx = TISAPIContext(client, logger=mock_logger)
        ctx.get("/test")
        mock_logger.debug.assert_called()


# ---------------------------------------------------------------------------
# post
# ---------------------------------------------------------------------------


class TestPost:
    def test_post_returns_response(self) -> None:
        response = _make_mock_response(method="POST")
        client = _make_mock_client(post_response=response)
        ctx = TISAPIContext(client)
        result = ctx.post("https://tis.sustech.edu.cn/api")
        assert result is response

    def test_post_sends_json_data(self) -> None:
        response = _make_mock_response(method="POST")
        client = _make_mock_client(post_response=response)
        ctx = TISAPIContext(client)
        ctx.post("/api", json_data={"xn": "2024"})
        client.post.assert_called_once()
        call_kwargs = client.post.call_args[1]
        assert call_kwargs["json"] == {"xn": "2024"}

    def test_post_sends_form_data(self) -> None:
        response = _make_mock_response(method="POST")
        client = _make_mock_client(post_response=response)
        ctx = TISAPIContext(client)
        ctx.post("/api", data={"mkdm[]": "002"})
        call_kwargs = client.post.call_args[1]
        assert call_kwargs["data"] == {"mkdm[]": "002"}

    def test_post_records_request_history(self) -> None:
        response = _make_mock_response(method="POST")
        client = _make_mock_client(post_response=response)
        ctx = TISAPIContext(client)
        ctx.post("/api")
        assert len(ctx.request_history) == 1
        assert ctx.request_history[0][0] == "POST"

    def test_post_normalizes_relative_url(self) -> None:
        response = _make_mock_response(method="POST")
        client = _make_mock_client(post_response=response)
        ctx = TISAPIContext(client)
        ctx.post("api/endpoint")
        called_url = str(client.post.call_args[0][0])
        assert called_url == "https://tis.sustech.edu.cn/api/endpoint"

    def test_post_with_logger(self) -> None:
        response = _make_mock_response(method="POST")
        client = _make_mock_client(post_response=response)
        mock_logger = MagicMock()
        ctx = TISAPIContext(client, logger=mock_logger)
        ctx.post("/api")
        mock_logger.debug.assert_called()


# ---------------------------------------------------------------------------
# _normalize_url
# ---------------------------------------------------------------------------


class TestNormalizeUrl:
    def test_absolute_url_returned_as_is(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        result = ctx._normalize_url("https://other.example.com/path")
        assert result == "https://other.example.com/path"

    def test_root_relative_url_prepends_base(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, base_url="https://tis.sustech.edu.cn")
        result = ctx._normalize_url("/path/to/resource")
        assert result == "https://tis.sustech.edu.cn/path/to/resource"

    def test_relative_url_prepends_base_with_slash(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, base_url="https://tis.sustech.edu.cn")
        result = ctx._normalize_url("api/endpoint")
        assert result == "https://tis.sustech.edu.cn/api/endpoint"

    def test_double_slash_path_normalized(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, base_url="https://tis.sustech.edu.cn")
        result = ctx._normalize_url("//double-slash")
        assert result == "https://double-slash"


# ---------------------------------------------------------------------------
# _build_headers
# ---------------------------------------------------------------------------


class TestBuildHeaders:
    def test_default_headers(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        headers = ctx._build_headers(None)
        assert headers["Accept"] == "application/json, text/plain, */*"
        assert headers["X-Requested-With"] == "XMLHttpRequest"
        assert "Referer" in headers

    def test_includes_role_code_when_set(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, role_code="STUDENT")
        headers = ctx._build_headers(None)
        assert headers["RoleCode"] == "STUDENT"

    def test_merges_extra_headers(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        headers = ctx._build_headers({"X-Custom": "my-value"})
        assert headers["X-Custom"] == "my-value"

    def test_extra_headers_override_defaults(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        headers = ctx._build_headers({"Accept": "text/html"})
        assert headers["Accept"] == "text/html"

    def test_extra_headers_override_role_code(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client, role_code="STUDENT")
        headers = ctx._build_headers({"RoleCode": "TEACHER"})
        assert headers["RoleCode"] == "TEACHER"


# ---------------------------------------------------------------------------
# _record_response
# ---------------------------------------------------------------------------


class TestRecordResponse:
    def test_appends_to_history(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        response = _make_mock_response(status_code=200)
        ctx._record_response("TEST", response)
        assert len(ctx.request_history) == 1
        label, method, code, url = ctx.request_history[0]
        assert label == "TEST"
        assert method == "GET"
        assert code == 200
        assert url == "https://tis.sustech.edu.cn/test"

    def test_multiple_requests_in_history(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        r1 = _make_mock_response(url="https://tis.sustech.edu.cn/a")
        r2 = _make_mock_response(url="https://tis.sustech.edu.cn/b")
        ctx._record_response("A", r1)
        ctx._record_response("B", r2)
        assert len(ctx.request_history) == 2

    def test_logger_warning_for_error_status(self) -> None:
        client = _make_mock_client()
        mock_logger = MagicMock()
        ctx = TISAPIContext(client, logger=mock_logger)
        response = _make_mock_response(status_code=500)
        ctx._record_response("ERR", response)
        mock_logger.warning.assert_called()

    def test_logger_debug_for_success_status(self) -> None:
        client = _make_mock_client()
        mock_logger = MagicMock()
        ctx = TISAPIContext(client, logger=mock_logger)
        response = _make_mock_response(status_code=200)
        ctx._record_response("OK", response)
        mock_logger.debug.assert_called()

    def test_no_logger_no_error_on_record(self) -> None:
        client = _make_mock_client()
        ctx = TISAPIContext(client)
        response = _make_mock_response(status_code=404)
        ctx._record_response("NOLOG", response)
        assert len(ctx.request_history) == 1
