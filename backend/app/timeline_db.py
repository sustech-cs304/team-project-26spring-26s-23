"""Timeline database helper — direct SQLite access to Electron's timeline.db.

This is the SINGLE source of truth for calendar data. Both Python tools and
Electron main process read/write this same database file.

The database file is located at {user_data_dir}/timeline.db, where user_data_dir
is passed via COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR env var or --user-data-dir CLI arg.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

# Schema must match frontend-copilot/electron/timeline-database/database.ts
_TIMELINE_DB_FILE_NAME = "timeline.db"

_TIMELINE_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS timeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    is_all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    status TEXT NOT NULL DEFAULT 'not_started',
    metadata_payload TEXT,
    progress REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
"""


def _resolve_user_data_dir() -> Path:
    """Resolve the Electron userData directory from env var.

    Priority:
    1. COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR env var (set by Electron host)
    2. COPILOT_DESKTOP_RUNTIME_DATABASE_DIR env var → parent directory

    Raises RuntimeError if neither env var is set — timeline.db is managed by
    the Electron main process and its location must be provided by the host.
    """
    env_dir = os.environ.get("COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR", "").strip()
    if env_dir:
        return Path(env_dir)

    db_dir = os.environ.get("COPILOT_DESKTOP_RUNTIME_DATABASE_DIR", "").strip()
    if db_dir:
        return Path(db_dir).parent

    raise RuntimeError(
        "Cannot locate timeline.db: neither COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR "
        "nor COPILOT_DESKTOP_RUNTIME_DATABASE_DIR is set. "
        "These are normally provided by the Electron host. "
        "If running standalone, set COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR "
        "to the Electron userData directory (e.g. %APPDATA%/CanDue)."
    )


def resolve_timeline_db_path(user_data_dir: str | Path | None = None) -> Path:
    """Resolve the path to the timeline.db file.

    Priority:
    1. Explicit user_data_dir argument
    2. COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR env var
    3. backend/data/ fallback
    """
    if user_data_dir is not None:
        base = Path(user_data_dir)
    else:
        base = _resolve_user_data_dir()
    db_path = base / _TIMELINE_DB_FILE_NAME
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return db_path


def ensure_timeline_schema(db_path: Path) -> None:
    """Ensure the timeline_events table exists."""
    with sqlite3.connect(str(db_path)) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(_TIMELINE_TABLE_DDL)
        conn.commit()


def query_timeline_events(
    db_path: Path,
    *,
    source: str | None = None,
    limit: int | None = None,
    order_by: str = "start_time ASC",
) -> list[dict[str, Any]]:
    """Read timeline events, optionally filtered by source."""
    ensure_timeline_schema(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        sql = "SELECT * FROM timeline_events"
        params: list[Any] = []
        if source is not None:
            sql += " WHERE source = ?"
            params.append(source)
        sql += f" ORDER BY {order_by}"
        if limit is not None:
            sql += f" LIMIT {limit}"
        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]


def insert_timeline_event(
    db_path: Path,
    *,
    source: str,
    source_id: str | None,
    title: str,
    start_time: str,
    end_time: str | None = None,
    description: str | None = None,
    is_all_day: bool = False,
    location: str | None = None,
    status: str = "not_started",
    metadata_payload: dict[str, Any] | None = None,
    progress: float = 0,
) -> int:
    """Insert a new timeline event. Returns the new row ID."""
    ensure_timeline_schema(db_path)
    import json

    with sqlite3.connect(str(db_path)) as conn:
        cursor = conn.execute(
            """INSERT INTO timeline_events
               (source, source_id, title, description, start_time, end_time,
                is_all_day, location, status, metadata_payload, progress)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                source,
                source_id,
                title,
                description,
                start_time,
                end_time,
                1 if is_all_day else 0,
                location,
                status,
                json.dumps(metadata_payload, ensure_ascii=False) if metadata_payload else None,
                progress,
            ),
        )
        conn.commit()
        return cursor.lastrowid or 0


def upsert_timeline_event(
    db_path: Path,
    *,
    source: str,
    source_id: str,
    title: str,
    start_time: str,
    end_time: str | None = None,
    description: str | None = None,
    is_all_day: bool = False,
    location: str | None = None,
    status: str = "not_started",
    metadata_payload: dict[str, Any] | None = None,
    progress: float = 0,
) -> int:
    """Upsert by (source, source_id). Returns the row ID."""
    ensure_timeline_schema(db_path)
    import json

    with sqlite3.connect(str(db_path)) as conn:
        existing = conn.execute(
            "SELECT id FROM timeline_events WHERE source = ? AND source_id = ?",
            (source, source_id),
        ).fetchone()

        if existing:
            conn.execute(
                """UPDATE timeline_events
                   SET title = ?, description = ?, start_time = ?, end_time = ?,
                       is_all_day = ?, location = ?, status = ?,
                       metadata_payload = ?, progress = ?,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (
                    title,
                    description,
                    start_time,
                    end_time,
                    1 if is_all_day else 0,
                    location,
                    status,
                    json.dumps(metadata_payload, ensure_ascii=False) if metadata_payload else None,
                    progress,
                    existing[0],
                ),
            )
            conn.commit()
            return existing[0]
        else:
            cursor = conn.execute(
                """INSERT INTO timeline_events
                   (source, source_id, title, description, start_time, end_time,
                    is_all_day, location, status, metadata_payload, progress)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    source,
                    source_id,
                    title,
                    description,
                    start_time,
                    end_time,
                    1 if is_all_day else 0,
                    location,
                    status,
                    json.dumps(metadata_payload, ensure_ascii=False) if metadata_payload else None,
                    progress,
                ),
            )
            conn.commit()
            return cursor.lastrowid or 0


def update_timeline_event(
    db_path: Path,
    event_id: int,
    *,
    title: str | None = None,
    description: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
    is_all_day: bool | None = None,
    location: str | None = None,
    status: str | None = None,
    metadata_payload: dict[str, Any] | None = None,
    progress: float | None = None,
) -> bool:
    """Update a timeline event by ID. Returns True if a row was updated."""
    ensure_timeline_schema(db_path)
    import json

    updates: dict[str, Any] = {}
    if title is not None:
        updates["title"] = title
    if description is not None:
        updates["description"] = description
    if start_time is not None:
        updates["start_time"] = start_time
    if end_time is not None:
        updates["end_time"] = end_time
    if is_all_day is not None:
        updates["is_all_day"] = 1 if is_all_day else 0
    if location is not None:
        updates["location"] = location
    if status is not None:
        updates["status"] = status
    if metadata_payload is not None:
        updates["metadata_payload"] = json.dumps(metadata_payload, ensure_ascii=False)
    if progress is not None:
        updates["progress"] = progress

    if not updates:
        return False

    updates["updated_at"] = "CURRENT_TIMESTAMP"
    set_clauses = ", ".join(f"{k} = ?" if k != "updated_at" else f"{k} = CURRENT_TIMESTAMP" for k in updates)
    values = [v for k, v in updates.items() if k != "updated_at"]

    with sqlite3.connect(str(db_path)) as conn:
        cursor = conn.execute(
            f"UPDATE timeline_events SET {set_clauses} WHERE id = ?",
            values + [event_id],
        )
        conn.commit()
        return cursor.rowcount > 0


def delete_timeline_event(db_path: Path, event_id: int) -> bool:
    """Delete a timeline event by ID. Returns True if deleted."""
    ensure_timeline_schema(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        cursor = conn.execute("DELETE FROM timeline_events WHERE id = ?", (event_id,))
        conn.commit()
        return cursor.rowcount > 0


def sync_timeline_events(
    db_path: Path,
    source: str,
    events: list[dict[str, Any]],
) -> dict[str, int]:
    """Sync events for a given source: upsert incoming, delete absent.

    Each event dict should have: source_id, title, start_time, and optionally
    end_time, description, is_all_day, location, status, metadata_payload.
    """
    ensure_timeline_schema(db_path)
    stats = {"inserted": 0, "updated": 0, "deleted": 0}

    with sqlite3.connect(str(db_path)) as conn:
        # Get existing IDs for this source
        existing = {
            row[0]: row[1]
            for row in conn.execute(
                "SELECT source_id, id FROM timeline_events WHERE source = ?",
                (source,),
            ).fetchall()
        }
        incoming_ids = {e["source_id"] for e in events}

        import json

        for event in events:
            sid = event["source_id"]
            is_all_day = 1 if event.get("is_all_day") else 0
            metadata = event.get("metadata_payload")
            metadata_json = json.dumps(metadata, ensure_ascii=False) if metadata else None

            if sid in existing:
                conn.execute(
                    """UPDATE timeline_events
                       SET title = ?, description = ?, start_time = ?, end_time = ?,
                           is_all_day = ?, location = ?, status = ?,
                           metadata_payload = ?, updated_at = CURRENT_TIMESTAMP
                       WHERE id = ?""",
                    (
                        event.get("title", ""),
                        event.get("description"),
                        event["start_time"],
                        event.get("end_time"),
                        is_all_day,
                        event.get("location"),
                        event.get("status", "not_started"),
                        metadata_json,
                        existing[sid],
                    ),
                )
                stats["updated"] += 1
            else:
                conn.execute(
                    """INSERT INTO timeline_events
                       (source, source_id, title, description, start_time, end_time,
                        is_all_day, location, status, metadata_payload)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        source,
                        sid,
                        event.get("title", ""),
                        event.get("description"),
                        event["start_time"],
                        event.get("end_time"),
                        is_all_day,
                        event.get("location"),
                        event.get("status", "not_started"),
                        metadata_json,
                    ),
                )
                stats["inserted"] += 1

        # Delete events no longer in source
        for sid, rid in existing.items():
            if sid not in incoming_ids:
                conn.execute("DELETE FROM timeline_events WHERE id = ?", (rid,))
                stats["deleted"] += 1

        conn.commit()
    return stats


def get_timeline_health(db_path: Path) -> dict[str, Any]:
    """Return health dashboard for the timeline database."""
    ensure_timeline_schema(db_path)
    with sqlite3.connect(str(db_path)) as conn:
        cursor = conn.cursor()

        total = cursor.execute("SELECT COUNT(*) FROM timeline_events").fetchone()
        total_records = int(total[0]) if total else 0

        by_source = [
            {"source": row[0], "count": row[1]}
            for row in cursor.execute(
                "SELECT source, COUNT(*) as count FROM timeline_events GROUP BY source ORDER BY count DESC"
            ).fetchall()
        ]

        by_status = [
            {"status": row[0], "count": row[1]}
            for row in cursor.execute(
                "SELECT status, COUNT(*) as count FROM timeline_events GROUP BY status"
            ).fetchall()
        ]

        time_range = cursor.execute(
            "SELECT MIN(start_time), MAX(start_time) FROM timeline_events"
        ).fetchone()

        has_blackboard = any(s["source"] == "bb" for s in by_source)
        has_wakeup = any(s["source"] == "wakeup" for s in by_source)
        has_custom = any(s["source"] == "custom" for s in by_source)

        issues: list[str] = []
        if total_records == 0:
            issues.append(
                "日历数据库完全为空。请通过前端导入 WakeUp 课程表 ICS，"
                "或使用 blackboard.calendar.refresh 同步 Blackboard 截止日期。"
            )
        else:
            missing: list[str] = []
            if not has_blackboard:
                missing.append("Blackboard")
            if not has_wakeup:
                missing.append("WakeUp")
            if missing:
                issues.append(f"缺少数据源：{', '.join(missing)}。请触发相应同步。")

    return {
        "totalRecords": total_records,
        "bySource": by_source,
        "byStatus": by_status,
        "timeRange": {
            "earliest": time_range[0] if time_range else None,
            "latest": time_range[1] if time_range else None,
        },
        "pipelineDiagnostics": {
            "hasBlackboardData": has_blackboard,
            "hasWakeUpData": has_wakeup,
            "hasCustomData": has_custom,
            "isHealthy": total_records > 0,
        },
        "recommendation": "；".join(issues) if issues else None,
    }


__all__ = [
    "resolve_timeline_db_path",
    "ensure_timeline_schema",
    "query_timeline_events",
    "insert_timeline_event",
    "upsert_timeline_event",
    "update_timeline_event",
    "delete_timeline_event",
    "sync_timeline_events",
    "get_timeline_health",
]
