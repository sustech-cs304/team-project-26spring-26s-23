"""Calendar SQL query tool — direct SQL interface to the timeline database.

Supports multi-statement SQL (separated by `;`) against timeline_events table.
Schema DDL is injected into the tool description so the Agent always knows the structure.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from app.timeline_db import (
    resolve_timeline_db_path,
    ensure_timeline_schema,
)
from app.tooling.runtime_adapter.copilot_runtime import get_runtime_context_metadata_value
from app.tooling.contract import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolContract,
    ToolInvocationContext,
    ToolMetadata,
    ToolResultEnvelope,
    ToolSchema,
)
from app.tooling.contract.errors import (
    NormalizedToolError,
    build_tool_exception_details,
    redact_tool_error_value,
)
from app.tooling.host_capabilities import ToolHostCapabilities

# ---------------------------------------------------------------------------
# SQL helpers
# ---------------------------------------------------------------------------


def _first_keyword(sql: str) -> str:
    stripped = sql.lstrip()
    if not stripped:
        return "UNKNOWN"
    return stripped.split(maxsplit=1)[0].rstrip(";").upper()


def _normalize_sql_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, (int, float, str, bool, type(None))):
        return value
    return str(value)


def _sql_row_to_mapping(columns: Sequence[str], row: Sequence[Any]) -> dict[str, Any]:
    return {column: _normalize_sql_value(value) for column, value in zip(columns, row)}


def _execute_multi_sql(
    *, sql: str, db_path: Path, result_limit: int
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Execute one or more SQL statements separated by `;`.

    Returns (summary_output, full_result_or_None) where full_result is only
    filled when there is a single SELECT statement returning rows.
    """
    ensure_timeline_schema(db_path)

    statements = [s.strip() for s in sql.split(";") if s.strip()]
    if not statements:
        statements = [sql.strip()] if sql.strip() else []

    all_columns: list[str] = []
    all_rows: list[dict[str, Any]] = []
    total_affected = 0
    execution_log: list[dict[str, Any]] = []

    with sqlite3.connect(str(db_path)) as conn:
        for stmt in statements:
            stmt_type = _first_keyword(stmt)
            cursor = conn.cursor()
            cursor.execute(stmt)
            has_rs = cursor.description is not None

            if has_rs:
                cols = [str(d[0]) for d in cursor.description]
                rows = cursor.fetchall()
                mapped = [_sql_row_to_mapping(cols, r) for r in rows]
                if not all_columns:
                    all_columns = cols
                all_rows.extend(mapped)
                execution_log.append({
                    "sql": stmt[:200],
                    "type": stmt_type,
                    "rows": len(mapped),
                })
            else:
                conn.commit()
                affected = cursor.rowcount if cursor.rowcount >= 0 else 0
                total_affected += affected
                execution_log.append({
                    "sql": stmt[:200],
                    "type": stmt_type,
                    "affected": affected,
                })

    row_count = len(all_rows)
    has_result_set = len(all_columns) > 0
    rows_preview = all_rows[:result_limit]

    output = {
        "hasResultSet": has_result_set,
        "columns": all_columns,
        "rowsPreview": rows_preview,
        "truncated": row_count > result_limit,
        "rowCount": row_count if has_result_set else None,
        "executionSummary": {
            "statementCount": len(statements),
            "totalAffectedRows": total_affected,
            "log": execution_log,
            "message": f"Executed {len(statements)} statement(s). "
                       f"{row_count} row(s) returned, {total_affected} row(s) affected.",
        },
    }

    full_result = None
    if has_result_set:
        full_result = {
            "hasResultSet": True,
            "columns": all_columns,
            "rows": all_rows,
            "rowCount": row_count,
            "executionSummary": output["executionSummary"],
        }

    return output, full_result


# ---------------------------------------------------------------------------
# Validation (only block destructive DDL)
# ---------------------------------------------------------------------------


def _validate_sql(sql: str) -> str | None:
    """Reject only DDL / PRAGMA statements. Everything else is allowed."""
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    blocked_keywords = {"CREATE", "DROP", "ALTER", "PRAGMA"}
    for stmt in statements:
        kw = _first_keyword(stmt)
        if kw in blocked_keywords:
            return (
                f"Statement '{kw}' is not allowed. "
                f"DDL and PRAGMA statements are blocked. "
                f"Only SELECT, INSERT, UPDATE, DELETE are permitted."
            )
    return None


# ---------------------------------------------------------------------------
# Tool metadata (DDL injected into description)
# ---------------------------------------------------------------------------


_CALENDAR_SQL_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["sql"],
        "properties": {
            "sql": {
                "type": "string",
                "minLength": 1,
                "description": (
                    "SQL statement(s) to execute against the timeline_events table. "
                    "Multiple statements separated by `;` are supported. "
                    "Supports SELECT, INSERT, UPDATE, DELETE."
                ),
            },
            "resultLimit": {
                "type": "integer",
                "description": "Max rows returned inline before truncation; defaults to 50.",
            },
            "persistArtifact": {
                "type": "boolean",
                "description": "When true and inline preview is truncated, save full result as JSON artifact.",
            },
        },
    }
)


_CALENDAR_SQL_DDL = """\
CREATE TABLE IF NOT EXISTS timeline_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    source          TEXT    NOT NULL,
    source_id       TEXT,
    title           TEXT    NOT NULL,
    description     TEXT,
    start_time      TEXT    NOT NULL,
    end_time        TEXT,
    is_all_day      INTEGER NOT NULL DEFAULT 0,
    location        TEXT,
    status          TEXT    NOT NULL DEFAULT 'not_started',
    metadata_payload TEXT,
    progress        REAL    DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);"""


_CALENDAR_SQL_METADATA = ToolMetadata(
    tool_id="calendar.sql.query",
    display_name="Calendar SQL Query",
    description=(
        "Execute SQL directly against the timeline database (timeline_events table) "
        "for inspection, modification, and retrieval of calendar events. "
        "Multiple statements separated by `;` are supported.\n\n"
        "**Table DDL**:\n```sql\n" + _CALENDAR_SQL_DDL + "\n```\n\n"
        "**Usage tips**:\n"
        "- `source` values: 'bb' (Blackboard), 'wakeup' (WakeUp课程表), "
        "'course' (教务系统), 'custom' (用户自定义).\n"
        "- When INSERT-ing new events, prefer source='custom' — other sources "
        "are managed by their own sync tools.\n"
        "- `start_time` / `end_time` use ISO-8601 format (e.g. '2026-06-01T10:00:00').\n"
        "- `status`: 'not_started', 'in_progress', 'completed'.\n"
        "- `is_all_day`: 1 for all-day events, 0 for time-specific.\n"
        "- `metadata_payload`: JSON string for extensible metadata.\n"
        "- This is the SAME database used by the frontend Gantt chart — "
        "changes are immediately visible in the UI.\n"
        "- Always SELECT before UPDATE/DELETE to verify the target rows."
    ),
    input_schema=_CALENDAR_SQL_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist full SQL results as artifacts when inline preview is truncated.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events.",
        ),
    ),
    tags=("calendar", "sql", "query"),
    annotations={"domain": "calendar", "facade": "tool-contract"},
    idempotent=False,
)


# ---------------------------------------------------------------------------
# Tool implementation
# ---------------------------------------------------------------------------


class CalendarSQLQueryTool:
    _metadata = _CALENDAR_SQL_METADATA

    @property
    def metadata(self) -> ToolMetadata:
        return self._metadata

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        normalized = dict(arguments or {})
        try:
            host.assert_satisfies(self.metadata.capability_requirements)

            sql = _read_required_text(normalized, "sql")
            result_limit = _read_result_limit(normalized)
            persist = _read_optional_bool(normalized, "persistArtifact", default=False)

            err = _validate_sql(sql)
            if err is not None:
                return ToolResultEnvelope.failure(
                    error=NormalizedToolError(code="invalid_input", message=err),
                    metadata={"toolId": self.metadata.tool_id},
                )

            db_path = _resolve_calendar_db_path(context)
            query_output, full_result = await asyncio.to_thread(
                _execute_multi_sql, sql=sql, db_path=db_path, result_limit=result_limit
            )

            output: dict[str, Any] = {
                "sql": sql,
                "database": {"path": db_path.as_posix(), "source": "timeline"},
                "usedDefaultDatabase": True,
                "hasResultSet": bool(query_output["hasResultSet"]),
                "columns": list(query_output["columns"]),
                "rowsPreview": list(query_output["rowsPreview"]),
                "truncated": bool(query_output["truncated"]),
                "rowCount": query_output["rowCount"],
                "executionSummary": dict(query_output["executionSummary"]),
                "artifact": None,
            }

            artifacts: list[ToolArtifactReference] = []
            if persist and full_result and output["truncated"]:
                try:
                    artifact_store: Any = host.require_capability("artifact_store")
                except Exception:
                    artifact_store = None

                if artifact_store is not None:
                    artifact = await artifact_store.save_text(
                        name=f"calendar-sql-{context.invocation_id}.json",
                        text=json.dumps(full_result, ensure_ascii=False, indent=2),
                        content_type="application/json",
                        metadata={"toolId": context.tool_id, "invocationId": context.invocation_id},
                    )
                    ref = ToolArtifactReference(
                        artifact_id=artifact.artifact_id,
                        name=artifact.name,
                        content_type=artifact.content_type,
                        uri=artifact.uri,
                        metadata=artifact.metadata,
                    )
                    output["artifact"] = ref.to_dict()
                    artifacts.append(ref)

            return ToolResultEnvelope.success(
                output=output,
                artifacts=tuple(artifacts),
                metadata={"toolId": self.metadata.tool_id},
            )
        except Exception as ex:
            return ToolResultEnvelope.failure(
                error=NormalizedToolError(
                    code="execution_failed",
                    message=f"Calendar SQL query failed: {ex}",
                    details=build_tool_exception_details(
                        error=ex,
                        diagnostic_context={"toolId": self.metadata.tool_id},
                        sanitizer=redact_tool_error_value,
                    ),
                ),
                metadata={"toolId": self.metadata.tool_id},
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _resolve_calendar_db_path(context: ToolInvocationContext) -> Path:
    user_data_dir = _read_runtime_user_data_dir(context)
    if user_data_dir is not None:
        return resolve_timeline_db_path(user_data_dir=user_data_dir)
    return resolve_timeline_db_path()


def _read_runtime_user_data_dir(context: ToolInvocationContext) -> str | None:
    value = get_runtime_context_metadata_value(
        ("runtimePaths", "userDataDir"),
    )
    if isinstance(value, str) and value.strip():
        return value.strip()

    runtime_context = context.metadata.get("runtimeContext")
    if not isinstance(runtime_context, Mapping):
        return None
    runtime_paths = runtime_context.get("runtimePaths")
    if not isinstance(runtime_paths, Mapping):
        return None
    metadata_value = runtime_paths.get("userDataDir")
    if isinstance(metadata_value, str) and metadata_value.strip():
        return metadata_value.strip()
    return None


def _read_required_text(args: Mapping[str, Any], name: str) -> str:
    v = str(args.get(name, "")).strip()
    if not v:
        raise ValueError(f"{name} must be a non-empty string.")
    return v


def _read_optional_bool(args: Mapping[str, Any], name: str, *, default: bool) -> bool:
    v = args.get(name)
    if v is None:
        return default
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        n = v.strip().lower()
        if n in {"true", "1", "yes"}:
            return True
        if n in {"false", "0", "no"}:
            return False
    raise ValueError(f"{name} must be a boolean.")


def _read_result_limit(args: Mapping[str, Any]) -> int:
    v = args.get("resultLimit")
    if v is None:
        return 50
    if isinstance(v, bool):
        raise ValueError("resultLimit must be an integer.")
    try:
        limit = int(v)
        if limit <= 0:
            raise ValueError("resultLimit must be positive.")
        return limit
    except (TypeError, ValueError) as e:
        raise ValueError("resultLimit must be a positive integer.") from e


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


_CALENDAR_TOOL_CONTRACTS: tuple[ToolContract, ...] = (
    CalendarSQLQueryTool(),
)


def get_calendar_tool_contracts() -> tuple[ToolContract, ...]:
    return _CALENDAR_TOOL_CONTRACTS


__all__ = [
    "CalendarSQLQueryTool",
    "get_calendar_tool_contracts",
]
