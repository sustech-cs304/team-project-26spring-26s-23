from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import httpx

from app.campus_info.models import DiscoveredOfficialDoc
from app.campus_info.storage import CachedDocEntry, load_cache_index, save_cache_index, utc_now_iso


@dataclass(frozen=True)
class DownloadResult:
    url: str
    source_id: str
    status: str
    local_path: str
    etag: str | None
    last_modified: str | None
    sha256: str | None
    size_bytes: int | None
    error: str | None


def sync_official_docs_to_cache(
    docs: list[DiscoveredOfficialDoc],
    *,
    cache_dir: Path,
    timeout_s: int = 30,
    force: bool = False,
) -> tuple[list[DownloadResult], dict[str, CachedDocEntry]]:
    index_path = cache_dir / "index.json"
    index = load_cache_index(index_path)

    raw_dir = cache_dir / "raw"
    results: list[DownloadResult] = []

    with httpx.Client(timeout=timeout_s, follow_redirects=True) as client:
        for doc in docs:
            out_path = raw_dir / f"{doc.source_id}.pdf"
            previous = index.get(doc.url)

            conditional_headers: dict[str, str] = {}
            if not force and previous is not None:
                if previous.etag:
                    conditional_headers["If-None-Match"] = previous.etag
                if previous.last_modified:
                    conditional_headers["If-Modified-Since"] = previous.last_modified

            checked_at = utc_now_iso()
            try:
                tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
                tmp_path.parent.mkdir(parents=True, exist_ok=True)
                h = hashlib.sha256()
                size_bytes = 0
                etag: str | None = None
                last_modified: str | None = None
                with client.stream(
                    "GET",
                    doc.url,
                    headers={**{"User-Agent": "Mozilla/5.0"}, **conditional_headers},
                ) as response:
                    if response.status_code == 304 and previous is not None:
                        index[doc.url] = CachedDocEntry(
                            source_id=doc.source_id,
                            title=doc.title,
                            category=doc.category,
                            url=doc.url,
                            updated_at=doc.updated_at,
                            local_path=previous.local_path,
                            etag=previous.etag,
                            last_modified=previous.last_modified,
                            sha256=previous.sha256,
                            size_bytes=previous.size_bytes,
                            checked_at=checked_at,
                            downloaded_at=previous.downloaded_at,
                        )
                        results.append(
                            DownloadResult(
                                url=doc.url,
                                source_id=doc.source_id,
                                status="not_modified",
                                local_path=previous.local_path,
                                etag=previous.etag,
                                last_modified=previous.last_modified,
                                sha256=previous.sha256,
                                size_bytes=previous.size_bytes,
                                error=None,
                            )
                        )
                        continue

                    _ = response.raise_for_status()
                    with tmp_path.open("wb") as f:
                        for chunk in response.iter_bytes():
                            if not chunk:
                                continue
                            _ = f.write(chunk)
                            h.update(chunk)
                            size_bytes += len(chunk)
                    headers = cast(Mapping[str, str], response.headers)
                    etag = headers.get("etag")
                    last_modified = headers.get("last-modified")

                sha = h.hexdigest()
                same_as_previous = previous is not None and previous.sha256 is not None and previous.sha256 == sha
                downloaded_at = previous.downloaded_at if same_as_previous and previous is not None else checked_at

                out_path.parent.mkdir(parents=True, exist_ok=True)
                _ = tmp_path.replace(out_path)

                relative_path = out_path.relative_to(cache_dir).as_posix()
                index[doc.url] = CachedDocEntry(
                    source_id=doc.source_id,
                    title=doc.title,
                    category=doc.category,
                    url=doc.url,
                    updated_at=doc.updated_at,
                    local_path=relative_path,
                    etag=etag,
                    last_modified=last_modified,
                    sha256=sha,
                    size_bytes=size_bytes,
                    checked_at=checked_at,
                    downloaded_at=downloaded_at,
                )

                status = "not_modified" if same_as_previous else ("updated" if previous is not None else "downloaded")
                results.append(
                    DownloadResult(
                        url=doc.url,
                        source_id=doc.source_id,
                        status=status,
                        local_path=relative_path,
                        etag=etag,
                        last_modified=last_modified,
                        sha256=sha,
                        size_bytes=size_bytes,
                        error=None,
                    )
                )
            except Exception as ex:
                local_path = previous.local_path if previous is not None else out_path.relative_to(cache_dir).as_posix()
                index[doc.url] = CachedDocEntry(
                    source_id=doc.source_id,
                    title=doc.title,
                    category=doc.category,
                    url=doc.url,
                    updated_at=doc.updated_at,
                    local_path=local_path,
                    etag=previous.etag if previous is not None else None,
                    last_modified=previous.last_modified if previous is not None else None,
                    sha256=previous.sha256 if previous is not None else None,
                    size_bytes=previous.size_bytes if previous is not None else None,
                    checked_at=checked_at,
                    downloaded_at=previous.downloaded_at if previous is not None else None,
                )
                results.append(
                    DownloadResult(
                        url=doc.url,
                        source_id=doc.source_id,
                        status="failed",
                        local_path=local_path,
                        etag=previous.etag if previous is not None else None,
                        last_modified=previous.last_modified if previous is not None else None,
                        sha256=previous.sha256 if previous is not None else None,
                        size_bytes=previous.size_bytes if previous is not None else None,
                        error=str(ex),
                    )
                )

    save_cache_index(index_path, index)
    return results, index
