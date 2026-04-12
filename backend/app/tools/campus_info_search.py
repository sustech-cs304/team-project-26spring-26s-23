from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from app.campus_info.indexing import SearchHit, search_fts


BACKEND_DIR = Path(__file__).resolve().parents[2]


@dataclass
class _MergedHit:
    score: float
    source_id: str
    title: str
    url: str
    chunk_index: int
    chunk_index_end: int
    page_numbers: list[int]
    content: str


def _collapse_ws(text: str) -> str:
    return " ".join(text.split())


def _pick_needle(query: str) -> str:
    return query.strip().strip('"').strip("'")


def _kwic(text: str, needle: str, context_chars: int) -> str:
    collapsed = _collapse_ws(text)
    if not collapsed:
        return ""
    if needle:
        pos = collapsed.find(needle)
        if pos >= 0:
            start = max(0, pos - context_chars)
            end = min(len(collapsed), pos + len(needle) + context_chars)
            prefix = "…" if start > 0 else ""
            suffix = "…" if end < len(collapsed) else ""
            return prefix + collapsed[start:end] + suffix
    preview_len = max(1, context_chars * 2)
    suffix = "…" if len(collapsed) > preview_len else ""
    return collapsed[:preview_len] + suffix


def _merge_adjacent_hits(hits: list[SearchHit]) -> list[_MergedHit]:
    out: list[_MergedHit] = []
    buckets: dict[str, list[SearchHit]] = {}
    for h in hits:
        buckets.setdefault(h.source_id, []).append(h)

    for _source_id, hs in buckets.items():
        hs_sorted = sorted(hs, key=lambda x: x.chunk_index)
        current: _MergedHit | None = None
        for h in hs_sorted:
            if current is None:
                current = _MergedHit(
                    score=h.score,
                    source_id=h.source_id,
                    title=h.title,
                    url=h.url,
                    chunk_index=h.chunk_index,
                    chunk_index_end=h.chunk_index,
                    page_numbers=sorted(set(h.page_numbers)),
                    content=h.content,
                )
                continue
            if h.chunk_index == current.chunk_index_end + 1:
                current.score = min(current.score, h.score)
                current.chunk_index_end = h.chunk_index
                current.page_numbers = sorted(set(current.page_numbers + h.page_numbers))
                current.content = (current.content + "\n" + h.content).strip()
                continue
            out.append(current)
            current = _MergedHit(
                score=h.score,
                source_id=h.source_id,
                title=h.title,
                url=h.url,
                chunk_index=h.chunk_index,
                chunk_index_end=h.chunk_index,
                page_numbers=sorted(set(h.page_numbers)),
                content=h.content,
            )
        if current is not None:
            out.append(current)

    return sorted(out, key=lambda x: x.score)


def _apply_max_per_doc_merged(hits: list[_MergedHit], max_per_doc: int) -> list[_MergedHit]:
    if max_per_doc <= 0:
        return hits
    counts: dict[str, int] = {}
    out: list[_MergedHit] = []
    for h in hits:
        n = counts.get(h.source_id, 0)
        if n >= max_per_doc:
            continue
        counts[h.source_id] = n + 1
        out.append(h)
    return out


def _load_sections_path_by_source_id(cache_dir: Path) -> dict[str, str]:
    manifest_path = cache_dir / "processed" / "chunks_manifest.json"
    if not manifest_path.exists():
        return {}
    loaded_obj: object = cast(object, json.loads(manifest_path.read_text(encoding="utf-8")))
    if not isinstance(loaded_obj, dict):
        return {}
    out: dict[str, str] = {}
    loaded_dict = cast(dict[object, object], loaded_obj)
    for _k, v in loaded_dict.items():
        if not isinstance(v, dict):
            continue
        vv = cast(dict[object, object], v)
        sid = vv.get("source_id")
        sp = vv.get("sections_path")
        if isinstance(sid, str) and isinstance(sp, str) and sid and sp:
            out[sid] = sp
    return out


def _extract_section_path(root: dict[str, object], pages: set[int], needle: str) -> list[str] | None:
    best_score = -1
    best_path: list[str] | None = None

    stack: list[tuple[dict[str, object], list[str]]] = [(root, [])]
    while stack:
        node, path = stack.pop()
        heading_obj = node.get("heading")
        heading = heading_obj if isinstance(heading_obj, str) else ""
        next_path = path + ([heading] if heading else [])

        pages_obj = node.get("page_numbers")
        content_obj = node.get("content")
        level_obj = node.get("level")
        node_pages: set[int] = set()
        if isinstance(pages_obj, list):
            pages_list = cast(list[object], pages_obj)
            for p in pages_list:
                if isinstance(p, int):
                    node_pages.add(p)
        overlap = len(node_pages & pages)
        if overlap > 0:
            content = content_obj if isinstance(content_obj, str) else ""
            level = level_obj if isinstance(level_obj, int) else 0
            match = 1 if (needle and needle in content) else 0
            score = overlap * 10 + match * 5 + level
            if best_path is None or score > best_score or (score == best_score and len(next_path) > len(best_path)):
                best_score = score
                best_path = next_path

        children_obj = node.get("children")
        if isinstance(children_obj, list):
            children_list = cast(list[object], children_obj)
            for c in children_list:
                if isinstance(c, dict):
                    stack.append((cast(dict[str, object], c), next_path))

    if best_path is None:
        return None
    cleaned = [h for h in best_path if h.strip()]
    return cleaned if cleaned else None


def _load_sections_root(
    *,
    cache_dir: Path,
    sections_path_by_source: dict[str, str],
    sections_cache: dict[str, dict[str, object]],
    source_id: str,
) -> dict[str, object] | None:
    if source_id in sections_cache:
        return sections_cache[source_id]
    rel = sections_path_by_source.get(source_id)
    if not rel:
        return None
    path = cache_dir / rel
    if not path.exists():
        return None
    loaded_obj: object = cast(object, json.loads(path.read_text(encoding="utf-8")))
    if not isinstance(loaded_obj, dict):
        return None
    loaded = cast(dict[str, object], loaded_obj)
    sections_obj = loaded.get("sections")
    if not isinstance(sections_obj, dict):
        return None
    sections_root = cast(dict[str, object], sections_obj)
    sections_cache[source_id] = sections_root
    return sections_root


async def execute_campus_info_search_tool(arguments: dict[str, Any] | None) -> dict[str, Any]:
    args = dict(arguments or {})
    query_obj = args.get("query")
    query = query_obj.strip() if isinstance(query_obj, str) else ""
    if not query:
        return {"error": {"code": "invalid_query", "message": "query must be a non-empty string"}}

    top_k_obj = args.get("topK")
    top_k = int(top_k_obj) if isinstance(top_k_obj, int) else 10
    top_k = max(1, min(50, top_k))

    max_per_doc_obj = args.get("maxPerDoc")
    max_per_doc = int(max_per_doc_obj) if isinstance(max_per_doc_obj, int) else 3
    max_per_doc = max(0, min(20, max_per_doc))

    context_chars_obj = args.get("contextChars")
    context_chars = int(context_chars_obj) if isinstance(context_chars_obj, int) else 80
    context_chars = max(10, min(500, context_chars))

    include_content_obj = args.get("includeContent")
    include_content = bool(include_content_obj) if isinstance(include_content_obj, bool) else False

    cache_dir_obj = args.get("cacheDir")
    cache_dir = Path(cache_dir_obj) if isinstance(cache_dir_obj, str) and cache_dir_obj.strip() else (BACKEND_DIR / "data" / "campus_docs")

    db_path_obj = args.get("dbPath")
    db_path = Path(db_path_obj) if isinstance(db_path_obj, str) and db_path_obj.strip() else (cache_dir / "index.sqlite")

    if not db_path.exists():
        return {
            "error": {
                "code": "index_not_found",
                "message": "SQLite index not found. Run build_index first.",
                "dbPath": db_path.as_posix(),
            }
        }

    needle = _pick_needle(query)
    raw_k = max(top_k, top_k * 5)
    if max_per_doc > 0:
        raw_k = max(raw_k, top_k * max_per_doc * 5)

    hits = search_fts(db_path=db_path, query=query, top_k=raw_k)
    merged = _merge_adjacent_hits(hits)
    limited = _apply_max_per_doc_merged(merged, max_per_doc)
    final_hits = limited[:top_k]

    sections_path_by_source = _load_sections_path_by_source_id(cache_dir)
    sections_cache: dict[str, dict[str, object]] = {}
    out_hits: list[dict[str, Any]] = []
    for h in final_hits:
        section_root = _load_sections_root(
            cache_dir=cache_dir,
            sections_path_by_source=sections_path_by_source,
            sections_cache=sections_cache,
            source_id=h.source_id,
        )
        section_path = (
            _extract_section_path(section_root, set(h.page_numbers), needle) if section_root is not None else None
        )
        out_hits.append(
            {
                "score": h.score,
                "sourceId": h.source_id,
                "title": h.title,
                "url": h.url,
                "chunkIndexStart": h.chunk_index,
                "chunkIndexEnd": h.chunk_index_end,
                "pages": h.page_numbers,
                "sectionPath": section_path,
                "snippet": _kwic(h.content, needle, context_chars),
                "content": h.content if include_content else None,
            }
        )

    return {
        "kind": "campus_info.search_result",
        "query": query,
        "topK": top_k,
        "maxPerDoc": max_per_doc,
        "contextChars": context_chars,
        "includeContent": include_content,
        "cacheDir": cache_dir.as_posix(),
        "dbPath": db_path.as_posix(),
        "hitCount": len(out_hits),
        "hits": out_hits,
    }

