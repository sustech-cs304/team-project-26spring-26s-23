"""Tool-contract facade for selected TIS domain capabilities.

This module is the stable entry-point for the TIS tool facade.
Domain-specific implementations live in sibling submodules:
  - grades.py          (personal grades)
  - gpa.py             (credit / GPA)
  - selected_courses.py (selected courses)
  - diagnostics.py     (SQL query / introspection)
  - result_mapping.py  (shared result helpers)

Only shared infrastructure, stable re-exports, and thin orchestration
remain in this file.
"""

from __future__ import annotations

import json
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
)
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.provider.use_cases import (
    fetch_credit_gpa_with_credentials,
    fetch_personal_grades_with_credentials,
    fetch_selected_courses_with_credentials,
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

_STATE_NAMESPACE_PERSONAL_GRADES = "tis.personal_grades.fetch"
_STATE_NAMESPACE_CREDIT_GPA = "tis.credit_gpa.fetch"
_STATE_NAMESPACE_SELECTED_COURSES = "tis.selected_courses.fetch"


def _build_secret_registry_key(namespace: str, key_name: str) -> str:
    """Build host secret registry keys without embedding credentials in code."""
    return f"{namespace}.{key_name}"


# Host-side secret registry key names for credential lookup.
_DEFAULT_SUSTECH_USERNAME_SECRET_NAME = _build_secret_registry_key(
    "sustech", "username"
)
_DEFAULT_SUSTECH_PASSWORD_SECRET_NAME = _build_secret_registry_key(
    "sustech", "casPassword"
)


class TISAuthenticationError(RuntimeError):
    """Raised when TIS credentials cannot be resolved or authenticated."""


# ---------------------------------------------------------------------------
# Base tool class (shared decorator / lifecycle)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Shared argument helpers
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


# ---------------------------------------------------------------------------
# JSON serialisation
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Shared normalisation helpers (used by sub-module argument models)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Shared argument / persistence models (used by multiple sub-domains)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Error mapping (shared across all tools)
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
# Credential resolution (shared across grades / gpa / selected-courses)
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


# ---------------------------------------------------------------------------
# Persistence helpers (shared across grades / gpa / selected-courses)
# ---------------------------------------------------------------------------


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
# Output persistence wrapper (shared across grades / gpa / selected-courses)
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Thin orchestration — import sub-domain implementations and re-export
# ---------------------------------------------------------------------------

from .diagnostics import TISSQLQueryTool  # noqa: E402
from .grades import TISPersonalGradesFetchTool  # noqa: E402
from .gpa import TISCreditGPAFetchTool  # noqa: E402
from .selected_courses import TISSelectedCoursesFetchTool  # noqa: E402

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
    "fetch_credit_gpa_with_credentials",
    "fetch_personal_grades_with_credentials",
    "fetch_selected_courses_with_credentials",
    "get_tis_tool_contracts",
]
