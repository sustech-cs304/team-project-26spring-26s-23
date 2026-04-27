"""Blackboard SQL query tool — sql_query sub-domain of the Blackboard tool facade."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any, cast

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.blackboard.data.db_manager import DatabaseManager
from app.tooling import (
    ArtifactStore,
    DatabaseResolver,
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
)

from . import tools


class _BlackboardSQLQueryArguments(tools._BlackboardToolArguments):
    sql: str = tools.Field(default="", validate_default=True)
    resultLimit: int = 50
    persistArtifact: bool = False

    @tools.field_validator("sql", mode="before")
    @classmethod
    def _normalize_sql(cls, value: Any) -> str:
        return tools._normalize_required_text_value(value, "sql")

    @tools.field_validator("resultLimit", mode="before")
    @classmethod
    def _normalize_result_limit(cls, value: Any) -> int:
        normalized = tools._normalize_optional_int_value(value, "resultLimit")
        return 50 if normalized is None else normalized

    @tools.field_validator("resultLimit")
    @classmethod
    def _validate_result_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("resultLimit must be a positive integer.")
        return value

    @tools.field_validator("persistArtifact", mode="before")
    @classmethod
    def _normalize_persist_artifact(cls, value: Any) -> bool:
        return tools._normalize_bool_value(value, "persistArtifact", default=False)


class _SQLDatabaseSummary(tools.SustechToolBoundaryModel):
    path: str
    source: str


class _BlackboardSQLQueryOutput(tools.SustechToolBoundaryModel):
    sql: str
    database: _SQLDatabaseSummary
    usedDefaultDatabase: bool
    hasResultSet: bool
    columns: list[str]
    rowsPreview: tools.JsonArray
    truncated: bool
    rowCount: int | None
    executionSummary: tools.JsonObject
    artifact: tools.JsonObject | None


class _BlackboardSQLQueryArtifactPayload(tools.SustechToolBoundaryModel):
    sql: str
    database: _SQLDatabaseSummary
    usedDefaultDatabase: bool
    hasResultSet: bool
    columns: list[str]
    rows: tools.JsonArray
    rowCount: int
    executionSummary: tools.JsonObject


_SQL_QUERY_METADATA = ToolMetadata(
    tool_id="blackboard.sql.query",
    display_name="Blackboard SQL Query",
    description=(
        "Execute raw SQL directly against the local Blackboard SQLite database for inspection and retrieval. "
        "Unless explicitly allowed, avoid DDL, DML, PRAGMA, and ATTACH statements."
    ),
    input_schema=tools._schema(
        properties={
            "sql": {
                "type": "string",
                "minLength": 1,
                "description": "SQL statement to execute against the local Blackboard SQLite database.",
            },
            "dbRelativePath": {
                "type": "string",
                "description": "Optional path, relative to the host database directory, of the SQLite database to query; omit to use the default Blackboard database.",
            },
            "resultLimit": {
                "type": "integer",
                "description": "Maximum number of rows returned inline in rowsPreview before truncation; defaults to 50.",
            },
            "persistArtifact": {
                "type": "boolean",
                "description": "When true and the inline preview is truncated, save the full SQL result as a JSON artifact.",
            },
        },
        required=("sql",),
    ),
    output_schema=tools._schema(
        properties={
            "sql": {"type": "string"},
            "database": {"type": "object"},
            "usedDefaultDatabase": {"type": "boolean"},
            "hasResultSet": {"type": "boolean"},
            "columns": {"type": "array"},
            "rowsPreview": {"type": "array"},
            "truncated": {"type": "boolean"},
            "rowCount": {"type": ["integer", "null"]},
            "executionSummary": {"type": "object"},
            "artifact": {"type": ["object", "null"]},
        },
        required=(
            "sql",
            "database",
            "usedDefaultDatabase",
            "hasResultSet",
            "columns",
            "rowsPreview",
            "truncated",
            "rowCount",
            "executionSummary",
            "artifact",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used.",
        ),
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist full SQL query results as host-owned artifacts when inline preview is truncated.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "sql", "query"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=False,
)


def _read_sql_query_result_limit(arguments: Mapping[str, Any]) -> int:
    raw_limit = tools._read_optional_int(arguments, "resultLimit")
    if raw_limit is None:
        return 50
    if raw_limit <= 0:
        raise ValueError("resultLimit must be a positive integer.")
    return raw_limit


def _default_blackboard_sql_query_db_path(host: ToolHostCapabilities) -> Path:
    database_resolver = cast(
        DatabaseResolver,
        host.require_capability("database_resolver"),
    )
    return database_resolver.resolve_database_path(
        relative_path=DatabaseManager.DEFAULT_DB_RELATIVE_PATH.as_posix()
    )


def _resolve_sql_query_db_path(
    arguments: Mapping[str, Any],
    host: ToolHostCapabilities,
) -> tuple[Path, str, bool]:
    tools._reject_explicit_db_path(arguments)
    db_relative_path = tools._read_optional_text(arguments, "dbRelativePath")
    if db_relative_path is not None:
        database_resolver = cast(
            DatabaseResolver,
            host.require_capability("database_resolver"),
        )
        return (
            database_resolver.resolve_database_path(relative_path=db_relative_path),
            "database_relative",
            False,
        )
    return _default_blackboard_sql_query_db_path(host), "default", True


def _sql_statement_type(sql: str) -> str:
    stripped = sql.lstrip()
    if stripped == "":
        return "UNKNOWN"
    return stripped.split(maxsplit=1)[0].rstrip(";").upper()


def _normalize_sql_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return tools._jsonable(value)


def _sql_row_to_mapping(columns: Sequence[str], row: Sequence[Any]) -> dict[str, Any]:
    return {column: _normalize_sql_value(value) for column, value in zip(columns, row)}


def _execute_sql_query(
    *,
    sql: str,
    db_path: Path,
    result_limit: int,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    statement_type = _sql_statement_type(sql)
    with sqlite3.connect(str(db_path)) as connection:
        cursor = connection.cursor()
        cursor.execute(sql)
        has_result_set = cursor.description is not None
        if has_result_set:
            columns = [str(description[0]) for description in cursor.description]
            rows = cursor.fetchall()
            full_rows = [_sql_row_to_mapping(columns, row) for row in rows]
            row_count = len(full_rows)
            rows_preview = full_rows[:result_limit]
            execution_summary = {
                "statementType": statement_type,
                "previewRowCount": len(rows_preview),
                "rowCount": row_count,
                "message": f"SQL query returned {row_count} row(s).",
            }
            return (
                {
                    "hasResultSet": True,
                    "columns": columns,
                    "rowsPreview": rows_preview,
                    "truncated": row_count > result_limit,
                    "rowCount": row_count,
                    "executionSummary": execution_summary,
                },
                {
                    "hasResultSet": True,
                    "columns": columns,
                    "rows": full_rows,
                    "rowCount": row_count,
                    "executionSummary": execution_summary,
                },
            )

        connection.commit()
        affected_row_count = cursor.rowcount if cursor.rowcount >= 0 else None
        return (
            {
                "hasResultSet": False,
                "columns": [],
                "rowsPreview": [],
                "truncated": False,
                "rowCount": None,
                "executionSummary": {
                    "statementType": statement_type,
                    "affectedRowCount": affected_row_count,
                    "message": "SQL statement executed without a result set.",
                },
            },
            None,
        )


async def _persist_sql_query_artifact_if_requested(
    *,
    persist_artifact: bool,
    context: ToolInvocationContext,
    host: ToolHostCapabilities,
    output: Mapping[str, Any],
    full_result: Mapping[str, Any] | None,
) -> tuple[dict[str, Any] | None, tuple[ToolArtifactReference, ...]]:
    if not persist_artifact or full_result is None or not bool(output.get("truncated")):
        return None, ()

    artifact_store = cast(ArtifactStore, host.require_capability("artifact_store"))
    artifact = await artifact_store.save_text(
        name=f"{context.tool_id.replace('.', '-')}-{context.invocation_id}.json",
        text=json.dumps(
            dict(full_result), ensure_ascii=False, indent=2, sort_keys=True
        ),
        content_type="application/json",
        metadata={
            "toolId": context.tool_id,
            "invocationId": context.invocation_id,
            "rowCount": full_result.get("rowCount"),
        },
    )
    reference = ToolArtifactReference(
        artifact_id=artifact.artifact_id,
        name=artifact.name,
        content_type=artifact.content_type,
        uri=artifact.uri,
        metadata=artifact.metadata,
    )
    return reference.to_dict(), (reference,)


class BlackboardSQLQueryTool(tools._BlackboardFacadeToolBase):
    _metadata = _SQL_QUERY_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _BlackboardSQLQueryArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict()
        db_path, db_path_source, used_default_database = _resolve_sql_query_db_path(
            normalized_arguments,
            host,
        )
        query_output, full_result = await asyncio.to_thread(
            _execute_sql_query,
            sql=parsed_arguments.sql,
            db_path=db_path,
            result_limit=parsed_arguments.resultLimit,
        )
        database_summary = _SQLDatabaseSummary(
            path=db_path.as_posix(),
            source=db_path_source,
        )
        output_model = _BlackboardSQLQueryOutput(
            sql=parsed_arguments.sql,
            database=database_summary,
            usedDefaultDatabase=used_default_database,
            hasResultSet=bool(query_output["hasResultSet"]),
            columns=cast(list[str], query_output["columns"]),
            rowsPreview=cast(tools.JsonArray, query_output["rowsPreview"]),
            truncated=bool(query_output["truncated"]),
            rowCount=cast(int | None, query_output["rowCount"]),
            executionSummary=cast(tools.JsonObject, query_output["executionSummary"]),
            artifact=None,
        )
        output = output_model.to_contract_dict()
        artifact_payload: dict[str, Any] | None = None
        if full_result is not None:
            artifact_payload = _BlackboardSQLQueryArtifactPayload(
                sql=parsed_arguments.sql,
                database=database_summary,
                usedDefaultDatabase=used_default_database,
                hasResultSet=bool(full_result["hasResultSet"]),
                columns=cast(list[str], full_result["columns"]),
                rows=cast(tools.JsonArray, full_result["rows"]),
                rowCount=cast(int, full_result["rowCount"]),
                executionSummary=cast(tools.JsonObject, full_result["executionSummary"]),
            ).to_contract_dict()
        artifact_output, artifacts = await _persist_sql_query_artifact_if_requested(
            persist_artifact=parsed_arguments.persistArtifact,
            context=context,
            host=host,
            output=output,
            full_result=artifact_payload,
        )
        output = output_model.model_copy(
            update={"artifact": artifact_output}
        ).to_contract_dict()
        return (
            output,
            artifacts,
            {
                "dbPathSource": db_path_source,
                "persistArtifactRequested": parsed_arguments.persistArtifact,
            },
        )
