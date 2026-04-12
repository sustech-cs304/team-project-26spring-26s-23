from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias, cast

JsonPrimitive: TypeAlias = str | int | float | bool | None
JsonArray: TypeAlias = list["JsonValue"]
JsonObject: TypeAlias = dict[str, "JsonValue"]
JsonValue: TypeAlias = JsonPrimitive | JsonArray | JsonObject


@dataclass(frozen=True)
class ChunkRecord:
    source_id: str
    title: str
    url: str
    chunk_index: int
    content: str
    page_numbers: list[int]
    doc_sha256: str | None
    doc_local_path: str
    generated_at: str


@dataclass(frozen=True)
class SearchHit:
    score: float
    source_id: str
    title: str
    url: str
    chunk_index: int
    page_numbers: list[int]
    content: str


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    _=conn.execute("PRAGMA journal_mode=WAL")
    _=conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _row_value(row: sqlite3.Row, key: str) -> object:
    return cast(object, row[key])


def _is_cjk_char(ch: str) -> bool:
    code = ord(ch)
    return (0x3400 <= code <= 0x4DBF) or (0x4E00 <= code <= 0x9FFF)


def _fts_normalize(text: str) -> str:
    parts: list[str] = []
    for ch in text:
        if ch.isspace():
            parts.append(" ")
            continue
        if _is_cjk_char(ch):
            parts.append(ch)
            parts.append(" ")
            continue
        parts.append(ch)
    return "".join(parts).strip()


def init_index_db(db_path: Path) -> bool:
    conn = _connect(db_path)
    try:
        recreated_fts = False
        _=conn.execute(
            """
            CREATE TABLE IF NOT EXISTS docs (
              source_id TEXT PRIMARY KEY,
              sha256 TEXT,
              title TEXT NOT NULL,
              url TEXT NOT NULL,
              local_path TEXT NOT NULL,
              updated_at TEXT,
              chunk_count INTEGER NOT NULL,
              chunk_path TEXT NOT NULL,
              generated_at TEXT NOT NULL
            )
            """
        )

        existing_row = cast(sqlite3.Row | None, conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'"
        ).fetchone())
        existing_sql_obj = _row_value(existing_row, "sql") if existing_row is not None else None
        existing_sql = existing_sql_obj if isinstance(existing_sql_obj, str) else None
        if existing_sql is not None and "content_raw" not in existing_sql:
            _ = conn.execute("DROP TABLE IF EXISTS chunks_fts")
            _ = conn.execute("DELETE FROM docs")
            recreated_fts = True

        _=conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
              content,
              content_raw UNINDEXED,
              source_id UNINDEXED,
              title UNINDEXED,
              url UNINDEXED,
              chunk_index UNINDEXED,
              page_numbers UNINDEXED,
              doc_sha256 UNINDEXED,
              doc_local_path UNINDEXED,
              generated_at UNINDEXED
            )
            """
        )
        _=conn.execute("CREATE INDEX IF NOT EXISTS idx_docs_sha256 ON docs(sha256)")
        conn.commit()
        return recreated_fts
    finally:
        conn.close()


def _parse_chunk_line(line: str) -> ChunkRecord | None:
    if not line.strip():
        return None
    obj: object = cast(object, json.loads(line))
    if not isinstance(obj, dict):
        return None
    d = cast(dict[str, object], obj)

    source_id_obj = d.get("source_id")
    title_obj = d.get("title")
    url_obj = d.get("url")
    chunk_index_obj = d.get("chunk_index")
    content_obj = d.get("content")
    page_numbers_obj = d.get("page_numbers")
    doc_sha256_obj = d.get("doc_sha256")
    doc_local_path_obj = d.get("doc_local_path")
    generated_at_obj = d.get("generated_at")

    if not isinstance(source_id_obj, str):
        return None
    if not isinstance(title_obj, str):
        return None
    if not isinstance(url_obj, str):
        return None
    if not isinstance(chunk_index_obj, int):
        return None
    if not isinstance(content_obj, str):
        return None
    if not isinstance(page_numbers_obj, list):
        return None
    page_numbers_list = cast(list[object], page_numbers_obj)
    if not all(isinstance(x, int) for x in page_numbers_list):
        return None
    if not isinstance(doc_local_path_obj, str):
        return None
    if not isinstance(generated_at_obj, str):
        return None

    doc_sha256 = doc_sha256_obj if isinstance(doc_sha256_obj, str) else None
    page_numbers = cast(list[int], page_numbers_list)
    return ChunkRecord(
        source_id=source_id_obj,
        title=title_obj,
        url=url_obj,
        chunk_index=chunk_index_obj,
        content=content_obj,
        page_numbers=page_numbers,
        doc_sha256=doc_sha256,
        doc_local_path=doc_local_path_obj,
        generated_at=generated_at_obj,
    )


def _load_chunks_jsonl(path: Path) -> list[ChunkRecord]:
    lines = path.read_text(encoding="utf-8").splitlines()
    records: list[ChunkRecord] = []
    for line in lines:
        rec = _parse_chunk_line(line)
        if rec is not None:
            records.append(rec)
    return records


def _load_manifest(path: Path) -> dict[str, JsonObject]:
    if not path.exists():
        return {}
    loaded_obj: object = cast(object, json.loads(path.read_text(encoding="utf-8")))
    if not isinstance(loaded_obj, dict):
        return {}
    out: dict[str, JsonObject] = {}
    loaded_dict = cast(dict[object, object], loaded_obj)
    for k, v in loaded_dict.items():
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        out[k] = cast(JsonObject, v)
    return out


def build_fts_index(
    *,
    cache_dir: Path,
    db_path: Path,
    force: bool = False,
) -> tuple[int, int]:
    recreated_fts = init_index_db(db_path)
    if recreated_fts:
        force = True
    manifest_path = cache_dir / "processed" / "chunks_manifest.json"
    manifest = _load_manifest(manifest_path)
    if not manifest:
        return (0, 0)

    conn = _connect(db_path)
    try:
        built = 0
        skipped = 0
        for _key, entry in manifest.items():
            source_id_obj = entry.get("source_id")
            title_obj = entry.get("title")
            url_obj = entry.get("url")
            local_path_obj = entry.get("local_path")
            chunk_count_obj = entry.get("chunk_count")
            chunk_path_obj = entry.get("chunk_path")
            updated_at_obj = entry.get("updated_at")
            generated_at_obj = entry.get("generated_at")
            sha256_obj = entry.get("sha256")

            if not isinstance(source_id_obj, str) or not source_id_obj:
                continue
            if not isinstance(title_obj, str):
                continue
            if not isinstance(url_obj, str):
                continue
            if not isinstance(local_path_obj, str):
                continue
            if not isinstance(chunk_count_obj, int):
                continue
            if not isinstance(chunk_path_obj, str):
                continue
            if not isinstance(generated_at_obj, str):
                continue

            sha256 = sha256_obj if isinstance(sha256_obj, str) else None
            updated_at = updated_at_obj if isinstance(updated_at_obj, str) else None

            if not force and sha256 is not None:
                row = cast(sqlite3.Row | None, conn.execute("SELECT sha256 FROM docs WHERE source_id = ?", (source_id_obj,)).fetchone())
                sha_obj = _row_value(row, "sha256") if row is not None else None
                if isinstance(sha_obj, str) and sha_obj == sha256:
                    skipped += 1
                    continue

            chunks_file = (cache_dir / chunk_path_obj) if not Path(chunk_path_obj).is_absolute() else Path(chunk_path_obj)
            if not chunks_file.exists():
                continue

            records = _load_chunks_jsonl(chunks_file)
            _=conn.execute("DELETE FROM chunks_fts WHERE source_id = ?", (source_id_obj,))
            _=conn.execute("DELETE FROM docs WHERE source_id = ?", (source_id_obj,))

            _=conn.execute(
                """
                INSERT INTO docs(source_id, sha256, title, url, local_path, updated_at, chunk_count, chunk_path, generated_at)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source_id_obj,
                    sha256,
                    title_obj,
                    url_obj,
                    local_path_obj,
                    updated_at,
                    chunk_count_obj,
                    chunk_path_obj,
                    generated_at_obj,
                ),
            )

            rows = [
                (
                    _fts_normalize(r.content),
                    r.content,
                    r.source_id,
                    r.title,
                    r.url,
                    r.chunk_index,
                    json.dumps(r.page_numbers, ensure_ascii=False),
                    r.doc_sha256,
                    r.doc_local_path,
                    r.generated_at,
                )
                for r in records
            ]
            _=conn.executemany(
                """
                INSERT INTO chunks_fts(
                  content, content_raw, source_id, title, url, chunk_index, page_numbers, doc_sha256, doc_local_path, generated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            conn.commit()
            built += 1
        return (built, skipped)
    finally:
        conn.close()


def search_fts(
    *,
    db_path: Path,
    query: str,
    top_k: int = 5,
) -> list[SearchHit]:
    conn = _connect(db_path)
    try:
        normalized_query = _fts_normalize(query)
        rows = cast(list[sqlite3.Row], conn.execute(
            """
            SELECT
              bm25(chunks_fts) AS score,
              source_id,
              title,
              url,
              chunk_index,
              page_numbers,
              content_raw
            FROM chunks_fts
            WHERE chunks_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
            (normalized_query, top_k),
        ).fetchall())

        hits: list[SearchHit] = []
        for row in rows:
            score_obj = _row_value(row, "score")
            source_id_obj = _row_value(row, "source_id")
            title_obj = _row_value(row, "title")
            url_obj = _row_value(row, "url")
            chunk_index_obj = _row_value(row, "chunk_index")
            page_numbers_obj = _row_value(row, "page_numbers")
            content_obj = _row_value(row, "content_raw")

            if not isinstance(source_id_obj, str):
                continue
            if not isinstance(title_obj, str):
                continue
            if not isinstance(url_obj, str):
                continue
            if not isinstance(chunk_index_obj, int):
                continue
            if not isinstance(page_numbers_obj, str):
                continue
            if not isinstance(content_obj, str):
                continue

            pages_loaded: object = cast(object, json.loads(page_numbers_obj))
            page_numbers: list[int] = []
            if isinstance(pages_loaded, list):
                pages_list = cast(list[object], pages_loaded)
                if all(isinstance(x, int) for x in pages_list):
                    page_numbers = cast(list[int], pages_list)
            score = float(score_obj) if isinstance(score_obj, (int, float)) else 0.0
            hits.append(
                SearchHit(
                    score=score,
                    source_id=source_id_obj,
                    title=title_obj,
                    url=url_obj,
                    chunk_index=chunk_index_obj,
                    page_numbers=page_numbers,
                    content=content_obj,
                )
            )
        return hits
    finally:
        conn.close()
