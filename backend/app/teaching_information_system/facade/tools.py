"""Tool-contract facade for selected TIS domain capabilities."""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, cast

import httpx

from app.teaching_information_system.api.dto import (
    TISCreditGPAQueryResult,
    TISGradeQueryResult,
    TISSelectedCoursesQueryResult,
)
from app.teaching_information_system.data import TISDatabaseManager
from app.teaching_information_system.provider.use_cases import (
    fetch_credit_gpa_with_credentials,
    fetch_personal_grades_with_credentials,
    fetch_selected_courses_with_credentials,
)
from app.teaching_information_system.shared import TISLogEvent
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

_STATE_NAMESPACE_PERSONAL_GRADES = "tis.personal_grades.fetch"
_STATE_NAMESPACE_CREDIT_GPA = "tis.credit_gpa.fetch"
_STATE_NAMESPACE_SELECTED_COURSES = "tis.selected_courses.fetch"


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
    if isinstance(error, TISAuthenticationError):
        return NormalizedToolError(
            code="authentication_required",
            message=_message_or_fallback(error, "TIS/CAS credentials are required."),
        )
    if isinstance(error, ValueError):
        return NormalizedToolError(
            code="invalid_input",
            message=_message_or_fallback(error, "Tool arguments are invalid."),
        )
    if isinstance(error, PermissionError):
        return NormalizedToolError(
            code="permission_denied",
            message=_message_or_fallback(error, "TIS access was denied."),
        )
    if isinstance(error, httpx.TimeoutException):
        return NormalizedToolError(
            code="timeout",
            message=_message_or_fallback(error, "TIS request timed out."),
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
            message=_message_or_fallback(error, f"TIS request failed with {status_code}."),
            details={"statusCode": status_code},
        )
    if isinstance(error, httpx.HTTPError):
        return NormalizedToolError(
            code="temporarily_unavailable",
            message=_message_or_fallback(error, "TIS host is temporarily unavailable."),
        )
    if isinstance(error, RuntimeError):
        message = str(error)
        if "CAS 登录" in message or "未认证" in message:
            return NormalizedToolError(code="authentication_required", message=message)
    return NormalizedToolError(
        code="execution_failed",
        message=_message_or_fallback(error, "TIS tool execution failed."),
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
        raise TISAuthenticationError("TIS/CAS credentials are required.")

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


def _read_persist_flag(arguments: Mapping[str, Any]) -> bool:
    return _read_bool(arguments, "persist", default=False)


def _validate_persistence_arguments(arguments: Mapping[str, Any], *, persist: bool) -> None:
    if persist:
        return
    for field_name in ("dbPath", "dbRelativePath", "ownerKey"):
        if _read_optional_text(arguments, field_name) is not None:
            raise ValueError(f"{field_name} requires persist=true.")
    if arguments.get("resetSchema") is not None:
        raise ValueError("resetSchema requires persist=true.")


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
    if db_relative_path is not None:
        workspace_resolver = cast(
            WorkspaceResolver,
            host.require_capability("workspace_resolver"),
        )
        resolved_path = workspace_resolver.resolve_workspace_path(relative_path=db_relative_path)
        return TISDatabaseManager(db_path=resolved_path, reset_schema=reset_schema), "workspace"

    db_path = _read_optional_text(arguments, "dbPath")
    if db_path is not None:
        return TISDatabaseManager(db_path=db_path, reset_schema=reset_schema), "argument"

    return TISDatabaseManager(reset_schema=reset_schema), "default"


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


def _personal_grades_output(result: TISGradeQueryResult) -> dict[str, Any]:
    output: dict[str, Any] = {
        "sourceUrl": result.source_url,
        "totalRecords": result.total_records,
        "resolvedRoleCode": result.resolved_role_code,
        "homepage": _jsonable(result.homepage),
        "gradeRecords": _jsonable(result.grade_records),
        "probes": _jsonable(result.probes),
        "logSummary": _summarize_logs(result.logs),
        "logs": _jsonable(result.logs),
    }
    if result.persistence is not None:
        output["persistence"] = _jsonable(result.persistence)
    return output


def _credit_gpa_output(result: TISCreditGPAQueryResult) -> dict[str, Any]:
    output: dict[str, Any] = {
        "sourceUrl": result.source_url,
        "pageUrl": result.page_url,
        "apiUrl": result.api_url,
        "resolvedRoleCode": result.resolved_role_code,
        "homepage": _jsonable(result.homepage),
        "summary": _jsonable(result.summary),
        "termRecords": _jsonable(result.term_records),
        "yearRecords": _jsonable(result.year_records),
        "probes": _jsonable(result.probes),
        "logSummary": _summarize_logs(result.logs),
        "logs": _jsonable(result.logs),
    }
    if result.persistence is not None:
        output["persistence"] = _jsonable(result.persistence)
    return output


def _selected_courses_output(result: TISSelectedCoursesQueryResult) -> dict[str, Any]:
    output: dict[str, Any] = {
        "sourceUrl": result.source_url,
        "pageUrl": result.page_url,
        "apiUrl": result.api_url,
        "semester": _jsonable(result.semester),
        "currentSemester": _jsonable(result.current_semester),
        "semesterSource": result.semester_source,
        "resolvedRoleCode": result.resolved_role_code,
        "resolvedPylx": result.resolved_pylx,
        "homepage": _jsonable(result.homepage),
        "summary": _jsonable(result.summary),
        "courseCount": len(result.courses),
        "courses": _jsonable(result.courses),
        "probes": _jsonable(result.probes),
        "logSummary": _summarize_logs(result.logs),
        "logs": _jsonable(result.logs),
    }
    if result.persistence is not None:
        output["persistence"] = _jsonable(result.persistence)
    return output


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
            "dbPath": {"type": "string"},
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
            "resolvedRoleCode": {"type": ["string", "null"]},
            "homepage": {"type": "object"},
            "gradeRecords": {"type": "array"},
            "probes": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "sourceUrl",
            "totalRecords",
            "homepage",
            "gradeRecords",
            "probes",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve TIS/CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="workspace_resolver",
            required=False,
            purpose="Resolve a host workspace-relative SQLite path when dbRelativePath is used for persistence.",
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
            "dbPath": {"type": "string"},
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
            "homepage": {"type": "object"},
            "summary": {"type": "object"},
            "termRecords": {"type": "array"},
            "yearRecords": {"type": "array"},
            "probes": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "sourceUrl",
            "pageUrl",
            "apiUrl",
            "homepage",
            "summary",
            "termRecords",
            "yearRecords",
            "probes",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve TIS/CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="workspace_resolver",
            required=False,
            purpose="Resolve a host workspace-relative SQLite path when dbRelativePath is used for persistence.",
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
            "dbPath": {"type": "string"},
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
            "homepage": {"type": "object"},
            "summary": {"type": "object"},
            "courseCount": {"type": "integer"},
            "courses": {"type": "array"},
            "probes": {"type": "array"},
            "logSummary": {"type": "object"},
            "logs": {"type": "array"},
            "persistence": {"type": ["object", "null"]},
        },
        required=(
            "sourceUrl",
            "pageUrl",
            "apiUrl",
            "semester",
            "currentSemester",
            "homepage",
            "summary",
            "courseCount",
            "courses",
            "probes",
            "logSummary",
            "logs",
        ),
    ),
    capability_requirements=(
        HostCapabilityRequirement(
            capability="secret_provider",
            required=False,
            purpose="Resolve TIS/CAS credentials from host-managed secrets.",
        ),
        HostCapabilityRequirement(
            capability="workspace_resolver",
            required=False,
            purpose="Resolve a host workspace-relative SQLite path when dbRelativePath is used for persistence.",
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
        credentials = await _resolve_credentials(arguments, host)
        persist = _read_persist_flag(arguments)
        _validate_persistence_arguments(arguments, persist=persist)
        role_code = _read_optional_text(arguments, "roleCode")
        owner_key = _read_optional_text(arguments, "ownerKey")
        db_manager, db_path_source = _resolve_db_manager(arguments, host, persist=persist)
        result = await asyncio.to_thread(
            fetch_personal_grades_with_credentials,
            credentials.username,
            credentials.password,
            role_code=role_code,
            persist=persist,
            db_manager=db_manager,
            owner_key=owner_key,
        )
        output = _personal_grades_output(result)
        metadata = _common_metadata(
            credential_source=credentials.source,
            persist=persist,
            db_path_source=db_path_source,
        )
        metadata.update(
            await _persist_state_if_requested(
                namespace=_STATE_NAMESPACE_PERSONAL_GRADES,
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


class TISCreditGPAFetchTool(_TISFacadeToolBase):
    _metadata = _CREDIT_GPA_FETCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        credentials = await _resolve_credentials(arguments, host)
        persist = _read_persist_flag(arguments)
        _validate_persistence_arguments(arguments, persist=persist)
        role_code = _read_optional_text(arguments, "roleCode")
        owner_key = _read_optional_text(arguments, "ownerKey")
        db_manager, db_path_source = _resolve_db_manager(arguments, host, persist=persist)
        result = await asyncio.to_thread(
            fetch_credit_gpa_with_credentials,
            credentials.username,
            credentials.password,
            role_code=role_code,
            persist=persist,
            db_manager=db_manager,
            owner_key=owner_key,
        )
        output = _credit_gpa_output(result)
        metadata = _common_metadata(
            credential_source=credentials.source,
            persist=persist,
            db_path_source=db_path_source,
        )
        metadata.update(
            await _persist_state_if_requested(
                namespace=_STATE_NAMESPACE_CREDIT_GPA,
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


class TISSelectedCoursesFetchTool(_TISFacadeToolBase):
    _metadata = _SELECTED_COURSES_FETCH_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        credentials = await _resolve_credentials(arguments, host)
        persist = _read_persist_flag(arguments)
        _validate_persistence_arguments(arguments, persist=persist)
        semester = _read_optional_text(arguments, "semester")
        role_code = _read_optional_text(arguments, "roleCode")
        raw_page_num = _read_optional_int(arguments, "pageNum")
        raw_page_size = _read_optional_int(arguments, "pageSize")
        page_num = 1 if raw_page_num is None else raw_page_num
        page_size = 19 if raw_page_size is None else raw_page_size
        if page_num <= 0:
            raise ValueError("pageNum must be a positive integer.")
        if page_size <= 0:
            raise ValueError("pageSize must be a positive integer.")
        owner_key = _read_optional_text(arguments, "ownerKey")
        db_manager, db_path_source = _resolve_db_manager(arguments, host, persist=persist)
        result = await asyncio.to_thread(
            fetch_selected_courses_with_credentials,
            credentials.username,
            credentials.password,
            semester=semester,
            role_code=role_code,
            page_num=page_num,
            page_size=page_size,
            persist=persist,
            db_manager=db_manager,
            owner_key=owner_key,
        )
        output = _selected_courses_output(result)
        metadata = _common_metadata(
            credential_source=credentials.source,
            persist=persist,
            db_path_source=db_path_source,
        )
        metadata.update(
            await _persist_state_if_requested(
                namespace=_STATE_NAMESPACE_SELECTED_COURSES,
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


TIS_FACADE_TOOLS: tuple[ToolContract, ...] = (
    TISPersonalGradesFetchTool(),
    TISCreditGPAFetchTool(),
    TISSelectedCoursesFetchTool(),
)


def get_tis_tool_contracts() -> tuple[ToolContract, ...]:
    """Return stable TIS tool-contract facades for runtime or transport adapters."""

    return TIS_FACADE_TOOLS


__all__ = [
    "TISCreditGPAFetchTool",
    "TISSelectedCoursesFetchTool",
    "TISPersonalGradesFetchTool",
    "TIS_FACADE_TOOLS",
    "get_tis_tool_contracts",
]
