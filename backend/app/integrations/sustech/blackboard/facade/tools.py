"""Tool-contract facade for selected Blackboard domain capabilities."""

from __future__ import annotations

import asyncio
import json
import sqlite3
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import httpx

from app.integrations.sustech.blackboard.data.db_manager import DatabaseManager
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardCourseResourcesSyncReport,
    BlackboardSnapshotSyncReport,
    CalendarICSSyncResult,
    CourseCatalogSearchResult,
)
from app.integrations.sustech.blackboard.provider.use_cases import (
    refresh_calendar_ics_subscription,
    run_blackboard_course_resources_sync,
    run_blackboard_snapshot_sync,
    search_course_catalog_with_credentials,
)
from app.tooling import (
    ArtifactStore,
    DatabaseResolver,
    HostCapabilityOperationError,
    HostCapabilityRequirement,
    HostEvent,
    MissingHostCapabilityError,
    NormalizedToolError,
    ToolArtifactReference,
    ToolContract,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
    ToolResultEnvelope,
    ToolSchema,
)
from app.tooling.contract.errors import build_tool_exception_details, redact_tool_error_value

_STATE_NAMESPACE_CALENDAR_REFRESH = "blackboard.calendar_refresh"
_STATE_NAMESPACE_SNAPSHOT_SYNC = "blackboard.snapshot_sync"
_STATE_NAMESPACE_COURSE_RESOURCES_SYNC = "blackboard.course_resources_sync"
_DEFAULT_SUSTECH_USERNAME_SECRET_NAME = "sustech.username"
_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME = "sustech.casPassword"


class BlackboardAuthenticationError(RuntimeError):
    """Raised when Blackboard credentials cannot be resolved or authenticated."""


class _BlackboardFacadeToolBase:
    _metadata: ToolMetadata

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
        normalized_arguments = _normalize_arguments(arguments)
        try:
            host.assert_satisfies(self.metadata.capability_requirements)
            _emit_event(
                host,
                context=context,
                event_type=f"{self.metadata.tool_id}.started",
                message=f"Started {self.metadata.tool_id}.",
            )
            output, artifacts, metadata = await self._invoke_impl(
                arguments=normalized_arguments,
                context=context,
                host=host,
            )
            envelope_metadata = {"toolId": self.metadata.tool_id, **metadata}
            _emit_event(
                host,
                context=context,
                event_type=f"{self.metadata.tool_id}.completed",
                message=f"Completed {self.metadata.tool_id}.",
                data={"artifactCount": len(artifacts)},
            )
            return ToolResultEnvelope.success(
                output=output,
                artifacts=artifacts,
                metadata=envelope_metadata,
            )
        except Exception as ex:
            error = _map_exception(
                ex,
                diagnostic_context=_error_diagnostic_context(
                    tool_id=self.metadata.tool_id,
                    context=context,
                    arguments=normalized_arguments,
                ),
            )
            _emit_event(
                host,
                context=context,
                event_type=f"{self.metadata.tool_id}.failed",
                message=error.message,
                data=error.to_dict(),
            )
            return ToolResultEnvelope.failure(
                error=error,
                metadata={"toolId": self.metadata.tool_id},
            )

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        raise NotImplementedError


def _normalize_arguments(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    if arguments is None:
        return {}
    return dict(arguments)


def _read_optional_text(arguments: Mapping[str, Any], field_name: str) -> str | None:
    value = arguments.get(field_name)
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _read_required_text(arguments: Mapping[str, Any], field_name: str) -> str:
    normalized = _read_optional_text(arguments, field_name)
    if normalized is None:
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _read_optional_int(arguments: Mapping[str, Any], field_name: str) -> int | None:
    value = arguments.get(field_name)
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer.")
    try:
        return int(value)
    except (TypeError, ValueError) as ex:
        raise ValueError(f"{field_name} must be an integer.") from ex


def _read_required_string_list(arguments: Mapping[str, Any], field_name: str) -> list[str]:
    value = arguments.get(field_name)
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array of non-empty strings.")

    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        if not text:
            raise ValueError(f"{field_name} must contain only non-empty strings.")
        if text in seen:
            continue
        seen.add(text)
        normalized.append(text)

    if not normalized:
        raise ValueError(f"{field_name} must contain at least one non-empty string.")
    return normalized


def _read_bool(arguments: Mapping[str, Any], field_name: str, *, default: bool) -> bool:
    value = arguments.get(field_name)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    raise ValueError(f"{field_name} must be a boolean.")


def _read_choice(
    arguments: Mapping[str, Any],
    field_name: str,
    *,
    choices: Sequence[str],
    default: str,
) -> str:
    normalized = _read_optional_text(arguments, field_name)
    if normalized is None:
        return default

    lowered = normalized.lower()
    normalized_choices = tuple(str(item).lower() for item in choices)
    if lowered not in normalized_choices:
        raise ValueError(f"{field_name} must be one of: {', '.join(normalized_choices)}.")
    return lowered


def _jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    if hasattr(value, "__dataclass_fields__"):
        return _jsonable(asdict(cast(Any, value)))
    if hasattr(value, "to_dict"):
        return _jsonable(cast(Any, value).to_dict())
    return value


def _schema(*, properties: Mapping[str, Any], required: Sequence[str] = ()) -> ToolSchema:
    payload: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": dict(properties),
    }
    if required:
        payload["required"] = list(required)
    return ToolSchema(schema=payload)


def _message_or_fallback(error: Exception, fallback: str) -> str:
    message = str(error).strip()
    return message or fallback



def _error_diagnostic_context(
    *,
    tool_id: str,
    context: ToolInvocationContext,
    arguments: Mapping[str, Any],
) -> dict[str, Any]:
    return {
        "integration": "blackboard",
        "toolId": tool_id,
        "invocationId": context.invocation_id,
        "argumentKeys": sorted(str(key) for key in arguments.keys()),
    }



def _build_error_details(
    *,
    error: Exception,
    details: Mapping[str, Any] | None = None,
    diagnostic_context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return build_tool_exception_details(
        error=error,
        details=details,
        diagnostic_context=diagnostic_context,
        sanitizer=redact_tool_error_value,
    )



def _normalized_error_with_details(
    *,
    normalized: NormalizedToolError,
    error: Exception,
    diagnostic_context: Mapping[str, Any] | None = None,
) -> NormalizedToolError:
    return NormalizedToolError(
        code=normalized.code,
        message=normalized.message,
        retryable=normalized.retryable,
        details=_build_error_details(
            error=error,
            details=normalized.details,
            diagnostic_context=diagnostic_context,
        ),
    )



def _map_exception(
    error: Exception,
    *,
    diagnostic_context: Mapping[str, Any] | None = None,
) -> NormalizedToolError:
    normalized: NormalizedToolError
    if isinstance(error, MissingHostCapabilityError):
        normalized = NormalizedToolError(
            code="host_capability_missing",
            message=str(error),
            details={"capability": error.capability},
        )
    elif isinstance(error, HostCapabilityOperationError):
        if error.code in {"unsupported_capability", "unsupported_operation"}:
            normalized = NormalizedToolError(
                code="host_capability_missing",
                message=error.message,
                retryable=error.retryable,
                details={"capability": error.capability, "hostErrorCode": error.code, **error.details},
            )
        elif error.code in {"temporarily_unavailable", "timeout"}:
            normalized = NormalizedToolError(
                code=error.code,
                message=error.message,
                retryable=error.retryable,
                details={"capability": error.capability, **error.details},
            )
        elif error.code in {"permission_denied", "not_found", "conflict"}:
            normalized = NormalizedToolError(
                code=error.code,
                message=error.message,
                retryable=error.retryable,
                details={"capability": error.capability, **error.details},
            )
        else:
            normalized = NormalizedToolError(
                code="execution_failed",
                message=error.message,
                retryable=error.retryable,
                details={"capability": error.capability, "hostErrorCode": error.code, **error.details},
            )
    elif isinstance(error, BlackboardAuthenticationError):
        normalized = NormalizedToolError(
            code="authentication_required",
            message=_message_or_fallback(error, "Blackboard credentials are required."),
        )
    elif isinstance(error, ValueError):
        normalized = NormalizedToolError(
            code="invalid_input",
            message=_message_or_fallback(error, "Tool arguments are invalid."),
        )
    elif isinstance(error, PermissionError):
        normalized = NormalizedToolError(
            code="permission_denied",
            message=_message_or_fallback(error, "Blackboard access was denied."),
        )
    elif isinstance(error, httpx.TimeoutException):
        normalized = NormalizedToolError(
            code="timeout",
            message=_message_or_fallback(error, "Blackboard request timed out."),
        )
    elif isinstance(error, httpx.HTTPStatusError):
        status_code = error.response.status_code
        code = "execution_failed"
        if status_code == 401:
            code = "authentication_required"
        elif status_code == 403:
            code = "permission_denied"
        elif status_code == 404:
            code = "not_found"
        elif status_code == 409:
            code = "conflict"
        elif status_code == 429:
            code = "rate_limited"
        elif status_code in {502, 503, 504}:
            code = "temporarily_unavailable"
        normalized = NormalizedToolError(
            code=code,
            message=_message_or_fallback(error, f"Blackboard request failed with {status_code}."),
            details={"statusCode": status_code},
        )
    elif isinstance(error, httpx.HTTPError):
        normalized = NormalizedToolError(
            code="temporarily_unavailable",
            message=_message_or_fallback(error, "Blackboard host is temporarily unavailable."),
        )
    elif isinstance(error, RuntimeError) and "CAS 登录失败" in str(error):
        normalized = NormalizedToolError(code="authentication_required", message=str(error))
    else:
        normalized = NormalizedToolError(
            code="execution_failed",
            message=_message_or_fallback(error, "Blackboard tool execution failed."),
        )
    return _normalized_error_with_details(
        normalized=normalized,
        error=error,
        diagnostic_context=diagnostic_context,
    )


def _emit_event(
    host: ToolHostCapabilities,
    *,
    context: ToolInvocationContext,
    event_type: str,
    message: str,
    data: Mapping[str, Any] | None = None,
) -> None:
    event_sink = host.event_sink
    if event_sink is None:
        return
    try:
        event_sink.emit(
            HostEvent(
                event_type=event_type,
                message=message,
                invocation_id=context.invocation_id,
                data={} if data is None else dict(data),
            )
        )
    except Exception:
        return


class _ResolvedCredentials:
    def __init__(self, *, username: str, password: str, source: str) -> None:
        self.username = username
        self.password = password
        self.source = source


async def _resolve_credentials(
    arguments: Mapping[str, Any],
    host: ToolHostCapabilities,
    *,
    default_username_secret_name: str | None = None,
    default_password_secret_name: str | None = None,
) -> _ResolvedCredentials:
    username = _read_optional_text(arguments, "username")
    password = _read_optional_text(arguments, "password")
    username_secret_name = _read_optional_text(arguments, "usernameSecretName")
    password_secret_name = _read_optional_text(arguments, "passwordSecretName")
    if username_secret_name is None:
        username_secret_name = default_username_secret_name
    if password_secret_name is None:
        password_secret_name = default_password_secret_name
    used_sources: set[str] = set()

    if username is not None:
        used_sources.add("arguments")
    if password is not None:
        used_sources.add("arguments")

    if username is None and username_secret_name is not None:
        secret_provider = host.require_capability("secret_provider")
        username = _normalize_secret(
            await cast(Any, secret_provider).get_secret(name=username_secret_name)
        )
        used_sources.add("host_secrets")
    if password is None and password_secret_name is not None:
        secret_provider = host.require_capability("secret_provider")
        password = _normalize_secret(
            await cast(Any, secret_provider).get_secret(name=password_secret_name)
        )
        used_sources.add("host_secrets")

    if username is None or password is None:
        raise BlackboardAuthenticationError("Blackboard CAS credentials are required.")

    source = "arguments"
    if used_sources == {"host_secrets"}:
        source = "host_secrets"
    elif used_sources == {"arguments", "host_secrets"}:
        source = "mixed"
    return _ResolvedCredentials(username=username, password=password, source=source)


def _normalize_secret(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _reject_explicit_db_path(arguments: Mapping[str, Any]) -> None:
    if _read_optional_text(arguments, "dbPath") is not None:
        raise ValueError(
            "dbPath is no longer supported. Use dbRelativePath anchored under the host database directory."
        )


def _default_blackboard_db_relative_path() -> str:
    return DatabaseManager.DEFAULT_DB_RELATIVE_PATH.as_posix()


def _resolve_db_path(arguments: Mapping[str, Any], host: ToolHostCapabilities) -> Path:
    _reject_explicit_db_path(arguments)
    db_relative_path = _read_optional_text(arguments, "dbRelativePath")
    database_resolver = cast(
        DatabaseResolver,
        host.require_capability("database_resolver"),
    )
    relative_path = db_relative_path or _default_blackboard_db_relative_path()
    return database_resolver.resolve_database_path(relative_path=relative_path)


def _db_path_source(arguments: Mapping[str, Any]) -> str:
    _reject_explicit_db_path(arguments)
    if _read_optional_text(arguments, "dbRelativePath") is not None:
        return "database_relative"
    return "default"


def _read_sql_query_result_limit(arguments: Mapping[str, Any]) -> int:
    raw_limit = _read_optional_int(arguments, "resultLimit")
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
        relative_path=_default_blackboard_db_relative_path()
    )


def _resolve_sql_query_db_path(
    arguments: Mapping[str, Any],
    host: ToolHostCapabilities,
) -> tuple[Path, str, bool]:
    _reject_explicit_db_path(arguments)
    db_relative_path = _read_optional_text(arguments, "dbRelativePath")
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
    return _jsonable(value)


def _sql_row_to_mapping(columns: Sequence[str], row: Sequence[Any]) -> dict[str, Any]:
    return {
        column: _normalize_sql_value(value)
        for column, value in zip(columns, row)
    }


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


async def _persist_state_if_requested(
    *,
    namespace: str,
    arguments: Mapping[str, Any],
    context: ToolInvocationContext,
    host: ToolHostCapabilities,
    output: Mapping[str, Any],
) -> dict[str, Any]:
    state_key = _read_optional_text(arguments, "stateKey")
    if state_key is None:
        return {}

    state_store = host.require_capability("state_store")
    await cast(Any, state_store).put(
        namespace=namespace,
        key=state_key,
        value={
            "context": context.to_dict(),
            "output": dict(output),
        },
    )
    return {
        "stateNamespace": namespace,
        "stateKey": state_key,
    }


async def _persist_artifact_if_requested(
    *,
    arguments: Mapping[str, Any],
    context: ToolInvocationContext,
    host: ToolHostCapabilities,
    output: Mapping[str, Any],
) -> tuple[ToolArtifactReference, ...]:
    artifact_name = _read_optional_text(arguments, "artifactName")
    if artifact_name is None:
        return ()

    artifact_store = cast(ArtifactStore, host.require_capability("artifact_store"))
    artifact = await artifact_store.save_text(
        name=artifact_name,
        text=json.dumps(dict(output), ensure_ascii=False, indent=2, sort_keys=True),
        content_type="application/json",
        metadata={
            "toolId": context.tool_id,
            "invocationId": context.invocation_id,
        },
    )
    return (
        ToolArtifactReference(
            artifact_id=artifact.artifact_id,
            name=artifact.name,
            content_type=artifact.content_type,
            uri=artifact.uri,
            metadata=artifact.metadata,
        ),
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
        text=json.dumps(dict(full_result), ensure_ascii=False, indent=2, sort_keys=True),
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


def _course_catalog_output(
    result: CourseCatalogSearchResult,
) -> dict[str, Any]:
    return {
        "keyword": result.keyword,
        "field": result.field,
        "operator": result.operator,
        "fetchMode": result.fetch_mode,
        "maxPages": result.max_pages,
        "limit": result.limit,
        "total": result.total,
        "results": _jsonable(result.results),
        "logSummary": _jsonable(result.log_summary),
        "logs": _jsonable(result.logs),
    }



def _calendar_refresh_output(result: CalendarICSSyncResult) -> dict[str, Any]:
    return {
        "feedUrl": result.feed_url,
        "refreshMode": result.refresh_mode,
        "dbPath": result.db_path.as_posix(),
        "stats": _jsonable(result.stats),
        "activeEventCount": result.active_event_count,
        "allEventCount": result.all_event_count,
        "activeEvents": _jsonable(result.active_events),
        "logSummary": _jsonable(result.log_summary),
        "logs": _jsonable(result.logs),
    }

def _compact_sync_stats(stats: Mapping[str, Any]) -> dict[str, int]:
    return {
        "inserted": int(stats.get("inserted", 0)),
        "updated": int(stats.get("updated", 0)),
        "deleted": int(stats.get("deleted", 0)),
    }



def _compact_sync_stats_by_table(
    stats_by_table: Mapping[str, Mapping[str, Any]],
) -> dict[str, dict[str, int]]:
    return {
        str(table): _compact_sync_stats(stats)
        for table, stats in stats_by_table.items()
    }



def _snapshot_sync_output(
    report: BlackboardSnapshotSyncReport,
    *,
    progress_messages: Sequence[str],
    persistence: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    _ = progress_messages
    output: dict[str, Any] = {
        "dbPath": report.db_path.as_posix(),
        "scrapedCounts": _jsonable(report.snapshot.scraped_counts()),
        "firstSyncStats": _compact_sync_stats_by_table(report.first_sync_stats),
        "secondSyncStats": (
            None
            if report.second_sync_stats is None
            else _compact_sync_stats_by_table(report.second_sync_stats)
        ),
        "tableCounts": _jsonable(report.table_counts),
        "expectedActiveCounts": _jsonable(report.expected_active_counts),
        "integrityOk": report.integrity_ok,
        "secondSyncHasNoNewRecords": report.second_sync_has_no_new_records(),
        "secondSyncHasNoDeletedRecords": report.second_sync_has_no_deleted_records(),
        "logSummary": _jsonable(report.log_summary),
    }
    if persistence:
        output["persistence"] = _jsonable(persistence)
    return output



def _build_output_persistence_summary(
    *,
    state_payload: Mapping[str, Any] | None,
    artifacts: Sequence[ToolArtifactReference],
) -> dict[str, Any] | None:
    summary: dict[str, Any] = {}
    if isinstance(state_payload, Mapping):
        state_namespace = state_payload.get("stateNamespace")
        state_key = state_payload.get("stateKey")
        if isinstance(state_namespace, str) and isinstance(state_key, str):
            summary["state"] = {
                "namespace": state_namespace,
                "key": state_key,
            }
    if artifacts:
        summary["artifacts"] = [artifact.to_dict() for artifact in artifacts]
    return summary or None



def _snapshot_sync_persisted_output(
    report: BlackboardSnapshotSyncReport,
    *,
    progress_messages: Sequence[str],
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "dbPath": report.db_path.as_posix(),
        "scrapedCounts": _jsonable(report.snapshot.scraped_counts()),
        "firstSyncStats": _jsonable(report.first_sync_stats),
        "secondSyncStats": _jsonable(report.second_sync_stats),
        "tableCounts": _jsonable(report.table_counts),
        "expectedActiveCounts": _jsonable(report.expected_active_counts),
        "integrityOk": report.integrity_ok,
        "secondSyncHasNoNewRecords": report.second_sync_has_no_new_records(),
        "secondSyncHasNoDeletedRecords": report.second_sync_has_no_deleted_records(),
        "logSummary": _jsonable(report.log_summary),
        "logs": _jsonable(report.logs),
    }
    if progress_messages:
        output["progressMessages"] = list(progress_messages)
    return output


def _course_resources_sync_output(
    report: BlackboardCourseResourcesSyncReport,
    *,
    progress_messages: Sequence[str],
    persistence: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    _ = progress_messages
    output: dict[str, Any] = {
        "dbPath": report.db_path.as_posix(),
        "requestedCourseIds": list(report.requested_course_ids),
        "processedCourseIds": list(report.processed_course_ids),
        "missingCourseIds": list(report.missing_course_ids),
        "failedCourseIds": list(report.failed_course_ids),
        "scrapedCounts": _jsonable(report.scraped_counts()),
        "syncStats": _compact_sync_stats_by_table(report.sync_stats),
        "tableCounts": _jsonable(report.table_counts),
        "logSummary": _jsonable(report.log_summary),
    }
    if persistence:
        output["persistence"] = _jsonable(persistence)
    return output



def _course_resources_sync_persisted_output(
    report: BlackboardCourseResourcesSyncReport,
    *,
    progress_messages: Sequence[str],
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "dbPath": report.db_path.as_posix(),
        "requestedCourseIds": list(report.requested_course_ids),
        "processedCourseIds": list(report.processed_course_ids),
        "missingCourseIds": list(report.missing_course_ids),
        "failedCourseIds": list(report.failed_course_ids),
        "scrapedCounts": _jsonable(report.scraped_counts()),
        "syncStats": _jsonable(report.sync_stats),
        "tableCounts": _jsonable(report.table_counts),
        "resourcePayloadsByCourse": _jsonable(report.resource_payloads_by_course),
        "logSummary": _jsonable(report.log_summary),
        "logs": _jsonable(report.logs),
    }
    if progress_messages:
        output["progressMessages"] = list(progress_messages)
    return output


_SQL_QUERY_METADATA = ToolMetadata(
    tool_id="blackboard.sql.query",
    display_name="Blackboard SQL Query",
    description=(
        "Execute raw SQL directly against the local Blackboard SQLite database for inspection and retrieval. "
        "Unless explicitly allowed, avoid DDL, DML, PRAGMA, and ATTACH statements."
    ),
    input_schema=_schema(
        properties={
            "sql": {"type": "string", "minLength": 1},
            "dbRelativePath": {"type": "string"},
            "resultLimit": {"type": "integer"},
            "persistArtifact": {"type": "boolean"},
        },
        required=("sql",),
    ),
    output_schema=_schema(
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


_COURSE_CATALOG_SEARCH_METADATA = ToolMetadata(
    tool_id="blackboard.course_catalog.search",
    display_name="Blackboard Course Catalog Search",
    description=(
        "Search Blackboard course catalog entries with Blackboard CAS credentials. "
        "Use fetchMode=quick for a lighter first-pass search that does not follow show-all, "
        "or fetchMode=full to keep the more complete behavior; maxPages caps pagination depth."
    ),
    input_schema=_schema(
        properties={
            "keyword": {"type": "string", "minLength": 1},
            "field": {"type": "string"},
            "operator": {"type": "string"},
            "fetchMode": {
                "type": "string",
                "enum": ["quick", "full"],
                "default": "full",
                "description": (
                    "quick searches only the initial result pages without following show-all; "
                    "full also follows show-all pagination for more complete results."
                ),
            },
            "maxPages": {
                "type": "integer",
                "minimum": 1,
                "default": 30,
                "description": "Maximum number of result pages to continue fetching before stopping.",
            },
            "limit": {"type": "integer"},
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
        },
        required=("keyword",),
    ),
    output_schema=_schema(
        properties={
            "keyword": {"type": "string"},
            "field": {"type": "string"},
            "operator": {"type": "string"},
            "fetchMode": {"type": "string", "enum": ["quick", "full"]},
            "maxPages": {"type": "integer", "minimum": 1},
            "limit": {"type": ["integer", "null"]},
            "total": {"type": "integer"},
            "results": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
        },
        required=(
            "keyword",
            "field",
            "operator",
            "fetchMode",
            "maxPages",
            "total",
            "results",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve Blackboard CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "catalog", "search"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=True,
)


_CALENDAR_REFRESH_METADATA = ToolMetadata(
    tool_id="blackboard.calendar.refresh",
    display_name="Blackboard Calendar Refresh",
    description=(
        "Refresh a Blackboard ICS subscription into the existing SQLite store. "
        "Use refreshMode=auto for conditional requests with cached validators, "
        "or refreshMode=force to ignore cached validators and re-download the ICS payload."
    ),
    input_schema=_schema(
        properties={
            "feedUrl": {"type": "string", "minLength": 1},
            "refreshMode": {
                "type": "string",
                "enum": ["auto", "force"],
                "default": "auto",
                "description": (
                    "auto reuses saved ETag/Last-Modified headers for conditional refreshes; "
                    "force ignores cached validators and fetches the ICS payload again."
                ),
            },
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "stateKey": {"type": "string"},
        },
        required=("feedUrl",),
    ),
    output_schema=_schema(
        properties={
            "feedUrl": {"type": "string"},
            "refreshMode": {"type": "string", "enum": ["auto", "force"]},
            "dbPath": {"type": "string"},
            "stats": {"type": "object"},
            "activeEventCount": {"type": "integer"},
            "allEventCount": {"type": "integer"},
            "activeEvents": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
        },
        required=(
            "feedUrl",
            "refreshMode",
            "dbPath",
            "stats",
            "activeEventCount",
            "allEventCount",
            "activeEvents",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist calendar refresh summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "calendar", "sync"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=False,
)
_SNAPSHOT_SYNC_METADATA = ToolMetadata(
    tool_id="blackboard.snapshot.sync",
    display_name="Blackboard Snapshot Sync",
    description="Fetch a Blackboard base snapshot and sync it into the existing SQLite store.",
    input_schema=_schema(
        properties={
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "verifySecondSync": {"type": "boolean"},
            "stateKey": {"type": "string"},
            "artifactName": {"type": "string"},
        },
    ),
    output_schema=_schema(
        properties={
            "dbPath": {"type": "string"},
            "scrapedCounts": {"type": "object"},
            "firstSyncStats": {"type": "object"},
            "secondSyncStats": {"type": ["object", "null"]},
            "tableCounts": {"type": "object"},
            "expectedActiveCounts": {"type": "object"},
            "integrityOk": {"type": "boolean"},
            "secondSyncHasNoNewRecords": {"type": "boolean"},
            "secondSyncHasNoDeletedRecords": {"type": "boolean"},
            "logSummary": {"type": "object"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "dbPath",
            "scrapedCounts",
            "firstSyncStats",
            "secondSyncStats",
            "tableCounts",
            "expectedActiveCounts",
            "integrityOk",
            "secondSyncHasNoNewRecords",
            "secondSyncHasNoDeletedRecords",
            "logSummary",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve Blackboard CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist snapshot sync summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist snapshot sync summaries as host-owned artifacts.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "snapshot", "sync"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=False,
)

_RESOURCE_SYNC_METADATA = ToolMetadata(
    tool_id="blackboard.course_resources.sync",
    display_name="Blackboard Course Resources Sync",
    description="Sync Blackboard resources for explicit course IDs into the existing SQLite store.",
    input_schema=_schema(
        properties={
            "courseIds": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "minItems": 1,
                "uniqueItems": True,
            },
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "stateKey": {"type": "string"},
            "artifactName": {"type": "string"},
        },
        required=("courseIds",),
    ),
    output_schema=_schema(
        properties={
            "dbPath": {"type": "string"},
            "requestedCourseIds": {"type": "array"},
            "processedCourseIds": {"type": "array"},
            "missingCourseIds": {"type": "array"},
            "failedCourseIds": {"type": "array"},
            "scrapedCounts": {"type": "object"},
            "syncStats": {"type": "object"},
            "tableCounts": {"type": "object"},
            "logSummary": {"type": "object"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "dbPath",
            "requestedCourseIds",
            "processedCourseIds",
            "missingCourseIds",
            "failedCourseIds",
            "scrapedCounts",
            "syncStats",
            "tableCounts",
            "logSummary",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve Blackboard CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist course resource sync summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist course resource sync summaries as host-owned artifacts.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("blackboard", "course_resources", "sync"),
    annotations={"domain": "blackboard", "facade": "tool-contract"},
    idempotent=False,
)


class BlackboardCourseCatalogSearchTool(_BlackboardFacadeToolBase):
    _metadata = _COURSE_CATALOG_SEARCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        _ = context
        credentials = await _resolve_credentials(arguments, host)
        keyword = _read_required_text(arguments, "keyword")
        field = _read_optional_text(arguments, "field") or "CourseName"
        operator = _read_optional_text(arguments, "operator") or "Contains"
        fetch_mode = _read_choice(arguments, "fetchMode", choices=("quick", "full"), default="full")
        raw_max_pages = _read_optional_int(arguments, "maxPages")
        max_pages = 30 if raw_max_pages is None else raw_max_pages
        if max_pages <= 0:
            raise ValueError("maxPages must be a positive integer.")
        raw_limit = _read_optional_int(arguments, "limit")
        limit = raw_limit if raw_limit is not None and raw_limit > 0 else None
        result = await asyncio.to_thread(
            search_course_catalog_with_credentials,
            credentials.username,
            credentials.password,
            keyword=keyword,
            field=field,
            operator=operator,
            limit=limit,
            fetch_mode=fetch_mode,
            max_pages=max_pages,
        )
        return (
            _course_catalog_output(result),
            (),
            {"credentialSource": credentials.source},
        )


class BlackboardCalendarRefreshTool(_BlackboardFacadeToolBase):
    _metadata = _CALENDAR_REFRESH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        feed_url = _read_required_text(arguments, "feedUrl")
        refresh_mode = _read_choice(arguments, "refreshMode", choices=("auto", "force"), default="auto")
        db_path = _resolve_db_path(arguments, host)
        reset_schema = _read_bool(arguments, "resetSchema", default=False)
        result = await asyncio.to_thread(
            refresh_calendar_ics_subscription,
            feed_url,
            db_path=db_path,
            reset_schema=reset_schema,
            refresh_mode=refresh_mode,
        )
        output = _calendar_refresh_output(result)
        metadata = {
            "dbPathSource": _db_path_source(arguments),
        }
        metadata.update(
            await _persist_state_if_requested(
                namespace=_STATE_NAMESPACE_CALENDAR_REFRESH,
                arguments=arguments,
                context=context,
                host=host,
                output=output,
            )
        )
        return output, (), metadata


class BlackboardSnapshotSyncTool(_BlackboardFacadeToolBase):
    _metadata = _SNAPSHOT_SYNC_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        credentials = await _resolve_credentials(
            arguments,
            host,
            default_username_secret_name=_DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        db_path = _resolve_db_path(arguments, host)
        reset_schema = _read_bool(arguments, "resetSchema", default=False)
        verify_second_sync = _read_bool(arguments, "verifySecondSync", default=True)
        progress_messages: list[str] = []
        report = await asyncio.to_thread(
            run_blackboard_snapshot_sync,
            credentials.username,
            credentials.password,
            db_path=db_path,
            reset_schema=reset_schema,
            verify_second_sync=verify_second_sync,
            progress=progress_messages.append,
        )
        output = _snapshot_sync_output(report, progress_messages=progress_messages)
        persist_details = (
            _read_optional_text(arguments, "stateKey") is not None
            or _read_optional_text(arguments, "artifactName") is not None
        )
        persisted_output = (
            _snapshot_sync_persisted_output(report, progress_messages=progress_messages)
            if persist_details
            else output
        )
        metadata = {
            "credentialSource": credentials.source,
            "dbPathSource": _db_path_source(arguments),
        }
        state_payload = await _persist_state_if_requested(
            namespace=_STATE_NAMESPACE_SNAPSHOT_SYNC,
            arguments=arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        metadata.update(state_payload)
        artifacts = await _persist_artifact_if_requested(
            arguments=arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        persistence_summary = _build_output_persistence_summary(
            state_payload=state_payload,
            artifacts=artifacts,
        )
        if persistence_summary is not None:
            output = _snapshot_sync_output(
                report,
                progress_messages=progress_messages,
                persistence=persistence_summary,
            )
        return output, artifacts, metadata


class BlackboardCourseResourcesSyncTool(_BlackboardFacadeToolBase):
    _metadata = _RESOURCE_SYNC_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        credentials = await _resolve_credentials(
            arguments,
            host,
            default_username_secret_name=_DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        course_ids = _read_required_string_list(arguments, "courseIds")
        db_path = _resolve_db_path(arguments, host)
        reset_schema = _read_bool(arguments, "resetSchema", default=False)
        progress_messages: list[str] = []
        report = await asyncio.to_thread(
            run_blackboard_course_resources_sync,
            credentials.username,
            credentials.password,
            course_ids=course_ids,
            db_path=db_path,
            reset_schema=reset_schema,
            progress=progress_messages.append,
        )
        output = _course_resources_sync_output(report, progress_messages=progress_messages)
        persist_details = (
            _read_optional_text(arguments, "stateKey") is not None
            or _read_optional_text(arguments, "artifactName") is not None
        )
        persisted_output = (
            _course_resources_sync_persisted_output(report, progress_messages=progress_messages)
            if persist_details
            else output
        )
        metadata = {
            "credentialSource": credentials.source,
            "dbPathSource": _db_path_source(arguments),
        }
        state_payload = await _persist_state_if_requested(
            namespace=_STATE_NAMESPACE_COURSE_RESOURCES_SYNC,
            arguments=arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        metadata.update(state_payload)
        artifacts = await _persist_artifact_if_requested(
            arguments=arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        persistence_summary = _build_output_persistence_summary(
            state_payload=state_payload,
            artifacts=artifacts,
        )
        if persistence_summary is not None:
            output = _course_resources_sync_output(
                report,
                progress_messages=progress_messages,
                persistence=persistence_summary,
            )
        return output, artifacts, metadata


class BlackboardSQLQueryTool(_BlackboardFacadeToolBase):
    _metadata = _SQL_QUERY_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        sql = _read_required_text(arguments, "sql")
        result_limit = _read_sql_query_result_limit(arguments)
        persist_artifact = _read_bool(arguments, "persistArtifact", default=False)
        db_path, db_path_source, used_default_database = _resolve_sql_query_db_path(arguments, host)
        query_output, full_result = await asyncio.to_thread(
            _execute_sql_query,
            sql=sql,
            db_path=db_path,
            result_limit=result_limit,
        )
        output: dict[str, Any] = {
            "sql": sql,
            "database": {
                "path": db_path.as_posix(),
                "source": db_path_source,
            },
            "usedDefaultDatabase": used_default_database,
            **query_output,
            "artifact": None,
        }
        artifact_payload: dict[str, Any] | None = None
        if full_result is not None:
            artifact_payload = {
                "sql": sql,
                "database": {
                    "path": db_path.as_posix(),
                    "source": db_path_source,
                },
                "usedDefaultDatabase": used_default_database,
                **full_result,
            }
        artifact_output, artifacts = await _persist_sql_query_artifact_if_requested(
            persist_artifact=persist_artifact,
            context=context,
            host=host,
            output=output,
            full_result=artifact_payload,
        )
        output["artifact"] = artifact_output
        return output, artifacts, {
            "dbPathSource": db_path_source,
            "persistArtifactRequested": persist_artifact,
        }


BLACKBOARD_FACADE_TOOLS: tuple[ToolContract, ...] = (
    BlackboardCourseCatalogSearchTool(),
    BlackboardCalendarRefreshTool(),
    BlackboardSnapshotSyncTool(),
    BlackboardCourseResourcesSyncTool(),
    BlackboardSQLQueryTool(),
)


def get_blackboard_tool_contracts() -> tuple[ToolContract, ...]:
    """Return stable Blackboard tool-contract facades for runtime or transport adapters."""

    return BLACKBOARD_FACADE_TOOLS


__all__ = [
    "BLACKBOARD_FACADE_TOOLS",
    "BlackboardCalendarRefreshTool",
    "BlackboardCourseCatalogSearchTool",
    "BlackboardCourseResourcesSyncTool",
    "BlackboardSnapshotSyncTool",
    "BlackboardSQLQueryTool",
    "get_blackboard_tool_contracts",
]

