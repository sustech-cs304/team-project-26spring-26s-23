"""Blackboard 领域共享标识提取与归一化工具。"""

from __future__ import annotations

import re
from typing import Iterable
from urllib.parse import parse_qs, unquote, urljoin, urlparse

DEFAULT_BLACKBOARD_BASE_URL = "https://bb.sustech.edu.cn"
DEFAULT_ID_TYPES: tuple[str, ...] = (
    "ann_id",
    "course_id",
    "content_id",
    "pk1",
    "xid",
    "rid",
    "id",
)
COURSE_ID_ALIASES: tuple[str, ...] = (
    "course_id",
    "id",
    "searchSelect",
    "search_select",
)
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


def _requested_blackboard_id_types(
    id_types: Iterable[str] | None,
) -> tuple[str, ...]:
    return tuple(id_types or DEFAULT_ID_TYPES)


def _resolve_blackboard_url(raw: str, base_url: str) -> str:
    return str(urljoin(base_url, raw))


def _fallback_candidate_texts(raw: str) -> tuple[str, str]:
    return raw, unquote(raw)


def _empty_blackboard_id_result(
    requested_types: tuple[str, ...],
) -> dict[str, str | None]:
    result: dict[str, str | None] = {id_type: None for id_type in requested_types}
    result["source"] = None
    return result


def _id_variants(id_type: str) -> tuple[str, str]:
    return id_type, id_type.replace("_", "")


def _store_extracted_id(
    result: dict[str, str | None],
    *,
    id_type: str,
    raw_value: str | None,
    source: str,
) -> None:
    if result.get(id_type) is not None:
        return

    cleaned = sanitize_blackboard_id(raw_value)
    if not cleaned:
        return

    result[id_type] = cleaned
    if result["source"] is None:
        result["source"] = source


def _extract_query_ids(
    query: dict[str, list[str]],
    requested_types: tuple[str, ...],
    result: dict[str, str | None],
) -> None:
    for id_type in requested_types:
        for variant in _id_variants(id_type):
            raw_value = _first_query_value(query, variant)
            if raw_value:
                _store_extracted_id(
                    result,
                    id_type=id_type,
                    raw_value=raw_value,
                    source="query",
                )
                break


def _extract_path_ids(
    parsed_path: str,
    requested_types: tuple[str, ...],
    result: dict[str, str | None],
) -> None:
    path_patterns: tuple[tuple[str, str], ...] = (
        (r"xid-([^/?#]+)", "xid"),
        (r"rid-([^/?#]+)", "rid"),
        (r"pid-(\d+)", "pk1"),
    )
    for pattern, id_type in path_patterns:
        if id_type in requested_types:
            match = re.search(pattern, parsed_path)
            if match:
                _store_extracted_id(
                    result,
                    id_type=id_type,
                    raw_value=match.group(1),
                    source="path",
                )


def _extract_fragment_ids(
    parsed_fragment: str,
    requested_types: tuple[str, ...],
    result: dict[str, str | None],
) -> None:
    fragment_match = re.search(r"(_\d+_\d+)", parsed_fragment)
    if not fragment_match:
        return

    fragment_id = fragment_match.group(1)
    for id_type in ("content_id", "pk1"):
        if id_type in requested_types:
            _store_extracted_id(
                result,
                id_type=id_type,
                raw_value=fragment_id,
                source="fragment",
            )


def _extract_fallback_ids(
    candidate_texts: Iterable[str],
    requested_types: tuple[str, ...],
    result: dict[str, str | None],
) -> None:
    for candidate_text in candidate_texts:
        for id_type in requested_types:
            for variant in _id_variants(id_type):
                match = re.search(
                    rf"(?<!\w){re.escape(variant)}\s*=\s*([^&'\";\)\s#]+)",
                    candidate_text,
                    re.IGNORECASE,
                )
                if match:
                    _store_extracted_id(
                        result,
                        id_type=id_type,
                        raw_value=match.group(1),
                        source="fallback",
                    )
                    break


def extract_blackboard_ids_from_url(
    url: str | None,
    *,
    id_types: Iterable[str] | None = None,
    base_url: str = DEFAULT_BLACKBOARD_BASE_URL,
) -> dict[str, str | None]:
    """统一提取 Blackboard URL 中的常见 ID。"""
    raw = str(url or "").strip()
    requested_types = _requested_blackboard_id_types(id_types)
    result = _empty_blackboard_id_result(requested_types)
    if not raw:
        return result

    parsed = urlparse(_resolve_blackboard_url(raw, base_url))
    _extract_query_ids(
        _normalize_query_mapping(str(parsed.query)), requested_types, result
    )
    _extract_path_ids(str(parsed.path), requested_types, result)
    _extract_fragment_ids(str(parsed.fragment), requested_types, result)
    _extract_fallback_ids(_fallback_candidate_texts(raw), requested_types, result)
    return result


def extract_course_id_from_url(
    url: str | None, *, aliases: Iterable[str] | None = None
) -> str | None:
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
