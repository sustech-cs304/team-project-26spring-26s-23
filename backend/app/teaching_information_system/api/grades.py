"""TIS 个人成绩查询解析与探测。"""

from __future__ import annotations

import json
from collections.abc import Iterable, Sequence
from typing import Any
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

from ..shared import TISLogger, _clean_text, _jsonable
from .client import TISClient
from .constants import (
    _COURSE_CODE_KEYS,
    _COURSE_NAME_KEYS,
    _CREDIT_KEYS,
    _DEFAULT_GRADE_PATH_CANDIDATES,
    _DEFAULT_TIS_BASE_URL,
    _DEFAULT_TIS_ENTRY_PATH,
    _DEFAULT_TIS_PERSONAL_GRADES_API_PATH,
    _DEFAULT_TIS_PERSONAL_GRADES_PAGE_PATH,
    _GRADE_MENU_KEYWORDS,
    _JSON_CONTAINER_KEYS,
    _SCORE_KEYS,
    _TERM_KEYS,
)
from .dto import TISGradeRecord, TISHomepageProfile, TISMenuEntry, TISProbeResult
from .fetch_helpers import _contains_keyword, _extract_response_auth_markers, _response_chain_urls, _same_host


def _first_non_empty(mapping: dict[str, Any], candidates: Sequence[str]) -> str | None:
    lowered = {str(key).lower(): key for key in mapping.keys()}
    for candidate in candidates:
        direct = mapping.get(candidate)
        if direct not in (None, ""):
            text = _clean_text(direct)
            if text:
                return text
        actual_key = lowered.get(candidate.lower())
        if actual_key is None:
            continue
        value = mapping.get(actual_key)
        text = _clean_text(value)
        if text:
            return text
    return None


def _pick_by_header_tokens(mapping: dict[str, Any], tokens: Iterable[str]) -> str | None:
    for key, value in mapping.items():
        lowered_key = str(key).lower()
        if any(str(token).lower() in lowered_key for token in tokens):
            text = _clean_text(value)
            if text:
                return text
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


def _dedupe_grade_records(records: Sequence[TISGradeRecord]) -> list[TISGradeRecord]:
    deduped: list[TISGradeRecord] = []
    seen: set[tuple[str, str, str, str]] = set()
    for record in records:
        key = (record.course_name, record.score, record.course_code or "", record.term or "")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    return deduped


def _merge_probe_records(probes: Sequence[TISProbeResult]) -> list[TISGradeRecord]:
    merged: list[TISGradeRecord] = []
    for probe in probes:
        merged.extend(probe.grade_records)
    return _dedupe_grade_records(merged)


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


def build_grade_candidate_urls(homepage: TISHomepageProfile, *, base_url: str = _DEFAULT_TIS_BASE_URL) -> list[str]:
    base_candidates = list(homepage.base_urls) or [base_url]
    explicit_candidates = list(homepage.grade_related_endpoints)

    for menu_entry in homepage.menu_entries:
        combined = " ".join(filter(None, [menu_entry.text, menu_entry.href, menu_entry.onclick]))
        if menu_entry.href and _contains_keyword(combined, _GRADE_MENU_KEYWORDS):
            explicit_candidates.append(menu_entry.href)

    resolved: list[str] = []
    for item in explicit_candidates:
        normalized = _normalize_candidate_url(item, page_url=homepage.page_url, base_url=base_url)
        if normalized:
            resolved.append(normalized)

    for root in base_candidates:
        normalized_root = _clean_text(root).rstrip("/") or base_url
        for path in _DEFAULT_GRADE_PATH_CANDIDATES:
            resolved.append(urljoin(f"{normalized_root}/", path.lstrip("/")))

    return _dedupe_preserve_order(url for url in resolved if _same_host(url, base_url=base_url))


def _build_real_grade_query_payload(*, pylx: str = "1", current: int = 1, page_size: int = 20) -> dict[str, Any]:
    return {
        "xn": None,
        "xq": None,
        "kcmc": None,
        "cxbj": "-1",
        "pylx": _clean_text(pylx) or "1",
        "current": int(current),
        "pageSize": int(page_size),
        "sffx": None,
    }


def _build_tis_probe_result(
    response: httpx.Response,
    *,
    probe_label: str,
    request_payload: dict[str, Any] | None = None,
    record_count: int = 0,
) -> TISProbeResult:
    content_type = str(response.headers.get("content-type") or "").lower()
    initial_request = response.history[0].request if response.history else response.request
    return TISProbeResult(
        url=str(response.url),
        method=str(response.request.method),
        status_code=int(response.status_code),
        content_type=content_type or None,
        record_count=int(record_count),
        grade_records=[],
        is_json="json" in content_type,
        preview=_clean_text(response.text, max_length=500) or None,
        probe_label=probe_label,
        requested_url=str(initial_request.url),
        requested_method=str(initial_request.method),
        redirect_count=len(response.history),
        request_headers={
            key: str(initial_request.headers.get(key) or "")
            for key in ("RoleCode", "Referer", "Content-Type", "X-Requested-With", "Accept", "Origin")
            if initial_request.headers.get(key)
        },
        request_payload_keys=sorted(request_payload.keys()) if request_payload is not None else [],
        request_payload={str(key): _jsonable(value) for key, value in request_payload.items()} if request_payload is not None else {},
    )


def _extract_grade_json_debug_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"payload_type": type(payload).__name__}
    content = payload.get("content")
    list_node = content.get("list") if isinstance(content, dict) else None
    sample_record = list_node[0] if isinstance(list_node, list) and list_node and isinstance(list_node[0], dict) else None
    return {
        "payload_type": "dict",
        "root_keys": sorted(str(key) for key in payload.keys())[:20],
        "content_keys": sorted(str(key) for key in content.keys())[:20] if isinstance(content, dict) else [],
        "list_length": len(list_node) if isinstance(list_node, list) else None,
        "sample_record_keys": sorted(str(key) for key in sample_record.keys())[:30] if isinstance(sample_record, dict) else [],
    }


def extract_grade_records_from_json(payload: Any) -> list[TISGradeRecord]:
    collected: list[TISGradeRecord] = []

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            course_name = _first_non_empty(node, _COURSE_NAME_KEYS)
            score = _first_non_empty(node, _SCORE_KEYS)
            if course_name and score:
                collected.append(
                    TISGradeRecord(
                        course_name=course_name,
                        score=score,
                        course_code=_first_non_empty(node, _COURSE_CODE_KEYS),
                        term=_first_non_empty(node, _TERM_KEYS),
                        credit=_first_non_empty(node, _CREDIT_KEYS),
                        raw={str(key): _jsonable(value) for key, value in node.items()},
                    )
                )
            for key in _JSON_CONTAINER_KEYS:
                child = node.get(key)
                if child is not None:
                    _walk(child)
            for child in node.values():
                if isinstance(child, (list, dict)):
                    _walk(child)
            return
        if isinstance(node, list):
            for item in node:
                _walk(item)

    _walk(payload)
    return _dedupe_grade_records(collected)


def extract_grade_records_from_html(html: str) -> list[TISGradeRecord]:
    soup = BeautifulSoup(html or "", "html.parser")
    records: list[TISGradeRecord] = []
    for table in soup.select("table"):
        rows = table.select("tr")
        if len(rows) < 2:
            continue
        headers = [_clean_text(cell.get_text(" ", strip=True)).lower() for cell in rows[0].find_all(["th", "td"])]
        if not headers:
            continue
        has_grade_signal = any(_contains_keyword(header, _GRADE_MENU_KEYWORDS + _COURSE_NAME_KEYS) for header in headers)
        if not has_grade_signal:
            continue

        for row in rows[1:]:
            cells = row.find_all(["th", "td"])
            if not cells:
                continue
            row_map: dict[str, Any] = {}
            for idx, cell in enumerate(cells):
                header = headers[idx] if idx < len(headers) else f"column_{idx}"
                row_map[header] = _clean_text(cell.get_text(" ", strip=True))
            course_name = _first_non_empty(row_map, _COURSE_NAME_KEYS) or _pick_by_header_tokens(row_map, ("课程", "course", "名称", "name"))
            score = _first_non_empty(row_map, _SCORE_KEYS) or _pick_by_header_tokens(row_map, ("成绩", "score", "grade"))
            if not course_name or not score:
                continue
            records.append(
                TISGradeRecord(
                    course_name=course_name,
                    score=score,
                    course_code=_first_non_empty(row_map, _COURSE_CODE_KEYS),
                    term=_first_non_empty(row_map, _TERM_KEYS),
                    credit=_first_non_empty(row_map, _CREDIT_KEYS),
                    raw={str(key): _jsonable(value) for key, value in row_map.items()},
                )
            )
    return _dedupe_grade_records(records)


def probe_grade_candidates(
    tis_client: TISClient,
    homepage: TISHomepageProfile,
    *,
    logger: TISLogger | None = None,
    max_probe_count: int = 12,
) -> list[TISProbeResult]:
    probes: list[TISProbeResult] = []
    candidate_urls = build_grade_candidate_urls(homepage, base_url=tis_client.config.base_url)
    seen_requests: set[tuple[str, str]] = set()

    def _append_probe_result(
        response: httpx.Response,
        *,
        probe_label: str,
        request_payload: dict[str, Any] | None = None,
    ) -> None:
        content_type = str(response.headers.get("content-type") or "").lower()
        is_json = "json" in content_type
        grade_records: list[TISGradeRecord] = []
        preview = _clean_text(response.text, max_length=500)
        json_debug_payload: dict[str, Any] | None = None
        redirect_chain = _response_chain_urls(response)
        auth_markers = _extract_response_auth_markers(response)

        if is_json:
            try:
                payload = response.json()
            except json.JSONDecodeError as ex:
                payload = None
                if logger is not None:
                    logger.warning("⚠ TIS JSON 响应解码失败", payload={"url": str(response.url), "probe_label": probe_label, "error": str(ex)})
            if payload is not None:
                grade_records = extract_grade_records_from_json(payload)
                json_debug_payload = _extract_grade_json_debug_payload(payload)
        else:
            grade_records = extract_grade_records_from_html(response.text)

        initial_request = response.history[0].request if response.history else response.request

        if logger is not None:
            info_payload: dict[str, Any] = {
                "url": str(response.url),
                "requested_url": str(initial_request.url),
                "status_code": int(response.status_code),
                "is_json": is_json,
                "record_count": len(grade_records),
                "probe_label": probe_label,
                "redirect_count": len(response.history),
                "redirect_chain": redirect_chain,
                **auth_markers,
            }
            if request_payload is not None:
                info_payload["request_payload_keys"] = sorted(request_payload.keys())
            logger.info("ℹ TIS 候选接口探测完成", payload=info_payload)
            if response.history:
                logger.debug("ℹ TIS 候选接口重定向链", payload={"probe_label": probe_label, "requested_url": str(initial_request.url), "redirect_chain": redirect_chain})
            if auth_markers["is_root_homepage"] or auth_markers["is_cas_login"] or auth_markers["has_login_form"]:
                logger.warning(
                    "⚠ TIS 候选接口出现认证态或根首页回退信号",
                    payload={"probe_label": probe_label, "requested_url": str(initial_request.url), "redirect_chain": redirect_chain, **auth_markers},
                )
            if json_debug_payload is not None:
                logger.debug("ℹ TIS JSON 成绩解析信号", payload={"url": str(response.url), "probe_label": probe_label, **json_debug_payload})

        probes.append(
            TISProbeResult(
                url=str(response.url),
                method=str(response.request.method),
                status_code=int(response.status_code),
                content_type=content_type or None,
                record_count=len(grade_records),
                grade_records=grade_records,
                is_json=is_json,
                preview=preview or None,
                probe_label=probe_label,
                requested_url=str(initial_request.url),
                requested_method=str(initial_request.method),
                redirect_count=len(response.history),
                request_headers={
                    key: str(initial_request.headers.get(key) or "")
                    for key in ("RoleCode", "Referer", "Content-Type", "X-Requested-With", "Accept", "Origin")
                    if initial_request.headers.get(key)
                },
                request_payload_keys=sorted(request_payload.keys()) if request_payload is not None else [],
                request_payload={str(key): _jsonable(value) for key, value in request_payload.items()} if request_payload is not None else {},
            )
        )

    for candidate_url in candidate_urls[: max(int(max_probe_count), 0) or 0]:
        request_key = ("GET", candidate_url)
        if request_key in seen_requests:
            continue
        seen_requests.add(request_key)
        try:
            response = tis_client.probe(candidate_url)
        except Exception as ex:
            if logger is not None:
                logger.warning("⚠ TIS 候选接口访问失败", payload={"url": candidate_url, "error": str(ex)})
            continue
        _append_probe_result(response, probe_label="homepage-candidate")

    grade_page_url = urljoin(tis_client.config.base_url, _DEFAULT_TIS_PERSONAL_GRADES_PAGE_PATH)
    grade_api_url = urljoin(tis_client.config.base_url, _DEFAULT_TIS_PERSONAL_GRADES_API_PATH)
    request_payload = _build_real_grade_query_payload(pylx=tis_client.pylx or "1")

    try:
        page_response = tis_client.probe(
            grade_page_url,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Referer": urljoin(tis_client.config.base_url, _DEFAULT_TIS_ENTRY_PATH),
            },
        )
        _append_probe_result(page_response, probe_label="har-grade-page")
    except Exception as ex:
        if logger is not None:
            logger.warning("⚠ HAR 定位到的成绩页面访问失败", payload={"url": grade_page_url, "error": str(ex)})

    try:
        api_response = tis_client.probe(
            grade_api_url,
            method="POST",
            json_data=request_payload,
            headers={
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Content-Type": "application/json",
                "Origin": tis_client.config.base_url,
                "Referer": grade_page_url,
            },
        )
        _append_probe_result(api_response, probe_label="har-grade-api", request_payload=request_payload)
    except Exception as ex:
        if logger is not None:
            logger.warning("⚠ HAR 定位到的成绩 JSON 接口访问失败", payload={"url": grade_api_url, "error": str(ex)})

    return probes


__all__ = [
    "analyze_homepage_html",
    "build_grade_candidate_urls",
    "extract_grade_records_from_html",
    "extract_grade_records_from_json",
    "probe_grade_candidates",
]
