from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Protocol, cast

from dotenv import load_dotenv

from app.campus_info.indexing import build_fts_index


BACKEND_DIR = Path(__file__).resolve().parents[4]


class Args(Protocol):
    cache_dir: Path
    db_path: Path
    force: bool


def main() -> int:
    parser = argparse.ArgumentParser(description="基于 chunks JSONL 构建 SQLite FTS5 索引")
    _ = parser.add_argument(
        "--cache-dir",
        type=Path,
        default=BACKEND_DIR / "data" / "campus_docs",
        help="campus_docs 缓存目录（含 processed/chunks_manifest.json）",
    )
    _ = parser.add_argument(
        "--db-path",
        type=Path,
        default=BACKEND_DIR / "data" / "campus_docs" / "index.sqlite",
        help="SQLite 数据库路径",
    )
    _ = parser.add_argument("--force", action="store_true", help="强制重建每个文档的索引记录")
    args = cast(Args, cast(object, parser.parse_args()))

    _ = load_dotenv(BACKEND_DIR / ".env")

    built, skipped = build_fts_index(cache_dir=args.cache_dir, db_path=args.db_path, force=args.force)
    payload = {
        "cache_dir": args.cache_dir.as_posix(),
        "db_path": args.db_path.as_posix(),
        "built_docs": built,
        "skipped_docs": skipped,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
