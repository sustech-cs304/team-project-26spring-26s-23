"""Tool-contract facade for selected TIS domain capabilities."""

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
from pydantic import Field, field_validator

from app.integrations.sustech.facade_contract_models import (
    ResolvedCredentialContract,
    SustechToolArgumentsModel,
    SustechToolBoundaryModel,
    parse_tool_arguments,
)

from app.integrations.sustech.teaching_information_system.api.dto import (
    TISCreditGPAQueryResult,
    TISGradeQueryResult,
    TISSelectedCoursesQueryResult,
)
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.provider.use_cases import (
    fetch_credit_gpa_with_credentials,
    fetch_personal_grades_with_credentials,
    fetch_selected_courses_with_credentials,
)
from app.integrations.sustech.teaching_information_system.shared import TISLogEvent
from app.tooling import (
    ArtifactStore,
    DatabaseResolver,
    HostCapabilityOperationError,
    HostCapabilityRequirement,
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

_STATE_NAMESPACE_PERSONAL_GRADES = "tis.personal_grades.fetch"
_STATE_NAMESPACE_CREDIT_GPA = "tis.credit_gpa.fetch"
_STATE_NAMESPACE_SELECTED_COURSES = "tis.selected_courses.fetch"


def _build_secret_registry_key(namespace: str, key_name: str) -> str:
    """Build host secret registry keys without embedding credentials in code."""

    return f"{namespace}.{key_name}"


# Host-side secret registry key names for credential lookup, not credential values.
_DEFAULT_SUSTECH_USERNAME_SECRET_NAME = _build_secret_registry_key(
    "sustech", "username"
)
_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME = _build_secret_registry_key(
    "sustech", "casPassword"
)


class TISAuthenticationError(RuntimeError):
    """Raised when TIS credentials cannot be resolved or authenticated."""


class _TISFacadeToolBase:
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


JsonObject = dict[str, Any]
JsonArray = list[Any]


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


class _TISToolArguments(SustechToolArgumentsModel):
    username: str | None = None
    password: str | None = None
    usernameSecretName: str | None = None
    passwordSecretName: str | None = None
    roleCode: str | None = None
    persist: bool = False
    ownerKey: str | None = None
    dbRelativePath: str | None = None
    dbPath: str | None = None
    resetSchema: bool | None = None
    stateKey: str | None = None
    artifactName: str | None = None

    @field_validator(
        "username",
        "password",
        "usernameSecretName",
        "passwordSecretName",
        "roleCode",
        "ownerKey",
        "dbRelativePath",
        "dbPath",
        "stateKey",
        "artifactName",
        mode="before",
    )
    @classmethod
    def _normalize_optional_text_fields(cls, value: Any) -> str | None:
        return _normalize_optional_text_value(value)

    @field_validator("persist", mode="before")
    @classmethod
    def _normalize_persist(cls, value: Any) -> bool:
        return _normalize_bool_value(value, "persist", default=False)

    @field_validator("resetSchema", mode="before")
    @classmethod
    def _normalize_reset_schema(cls, value: Any) -> bool | None:
        if value is None:
            return None
        return _normalize_bool_value(value, "resetSchema", default=False)


class _TISPersonalGradesFetchArguments(_TISToolArguments):
    pass


class _TISCreditGPAFetchArguments(_TISToolArguments):
    pass


class _TISSelectedCoursesFetchArguments(_TISToolArguments):
    semester: str | None = None
    pageNum: int = 1
    pageSize: int = 19

    @field_validator("semester", mode="before")
    @classmethod
    def _normalize_semester(cls, value: Any) -> str | None:
        return _normalize_optional_text_value(value)

    @field_validator("pageNum", mode="before")
    @classmethod
    def _normalize_page_num(cls, value: Any) -> int:
        normalized = _normalize_optional_int_value(value, "pageNum")
        return 1 if normalized is None else normalized

    @field_validator("pageSize", mode="before")
    @classmethod
    def _normalize_page_size(cls, value: Any) -> int:
        normalized = _normalize_optional_int_value(value, "pageSize")
        return 19 if normalized is None else normalized

    @field_validator("pageNum")
    @classmethod
    def _validate_page_num(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("pageNum must be a positive integer.")
        return value

    @field_validator("pageSize")
    @classmethod
    def _validate_page_size(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("pageSize must be a positive integer.")
        return value


class _TISSQLQueryArguments(SustechToolArgumentsModel):
    sql: str = Field(default="", validate_default=True)
    dbRelativePath: str | None = None
    dbPath: str | None = None
    resultLimit: int = 50
    persistArtifact: bool = False

    @field_validator("sql", mode="before")
    @classmethod
    def _normalize_sql(cls, value: Any) -> str:
        return _normalize_required_text_value(value, "sql")

    @field_validator("dbRelativePath", "dbPath", mode="before")
    @classmethod
    def _normalize_optional_text_fields(cls, value: Any) -> str | None:
        return _normalize_optional_text_value(value)

    @field_validator("resultLimit", mode="before")
    @classmethod
    def _normalize_result_limit(cls, value: Any) -> int:
        normalized = _normalize_optional_int_value(value, "resultLimit")
        return 50 if normalized is None else normalized

    @field_validator("resultLimit")
    @classmethod
    def _validate_result_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("resultLimit must be a positive integer.")
        return value

    @field_validator("persistArtifact", mode="before")
    @classmethod
    def _normalize_persist_artifact(cls, value: Any) -> bool:
        return _normalize_bool_value(value, "persistArtifact", default=False)


class _PersistenceStateSummary(SustechToolBoundaryModel):
    namespace: str
    key: str


class _TISOutputPersistence(SustechToolBoundaryModel):
    details: JsonObject = Field(default_factory=dict)
    state: _PersistenceStateSummary | None = None
    artifacts: list[JsonObject] = Field(default_factory=list)

    def to_optional_contract_dict(self) -> dict[str, Any] | None:
        persistence: dict[str, Any] = dict(self.details)
        if self.state is not None:
            persistence["state"] = self.state.to_contract_dict()
        if self.artifacts:
            persistence["artifacts"] = list(self.artifacts)
        return persistence or None


class _TISPersonalGradesOutput(SustechToolBoundaryModel):
    sourceUrl: str
    totalRecords: int
    terms: list[str]
    counts: JsonObject
    resolvedRoleCode: str | None = None
    logSummary: JsonObject
    persistence: JsonObject | None = None


class _TISPersonalGradesPersistedOutput(SustechToolBoundaryModel):
    sourceUrl: str
    totalRecords: int
    resolvedRoleCode: str | None = None
    homepage: JsonObject
    gradeRecords: JsonArray
    probes: JsonArray
    logSummary: JsonObject
    logs: JsonArray
    persistence: JsonObject | None = None


class _TISCreditGPAOutput(SustechToolBoundaryModel):
    sourceUrl: str
    pageUrl: str
    apiUrl: str
    resolvedRoleCode: str | None = None
    summary: JsonObject
    counts: JsonObject
    logSummary: JsonObject
    persistence: JsonObject | None = None


class _TISCreditGPAPersistedOutput(SustechToolBoundaryModel):
    sourceUrl: str
    pageUrl: str
    apiUrl: str
    resolvedRoleCode: str | None = None
    homepage: JsonObject
    summary: JsonObject
    termRecords: JsonArray
    yearRecords: JsonArray
    probes: JsonArray
    logSummary: JsonObject
    logs: JsonArray
    persistence: JsonObject | None = None


class _TISSelectedCoursesOutput(SustechToolBoundaryModel):
    sourceUrl: str
    pageUrl: str
    apiUrl: str
    semester: JsonObject
    currentSemester: JsonObject | None
    semesterSource: str | None = None
    resolvedRoleCode: str | None = None
    resolvedPylx: str | None = None
    summary: JsonObject
    courseCount: int
    counts: JsonObject
    logSummary: JsonObject
    persistence: JsonObject | None = None


class _TISSelectedCoursesPersistedOutput(SustechToolBoundaryModel):
    sourceUrl: str
    pageUrl: str
    apiUrl: str
    semester: JsonObject
    currentSemester: JsonObject | None
    semesterSource: str | None = None
    resolvedRoleCode: str | None = None
    resolvedPylx: str | None = None
    homepage: JsonObject
    summary: JsonObject
    courseCount: int
    courses: JsonArray
    probes: JsonArray
    logSummary: JsonObject
    logs: JsonArray
    persistence: JsonObject | None = None


class _SQLDatabaseSummary(SustechToolBoundaryModel):
    path: str
    source: str


class _TISSQLQueryOutput(SustechToolBoundaryModel):
    sql: str
    database: _SQLDatabaseSummary
    usedDefaultDatabase: bool
    hasResultSet: bool
    columns: list[str]
    rowsPreview: JsonArray
    truncated: bool
    rowCount: int | None
    executionSummary: JsonObject
    artifact: JsonObject | None


class _TISSQLQueryArtifactPayload(SustechToolBoundaryModel):
    sql: str
    database: _SQLDatabaseSummary
    usedDefaultDatabase: bool
    hasResultSet: bool
    columns: list[str]
    rows: JsonArray
    rowCount: int
    executionSummary: JsonObject


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
        "integration": "teaching_information_system",
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


def _host_capability_error_details(
    error: HostCapabilityOperationError,
    *,
    include_host_code: bool,
) -> dict[str, Any]:
    details: dict[str, Any] = {
        "capability": error.capability,
        **error.details,
    }
    if include_host_code:
        details["hostErrorCode"] = error.code
    return details


def _map_host_capability_operation_error(
    error: HostCapabilityOperationError,
) -> NormalizedToolError:
    if error.code in {"unsupported_capability", "unsupported_operation"}:
        return NormalizedToolError(
            code="host_capability_missing",
            message=error.message,
            retryable=error.retryable,
            details=_host_capability_error_details(error, include_host_code=True),
        )

    if error.code in {"temporarily_unavailable", "timeout"}:
        return NormalizedToolError(
            code=cast(NormalizedToolErrorCode, error.code),
            message=error.message,
            retryable=error.retryable,
            details=_host_capability_error_details(error, include_host_code=False),
        )

    if error.code in {"permission_denied", "not_found", "conflict"}:
        return NormalizedToolError(
            code=cast(NormalizedToolErrorCode, error.code),
            message=error.message,
            retryable=error.retryable,
            details=_host_capability_error_details(error, include_host_code=False),
        )

    return NormalizedToolError(
        code="execution_failed",
        message=error.message,
        retryable=error.retryable,
        details=_host_capability_error_details(error, include_host_code=True),
    )


def _map_http_status_error(error: httpx.HTTPStatusError) -> NormalizedToolError:
    status_code = error.response.status_code
    status_code_map: dict[int, NormalizedToolErrorCode] = {
        401: "authentication_required",
        403: "permission_denied",
        404: "not_found",
        409: "conflict",
        429: "rate_limited",
        502: "temporarily_unavailable",
        503: "temporarily_unavailable",
        504: "temporarily_unavailable",
    }
    code = status_code_map.get(status_code, "execution_failed")
    return NormalizedToolError(
        code=code,
        message=_message_or_fallback(error, f"TIS request failed with {status_code}."),
        details={"statusCode": status_code},
    )


def _map_runtime_error(error: RuntimeError) -> NormalizedToolError:
    message = str(error)
    if "CAS 登录" in message or "未认证" in message:
        return NormalizedToolError(code="authentication_required", message=message)
    return NormalizedToolError(
        code="execution_failed",
        message=_message_or_fallback(error, "TIS tool execution failed."),
    )


def _map_exception(
    error: Exception,
    *,
    diagnostic_context: Mapping[str, Any] | None = None,
) -> NormalizedToolError:
    if isinstance(error, MissingHostCapabilityError):
        normalized = NormalizedToolError(
            code="host_capability_missing",
            message=str(error),
            details={"capability": error.capability},
        )
    elif isinstance(error, HostCapabilityOperationError):
        normalized = _map_host_capability_operation_error(error)
    elif isinstance(error, TISAuthenticationError):
        normalized = NormalizedToolError(
            code="authentication_required",
            message=_message_or_fallback(error, "TIS/CAS credentials are required."),
        )
    elif isinstance(error, ValueError):
        normalized = NormalizedToolError(
            code="invalid_input",
            message=_message_or_fallback(error, "Tool arguments are invalid."),
        )
    elif isinstance(error, PermissionError):
        normalized = NormalizedToolError(
            code="permission_denied",
            message=_message_or_fallback(error, "TIS access was denied."),
        )
    elif isinstance(error, httpx.TimeoutException):
        normalized = NormalizedToolError(
            code="timeout",
            message=_message_or_fallback(error, "TIS request timed out."),
        )
    elif isinstance(error, httpx.HTTPStatusError):
        normalized = _map_http_status_error(error)
    elif isinstance(error, httpx.HTTPError):
        normalized = NormalizedToolError(
            code="temporarily_unavailable",
            message=_message_or_fallback(error, "TIS host is temporarily unavailable."),
        )
    elif isinstance(error, RuntimeError):
        normalized = _map_runtime_error(error)
    else:
        normalized = NormalizedToolError(
            code="execution_failed",
            message=_message_or_fallback(error, "TIS tool execution failed."),
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
        raise TISAuthenticationError("TIS/CAS credentials are required.")

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


def _read_persist_flag(arguments: Mapping[str, Any]) -> bool:
    return _read_bool(arguments, "persist", default=False)


def _validate_persistence_arguments(
    arguments: Mapping[str, Any], *, persist: bool
) -> None:
    if _read_optional_text(arguments, "dbPath") is not None:
        raise ValueError(
            "dbPath is no longer supported. Use dbRelativePath anchored under the host database directory."
        )
    if persist:
        return
    for field_name in ("dbRelativePath", "ownerKey"):
        if _read_optional_text(arguments, field_name) is not None:
            raise ValueError(f"{field_name} requires persist=true.")
    if arguments.get("resetSchema") is not None:
        raise ValueError("resetSchema requires persist=true.")


def _default_tis_db_relative_path() -> str:
    return TISDatabaseManager.DEFAULT_DB_RELATIVE_PATH.as_posix()


def _resolve_db_manager(
    arguments: Mapping[str, Any],
    host: ToolHostCapabilities,
    *,
    persist: bool,
) -> tuple[TISDatabaseManager | None, str | None]:
    if not persist:
        return None, None

    reset_schema = _read_bool(arguments, "resetSchema", default=False)
    db_relative_path = _read_optional_text(arguments, "dbRelativePath")
    database_resolver = cast(
        DatabaseResolver,
        host.require_capability("database_resolver"),
    )
    relative_path = db_relative_path or _default_tis_db_relative_path()
    resolved_path = database_resolver.resolve_database_path(relative_path=relative_path)
    return (
        TISDatabaseManager(db_path=resolved_path, reset_schema=reset_schema),
        "database_relative" if db_relative_path is not None else "default",
    )


def _read_sql_query_result_limit(arguments: Mapping[str, Any]) -> int:
    raw_limit = _read_optional_int(arguments, "resultLimit")
    if raw_limit is None:
        return 50
    if raw_limit <= 0:
        raise ValueError("resultLimit must be a positive integer.")
    return raw_limit


def _default_tis_sql_query_db_path(host: ToolHostCapabilities) -> Path:
    database_resolver = cast(
        DatabaseResolver,
        host.require_capability("database_resolver"),
    )
    return database_resolver.resolve_database_path(
        relative_path=_default_tis_db_relative_path()
    )


def _resolve_sql_query_db_path(
    arguments: Mapping[str, Any],
    host: ToolHostCapabilities,
) -> tuple[Path, str, bool]:
    if _read_optional_text(arguments, "dbPath") is not None:
        raise ValueError(
            "dbPath is no longer supported. Use dbRelativePath anchored under the host database directory."
        )

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

    return _default_tis_sql_query_db_path(host), "default", True


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


def _summarize_logs(logs: Sequence[TISLogEvent]) -> dict[str, Any]:
    by_level: dict[str, int] = {}
    by_layer: dict[str, int] = {}
    by_source: dict[str, int] = {}
    for log in logs:
        by_level[log.level] = by_level.get(log.level, 0) + 1
        by_layer[log.layer] = by_layer.get(log.layer, 0) + 1
        by_source[log.source] = by_source.get(log.source, 0) + 1
    return {
        "total": len(logs),
        "by_level": by_level,
        "by_layer": by_layer,
        "by_source": by_source,
    }


def _common_metadata(
    *,
    credential_source: str,
    persist: bool,
    db_path_source: str | None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "credentialSource": credential_source,
        "persistenceRequested": persist,
    }
    if db_path_source is not None:
        metadata["dbPathSource"] = db_path_source
    return metadata


def _detail_export_requested(arguments: Mapping[str, Any]) -> bool:
    return (
        _read_optional_text(arguments, "stateKey") is not None
        or _read_optional_text(arguments, "artifactName") is not None
    )


def _build_output_persistence(
    *,
    result_persistence: Mapping[str, Any] | None,
    state_payload: Mapping[str, Any] | None = None,
    artifacts: Sequence[ToolArtifactReference] = (),
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
    return _TISOutputPersistence(
        details=(
            cast(JsonObject, _jsonable(result_persistence))
            if isinstance(result_persistence, Mapping)
            else {}
        ),
        state=state_summary,
        artifacts=[artifact.to_dict() for artifact in artifacts],
    ).to_optional_contract_dict()


def _personal_grades_output(result: TISGradeQueryResult) -> dict[str, Any]:
    terms = sorted(
        {
            term.strip()
            for term in (record.term for record in result.grade_records)
            if isinstance(term, str) and term.strip() != ""
        }
    )
    model = _TISPersonalGradesOutput(
        sourceUrl=result.source_url,
        totalRecords=result.total_records,
        terms=terms,
        counts={
            "records": result.total_records,
            "terms": len(terms),
            "probes": len(result.probes),
        },
        resolvedRoleCode=result.resolved_role_code,
        logSummary=_summarize_logs(result.logs),
        persistence=(
            cast(JsonObject, _jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _personal_grades_persisted_output(result: TISGradeQueryResult) -> dict[str, Any]:
    model = _TISPersonalGradesPersistedOutput(
        sourceUrl=result.source_url,
        totalRecords=result.total_records,
        resolvedRoleCode=result.resolved_role_code,
        homepage=cast(JsonObject, _jsonable(result.homepage)),
        gradeRecords=cast(JsonArray, _jsonable(result.grade_records)),
        probes=cast(JsonArray, _jsonable(result.probes)),
        logSummary=_summarize_logs(result.logs),
        logs=cast(JsonArray, _jsonable(result.logs)),
        persistence=(
            cast(JsonObject, _jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _credit_gpa_output(result: TISCreditGPAQueryResult) -> dict[str, Any]:
    model = _TISCreditGPAOutput(
        sourceUrl=result.source_url,
        pageUrl=result.page_url,
        apiUrl=result.api_url,
        resolvedRoleCode=result.resolved_role_code,
        summary=cast(JsonObject, _jsonable(result.summary)),
        counts={
            "terms": len(result.term_records),
            "years": len(result.year_records),
            "probes": len(result.probes),
        },
        logSummary=_summarize_logs(result.logs),
        persistence=(
            cast(JsonObject, _jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _credit_gpa_persisted_output(result: TISCreditGPAQueryResult) -> dict[str, Any]:
    model = _TISCreditGPAPersistedOutput(
        sourceUrl=result.source_url,
        pageUrl=result.page_url,
        apiUrl=result.api_url,
        resolvedRoleCode=result.resolved_role_code,
        homepage=cast(JsonObject, _jsonable(result.homepage)),
        summary=cast(JsonObject, _jsonable(result.summary)),
        termRecords=cast(JsonArray, _jsonable(result.term_records)),
        yearRecords=cast(JsonArray, _jsonable(result.year_records)),
        probes=cast(JsonArray, _jsonable(result.probes)),
        logSummary=_summarize_logs(result.logs),
        logs=cast(JsonArray, _jsonable(result.logs)),
        persistence=(
            cast(JsonObject, _jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _selected_courses_output(result: TISSelectedCoursesQueryResult) -> dict[str, Any]:
    model = _TISSelectedCoursesOutput(
        sourceUrl=result.source_url,
        pageUrl=result.page_url,
        apiUrl=result.api_url,
        semester=cast(JsonObject, _jsonable(result.semester)),
        currentSemester=cast(JsonObject | None, _jsonable(result.current_semester)),
        semesterSource=result.semester_source,
        resolvedRoleCode=result.resolved_role_code,
        resolvedPylx=result.resolved_pylx,
        summary=cast(JsonObject, _jsonable(result.summary)),
        courseCount=len(result.courses),
        counts={
            "courses": len(result.courses),
            "probes": len(result.probes),
        },
        logSummary=_summarize_logs(result.logs),
        persistence=(
            cast(JsonObject, _jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _selected_courses_persisted_output(
    result: TISSelectedCoursesQueryResult,
) -> dict[str, Any]:
    model = _TISSelectedCoursesPersistedOutput(
        sourceUrl=result.source_url,
        pageUrl=result.page_url,
        apiUrl=result.api_url,
        semester=cast(JsonObject, _jsonable(result.semester)),
        currentSemester=cast(JsonObject | None, _jsonable(result.current_semester)),
        semesterSource=result.semester_source,
        resolvedRoleCode=result.resolved_role_code,
        resolvedPylx=result.resolved_pylx,
        homepage=cast(JsonObject, _jsonable(result.homepage)),
        summary=cast(JsonObject, _jsonable(result.summary)),
        courseCount=len(result.courses),
        courses=cast(JsonArray, _jsonable(result.courses)),
        probes=cast(JsonArray, _jsonable(result.probes)),
        logSummary=_summarize_logs(result.logs),
        logs=cast(JsonArray, _jsonable(result.logs)),
        persistence=(
            cast(JsonObject, _jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


_SQL_QUERY_METADATA = ToolMetadata(
    tool_id="tis.sql.query",
    display_name="TIS SQL Query",
    description=(
        "Execute raw SQL directly against the local TIS SQLite database for inspection and retrieval. "
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
    tags=("tis", "sql", "query"),
    annotations={"domain": "teaching_information_system", "facade": "tool-contract"},
    idempotent=False,
)


_PERSONAL_GRADES_FETCH_METADATA = ToolMetadata(
    tool_id="tis.personal_grades.fetch",
    display_name="TIS Personal Grades Fetch",
    description="Fetch personal grade records from TIS with optional persistence and host-managed state or artifact export.",
    input_schema=_schema(
        properties={
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
            "roleCode": {"type": "string"},
            "persist": {"type": "boolean"},
            "ownerKey": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "stateKey": {"type": "string"},
            "artifactName": {"type": "string"},
        }
    ),
    output_schema=_schema(
        properties={
            "sourceUrl": {"type": "string"},
            "totalRecords": {"type": "integer"},
            "terms": {"type": "array"},
            "counts": {"type": "object"},
            "resolvedRoleCode": {"type": ["string", "null"]},
            "logSummary": {"type": "object"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "sourceUrl",
            "totalRecords",
            "terms",
            "counts",
            "logSummary",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve TIS/CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used for persistence.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist fetch summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist fetch summaries as host-owned artifacts.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("tis", "grades", "fetch"),
    annotations={"domain": "teaching_information_system", "facade": "tool-contract"},
    idempotent=False,
)

_CREDIT_GPA_FETCH_METADATA = ToolMetadata(
    tool_id="tis.credit_gpa.fetch",
    display_name="TIS Credit GPA Fetch",
    description="Fetch credit and GPA summaries from TIS with optional persistence and host-managed state or artifact export.",
    input_schema=_schema(
        properties={
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
            "roleCode": {"type": "string"},
            "persist": {"type": "boolean"},
            "ownerKey": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "stateKey": {"type": "string"},
            "artifactName": {"type": "string"},
        }
    ),
    output_schema=_schema(
        properties={
            "sourceUrl": {"type": "string"},
            "pageUrl": {"type": "string"},
            "apiUrl": {"type": "string"},
            "resolvedRoleCode": {"type": ["string", "null"]},
            "summary": {"type": "object"},
            "counts": {"type": "object"},
            "logSummary": {"type": "object"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "sourceUrl",
            "pageUrl",
            "apiUrl",
            "summary",
            "counts",
            "logSummary",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve TIS/CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used for persistence.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist fetch summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist fetch summaries as host-owned artifacts.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("tis", "credit-gpa", "fetch"),
    annotations={"domain": "teaching_information_system", "facade": "tool-contract"},
    idempotent=False,
)

_SELECTED_COURSES_FETCH_METADATA = ToolMetadata(
    tool_id="tis.selected_courses.fetch",
    display_name="TIS Selected Courses Fetch",
    description="Fetch selected course records from TIS with optional semester selection, persistence, and host-managed state or artifact export.",
    input_schema=_schema(
        properties={
            "username": {"type": "string"},
            "password": {"type": "string"},
            "usernameSecretName": {"type": "string"},
            "passwordSecretName": {"type": "string"},
            "semester": {"type": "string"},
            "roleCode": {"type": "string"},
            "pageNum": {"type": "integer"},
            "pageSize": {"type": "integer"},
            "persist": {"type": "boolean"},
            "ownerKey": {"type": "string"},
            "dbRelativePath": {"type": "string"},
            "resetSchema": {"type": "boolean"},
            "stateKey": {"type": "string"},
            "artifactName": {"type": "string"},
        }
    ),
    output_schema=_schema(
        properties={
            "sourceUrl": {"type": "string"},
            "pageUrl": {"type": "string"},
            "apiUrl": {"type": "string"},
            "semester": {"type": "object"},
            "currentSemester": {"type": ["object", "null"]},
            "semesterSource": {"type": ["string", "null"]},
            "resolvedRoleCode": {"type": ["string", "null"]},
            "resolvedPylx": {"type": ["string", "null"]},
            "summary": {"type": "object"},
            "courseCount": {"type": "integer"},
            "counts": {"type": "object"},
            "logSummary": {"type": "object"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "sourceUrl",
            "pageUrl",
            "apiUrl",
            "semester",
            "currentSemester",
            "summary",
            "courseCount",
            "counts",
            "logSummary",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve TIS/CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="database_resolver",
            required=False,
            purpose="Resolve a host database-relative SQLite path when dbRelativePath is used for persistence.",
        ),
        HostCapabilityRequirement(
            capability="state_store",
            required=False,
            purpose="Persist fetch summaries into host-managed state.",
        ),
        HostCapabilityRequirement(
            capability="artifact_store",
            required=False,
            purpose="Persist fetch summaries as host-owned artifacts.",
        ),
        HostCapabilityRequirement(
            capability="event_sink",
            required=False,
            purpose="Emit tool lifecycle events to the host.",
        ),
    ),
    tags=("tis", "selected-courses", "fetch"),
    annotations={"domain": "teaching_information_system", "facade": "tool-contract"},
    idempotent=False,
)


class TISPersonalGradesFetchTool(_TISFacadeToolBase):
    _metadata = _PERSONAL_GRADES_FETCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _TISPersonalGradesFetchArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict(exclude_none=False)
        credentials = await _resolve_credentials(
            normalized_arguments,
            host,
            default_username_secret_name=_DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        persist = parsed_arguments.persist
        _validate_persistence_arguments(normalized_arguments, persist=persist)
        db_manager, db_path_source = _resolve_db_manager(
            normalized_arguments,
            host,
            persist=persist,
        )
        result = await asyncio.to_thread(
            fetch_personal_grades_with_credentials,
            credentials.username,
            credentials.password,
            role_code=parsed_arguments.roleCode,
            persist=persist,
            db_manager=db_manager,
            owner_key=parsed_arguments.ownerKey,
        )
        output = _personal_grades_output(result)
        persisted_output = (
            _personal_grades_persisted_output(result)
            if _detail_export_requested(normalized_arguments)
            else output
        )
        metadata = _common_metadata(
            credential_source=credentials.source,
            persist=persist,
            db_path_source=db_path_source,
        )
        state_payload = await _persist_state_if_requested(
            namespace=_STATE_NAMESPACE_PERSONAL_GRADES,
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        metadata.update(state_payload)
        artifacts = await _persist_artifact_if_requested(
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        persistence_summary = _build_output_persistence(
            result_persistence=result.persistence,
            state_payload=state_payload,
            artifacts=artifacts,
        )
        if persistence_summary is not None:
            output["persistence"] = persistence_summary
        return output, artifacts, metadata


class TISCreditGPAFetchTool(_TISFacadeToolBase):
    _metadata = _CREDIT_GPA_FETCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _TISCreditGPAFetchArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict(exclude_none=False)
        credentials = await _resolve_credentials(
            normalized_arguments,
            host,
            default_username_secret_name=_DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        persist = parsed_arguments.persist
        _validate_persistence_arguments(normalized_arguments, persist=persist)
        db_manager, db_path_source = _resolve_db_manager(
            normalized_arguments,
            host,
            persist=persist,
        )
        result = await asyncio.to_thread(
            fetch_credit_gpa_with_credentials,
            credentials.username,
            credentials.password,
            role_code=parsed_arguments.roleCode,
            persist=persist,
            db_manager=db_manager,
            owner_key=parsed_arguments.ownerKey,
        )
        output = _credit_gpa_output(result)
        persisted_output = (
            _credit_gpa_persisted_output(result)
            if _detail_export_requested(normalized_arguments)
            else output
        )
        metadata = _common_metadata(
            credential_source=credentials.source,
            persist=persist,
            db_path_source=db_path_source,
        )
        state_payload = await _persist_state_if_requested(
            namespace=_STATE_NAMESPACE_CREDIT_GPA,
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        metadata.update(state_payload)
        artifacts = await _persist_artifact_if_requested(
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        persistence_summary = _build_output_persistence(
            result_persistence=result.persistence,
            state_payload=state_payload,
            artifacts=artifacts,
        )
        if persistence_summary is not None:
            output["persistence"] = persistence_summary
        return output, artifacts, metadata


class TISSelectedCoursesFetchTool(_TISFacadeToolBase):
    _metadata = _SELECTED_COURSES_FETCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _TISSelectedCoursesFetchArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict(exclude_none=False)
        credentials = await _resolve_credentials(
            normalized_arguments,
            host,
            default_username_secret_name=_DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        persist = parsed_arguments.persist
        _validate_persistence_arguments(normalized_arguments, persist=persist)
        db_manager, db_path_source = _resolve_db_manager(
            normalized_arguments,
            host,
            persist=persist,
        )
        result = await asyncio.to_thread(
            fetch_selected_courses_with_credentials,
            credentials.username,
            credentials.password,
            semester=parsed_arguments.semester,
            role_code=parsed_arguments.roleCode,
            page_num=parsed_arguments.pageNum,
            page_size=parsed_arguments.pageSize,
            persist=persist,
            db_manager=db_manager,
            owner_key=parsed_arguments.ownerKey,
        )
        output = _selected_courses_output(result)
        persisted_output = (
            _selected_courses_persisted_output(result)
            if _detail_export_requested(normalized_arguments)
            else output
        )
        metadata = _common_metadata(
            credential_source=credentials.source,
            persist=persist,
            db_path_source=db_path_source,
        )
        state_payload = await _persist_state_if_requested(
            namespace=_STATE_NAMESPACE_SELECTED_COURSES,
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        metadata.update(state_payload)
        artifacts = await _persist_artifact_if_requested(
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        persistence_summary = _build_output_persistence(
            result_persistence=result.persistence,
            state_payload=state_payload,
            artifacts=artifacts,
        )
        if persistence_summary is not None:
            output["persistence"] = persistence_summary
        return output, artifacts, metadata


class TISSQLQueryTool(_TISFacadeToolBase):
    _metadata = _SQL_QUERY_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _TISSQLQueryArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict(exclude_none=False)
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
        output_model = _TISSQLQueryOutput(
            sql=parsed_arguments.sql,
            database=database_summary,
            usedDefaultDatabase=used_default_database,
            hasResultSet=bool(query_output["hasResultSet"]),
            columns=cast(list[str], query_output["columns"]),
            rowsPreview=cast(JsonArray, query_output["rowsPreview"]),
            truncated=bool(query_output["truncated"]),
            rowCount=cast(int | None, query_output["rowCount"]),
            executionSummary=cast(JsonObject, query_output["executionSummary"]),
            artifact=None,
        )
        output = output_model.to_contract_dict()
        artifact_payload: dict[str, Any] | None = None
        if full_result is not None:
            artifact_payload = _TISSQLQueryArtifactPayload(
                sql=parsed_arguments.sql,
                database=database_summary,
                usedDefaultDatabase=used_default_database,
                hasResultSet=bool(full_result["hasResultSet"]),
                columns=cast(list[str], full_result["columns"]),
                rows=cast(JsonArray, full_result["rows"]),
                rowCount=cast(int, full_result["rowCount"]),
                executionSummary=cast(JsonObject, full_result["executionSummary"]),
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


TIS_FACADE_TOOLS: tuple[ToolContract, ...] = (
    TISPersonalGradesFetchTool(),
    TISCreditGPAFetchTool(),
    TISSelectedCoursesFetchTool(),
    TISSQLQueryTool(),
)


def get_tis_tool_contracts() -> tuple[ToolContract, ...]:
    """Return stable TIS tool-contract facades for runtime or transport adapters."""

    return TIS_FACADE_TOOLS


__all__ = [
    "TISCreditGPAFetchTool",
    "TISSelectedCoursesFetchTool",
    "TISPersonalGradesFetchTool",
    "TISSQLQueryTool",
    "TIS_FACADE_TOOLS",
    "get_tis_tool_contracts",
]
