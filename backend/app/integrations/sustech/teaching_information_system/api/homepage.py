"""TIS 首页分析能力。"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from bs4.element import Tag

from ..shared import _clean_text
from .constants import _DEFAULT_TIS_BASE_URL, _GRADE_MENU_KEYWORDS, _SCHEDULE_KEYWORDS
from .dto import DEFAULT_TIS_SERVICE_CONFIG, TISHomepageProfile, TISMenuEntry
from .fetch_helpers import _contains_keyword, _same_host


def analyze_homepage_html(
    html: str,
    *,
    page_url: str = DEFAULT_TIS_SERVICE_CONFIG.homepage_url,
    base_url: str = DEFAULT_TIS_SERVICE_CONFIG.base_url,
) -> TISHomepageProfile:
    """从 TIS 首页 HTML 中提取 iframe、菜单、接口与角色信号。"""

    soup = BeautifulSoup(html or "", "html.parser")
    title = _clean_text(soup.title.get_text(" ", strip=True) if soup.title else "")
    iframe_urls = _dedupe_preserve_order(
        [
            urljoin(page_url, str(frame.get("src") or "").strip())
            for frame in soup.select("iframe[src]")
            if str(frame.get("src") or "").strip()
        ]
    )

    base_urls = _extract_base_urls(html, page_url=page_url, base_url=base_url)
    discovered_endpoints = _extract_candidate_endpoints(html, page_url=page_url, base_url=base_url)
    menu_entries = _extract_menu_entries(soup, page_url=page_url)
    role_codes = _extract_role_codes(html)

    schedule_related = [item for item in discovered_endpoints if _contains_keyword(item, _SCHEDULE_KEYWORDS)]
    grade_related = [item for item in discovered_endpoints if _contains_keyword(item, _GRADE_MENU_KEYWORDS)]
    for item in menu_entries:
        searchable = " ".join(filter(None, [item.text, item.href, item.onclick]))
        if item.href and _contains_keyword(searchable, _GRADE_MENU_KEYWORDS):
            grade_related.append(item.href)
        if item.href and _contains_keyword(searchable, _SCHEDULE_KEYWORDS):
            schedule_related.append(item.href)

    prefers_json_api = _estimate_prefers_json_api(
        discovered_endpoints=discovered_endpoints,
        iframe_urls=iframe_urls,
        html=html,
    )
    return TISHomepageProfile(
        page_url=page_url,
        title=title,
        iframe_urls=iframe_urls,
        base_urls=base_urls,
        menu_entries=menu_entries,
        discovered_endpoints=discovered_endpoints,
        schedule_related_endpoints=_dedupe_preserve_order(grade_or_schedule for grade_or_schedule in schedule_related),
        grade_related_endpoints=_dedupe_preserve_order(grade_or_schedule for grade_or_schedule in grade_related),
        role_codes=role_codes,
        prefers_json_api=prefers_json_api,
        raw_signals={
            "script_count": len(soup.find_all("script")),
            "iframe_count": len(iframe_urls),
            "anchor_count": len(soup.find_all("a")),
        },
    )


def _extract_menu_entries(soup: BeautifulSoup, *, page_url: str) -> list[TISMenuEntry]:
    entries: list[TISMenuEntry] = []
    for node in soup.select("a[href], a[onclick], button[onclick], [role='menuitem']"):
        if not isinstance(node, Tag):
            continue
        text = _clean_text(node.get_text(" ", strip=True), max_length=120)
        href = _clean_text(node.get("href")) or None
        onclick = _clean_text(node.get("onclick"), max_length=300) or None
        target = _clean_text(node.get("target")) or None
        if href and href not in ("#", "javascript:;", "javascript:void(0)"):
            href = urljoin(page_url, href)
        if not any([text, href, onclick]):
            continue
        menu_type = None
        searchable = " ".join(filter(None, [text, href, onclick])).lower()
        if _contains_keyword(searchable, _GRADE_MENU_KEYWORDS):
            menu_type = "grade"
        elif _contains_keyword(searchable, _SCHEDULE_KEYWORDS):
            menu_type = "schedule"
        entries.append(TISMenuEntry(text=text, href=href, onclick=onclick, target=target, menu_type=menu_type))
    return _dedupe_menu_entries(entries)


def _extract_base_urls(html: str, *, page_url: str, base_url: str) -> list[str]:
    candidates: list[str] = [base_url]
    base_matchers = (
        r"(?:baseUrl|baseURL|basePath|contextPath|ctx)\s*[:=]\s*['\"]([^'\"]+)['\"]",
        r"<base[^>]+href=['\"]([^'\"]+)['\"]",
    )
    for pattern in base_matchers:
        for match in re.finditer(pattern, html or "", flags=re.IGNORECASE):
            value = _clean_text(match.group(1))
            normalized = _normalize_candidate_url(value, page_url=page_url, base_url=base_url)
            if normalized:
                candidates.append(normalized)
    return _dedupe_preserve_order(candidates)


def _extract_candidate_endpoints(html: str, *, page_url: str, base_url: str) -> list[str]:
    quoted_url_pattern = r"['\"]((?:https?://|/)[^'\"<>\s]+)['\"]"
    candidates: list[str] = []
    for match in re.finditer(quoted_url_pattern, html or "", flags=re.IGNORECASE):
        normalized = _normalize_candidate_url(match.group(1), page_url=page_url, base_url=base_url)
        if normalized:
            candidates.append(normalized)

    endpoint_hint_pattern = r"([A-Za-z0-9_\-/]+\.(?:do|json|action|ajax)(?:\?[^\s'\"]*)?)"
    for match in re.finditer(endpoint_hint_pattern, html or "", flags=re.IGNORECASE):
        normalized = _normalize_candidate_url(match.group(1), page_url=page_url, base_url=base_url)
        if normalized:
            candidates.append(normalized)
    return _dedupe_preserve_order(url for url in candidates if _same_host(url, base_url=base_url))


def _extract_role_codes(html: str) -> list[str]:
    patterns = (
        r"RoleCode\s*[:=]\s*['\"]([^'\"]+)['\"]",
        r"roleCode\s*[:=]\s*['\"]([^'\"]+)['\"]",
        r"rolecode\s*[:=]\s*['\"]([^'\"]+)['\"]",
    )
    role_codes: list[str] = []
    for pattern in patterns:
        for match in re.finditer(pattern, html or "", flags=re.IGNORECASE):
            code = _clean_text(match.group(1), max_length=64)
            if code:
                role_codes.append(code)
    return _dedupe_preserve_order(role_codes)


def _estimate_prefers_json_api(*, discovered_endpoints: Sequence[str], iframe_urls: Sequence[str], html: str) -> bool:
    endpoint_score = sum(
        1 for item in discovered_endpoints if re.search(r"(ajax|api|json|query|list|data|load|get[A-Z_])", item, flags=re.IGNORECASE)
    )
    iframe_score = 1 if iframe_urls else 0
    html_score = 1 if re.search(r"XMLHttpRequest|fetch\(|axios\.|\$\.ajax", html or "", flags=re.IGNORECASE) else 0
    return endpoint_score + iframe_score + html_score >= 2


def _normalize_candidate_url(candidate: str, *, page_url: str, base_url: str) -> str | None:
    text = _clean_text(candidate)
    if not text or text.startswith("javascript:"):
        return None
    if text.startswith("http://") or text.startswith("https://"):
        return text
    if text.startswith("/"):
        return f"{base_url.rstrip('/')}{text}"
    if "/" in text or "." in text:
        return urljoin(page_url, text)
    return None


def _dedupe_preserve_order(items: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        normalized = _clean_text(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _dedupe_menu_entries(entries: Sequence[TISMenuEntry]) -> list[TISMenuEntry]:
    result: list[TISMenuEntry] = []
    seen: set[tuple[str, str, str]] = set()
    for entry in entries:
        key = (entry.text, entry.href or "", entry.onclick or "")
        if key in seen:
            continue
        seen.add(key)
        result.append(entry)
    return result


__all__ = ["analyze_homepage_html"]
