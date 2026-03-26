from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeAlias, cast

from app.campus_info.models import OfficialDocCategory

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonArray: TypeAlias = list["JsonValue"]
JsonObject: TypeAlias = dict[str, "JsonValue"]
JsonValue: TypeAlias = JsonPrimitive | JsonArray | JsonObject


@dataclass(frozen=True)
class CachedDocEntry:
    source_id: str
    title: str
    category: OfficialDocCategory
    url: str
    updated_at: str | None
    local_path: str
    etag: str | None
    last_modified: str | None
    sha256: str | None
    size_bytes: int | None
    checked_at: str
    downloaded_at: str | None

    def to_json(self) -> JsonObject:
        return {
            "source_id": self.source_id,
            "title": self.title,
            "category": self.category.value,
            "url": self.url,
            "updated_at": self.updated_at,
            "local_path": self.local_path,
            "etag": self.etag,
            "last_modified": self.last_modified,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "checked_at": self.checked_at,
            "downloaded_at": self.downloaded_at,
        }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_cache_index(index_path: Path) -> dict[str, CachedDocEntry]:
    if not index_path.exists():
        return {}

    raw_obj: object = cast(object, json.loads(index_path.read_text(encoding="utf-8")))
    if not isinstance(raw_obj, dict):
        return {}

    entries: dict[str, CachedDocEntry] = {}
    raw_dict = cast(dict[object, object], raw_obj)
    for url_obj, value_obj in raw_dict.items():
        if not isinstance(url_obj, str) or not isinstance(value_obj, dict):
            continue
        url = url_obj
        value = cast(dict[str, object], value_obj)
        updated_at_obj = value.get("updated_at")
        local_path_obj = value.get("local_path")
        etag_obj = value.get("etag")
        last_modified_obj = value.get("last_modified")
        sha256_obj = value.get("sha256")
        size_bytes_obj = value.get("size_bytes")
        checked_at_obj = value.get("checked_at")
        downloaded_at_obj = value.get("downloaded_at")

        category_value = value.get("category")
        try:
            category = OfficialDocCategory(str(category_value))
        except Exception:
            category = OfficialDocCategory.OTHER
        entries[url] = CachedDocEntry(
            source_id=str(value.get("source_id") or ""),
            title=str(value.get("title") or ""),
            category=category,
            url=url,
            updated_at=updated_at_obj if isinstance(updated_at_obj, str) else None,
            local_path=str(local_path_obj or ""),
            etag=etag_obj if isinstance(etag_obj, str) else None,
            last_modified=last_modified_obj if isinstance(last_modified_obj, str) else None,
            sha256=sha256_obj if isinstance(sha256_obj, str) else None,
            size_bytes=size_bytes_obj if isinstance(size_bytes_obj, int) else None,
            checked_at=str(checked_at_obj or ""),
            downloaded_at=downloaded_at_obj if isinstance(downloaded_at_obj, str) else None,
        )
    return entries


def save_cache_index(index_path: Path, entries: dict[str, CachedDocEntry]) -> None:
    index_path.parent.mkdir(parents=True, exist_ok=True)
    payload: JsonObject = {}
    for url, entry in sorted(entries.items()):
        payload[url] = entry.to_json()
    _ = index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
