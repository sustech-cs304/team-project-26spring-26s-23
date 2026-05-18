"""Tool-contract facade for selected Blackboard domain capabilities.

This module is the stable entry-point for the Blackboard tool facade.
Domain-specific implementations live in sibling submodules:
  - course_catalog.py  (course catalog search)
  - calendar_refresh.py (calendar ICS refresh)
  - data_sync.py        (snapshot sync)
  - course_resources.py (course resources sync)
  - sql_query.py        (SQL query / introspection)

Only shared infrastructure, stable re-exports, and thin orchestration
remain in this file.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Literal, cast

import httpx
from pydantic import Field, field_validator

from app.integrations.sustech.facade_contract_models import (
    ResolvedCredentialContract,
    SustechToolArgumentsModel,
    SustechToolBoundaryModel,
)
from app.integrations.sustech.blackboard.data.db_manager import DatabaseManager
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
    HostEvent,
    MissingHostCapabilityError,
    NormalizedToolError,
    NormalizedToolErrorCode,
    ToolArtifactReference,
    ToolContract,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
    ToolResultEnvelope,
    ToolSchema,
)
from app.tooling.contract.errors import (
    build_tool_exception_details,
    redact_tool_error_value,
)

# ---------------------------------------------------------------------------
# State namespace constants
# ---------------------------------------------------------------------------

_STATE_NAMESPACE_CALENDAR_REFRESH = "blackboard.calendar_refresh"
_STATE_NAMESPACE_SNAPSHOT_SYNC = "blackboard.snapshot_sync"
_STATE_NAMESPACE_COURSE_RESOURCES_SYNC = "blackboard.course_resources_sync"
_LATEST_STATUS_STATE_KEY = "latest_status"
# Bandit B105 false positive: these are config/secret registry key names, not credentials.
_DEFAULT_SUSTECH_USERNAME_SECRET_NAME = "sustech.username"  # nosec B105
_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME = "sustech.casPassword"  # nosec B105


# ---------------------------------------------------------------------------
# Shared exception
# ---------------------------------------------------------------------------


class BlackboardAuthenticationError(RuntimeError):
    """Raised when Blackboard credentials cannot be resolved or authenticated."""


# ---------------------------------------------------------------------------
# Base tool class (shared decorator / lifecycle)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Shared argument readers / normalizers
# ---------------------------------------------------------------------------


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


def _read_required_string_list(
    arguments: Mapping[str, Any], field_name: str
) -> list[str]:
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
        raise ValueError(
            f"{field_name} must be one of: {', '.join(normalized_choices)}."
        )
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


def _schema(
    *, properties: Mapping[str, Any], required: Sequence[str] = ()
) -> ToolSchema:
    payload: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": dict(properties),
    }
    if required:
        payload["required"] = list(required)
    return ToolSchema(schema=payload)


# Shared type aliases
JsonObject = dict[str, Any]
JsonArray = list[Any]
BlackboardFetchMode = Literal["quick", "full"]
BlackboardCalendarRefreshMode = Literal["auto", "force"]


def _normalize_optional_text_value(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_required_text_value(value: Any, field_name: str) -> str:
    normalized = _normalize_optional_text_value(value)
    if normalized is None:
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_optional_int_value(value: Any, field_name: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer.")
    try:
        return int(value)
    except (TypeError, ValueError) as ex:
        raise ValueError(f"{field_name} must be an integer.") from ex


def _normalize_bool_value(value: Any, field_name: str, *, default: bool) -> bool:
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


def _normalize_choice_value(
    value: Any,
    field_name: str,
    *,
    choices: Sequence[str],
    default: str,
) -> str:
    normalized = _normalize_optional_text_value(value)
    if normalized is None:
        return default

    lowered = normalized.lower()
    normalized_choices = tuple(str(item).lower() for item in choices)
    if lowered not in normalized_choices:
        raise ValueError(
            f"{field_name} must be one of: {', '.join(normalized_choices)}."
        )
    return lowered


def _normalize_required_string_list_value(
    value: Any,
    field_name: str,
) -> list[str]:
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


# ---------------------------------------------------------------------------
# Shared argument models
# ---------------------------------------------------------------------------


class _BlackboardToolArguments(SustechToolArgumentsModel):
    username: str | None = None
    password: str | None = None
    usernameSecretName: str | None = None
    passwordSecretName: str | None = None
    dbRelativePath: str | None = None
    dbPath: str | None = None
    stateKey: str | None = None
    artifactName: str | None = None

    @field_validator(
        "username",
        "password",
        "usernameSecretName",
        "passwordSecretName",
        "dbRelativePath",
        "dbPath",
        "stateKey",
        "artifactName",
        mode="before",
    )
    @classmethod
    def _normalize_optional_text_fields(cls, value: Any) -> str | None:
        return _normalize_optional_text_value(value)


# ---------------------------------------------------------------------------
# Shared output models
# ---------------------------------------------------------------------------


class _SyncStatsSummary(SustechToolBoundaryModel):
    inserted: int
    updated: int
    deleted: int


class _PersistenceStateSummary(SustechToolBoundaryModel):
    namespace: str
    key: str


class _PersistenceSummary(SustechToolBoundaryModel):
    state: _PersistenceStateSummary | None = None
    artifacts: list[JsonObject] = Field(default_factory=list)

    def to_optional_contract_dict(self) -> dict[str, Any] | None:
        if self.state is None and not self.artifacts:
            return None
        exclude: set[str] = set()
        if self.state is None:
            exclude.add("state")
        if not self.artifacts:
            exclude.add("artifacts")
        return self.to_contract_dict(exclude=exclude)


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


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
                details={
                    "capability": error.capability,
                    "hostErrorCode": error.code,
                    **error.details,
                },
            )
        elif error.code in {"temporarily_unavailable", "timeout"}:
            normalized = NormalizedToolError(
                code=cast(NormalizedToolErrorCode, error.code),
                message=error.message,
                retryable=error.retryable,
                details={"capability": error.capability, **error.details},
            )
        elif error.code in {"permission_denied", "not_found", "conflict"}:
            normalized = NormalizedToolError(
                code=cast(NormalizedToolErrorCode, error.code),
                message=error.message,
                retryable=error.retryable,
                details={"capability": error.capability, **error.details},
            )
        else:
            normalized = NormalizedToolError(
                code="execution_failed",
                message=error.message,
                retryable=error.retryable,
                details={
                    "capability": error.capability,
                    "hostErrorCode": error.code,
                    **error.details,
                },
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
        code: NormalizedToolErrorCode = "execution_failed"
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
            message=_message_or_fallback(
                error, f"Blackboard request failed with {status_code}."
            ),
            details={"statusCode": status_code},
        )
    elif isinstance(error, httpx.HTTPError):
        normalized = NormalizedToolError(
            code="temporarily_unavailable",
            message=_message_or_fallback(
                error, "Blackboard host is temporarily unavailable."
            ),
        )
    elif isinstance(error, RuntimeError) and "CAS 登录失败" in str(error):
        normalized = NormalizedToolError(
            code="authentication_required", message=str(error)
        )
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


# ---------------------------------------------------------------------------
# Event emission
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Credential resolution
# ---------------------------------------------------------------------------


async def _resolve_credentials(
    arguments: Mapping[str, Any],
    host: ToolHostCapabilities,
    *,
    default_username_secret_name: str | None = None,
    default_password_secret_name: str | None = None,
) -> ResolvedCredentialContract:
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
    return ResolvedCredentialContract(
        username=username, password=password, source=source
    )


def _normalize_secret(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


# ---------------------------------------------------------------------------
# Database path resolution
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Shared persistence helpers
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Shared sync helpers
# ---------------------------------------------------------------------------


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


def _sync_stats_summary_models(
    stats_by_table: Mapping[str, Mapping[str, Any]],
) -> dict[str, _SyncStatsSummary]:
    return {
        str(table): _SyncStatsSummary(**_compact_sync_stats(stats))
        for table, stats in stats_by_table.items()
    }


def _build_output_persistence_summary(
    *,
    state_payload: Mapping[str, Any] | None,
    artifacts: Sequence[ToolArtifactReference],
) -> dict[str, Any] | None:
    state_summary: _PersistenceStateSummary | None = None
    if isinstance(state_payload, Mapping):
        state_namespace = state_payload.get("stateNamespace")
        state_key = state_payload.get("stateKey")
        if isinstance(state_namespace, str) and isinstance(state_key, str):
            state_summary = _PersistenceStateSummary(
                namespace=state_namespace,
                key=state_key,
            )
    return _PersistenceSummary(
        state=state_summary,
        artifacts=[artifact.to_dict() for artifact in artifacts],
    ).to_optional_contract_dict()


# ---------------------------------------------------------------------------
# Re-export use case functions so that callers (including tests) can
# monkeypatch them through the facade module entry point.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Thin orchestration — import sub-domain implementations and re-export
# ---------------------------------------------------------------------------

from .calendar_refresh import BlackboardCalendarRefreshTool  # noqa: E402
from .course_catalog import BlackboardCourseCatalogSearchTool  # noqa: E402
from .course_resources import BlackboardCourseResourcesSyncTool  # noqa: E402
from .data_sync import BlackboardSnapshotSyncTool  # noqa: E402
from .sql_query import BlackboardSQLQueryTool  # noqa: E402

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
    "refresh_calendar_ics_subscription",
    "run_blackboard_course_resources_sync",
    "run_blackboard_snapshot_sync",
    "search_course_catalog_with_credentials",
    "get_blackboard_tool_contracts",
]
