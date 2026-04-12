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

from app.campus_info.fetcher import discover_official_docs
from app.campus_info.models import DiscoveredOfficialDoc, OfficialDocSeed
from app.campus_info.sources import get_official_doc_seeds

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonArray: TypeAlias = list["JsonValue"]
JsonObject: TypeAlias = dict[str, "JsonValue"]
JsonValue: TypeAlias = JsonPrimitive | JsonArray | JsonObject


class Args(Protocol):
    save_json: bool


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="发现/展开校园官方文档来源")
    _ = parser.add_argument(
        "--save",
        "--save-json",
        dest="save_json",
        action="store_true",
        help="保存展开结果为 JSON 到 backend/data/reports/",
    )
    return parser


def _save_json_report(backend_dir: Path, payload: JsonObject) -> Path:
    report_dir = backend_dir / "data" / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = report_dir / f"campus_official_docs_{timestamp}.json"
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    return out_path


def main() -> int:
    parser = _build_parser()
    args = cast(Args, cast(object, parser.parse_args()))

    _ = load_dotenv(BACKEND_DIR / ".env")

    seeds: list[OfficialDocSeed] = get_official_doc_seeds()
    all_docs: JsonArray = []
    for seed in seeds:
        docs: list[DiscoveredOfficialDoc] = discover_official_docs(seed)
        for d in docs:
            doc: JsonObject = {
                "source_id": d.source_id,
                "title": d.title,
                "category": d.category.value,
                "url": d.url,
                "updated_at": d.updated_at,
            }
            all_docs.append(doc)

    payload: JsonObject = {
        "run_at": datetime.now().isoformat(timespec="seconds"),
        "seed_count": len(seeds),
        "doc_count": len(all_docs),
        "docs": all_docs,
    }

    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if args.save_json:
        out_path = _save_json_report(BACKEND_DIR, payload)
        print(f"saved: {out_path.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

