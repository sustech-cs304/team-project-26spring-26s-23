from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from app.campus_info.chunker import chunk_extracted_document
from app.campus_info.downloader import sync_official_docs_to_cache
from app.campus_info.extractor import extract_pdf_document
from app.campus_info.fetcher import discover_official_docs
from app.campus_info.indexing import build_fts_index
from app.campus_info.sectionizer import sectionize_document
from app.campus_info.sources import get_official_doc_seeds
from app.campus_info.storage import load_cache_index


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _load_json_object(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _build_update_plan(
    *,
    cache_dir: Path,
    max_docs: int,
) -> dict[str, Any]:
    index_path = cache_dir / "index.json"
    first_time = not index_path.exists()
    entries = load_cache_index(index_path) if index_path.exists() else {}

    seeds = get_official_doc_seeds()
    discovered = []
    for seed in seeds:
        discovered.extend(discover_official_docs(seed))
    if max_docs > 0:
        discovered = discovered[:max_docs]

    missing = 0
    for doc in discovered:
        previous = entries.get(doc.url)
        if previous is None or not previous.downloaded_at:
            missing += 1
            continue
        local_path = cache_dir / previous.local_path
        if not local_path.exists():
            missing += 1

    return {
        "firstTime": first_time,
        "discoveredCount": len(discovered),
        "missingCount": missing,
    }



def ensure_campus_docs_ready(
    *,
    cache_dir: Path,
    timeout_s: int = 30,
    force_download: bool = False,
    max_docs: int = 0,
    chunk_size: int = 100,
    overlap: int = 20,
    write_sections: bool = True,
    confirm: bool = False,
    large_update_threshold: int = 8,
    build_sqlite_index: bool = True,
) -> dict[str, Any]:
    plan = _build_update_plan(cache_dir=cache_dir, max_docs=max_docs)
    first_time = bool(plan.get("firstTime"))
    missing_count = int(plan.get("missingCount") or 0)
    needs_confirmation = first_time or missing_count >= max(1, large_update_threshold)
    if needs_confirmation and not confirm:
        return {
            "ok": False,
            "needsConfirmation": True,
            "plan": plan,
            "message": (
                "首次下载或检测到较大规模更新，执行前需要确认。"
                if first_time
                else "检测到较大规模缺失/更新，执行前需要确认。"
            ),
        }

    cache_dir.mkdir(parents=True, exist_ok=True)
    seeds = get_official_doc_seeds()
    discovered = []
    for seed in seeds:
        discovered.extend(discover_official_docs(seed))
    if max_docs > 0:
        discovered = discovered[:max_docs]

    download_results, _index = sync_official_docs_to_cache(
        discovered,
        cache_dir=cache_dir,
        timeout_s=timeout_s,
        force=force_download,
    )
    download_counts: dict[str, int] = {}
    for item in download_results:
        download_counts[item.status] = download_counts.get(item.status, 0) + 1

    index_path = cache_dir / "index.json"
    entries = load_cache_index(index_path)

    processed_dir = cache_dir / "processed"
    chunks_dir = processed_dir / "chunks"
    sections_dir = processed_dir / "sections"
    manifest_path = processed_dir / "chunks_manifest.json"
    processed_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir.mkdir(parents=True, exist_ok=True)
    if write_sections:
        sections_dir.mkdir(parents=True, exist_ok=True)

    raw_manifest = _load_json_object(manifest_path)
    processed_count = 0
    skipped_count = 0
    now_iso = _utc_now_iso()

    for _url, entry in entries.items():
        if not entry.downloaded_at:
            continue
        if max_docs > 0 and processed_count >= max_docs:
            break
        if not entry.source_id:
            continue

        pdf_path = cache_dir / entry.local_path
        if not pdf_path.exists():
            continue

        cache_key = entry.source_id or entry.url
        existing_obj = raw_manifest.get(cache_key)
        existing = existing_obj if isinstance(existing_obj, dict) else None
        existing_sha = (
            existing.get("sha256")
            if existing and isinstance(existing.get("sha256"), str)
            else None
        )
        current_sha = entry.sha256

        out_path = chunks_dir / f"{entry.source_id}.jsonl"
        if (
            not force_download
            and current_sha
            and existing_sha
            and current_sha == existing_sha
            and out_path.exists()
        ):
            skipped_count += 1
            continue

        extracted = extract_pdf_document(
            pdf_path=pdf_path,
            source_id=entry.source_id,
            title=entry.title,
            url=entry.url,
        )
        if not extracted:
            continue

        sections_path: Path | None = None
        if write_sections:
            section_root = sectionize_document(extracted)
            section_payload: dict[str, Any] = {
                "source_id": entry.source_id,
                "title": entry.title,
                "url": entry.url,
                "page_count": len(extracted.pages),
                "sections": cast(dict[str, Any], section_root.to_dict()),
            }
            sections_path = sections_dir / f"{entry.source_id}.json"
            sections_path.write_text(
                json.dumps(section_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        chunks = chunk_extracted_document(
            extracted,
            max_chunk_size=chunk_size,
            overlap=overlap,
        )
        lines: list[str] = []
        for c in chunks:
            payload = {
                "source_id": c.source_id,
                "title": c.title,
                "url": c.url,
                "chunk_index": c.chunk_index,
                "content": c.content,
                "page_numbers": [int(n) for n in c.page_numbers],
                "doc_sha256": current_sha,
                "doc_local_path": entry.local_path,
                "generated_at": now_iso,
            }
            lines.append(json.dumps(payload, ensure_ascii=False))
        out_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

        try:
            chunk_path = out_path.relative_to(cache_dir).as_posix()
        except Exception:
            chunk_path = out_path.as_posix()

        sections_path_str: str | None
        if sections_path is None:
            sections_path_str = None
        else:
            try:
                sections_path_str = sections_path.relative_to(cache_dir).as_posix()
            except Exception:
                sections_path_str = sections_path.as_posix()

        raw_manifest[cache_key] = {
            "source_id": entry.source_id,
            "title": entry.title,
            "url": entry.url,
            "sha256": current_sha,
            "local_path": entry.local_path,
            "chunk_count": len(chunks),
            "updated_at": entry.updated_at,
            "generated_at": now_iso,
            "chunk_path": chunk_path,
            "sections_path": sections_path_str,
        }
        processed_count += 1

    manifest_path.write_text(
        json.dumps(raw_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    index_summary: dict[str, Any] | None = None
    if build_sqlite_index:
        db_path = cache_dir / "index.sqlite"
        built, skipped = build_fts_index(
            cache_dir=cache_dir,
            db_path=db_path,
            force=False,
        )
        index_summary = {
            "dbPath": db_path.as_posix(),
            "builtDocs": built,
            "skippedDocs": skipped,
        }

    return {
        "ok": True,
        "cacheDir": cache_dir.as_posix(),
        "discoveredCount": len(discovered),
        "downloadCounts": download_counts,
        "processedCount": processed_count,
        "skippedProcessedCount": skipped_count,
        "index": index_summary,
        "generatedAt": now_iso,
        "plan": plan,
    }


__all__ = ["ensure_campus_docs_ready"]
