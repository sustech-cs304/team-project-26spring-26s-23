from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeAlias, cast

from app.campus_info.chunker import chunk_extracted_document
from app.campus_info.extractor import extract_pdf_document
from app.campus_info.storage import load_cache_index

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonArray: TypeAlias = list["JsonValue"]
JsonObject: TypeAlias = dict[str, "JsonValue"]
JsonValue: TypeAlias = JsonPrimitive | JsonArray | JsonObject

class Args(argparse.Namespace):
    cache_dir: Path = Path("data/campus_docs")
    out_dir: Path | None = None
    max_docs: int = 0
    force: bool = False


def main() -> int:
    parser = argparse.ArgumentParser(description="Test PDF extraction and chunking.")
    _ = parser.add_argument("--cache-dir", type=Path, default=Path("data/campus_docs"), help="Cache directory")
    _ = parser.add_argument(
        "--out-dir",
        type=Path,
        default=None,
        help="输出目录（写入每个文档的 chunks JSONL）；默认 <cache-dir>/processed/chunks",
    )
    _ = parser.add_argument("--max-docs", type=int, default=0, help="最多处理多少个文档，<=0 表示不限制")
    _ = parser.add_argument("--force", action="store_true", help="忽略已有产物，强制重新生成")
    args = parser.parse_args(namespace=Args())

    cache_dir = args.cache_dir
    processed_dir = cache_dir / "processed"
    out_dir = args.out_dir if args.out_dir is not None else (processed_dir / "chunks")
    manifest_path = processed_dir / "chunks_manifest.json"
    processed_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = cache_dir / "index.json"
    if not index_path.exists():
        logger.error(f"Index not found at {index_path}. Run sync_docs first.")
        return 1

    entries = load_cache_index(index_path)
    if not entries:
        logger.warning("No entries found in cache index.")
        return 0

    raw_manifest: JsonObject = {}
    if manifest_path.exists():
        try:
            loaded_obj = cast(object, json.loads(manifest_path.read_text(encoding="utf-8")))
            if isinstance(loaded_obj, dict):
                raw_manifest = cast(JsonObject, loaded_obj)
        except Exception:
            raw_manifest = {}

    processed_count = 0
    skipped_count = 0
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds")

    for url, entry in entries.items():
        if not entry.downloaded_at:
            continue
        if args.max_docs > 0 and processed_count >= args.max_docs:
            break

        pdf_path = cache_dir / entry.local_path
        if not pdf_path.exists():
            logger.warning(f"File {pdf_path} not found for {url}")
            continue

        cache_key = entry.source_id or entry.url
        existing_obj = raw_manifest.get(cache_key)
        existing = existing_obj if isinstance(existing_obj, dict) else None
        existing_sha = existing.get("sha256") if existing and isinstance(existing.get("sha256"), str) else None
        current_sha = entry.sha256
        out_path = out_dir / f"{entry.source_id}.jsonl"
        if not args.force and current_sha and existing_sha and current_sha == existing_sha and out_path.exists():
            skipped_count += 1
            continue

        logger.info(f"Extracting: {entry.title} ({pdf_path})")
        extracted_doc = extract_pdf_document(
            pdf_path=pdf_path,
            source_id=entry.source_id,
            title=entry.title,
            url=entry.url,
        )

        if not extracted_doc:
            logger.error(f"Failed to extract {entry.title}")
            continue

        logger.info(f"  -> Extracted {len(extracted_doc.pages)} pages.")

        chunks = chunk_extracted_document(extracted_doc, max_chunk_size=1000, overlap=200)
        logger.info(f"  -> Generated {len(chunks)} chunks.")

        lines: list[str] = []
        for c in chunks:
            page_numbers = cast(JsonArray, [int(n) for n in c.page_numbers])
            payload: JsonObject = {
                "source_id": c.source_id,
                "title": c.title,
                "url": c.url,
                "chunk_index": c.chunk_index,
                "content": c.content,
                "page_numbers": page_numbers,
                "doc_sha256": current_sha,
                "doc_local_path": entry.local_path, 
                "generated_at": now_iso,
            }
            lines.append(json.dumps(payload, ensure_ascii=False))
        _ = out_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

        try:
            chunk_path = out_path.relative_to(cache_dir).as_posix()
        except Exception:
            chunk_path = out_path.as_posix()

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
        }

        if chunks:
            sample = chunks[0]
            logger.info("  -> Sample Chunk 0:")
            logger.info(f"     Title: {sample.title}")
            logger.info(f"     Pages: {sample.page_numbers}")
            logger.info(f"     Content length: {len(sample.content)} chars")
            print("-" * 40)
            print(sample.content[:300] + "...\n(truncated)")
            print("-" * 40)
        print("\n")
        processed_count += 1

    _ = manifest_path.write_text(
        json.dumps(raw_manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    logger.info(f"Saved chunks: {processed_count}, skipped: {skipped_count}")
    logger.info(f"Chunks dir: {out_dir.as_posix()}")
    logger.info(f"Manifest: {manifest_path.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
