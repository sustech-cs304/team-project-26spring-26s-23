from __future__ import annotations

import json
import re
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, TypeVar

_T = TypeVar("_T")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def jsonable(item: Any) -> Any:
    if hasattr(item, "to_dict"):
        return item.to_dict()
    return item


def sample_items(items: list[_T], limit: int = 3) -> list[_T]:
    return items[:limit]


def ensure_report_dir(tmp_path: Path) -> Path:
    report_dir = tmp_path / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    return report_dir


def build_timestamped_report_paths(
    tmp_path: Path,
    stem: str,
    *,
    include_markdown: bool = False,
) -> tuple[Path, Path | None]:
    report_dir = tmp_path / "reports"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = report_dir / f"{stem}_{timestamp}.json"
    md_path = report_dir / f"{stem}_{timestamp}.md" if include_markdown else None
    return json_path, md_path


def report_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def write_json_report(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(report_json(payload), encoding="utf-8")


def write_text_report(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def safe_path_component(name: str, *, default: str) -> str:
    safe = re.sub(r"[\\/:*?\"<>|]", "_", name).strip()
    return safe or default


def find_probe(probes: Iterable[Any], label: str) -> Any | None:
    return next((probe for probe in probes if getattr(probe, "probe_label", None) == label), None)


def record_failure(report: dict[str, Any], error: BaseException) -> None:
    report["status"] = "error"
    report["fatal_error"] = f"{type(error).__name__}: {error}"
    report["traceback"] = traceback.format_exc()
