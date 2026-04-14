"""Blackboard 领域共享标识提取与归一化工具。"""

from __future__ import annotations

import re
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urljoin, urlparse

DEFAULT_BLACKBOARD_BASE_URL = "https://bb.sustech.edu.cn"
DEFAULT_ID_TYPES: tuple[str, ...] = ("course_id", "content_id", "pk1", "xid", "rid", "id")
COURSE_ID_ALIASES: tuple[str, ...] = ("course_id", "id", "searchSelect", "search_select")
COURSE_ID_PATTERN = re.compile(r"(_\d+_\d+)")


def sanitize_blackboard_id(value: str | None) -> str:
    """清理 Blackboard ID 片段，去除常见尾随分隔符。"""
    token = str(value or "").strip()
    if not token:
        return ""

    for sep in ("&", "'", '"', ")", ";", " ", "#"):
        token, _, _ = token.partition(sep)
    return token.strip()


def _normalize_query_mapping(raw_query: str) -> dict[str, list[str]]:
    """将 parse_qs 结果显式收敛为 `dict[str, list[str]]`。"""
    normalized: dict[str, list[str]] = {}
    for key, values in parse_qs(raw_query).items():
        normalized[str(key)] = [str(item) for item in values]
    return normalized


def _first_query_value(query: dict[str, list[str]], key: str) -> str | None:
    values = query.get(key)
    if not values:
        return None
    first = next(iter(values), None)
    return str(first) if first is not None else None


def extract_blackboard_ids_from_url(
    url: str | None,
    *,
    id_types: Iterable[str] | None = None,
    base_url: str = DEFAULT_BLACKBOARD_BASE_URL,
) -> dict[str, str | None]:
    """统一提取 Blackboard URL 中的常见 ID。"""
    raw = str(url or "").strip()
    requested_types = tuple(id_types or DEFAULT_ID_TYPES)

    if not raw:
        result = {id_type: None for id_type in requested_types}
        result["source"] = None
        return result

    result: dict[str, str | None] = {id_type: None for id_type in requested_types}
    result["source"] = None

    joined_url = str(urljoin(base_url, raw))
    parsed = urlparse(joined_url)
    query = _normalize_query_mapping(str(parsed.query))
    parsed_path = str(parsed.path)
    parsed_fragment = str(parsed.fragment)

    for id_type in requested_types:
        variants = (id_type, id_type.replace("_", ""))
        for variant in variants:
            raw_value = _first_query_value(query, variant)
            if not raw_value:
                continue
            cleaned = sanitize_blackboard_id(raw_value)
            if not cleaned:
                continue
            result[id_type] = cleaned
            if result["source"] is None:
                result["source"] = "query"
            break

    path_patterns: tuple[tuple[str, str], ...] = (
        (r"xid-([^/?#]+)", "xid"),
        (r"rid-([^/?#]+)", "rid"),
        (r"pid-(\d+)", "pk1"),
    )
    for pattern, id_type in path_patterns:
        if id_type not in requested_types or result[id_type] is not None:
            continue
        match = re.search(pattern, parsed_path)
        if not match:
            continue
        result[id_type] = sanitize_blackboard_id(match.group(1)) or None
        if result[id_type] and result["source"] is None:
            result["source"] = "path"

    if parsed_fragment:
        fragment_match = re.fullmatch(r"(_\d+_\d+)", parsed_fragment)
        if fragment_match:
            fragment_id = fragment_match.group(1)
            for id_type in ("content_id", "pk1"):
                if id_type in requested_types and result[id_type] is None:
                    result[id_type] = fragment_id
                    if result["source"] is None:
                        result["source"] = "fragment"

    decoded = unquote(raw)
    for candidate_text in (raw, decoded):
        for id_type in requested_types:
            if result[id_type] is not None:
                continue
            variants = (id_type, id_type.replace("_", ""))
            for variant in variants:
                match = re.search(
                    rf"(?<!\w){re.escape(variant)}\s*=\s*([^&'\";\)\s#]+)",
                    candidate_text,
                    re.IGNORECASE,
                )
                if not match:
                    continue
                cleaned = sanitize_blackboard_id(match.group(1))
                if not cleaned:
                    continue
                result[id_type] = cleaned
                if result["source"] is None:
                    result["source"] = "fallback"
                break

    return result


def extract_course_id_from_url(url: str | None, *, aliases: Iterable[str] | None = None) -> str | None:
    """从 Blackboard URL 中提取课程 ID。"""
    id_candidates = tuple(aliases or COURSE_ID_ALIASES)
    ids = extract_blackboard_ids_from_url(url, id_types=id_candidates)
    for key in id_candidates:
        value = ids.get(key)
        if value:
            return value
    return None


def extract_blackboard_token_from_text(*values: str | None) -> str | None:
    """从文本中提取裸露的 Blackboard `_123_1` 风格 ID。"""
    merged = " | ".join(str(value or "") for value in values)
    match = COURSE_ID_PATTERN.search(merged)
    return match.group(1) if match else None
