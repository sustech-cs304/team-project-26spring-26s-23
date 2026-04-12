from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Protocol, TypeAlias, cast

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[4]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.campus_info.downloader import sync_official_docs_to_cache
from app.campus_info.fetcher import discover_official_docs
from app.campus_info.models import DiscoveredOfficialDoc, OfficialDocSeed
from app.campus_info.sources import get_official_doc_seeds

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonArray: TypeAlias = list["JsonValue"]
JsonObject: TypeAlias = dict[str, "JsonValue"]
JsonValue: TypeAlias = JsonPrimitive | JsonArray | JsonObject


class Args(Protocol):
    save_json: bool
    timeout_s: int
    force: bool
    max_docs: int


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="下载/缓存校园官方文档，并做更新检测")
    _ = parser.add_argument(
        "--save",
        "--save-json",
        dest="save_json",
        action="store_true",
        help="保存本次同步结果为 JSON 到 backend/data/reports/",
    )
    _ = parser.add_argument("--timeout-s", type=int, default=30, help="单次请求超时秒数，默认 30")
    _ = parser.add_argument("--force", action="store_true", help="忽略 ETag/Last-Modified，强制重新下载")
    _ = parser.add_argument("--max-docs", type=int, default=0, help="最多处理多少个文档，<=0 表示不限制")
    return parser


def _save_json_report(backend_dir: Path, payload: JsonObject) -> Path:
    report_dir = backend_dir / "data" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = report_dir / f"campus_docs_sync_{timestamp}.json"
    _=out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def _discover_all_docs(seeds: list[OfficialDocSeed]) -> list[DiscoveredOfficialDoc]:
    all_docs: list[DiscoveredOfficialDoc] = []
    for seed in seeds:
        all_docs.extend(discover_official_docs(seed))
    return all_docs


def main() -> int:
    parser = _build_parser()
    args = cast(Args, cast(object, parser.parse_args()))

    _ = load_dotenv(BACKEND_DIR / ".env")

    seeds: list[OfficialDocSeed] = get_official_doc_seeds()
    docs = _discover_all_docs(seeds)
    if args.max_docs and args.max_docs > 0:
        docs = docs[: args.max_docs]

    cache_dir = BACKEND_DIR / "data" / "campus_docs"
    results, _index = sync_official_docs_to_cache(
        docs,
        cache_dir=cache_dir,
        timeout_s=args.timeout_s,
        force=args.force,
    )

    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1

    payload: JsonObject = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "cache_dir": cache_dir.as_posix(),
        "seed_count": len(seeds),
        "doc_count": len(docs),
        "result_count": len(results),
        "counts": {k: v for k, v in sorted(counts.items())},
        "results": [
            {
                "url": r.url,
                "source_id": r.source_id,
                "status": r.status,
                "local_path": r.local_path,
                "etag": r.etag,
                "last_modified": r.last_modified,
                "sha256": r.sha256,
                "size_bytes": r.size_bytes,
                "error": r.error,
            }
            for r in results
        ],
    }

    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if args.save_json:
        out_path = _save_json_report(BACKEND_DIR, payload)
        print(f"saved: {out_path.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
