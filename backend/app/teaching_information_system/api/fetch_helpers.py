"""TIS API 抓取辅助函数。"""

from __future__ import annotations

import json
import re
from typing import Any, Sequence
from urllib.parse import urlparse

import httpx

from ..shared import _clean_text
from .constants import _DEFAULT_TIS_BASE_URL, _GRADE_MENU_KEYWORDS


def _contains_keyword(text: str, keywords: Sequence[str]) -> bool:
    lowered = str(text or "").lower()
    return any(str(keyword).lower() in lowered for keyword in keywords)


def _same_host(url: str, *, base_url: str) -> bool:
    parsed_url = urlparse(str(url or ""))
    parsed_base = urlparse(base_url)
    return bool(parsed_url.netloc) and parsed_url.netloc == parsed_base.netloc


def _response_chain_urls(response: httpx.Response) -> list[str]:
    return [str(item.url) for item in response.history] + [str(response.url)]


def _summarize_cookie_names(cookies: dict[str, str]) -> dict[str, Any]:
    names = sorted(_clean_text(name) for name in cookies.keys() if _clean_text(name))
    lowered = [name.lower() for name in names]
    return {
        "cookie_names": names,
        "cookie_count": len(names),
        "has_jsessionid": "jsessionid" in lowered,
        "has_castgc": "castgc" in lowered,
        "has_tgc": "tgc" in lowered,
        "has_route_cookie": any("route" in name for name in lowered),
    }


def _extract_response_auth_markers(
    response: httpx.Response,
    *,
    base_url: str = _DEFAULT_TIS_BASE_URL,
) -> dict[str, Any]:
    body = response.text or ""
    lowered = body.lower()
    final_url = str(response.url)
    parsed_url = urlparse(final_url)
    parsed_base_url = urlparse(str(base_url or _DEFAULT_TIS_BASE_URL))
    title_match = re.search(r"<title[^>]*>(.*?)</title>", body, flags=re.IGNORECASE | re.DOTALL)
    title = _clean_text(title_match.group(1)) if title_match else ""
    is_root_homepage = (
        parsed_url.netloc == parsed_base_url.netloc
        and parsed_url.path in ("", "/")
        and "教学管理与服务平台" in body
    )
    is_cas_login = (
        "cas.sustech.edu.cn" in final_url
        or 'name="execution"' in lowered
        or 'id="fm1"' in lowered
        or "统一身份认证" in body
    )
    has_login_form = 'name="username"' in lowered and 'name="password"' in lowered
    contains_grcjcx = "grcjcx" in lowered
    return {
        "response_title": title or None,
        "final_path": parsed_url.path or "/",
        "is_root_homepage": is_root_homepage,
        "is_cas_login": is_cas_login,
        "has_login_form": has_login_form,
        "contains_grcjcx": contains_grcjcx,
        "has_grade_keyword": contains_grcjcx or _contains_keyword(body, _GRADE_MENU_KEYWORDS),
    }


def _safe_parse_json_response(response: httpx.Response) -> Any | None:
    try:
        return response.json()
    except (json.JSONDecodeError, ValueError):
        return None


def _extract_role_code_from_user_payload(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    role_codes = payload.get("rolecode") or payload.get("roleCode")
    if isinstance(role_codes, list):
        for item in role_codes:
            text = _clean_text(item)
            if text:
                return text
    text = _clean_text(role_codes)
    if text:
        return text
    roles = payload.get("role")
    if isinstance(roles, list):
        for item in roles:
            if not isinstance(item, dict):
                continue
            text = _clean_text(item.get("jsdm"))
            if text:
                return text
    return None


def _extract_pylx_from_payload(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("pylx", "PYLX"):
        text = _clean_text(payload.get(key))
        if text:
            return text
    return None


def _is_authenticated_tis_response(
    response: httpx.Response,
    *,
    base_url: str = _DEFAULT_TIS_BASE_URL,
) -> bool:
    markers = _extract_response_auth_markers(response, base_url=base_url)
    chain = _response_chain_urls(response)
    return not (
        markers["is_root_homepage"]
        or markers["is_cas_login"]
        or markers["has_login_form"]
        or any("/authentication/require" in item for item in chain)
        or any("/session/invalid" in item for item in chain)
    )


__all__ = [
    "_contains_keyword",
    "_extract_pylx_from_payload",
    "_extract_response_auth_markers",
    "_extract_role_code_from_user_payload",
    "_is_authenticated_tis_response",
    "_response_chain_urls",
    "_safe_parse_json_response",
    "_same_host",
    "_summarize_cookie_names",
]
