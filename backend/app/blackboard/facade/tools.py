"""Tool-contract facade for selected Blackboard domain capabilities."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import httpx

from app.blackboard.provider.results import (
    BlackboardSnapshotSyncReport,
    CalendarICSSyncResult,
    CourseCatalogSearchResult,
)
from app.blackboard.provider.use_cases import (
    refresh_calendar_ics_subscription,
    run_blackboard_snapshot_sync,
    search_course_catalog_with_credentials,
)
from app.tooling import (
    ArtifactStore,
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
    WorkspaceResolver,
)

_STATE_NAMESPACE_CALENDAR_REFRESH = "blackboard.calendar_refresh"
_STATE_NAMESPACE_SNAPSHOT_SYNC = "blackboard.snapshot_sync"


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
            error = _map_exception(ex)
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


def _map_exception(error: Exception) -> NormalizedToolError:
    if isinstance(error, MissingHostCapabilityError):
        return NormalizedToolError(
            code="host_capability_missing",
            message=str(error),
            details={"capability": error.capability},
        )
    if isinstance(error, BlackboardAuthenticationError):
        return NormalizedToolError(
            code="authentication_required",
            message=_message_or_fallback(error, "Blackboard credentials are required."),
        )
    if isinstance(error, ValueError):
        return NormalizedToolError(
            code="invalid_input",
            message=_message_or_fallback(error, "Tool arguments are invalid."),
        )
    if isinstance(error, PermissionError):
        return NormalizedToolError(
            code="permission_denied",
            message=_message_or_fallback(error, "Blackboard access was denied."),
        )
    if isinstance(error, httpx.TimeoutException):
        return NormalizedToolError(
            code="timeout",
            message=_message_or_fallback(error, "Blackboard request timed out."),
        )
    if isinstance(error, httpx.HTTPStatusError):
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
        return NormalizedToolError(
            code=code,
            message=_message_or_fallback(error, f"Blackboard request failed with {status_code}."),
            details={"statusCode": status_code},
        )
    if isinstance(error, httpx.HTTPError):
        return NormalizedToolError(
            code="temporarily_unavailable",
            message=_message_or_fallback(error, "Blackboard host is temporarily unavailable."),
        )
    if isinstance(error, RuntimeError) and "CAS 登录失败" in str(error):
        return NormalizedToolError(code="authentication_required", message=str(error))
    return NormalizedToolError(
        code="execution_failed",
        message=_message_or_fallback(error, "Blackboard tool execution failed."),
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
) -> _ResolvedCredentials:
    username = _read_optional_text(arguments, "username")
    password = _read_optional_text(arguments, "password")
    username_secret_name = _read_optional_text(arguments, "usernameSecretName")
    password_secret_name = _read_optional_text(arguments, "passwordSecretName")
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


def _resolve_db_path(arguments: Mapping[str, Any], host: ToolHostCapabilities) -> Path | None:
    db_relative_path = _read_optional_text(arguments, "dbRelativePath")
    if db_relative_path is not None:
        workspace_resolver = cast(
            WorkspaceResolver,
            host.require_capability("workspace_resolver"),
        )
        return workspace_resolver.resolve_workspace_path(relative_path=db_relative_path)

    db_path = _read_optional_text(arguments, "dbPath")
    if db_path is None:
        return None
    return Path(db_path)


def _db_path_source(arguments: Mapping[str, Any]) -> str:
    if _read_optional_text(arguments, "dbRelativePath") is not None:
        return "workspace"
    if _read_optional_text(arguments, "dbPath") is not None:
        return "argument"
    return "default"


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


def _course_catalog_output(
    result: CourseCatalogSearchResult,
) -> dict[str, Any]:
    return {
        "keyword": result.keyword,
        "field": result.field,
        "operator": result.operator,
        "limit": result.limit,
        "total": result.total,
        "results": _jsonable(result.results),
        "logSummary": _jsonable(result.log_summary),
        "logs": _jsonable(result.logs),
    }


def _calendar_refresh_output(result: CalendarICSSyncResult) -> dict[str, Any]:
    return {
        "feedUrl": result.feed_url,
        "dbPath": result.db_path.as_posix(),
        "stats": _jsonable(result.stats),
        "activeEventCount": result.active_event_count,
        "allEventCount": result.all_event_count,
        "activeEvents": _jsonable(result.active_events),
        "logSummary": _jsonable(result.log_summary),
        "logs": _jsonable(result.logs),
    }


def _snapshot_sync_output(
    report: BlackboardSnapshotSyncReport,
    *,
    progress_messages: Sequence[str],
) -> dict[str, Any]:
    output: dict[str, Any] = {
        "dbPath": report.db_path.as_posix(),
        "resourceCourseLimit": report.snapshot.resource_course_limit,
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


_COURSE_CATALOG_SEARCH_METADATA = ToolMetadata(
    tool_id="blackboard.course_catalog.search",
    display_name="Blackboard Course Catalog Search",
    description="Search Blackboard course catalog entries with Blackboard CAS credentials.",
    input_schema=_schema(
        properties={
            "keyword": {"type": "string", "minLength": 1},
            "field": {"type": "string"},
            "operator": {"type": "string"},
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
            "limit": {"type": ["integer", "null"]},
            "total": {"type": "integer"},
            "results": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
        },
        required=("keyword", "field", "operator", "total", "results", "logSummary", "logs"),
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
    description="Refresh a Blackboard ICS subscription into the existing SQLite store.",
    input_schema=_schema(
        properties={
            "feedUrl": {"type": "string", "minLength": 1},
            "dbPath": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "stateKey": {"type": "string"},
        },
        required=("feedUrl",),
    ),
    output_schema=_schema(
        properties={
            "feedUrl": {"type": "string"},
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
            capability="workspace_resolver",
            required=False,
            purpose="Resolve a host workspace-relative SQLite path when dbRelativePath is used.",
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
    description="Fetch a Blackboard snapshot and sync it into the existing SQLite store.",
    input_schema=_schema(
        properties={
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
            "dbPath": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "resourceCourseLimit": {"type": "integer"},
            "verifySecondSync": {"type": "boolean"},
            "stateKey": {"type": "string"},
            "artifactName": {"type": "string"},
        },
    ),
    output_schema=_schema(
        properties={
            "dbPath": {"type": "string"},
            "resourceCourseLimit": {"type": "integer"},
            "scrapedCounts": {"type": "object"},
            "firstSyncStats": {"type": "object"},
            "secondSyncStats": {"type": ["object", "null"]},
            "tableCounts": {"type": "object"},
            "expectedActiveCounts": {"type": "object"},
            "integrityOk": {"type": "boolean"},
            "secondSyncHasNoNewRecords": {"type": "boolean"},
            "secondSyncHasNoDeletedRecords": {"type": "boolean"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
            "progressMessages": {"type": "array"},
        },
        required=(
            "dbPath",
            "resourceCourseLimit",
            "scrapedCounts",
            "firstSyncStats",
            "secondSyncStats",
            "tableCounts",
            "expectedActiveCounts",
            "integrityOk",
            "secondSyncHasNoNewRecords",
            "secondSyncHasNoDeletedRecords",
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
            capability="workspace_resolver",
            required=False,
            purpose="Resolve a host workspace-relative SQLite path when dbRelativePath is used.",
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
        db_path = _resolve_db_path(arguments, host)
        reset_schema = _read_bool(arguments, "resetSchema", default=False)
        result = await asyncio.to_thread(
            refresh_calendar_ics_subscription,
            feed_url,
            db_path=db_path,
            reset_schema=reset_schema,
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
        credentials = await _resolve_credentials(arguments, host)
        db_path = _resolve_db_path(arguments, host)
        reset_schema = _read_bool(arguments, "resetSchema", default=False)
        raw_resource_course_limit = _read_optional_int(arguments, "resourceCourseLimit")
        resource_course_limit = 3 if raw_resource_course_limit is None else max(raw_resource_course_limit, 0)
        verify_second_sync = _read_bool(arguments, "verifySecondSync", default=True)
        progress_messages: list[str] = []
        report = await asyncio.to_thread(
            run_blackboard_snapshot_sync,
            credentials.username,
            credentials.password,
            db_path=db_path,
            reset_schema=reset_schema,
            resource_course_limit=resource_course_limit,
            verify_second_sync=verify_second_sync,
            progress=progress_messages.append,
        )
        output = _snapshot_sync_output(report, progress_messages=progress_messages)
        metadata = {
            "credentialSource": credentials.source,
            "dbPathSource": _db_path_source(arguments),
        }
        metadata.update(
            await _persist_state_if_requested(
                namespace=_STATE_NAMESPACE_SNAPSHOT_SYNC,
                arguments=arguments,
                context=context,
                host=host,
                output=output,
            )
        )
        artifacts = await _persist_artifact_if_requested(
            arguments=arguments,
            context=context,
            host=host,
            output=output,
        )
        return output, artifacts, metadata


BLACKBOARD_FACADE_TOOLS: tuple[ToolContract, ...] = (
    BlackboardCourseCatalogSearchTool(),
    BlackboardCalendarRefreshTool(),
    BlackboardSnapshotSyncTool(),
)


def get_blackboard_tool_contracts() -> tuple[ToolContract, ...]:
    """Return stable Blackboard tool-contract facades for runtime or transport adapters."""

    return BLACKBOARD_FACADE_TOOLS


__all__ = [
    "BLACKBOARD_FACADE_TOOLS",
    "BlackboardCalendarRefreshTool",
    "BlackboardCourseCatalogSearchTool",
    "BlackboardSnapshotSyncTool",
    "get_blackboard_tool_contracts",
]
