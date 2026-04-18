"""SQLite store for structured runtime debug log events."""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Mapping
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .contracts import (
    DebugLogCategory,
    DebugLogAuditRecord,
    DebugLogEnvironmentMode,
    DebugLogEvent,
    DebugLogLevel,
    DebugLogQueryFilter,
    DebugLogQueryResult,
)
from .sanitizer import Sanitizer

DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME = "copilot-debug-log.db"
DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS = 5.0
ENV_DEBUG_LOG_DATABASE_PATH = "COPILOT_RUNTIME_DEBUG_LOG_DATABASE_PATH"
ENV_DESKTOP_DATABASE_DIR = "COPILOT_DESKTOP_RUNTIME_DATABASE_DIR"
_ALLOWED_WAL_CHECKPOINT_MODES = frozenset({"PASSIVE", "FULL", "RESTART", "TRUNCATE"})


def resolve_debug_log_database_path(
    *,
    runtime_config: Any | None = None,
    db_path: str | Path | None = None,
    env: Mapping[str, str] | None = None,
) -> Path:
    env_map = os.environ if env is None else env
    if db_path is not None:
        candidate = Path(db_path)
    else:
        explicit_path = _normalize_optional_text(
            env_map.get(ENV_DEBUG_LOG_DATABASE_PATH)
        )
        if explicit_path is not None:
            candidate = Path(explicit_path)
        elif (
            runtime_config is not None
            and getattr(runtime_config, "debug_log_database_file", None) is not None
        ):
            candidate = Path(runtime_config.debug_log_database_file)
        elif runtime_config is not None:
            candidate = (
                Path(runtime_config.database_dir) / DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME
            )
        else:
            configured_database_dir = _normalize_optional_text(
                env_map.get(ENV_DESKTOP_DATABASE_DIR)
            )
            if configured_database_dir is not None:
                candidate = (
                    Path(configured_database_dir) / DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME
                )
            else:
                from app.desktop_runtime.config import BACKEND_DIR

                candidate = BACKEND_DIR / "data" / DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME

    if not candidate.is_absolute():
        from app.desktop_runtime.config import BACKEND_DIR

        candidate = BACKEND_DIR / candidate
    resolved = candidate.resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    return resolved


class DebugLogStore:
    """Persist sanitized lifecycle and runtime debug events to a dedicated SQLite DB."""

    def __init__(
        self,
        *,
        runtime_config: Any | None = None,
        db_path: str | Path | None = None,
        sanitizer: Sanitizer | None = None,
    ) -> None:
        self.db_path = resolve_debug_log_database_path(
            runtime_config=runtime_config, db_path=db_path
        )
        self.sanitizer = sanitizer or Sanitizer()
        self._initialize_schema()

    def write_event(self, event: DebugLogEvent) -> None:
        normalized_occurred_at = _format_datetime_for_storage(event.occurred_at)
        sanitized_message, _message_changed = self.sanitizer.sanitize_text(
            event.message
        )
        assert (
            sanitized_message is not None
        )  # pragma: no cover - sanitize_text() preserves non-None str inputs
        sanitized_error_summary = self.sanitizer.sanitize_error_text(
            event.error_summary
        )
        summary_stack, _stack_truncated = self.sanitizer.sanitize_stack(
            event.exception_stack
        )
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO debug_log_events (
                    occurred_at,
                    level,
                    category,
                    event_name,
                    message,
                    environment,
                    phase,
                    run_id,
                    thread_id,
                    request_id,
                    correlation_id,
                    session_id,
                    component,
                    operation,
                    tags_json,
                    summary_json,
                    summary_truncated,
                    summary_redacted_keys_json,
                    summary_dropped_fields_json,
                    error_summary,
                    exception_type,
                    exception_stack
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized_occurred_at,
                    event.level.value,
                    event.category.value,
                    event.event_name,
                    sanitized_message,
                    event.environment.value,
                    event.context.phase,
                    event.context.run_id,
                    event.context.thread_id,
                    event.context.request_id,
                    event.context.correlation_id,
                    event.context.session_id,
                    event.context.component,
                    event.context.operation,
                    json.dumps(event.context.tags, ensure_ascii=False, sort_keys=True),
                    json.dumps(
                        event.summary.content, ensure_ascii=False, sort_keys=True
                    ),
                    int(event.summary.truncated),
                    json.dumps(list(event.summary.redacted_keys), ensure_ascii=False),
                    json.dumps(list(event.summary.dropped_fields), ensure_ascii=False),
                    sanitized_error_summary,
                    event.exception_type,
                    summary_stack,
                ),
            )

    def write_audit_record(self, record: DebugLogAuditRecord) -> None:
        with self._connection() as connection:
            connection.execute(
                """
                INSERT INTO debug_log_audit (
                    occurred_at,
                    action,
                    trigger_reason,
                    status,
                    deleted_rows,
                    details_json,
                    error_summary
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    _format_datetime_for_storage(record.occurred_at),
                    record.action,
                    record.trigger,
                    record.status,
                    record.deleted_rows,
                    json.dumps(record.details, ensure_ascii=False, sort_keys=True),
                    record.error_summary,
                ),
            )

    def count_events(self) -> int:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS total FROM debug_log_events"
            ).fetchone()
        return int(row["total"])

    def delete_events_older_than(self, cutoff: datetime, *, limit: int) -> int:
        normalized_limit = max(int(limit), 1)
        with self._connection() as connection:
            cursor = connection.execute(
                """
                DELETE FROM debug_log_events
                WHERE id IN (
                    SELECT id
                    FROM debug_log_events
                    WHERE occurred_at < ?
                    ORDER BY occurred_at ASC, id ASC
                    LIMIT ?
                )
                """,
                (_format_datetime_for_storage(cutoff), normalized_limit),
            )
        return int(cursor.rowcount if cursor.rowcount is not None else 0)

    def get_latest_audit_record(
        self,
        *,
        action: str | None = None,
        status: str | None = None,
    ) -> DebugLogAuditRecord | None:
        where_clauses: list[str] = []
        parameters: list[object] = []
        if action is not None:
            where_clauses.append("action = ?")
            parameters.append(action)
        if status is not None:
            where_clauses.append("status = ?")
            parameters.append(status)

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        with self._connection() as connection:
            row = connection.execute(
                f"""
                SELECT occurred_at, action, trigger_reason, status, deleted_rows, details_json, error_summary
                FROM debug_log_audit
                {where_sql}
                ORDER BY occurred_at DESC, id DESC
                LIMIT 1
                """,
                tuple(parameters),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_audit_record(row)

    def list_audit_records(
        self, *, limit: int = 20, action: str | None = None
    ) -> tuple[DebugLogAuditRecord, ...]:
        normalized_limit = max(int(limit), 1)
        where_sql = ""
        parameters: tuple[object, ...] = (normalized_limit,)
        if action is not None:
            where_sql = "WHERE action = ?"
            parameters = (action, normalized_limit)

        with self._connection() as connection:
            rows = connection.execute(
                f"""
                SELECT occurred_at, action, trigger_reason, status, deleted_rows, details_json, error_summary
                FROM debug_log_audit
                {where_sql}
                ORDER BY occurred_at DESC, id DESC
                LIMIT ?
                """,
                parameters,
            ).fetchall()
        return tuple(self._row_to_audit_record(row) for row in rows)

    def get_database_file_size_bytes(self) -> int:
        if not self.db_path.exists():
            return 0
        return int(self.db_path.stat().st_size)

    def checkpoint_wal(self, *, mode: str = "PASSIVE") -> None:
        normalized_mode = mode.strip().upper()
        if normalized_mode not in _ALLOWED_WAL_CHECKPOINT_MODES:
            raise ValueError(f"Unsupported wal_checkpoint mode: {mode}")
        with self._connection() as connection:
            connection.execute(f"PRAGMA wal_checkpoint({normalized_mode});")

    def list_recent_events(self, *, limit: int = 20) -> tuple[DebugLogQueryResult, ...]:
        return self.query_events(DebugLogQueryFilter(limit=limit))

    def query_events(
        self, query_filter: DebugLogQueryFilter
    ) -> tuple[DebugLogQueryResult, ...]:
        normalized_limit = max(int(query_filter.limit), 1)
        where_clauses: list[str] = []
        parameters: list[object] = []

        for field_name, field_value in (
            ("run_id", query_filter.run_id),
            ("thread_id", query_filter.thread_id),
            ("request_id", query_filter.request_id),
            ("correlation_id", query_filter.correlation_id),
        ):
            if field_value is not None:
                where_clauses.append(f"{field_name} = ?")
                parameters.append(field_value)

        if query_filter.level is not None:
            where_clauses.append("level = ?")
            parameters.append(query_filter.level.value)
        if query_filter.category is not None:
            where_clauses.append("category = ?")
            parameters.append(query_filter.category.value)
        if query_filter.occurred_from is not None:
            where_clauses.append("occurred_at >= ?")
            parameters.append(_format_datetime_for_storage(query_filter.occurred_from))
        if query_filter.occurred_to is not None:
            where_clauses.append("occurred_at <= ?")
            parameters.append(_format_datetime_for_storage(query_filter.occurred_to))

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        with self._connection() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    id,
                    occurred_at,
                    level,
                    category,
                    event_name,
                    message,
                    environment,
                    phase,
                    run_id,
                    thread_id,
                    request_id,
                    correlation_id,
                    session_id,
                    component,
                    operation,
                    tags_json,
                    summary_json,
                    summary_truncated,
                    summary_redacted_keys_json,
                    summary_dropped_fields_json,
                    error_summary,
                    exception_type,
                    exception_stack
                FROM debug_log_events
                {where_sql}
                ORDER BY occurred_at DESC, id DESC
                LIMIT ?
                """,
                (*parameters, normalized_limit),
            ).fetchall()
        return tuple(self._row_to_query_result(row) for row in rows)

    def get_event_by_id(self, event_id: int) -> DebugLogQueryResult | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                SELECT
                    id,
                    occurred_at,
                    level,
                    category,
                    event_name,
                    message,
                    environment,
                    phase,
                    run_id,
                    thread_id,
                    request_id,
                    correlation_id,
                    session_id,
                    component,
                    operation,
                    tags_json,
                    summary_json,
                    summary_truncated,
                    summary_redacted_keys_json,
                    summary_dropped_fields_json,
                    error_summary,
                    exception_type,
                    exception_stack
                FROM debug_log_events
                WHERE id = ?
                """,
                (event_id,),
            ).fetchone()
        if row is None:
            return None
        return self._row_to_query_result(row)

    def _initialize_schema(self) -> None:
        with self._connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS debug_log_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    occurred_at TEXT NOT NULL,
                    level TEXT NOT NULL,
                    category TEXT NOT NULL,
                    event_name TEXT NOT NULL,
                    message TEXT NOT NULL,
                    environment TEXT NOT NULL,
                    phase TEXT,
                    run_id TEXT,
                    thread_id TEXT,
                    request_id TEXT,
                    correlation_id TEXT,
                    session_id TEXT,
                    component TEXT,
                    operation TEXT,
                    tags_json TEXT NOT NULL,
                    summary_json TEXT NOT NULL,
                    summary_truncated INTEGER NOT NULL DEFAULT 0,
                    summary_redacted_keys_json TEXT NOT NULL,
                    summary_dropped_fields_json TEXT NOT NULL,
                    error_summary TEXT,
                    exception_type TEXT,
                    exception_stack TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_debug_log_events_occurred_at
                    ON debug_log_events(occurred_at DESC);
                CREATE INDEX IF NOT EXISTS idx_debug_log_events_category_level
                    ON debug_log_events(category, level, occurred_at DESC);
                CREATE INDEX IF NOT EXISTS idx_debug_log_events_correlation
                    ON debug_log_events(run_id, thread_id, request_id, correlation_id);

                CREATE TABLE IF NOT EXISTS debug_log_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    occurred_at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    trigger_reason TEXT NOT NULL,
                    status TEXT NOT NULL,
                    deleted_rows INTEGER NOT NULL DEFAULT 0,
                    details_json TEXT NOT NULL,
                    error_summary TEXT
                );
                """
            )

    @contextmanager
    def _connection(self):
        connection = sqlite3.connect(
            self.db_path,
            timeout=DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS,
            check_same_thread=False,
        )
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA foreign_keys=ON;")
            connection.execute("PRAGMA journal_mode=WAL;")
            connection.execute("PRAGMA synchronous=NORMAL;")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _row_to_query_result(self, row: sqlite3.Row) -> DebugLogQueryResult:
        return DebugLogQueryResult(
            event_id=int(row["id"]),
            occurred_at=datetime.fromisoformat(row["occurred_at"]),
            level=DebugLogLevel(row["level"]),
            category=DebugLogCategory(row["category"]),
            event_name=row["event_name"],
            message=row["message"],
            environment=DebugLogEnvironmentMode(row["environment"]),
            phase=row["phase"],
            run_id=row["run_id"],
            thread_id=row["thread_id"],
            request_id=row["request_id"],
            correlation_id=row["correlation_id"],
            session_id=row["session_id"],
            component=row["component"],
            operation=row["operation"],
            tags=json.loads(row["tags_json"]),
            summary=json.loads(row["summary_json"]),
            summary_truncated=bool(row["summary_truncated"]),
            summary_redacted_keys=tuple(json.loads(row["summary_redacted_keys_json"])),
            summary_dropped_fields=tuple(
                json.loads(row["summary_dropped_fields_json"])
            ),
            error_summary=row["error_summary"],
            exception_type=row["exception_type"],
            exception_stack=row["exception_stack"],
        )

    def _row_to_audit_record(self, row: sqlite3.Row) -> DebugLogAuditRecord:
        return DebugLogAuditRecord(
            occurred_at=datetime.fromisoformat(row["occurred_at"]),
            action=row["action"],
            trigger=row["trigger_reason"],
            status=row["status"],
            details=json.loads(row["details_json"]),
            deleted_rows=int(row["deleted_rows"]),
            error_summary=row["error_summary"],
        )


def _normalize_optional_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_datetime_to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _format_datetime_for_storage(value: datetime) -> str:
    return _normalize_datetime_to_utc(value).isoformat(timespec="microseconds")


__all__ = [
    "DEFAULT_DEBUG_LOG_DATABASE_FILE_NAME",
    "DEFAULT_SQLITE_BUSY_TIMEOUT_SECONDS",
    "ENV_DEBUG_LOG_DATABASE_PATH",
    "ENV_DESKTOP_DATABASE_DIR",
    "DebugLogStore",
    "resolve_debug_log_database_path",
]
