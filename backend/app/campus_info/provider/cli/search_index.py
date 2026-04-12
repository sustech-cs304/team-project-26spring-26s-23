from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Protocol, cast

from dotenv import load_dotenv

from app.campus_info.indexing import SearchHit, search_fts


BACKEND_DIR = Path(__file__).resolve().parents[4]


class Args(Protocol):
    db_path: Path
    cache_dir: Path | None
    query: str
    top_k: int
    context_chars: int
    full_content: bool
    no_merge: bool
    max_per_doc: int


@dataclass
class MergedHit:
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


def _pick_needle(query: str) -> list[str]:
    stripped = query.strip().strip('"').strip("'")
    if stripped:
        return [stripped]
    return []


def _kwic(text: str, needles: list[str], context_chars: int) -> str:
    collapsed = _collapse_ws(text)
    if not collapsed:
        return ""
    for needle in needles:
        if not needle:
            continue
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


def _merge_adjacent_hits(hits: list[SearchHit]) -> list[MergedHit]:
    out: list[MergedHit] = []
    buckets: dict[str, list[SearchHit]] = {}
    for h in hits:
        buckets.setdefault(h.source_id, []).append(h)

    for _source_id, hs in buckets.items():
        hs_sorted = sorted(hs, key=lambda x: x.chunk_index)
        current: MergedHit | None = None
        for h in hs_sorted:
            if current is None:
                current = MergedHit(
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
            current = MergedHit(
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


def _apply_max_per_doc_merged(hits: list[MergedHit], max_per_doc: int) -> list[MergedHit]:
    if max_per_doc <= 0:
        return hits
    counts: dict[str, int] = {}
    out: list[MergedHit] = []
    for h in hits:
        n = counts.get(h.source_id, 0)
        if n >= max_per_doc:
            continue
        counts[h.source_id] = n + 1
        out.append(h)
    return out


def _apply_max_per_doc_raw(hits: list[SearchHit], max_per_doc: int) -> list[SearchHit]:
    if max_per_doc <= 0:
        return hits
    counts: dict[str, int] = {}
    out: list[SearchHit] = []
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


def main() -> int:
    parser = argparse.ArgumentParser(description="在 SQLite FTS5 索引中检索 chunks")
    _ = parser.add_argument(
        "--db-path",
        type=Path,
        default=BACKEND_DIR / "data" / "campus_docs" / "index.sqlite",
        help="SQLite 数据库路径",
    )
    _ = parser.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="campus_docs 缓存目录（默认取 <db-path> 的父目录，用于读取 sections）",
    )
    _ = parser.add_argument("--query", type=str, required=True, help="FTS 查询（支持关键词、短语等）")
    _ = parser.add_argument("--top-k", type=int, default=15, help="返回多少条命中")
    _ = parser.add_argument("--context-chars", type=int, default=80, help="围绕命中关键词截取的前后字符数")
    _ = parser.add_argument("--full-content", action="store_true", help="输出完整 content（默认只输出截断预览）")
    _ = parser.add_argument("--no-merge", action="store_true", help="不合并同一文档内相邻的命中 chunk")
    _ = parser.add_argument("--max-per-doc", type=int, default=5, help="每个 source_id 最多保留多少条命中（<=0 表示不限制）")
    args = cast(Args, cast(object, parser.parse_args()))

    _ = load_dotenv(BACKEND_DIR / ".env")

    raw_k = max(args.top_k, args.top_k * 5)
    if args.max_per_doc > 0:
        raw_k = max(raw_k, args.top_k * args.max_per_doc * 5)
    hits = search_fts(db_path=args.db_path, query=args.query, top_k=raw_k)
    if not args.no_merge:
        merged_hits = _merge_adjacent_hits(hits)
        limited_hits = _apply_max_per_doc_merged(merged_hits, args.max_per_doc)
        hits = limited_hits[: args.top_k]
    else:
        limited_hits2 = _apply_max_per_doc_raw(hits, args.max_per_doc)
        hits = limited_hits2[: args.top_k]
    needles = _pick_needle(args.query)
    cache_dir = args.cache_dir if args.cache_dir is not None else args.db_path.parent
    sections_path_by_source = _load_sections_path_by_source_id(cache_dir)
    sections_cache: dict[str, dict[str, object]] = {}
    needle = needles[0] if needles else ""
    hit_payloads: list[dict[str, object]] = []
    for h in hits:
        section_root = _load_sections_root(
            cache_dir=cache_dir,
            sections_path_by_source=sections_path_by_source,
            sections_cache=sections_cache,
            source_id=h.source_id,
        )
        section_path = (
            _extract_section_path(section_root, set(h.page_numbers), needle) if section_root is not None else None
        )
        hit_payloads.append(
            {
                "score": h.score,
                "source_id": h.source_id,
                "title": h.title,
                "url": h.url,
                "chunk_index": h.chunk_index,
                "chunk_index_end": getattr(h, "chunk_index_end", h.chunk_index),
                "page_numbers": h.page_numbers,
                "section_path": section_path,
                "content_preview": _kwic(h.content, needles, args.context_chars),
                "content": h.content if args.full_content else None,
            }
        )
    payload = {
        "db_path": args.db_path.as_posix(),
        "cache_dir": cache_dir.as_posix(),
        "query": args.query,
        "top_k": args.top_k,
        "hits": hit_payloads,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
