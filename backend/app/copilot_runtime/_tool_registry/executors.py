"""Executable builtin tool implementations for the Copilot runtime tool registry."""

from __future__ import annotations

import os
import random
from collections.abc import Mapping
from pathlib import Path
from typing import Any, TypedDict

from app.desktop_runtime.config import DEFAULT_USER_DATA_DIR, ENV_USER_DATA_DIR

from .constants import DEFAULT_WEATHER_LOCATION, WEATHER_SAMPLE_RESULTS


async def execute_weather_current_tool(
    arguments: Mapping[str, Any] | None,
    *,
    rng: random.Random | None = None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_location = payload.get("location")
    location = (
        raw_location.strip()
        if isinstance(raw_location, str) and raw_location.strip() != ""
        else DEFAULT_WEATHER_LOCATION
    )
    selected_rng = rng or random.Random()  # nosec B311
    sample = selected_rng.choice(WEATHER_SAMPLE_RESULTS)
    return {
        "location": location,
        "condition": sample["condition"],
        "temperatureC": sample["temperatureC"],
        "humidity": sample["humidity"],
        "summary": sample["summary"],
    }


async def execute_default_weather_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    return await execute_weather_current_tool(arguments)


async def execute_request_user_form_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    raw_fields = payload.get("fields")
    if not isinstance(raw_fields, list) or len(raw_fields) == 0:
        raise ValueError("fields must be a non-empty array")

    form_request: dict[str, Any] = {
        "formId": _normalize_required_text_argument(
            payload.get("form_id"), field_name="form_id"
        ),
        "title": _normalize_required_text_argument(
            payload.get("title"), field_name="title"
        ),
        "fields": [_normalize_form_field(field) for field in raw_fields],
    }
    description = _normalize_optional_text_argument(payload.get("description"))
    submit_label = _normalize_optional_text_argument(payload.get("submit_label"))
    if description is not None:
        form_request["description"] = description
    if submit_label is not None:
        form_request["submitLabel"] = submit_label

    return {
        "summary": description or f"请填写表单：{form_request['title']}",
        "formRequest": form_request,
    }


def _resolve_desktop_user_data_dir() -> Path:
    env_value = os.environ.get(ENV_USER_DATA_DIR)
    if env_value:
        return Path(env_value).expanduser()
    appdata = os.environ.get("APPDATA")
    if appdata:
        candidate = Path(appdata) / "CanDue"
        if candidate.exists():
            return candidate
    return DEFAULT_USER_DATA_DIR


async def execute_campus_docs_ensure_ready_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    user_data_dir = _resolve_desktop_user_data_dir()
    cache_dir = user_data_dir / "campus_docs"

    from app.campus_info.auto_update import ensure_campus_docs_ready

    return ensure_campus_docs_ready(
        cache_dir=cache_dir,
        confirm=bool(payload.get("confirm") or False),
        timeout_s=int(payload.get("timeoutS") or 30),
        force_download=bool(payload.get("forceDownload") or False),
        max_docs=int(payload.get("maxDocs") or 0),
        chunk_size=int(payload.get("chunkSize") or 100),
        overlap=int(payload.get("overlap") or 20),
        write_sections=bool(
            payload.get("writeSections") if "writeSections" in payload else True
        ),
        build_sqlite_index=bool(
            payload.get("buildSqliteIndex")
            if "buildSqliteIndex" in payload
            else True
        ),
        large_update_threshold=int(payload.get("largeUpdateThreshold") or 8),
    )


def _collapse_ws(text: str) -> str:
    return " ".join(text.split())


def _kwic(text: str, needle: str, context_chars: int) -> str:
    collapsed = _collapse_ws(text)
    if not collapsed:
        return ""
    n = needle.strip().strip('"').strip("'")
    if n:
        pos = collapsed.find(n)
        if pos >= 0:
            start = max(0, pos - context_chars)
            end = min(len(collapsed), pos + len(n) + context_chars)
            prefix = "…" if start > 0 else ""
            suffix = "…" if end < len(collapsed) else ""
            return prefix + collapsed[start:end] + suffix
    preview_len = max(1, context_chars * 2)
    suffix = "…" if len(collapsed) > preview_len else ""
    return collapsed[:preview_len] + suffix


async def execute_campus_docs_search_tool(
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload = dict(arguments or {})
    query = payload.get("query")
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a non-empty string")
    top_k = int(payload.get("topK") or 10)
    raw_context_chars = payload.get("contextChars")
    context_chars = int(raw_context_chars) if isinstance(raw_context_chars, int) else 80
    full_content = bool(payload.get("fullContent") or False)
    max_per_doc = int(payload.get("maxPerDoc") or 5)
    merge_adjacent = bool(payload.get("mergeAdjacent") if "mergeAdjacent" in payload else True)

    user_data_dir = _resolve_desktop_user_data_dir()
    cache_dir = user_data_dir / "campus_docs"
    db_path = cache_dir / "index.sqlite"

    from app.campus_info.indexing import search_fts
    from app.campus_info.provider.cli.search_index import (
        _apply_max_per_doc_raw,
        _load_sections_path_by_source_id,
        _load_sections_root,
        _extract_section_path,
        _merge_adjacent_hits,
        _apply_max_per_doc_merged,
    )

    raw_k = max(top_k, top_k * 5)
    if max_per_doc > 0:
        raw_k = max(raw_k, top_k * max_per_doc * 5)
    hits = search_fts(db_path=db_path, query=query, top_k=raw_k)

    if merge_adjacent:
        merged = _merge_adjacent_hits(hits)
        merged = _apply_max_per_doc_merged(merged, max_per_doc)
        merged = merged[:top_k]
        normalized_hits: list[dict[str, Any]] = []
        sections_path_by_source = _load_sections_path_by_source_id(cache_dir)
        sections_cache: dict[str, dict[str, object]] = {}
        needle = query.strip().strip('"').strip("'")
        for h in merged:
            section_root = _load_sections_root(
                cache_dir=cache_dir,
                sections_path_by_source=sections_path_by_source,
                sections_cache=sections_cache,
                source_id=h.source_id,
            )
            section_path = (
                _extract_section_path(section_root, set(h.page_numbers), needle)
                if section_root is not None
                else None
            )
            content = h.content if full_content else None
            normalized_hits.append(
                {
                    "score": h.score,
                    "sourceId": h.source_id,
                    "title": h.title,
                    "url": h.url,
                    "chunkIndex": h.chunk_index,
                    "chunkIndexEnd": h.chunk_index_end,
                    "pages": h.page_numbers,
                    "sectionPath": section_path,
                    "snippet": _kwic(h.content, needle, context_chars),
                    "content": content,
                }
            )
        return {
            "ok": True,
            "dbPath": db_path.as_posix(),
            "cacheDir": cache_dir.as_posix(),
            "query": query,
            "topK": top_k,
            "hits": normalized_hits,
        }

    limited = _apply_max_per_doc_raw(hits, max_per_doc)
    limited = limited[:top_k]
    sections_path_by_source = _load_sections_path_by_source_id(cache_dir)
    sections_cache2: dict[str, dict[str, object]] = {}
    needle2 = query.strip().strip('"').strip("'")
    out_hits: list[dict[str, Any]] = []
    for h in limited:
        section_root = _load_sections_root(
            cache_dir=cache_dir,
            sections_path_by_source=sections_path_by_source,
            sections_cache=sections_cache2,
            source_id=h.source_id,
        )
        section_path = (
            _extract_section_path(section_root, set(h.page_numbers), needle2)
            if section_root is not None
            else None
        )
        out_hits.append(
            {
                "score": h.score,
                "sourceId": h.source_id,
                "title": h.title,
                "url": h.url,
                "chunkIndex": h.chunk_index,
                "chunkIndexEnd": h.chunk_index,
                "pages": h.page_numbers,
                "sectionPath": section_path,
                "snippet": _kwic(h.content, needle2, context_chars),
                "content": h.content if full_content else None,
            }
        )
    return {
        "ok": True,
        "dbPath": db_path.as_posix(),
        "cacheDir": cache_dir.as_posix(),
        "query": query,
        "topK": top_k,
        "hits": out_hits,
    }


def _normalize_optional_text_argument(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_required_text_argument(value: Any, *, field_name: str) -> str:
    normalized = _normalize_optional_text_argument(value)
    if normalized is None:
        raise ValueError(f"{field_name} must be a non-empty string")
    return normalized


def _normalize_form_field_option(value: Any) -> dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError("field options must be objects")
    return {
        "value": _normalize_required_text_argument(
            value.get("value"), field_name="field.options[].value"
        ),
        "label": _normalize_required_text_argument(
            value.get("label"), field_name="field.options[].label"
        ),
    }


def _normalize_form_field(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("fields must contain only objects")
    field_type = _normalize_required_text_argument(
        value.get("type"), field_name="field.type"
    )
    if field_type not in {"text", "textarea", "number", "select", "checkbox"}:
        raise ValueError(
            "field.type must be one of text, textarea, number, select, checkbox"
        )

    normalized: dict[str, Any] = {
        "name": _normalize_required_text_argument(
            value.get("name"), field_name="field.name"
        ),
        "label": _normalize_required_text_argument(
            value.get("label"), field_name="field.label"
        ),
        "type": field_type,
    }
    description = _normalize_optional_text_argument(value.get("description"))
    placeholder = _normalize_optional_text_argument(value.get("placeholder"))
    if description is not None:
        normalized["description"] = description
    if placeholder is not None:
        normalized["placeholder"] = placeholder
    if isinstance(value.get("required"), bool):
        normalized["required"] = value.get("required")
    if field_type == "select":
        options = value.get("options")
        if not isinstance(options, list) or len(options) == 0:
            raise ValueError("select fields require a non-empty options array")
        normalized["options"] = [
            _normalize_form_field_option(option) for option in options
        ]
    elif "options" in value:
        raise ValueError("checkbox fields do not support options")
    return normalized
