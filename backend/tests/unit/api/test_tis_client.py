from __future__ import annotations

from typing import Any

import httpx

from app.teaching_information_system.api.client import TISClient
from app.teaching_information_system.api.dto import TISServiceConfig


def _html_response(url: str, *, headers: dict[str, str] | None = None) -> httpx.Response:
    return httpx.Response(
        200,
        text="<html><title>教学管理与服务平台</title></html>",
        request=httpx.Request("GET", url, headers=headers),
    )


def _json_response(
    method: str,
    url: str,
    payload: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> httpx.Response:
    return httpx.Response(
        200,
        json=payload,
        request=httpx.Request(method, url, headers=headers),
    )


def test_warmup_auth_main_uses_configured_entry_url_as_referer() -> None:
    config = TISServiceConfig(
        base_url="https://tis.example.edu.cn",
        entry_path="/custom-entry",
        homepage_path="/student_index",
    )
    client = TISClient(config=config)
    request_headers: dict[str, dict[str, str]] = {}

    def fake_get(
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        label: str = "GET",
    ) -> httpx.Response:
        del params
        request_headers[label] = dict(headers or {})
        return _html_response(url, headers=headers)

    def fake_post(
        url: str,
        *,
        data: Any | None = None,
        json_data: Any | None = None,
        headers: dict[str, str] | None = None,
        label: str = "POST",
    ) -> httpx.Response:
        del data, json_data
        request_headers[label] = dict(headers or {})
        payload: dict[str, Any] = {}
        if label == "TIS-User-Me":
            payload = {"rolecode": ["STUDENT"], "pylx": "1"}
        elif label == "TIS-QueryXsxx":
            payload = {"pylx": "1"}
        elif label == "TIS-GetMknodeMore":
            payload = {"002": [{"name": "grade"}]}
        return _json_response("POST", url, payload, headers=headers)

    client.context.get = fake_get  # type: ignore[method-assign]
    client.context.post = fake_post  # type: ignore[method-assign]

    try:
        summary = client._warmup_authenticated_context()
    finally:
        client.close()

    assert summary["authenticated"] is True
    assert request_headers["TIS-Auth-Main"]["Referer"] == config.entry_url
