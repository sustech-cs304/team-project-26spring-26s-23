"""Selected courses fetch tool — selected-courses sub-domain of the TIS tool facade."""

from __future__ import annotations

import asyncio
from typing import Any, cast

from pydantic import field_validator

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.teaching_information_system.api.dto import (
    TISSelectedCoursesQueryResult,
)
from app.tooling import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
)

from . import tools
from .result_mapping import (
    _common_metadata,
    _detail_export_requested,
    _summarize_logs,
)


class _TISSelectedCoursesFetchArguments(tools._TISToolArguments):
    semester: str | None = None
    pageNum: int = 1
    pageSize: int = 19

    @field_validator("semester", mode="before")
    @classmethod
    def _normalize_semester(cls, value: Any) -> str | None:
        return tools._normalize_optional_text_value(value)

    @field_validator("pageNum", mode="before")
    @classmethod
    def _normalize_page_num(cls, value: Any) -> int:
        normalized = tools._normalize_optional_int_value(value, "pageNum")
        return 1 if normalized is None else normalized

    @field_validator("pageSize", mode="before")
    @classmethod
    def _normalize_page_size(cls, value: Any) -> int:
        normalized = tools._normalize_optional_int_value(value, "pageSize")
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


class _TISSelectedCoursesOutput(tools.SustechToolBoundaryModel):
    sourceUrl: str
    pageUrl: str
    apiUrl: str
    semester: tools.JsonObject
    currentSemester: tools.JsonObject | None
    semesterSource: str | None = None
    resolvedRoleCode: str | None = None
    resolvedPylx: str | None = None
    summary: tools.JsonObject
    courseCount: int
    counts: tools.JsonObject
    logSummary: tools.JsonObject
    persistence: tools.JsonObject | None = None


class _TISSelectedCoursesPersistedOutput(tools.SustechToolBoundaryModel):
    sourceUrl: str
    pageUrl: str
    apiUrl: str
    semester: tools.JsonObject
    currentSemester: tools.JsonObject | None
    semesterSource: str | None = None
    resolvedRoleCode: str | None = None
    resolvedPylx: str | None = None
    homepage: tools.JsonObject
    summary: tools.JsonObject
    courseCount: int
    courses: tools.JsonArray
    probes: tools.JsonArray
    logSummary: tools.JsonObject
    logs: tools.JsonArray
    persistence: tools.JsonObject | None = None


def _selected_courses_output(result: TISSelectedCoursesQueryResult) -> dict[str, Any]:
    model = _TISSelectedCoursesOutput(
        sourceUrl=result.source_url,
        pageUrl=result.page_url,
        apiUrl=result.api_url,
        semester=cast(tools.JsonObject, tools._jsonable(result.semester)),
        currentSemester=cast(
            tools.JsonObject | None, tools._jsonable(result.current_semester)
        ),
        semesterSource=result.semester_source,
        resolvedRoleCode=result.resolved_role_code,
        resolvedPylx=result.resolved_pylx,
        summary=cast(tools.JsonObject, tools._jsonable(result.summary)),
        courseCount=len(result.courses),
        counts={
            "courses": len(result.courses),
            "probes": len(result.probes),
        },
        logSummary=_summarize_logs(result.logs),
        persistence=(
            cast(tools.JsonObject, tools._jsonable(result.persistence))
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
        semester=cast(tools.JsonObject, tools._jsonable(result.semester)),
        currentSemester=cast(
            tools.JsonObject | None, tools._jsonable(result.current_semester)
        ),
        semesterSource=result.semester_source,
        resolvedRoleCode=result.resolved_role_code,
        resolvedPylx=result.resolved_pylx,
        homepage=cast(tools.JsonObject, tools._jsonable(result.homepage)),
        summary=cast(tools.JsonObject, tools._jsonable(result.summary)),
        courseCount=len(result.courses),
        courses=cast(tools.JsonArray, tools._jsonable(result.courses)),
        probes=cast(tools.JsonArray, tools._jsonable(result.probes)),
        logSummary=_summarize_logs(result.logs),
        logs=cast(tools.JsonArray, tools._jsonable(result.logs)),
        persistence=(
            cast(tools.JsonObject, tools._jsonable(result.persistence))
            if result.persistence is not None
            else None
        ),
    )
    exclude: set[str] = set()
    if result.persistence is None:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


_SELECTED_COURSES_FETCH_METADATA = ToolMetadata(
    tool_id="tis.selected_courses.fetch",
    display_name="TIS Selected Courses Fetch",
    description="Fetch selected course records from TIS with optional semester selection, persistence, and host-managed state or artifact export.",
    input_schema=tools._schema(
        properties={
            "username": {
                "type": "string",
                "description": "TIS/CAS username. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "password": {
                "type": "string",
                "description": "TIS/CAS password. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "usernameSecretName": {
                "type": "string",
                "description": "Host secret name that stores the TIS/CAS username. Usually omit it to use the default secret `sustech.username`.",
            },
            "passwordSecretName": {
                "type": "string",
                "description": "Host secret name that stores the TIS/CAS password. Usually omit it to use the default secret `sustech.casPassword`.",
            },
            "semester": {
                "type": "string",
                "description": "Semester to fetch. Leave empty for the current term; also accepts `当前学期`, `current`, `current_semester`, `2024-2025-1`, or `2024-20251`.",
            },
            "roleCode": {
                "type": "string",
                "description": "Optional TIS RoleCode header. Leave empty to let the tool derive the first available role from the homepage, falling back to `01` when needed.",
            },
            "pageNum": {
                "type": "integer",
                "description": "1-based page number passed to the selected-courses API. Defaults to 1.",
            },
            "pageSize": {
                "type": "integer",
                "description": "Page size passed to the selected-courses API. Defaults to 19.",
            },
            "persist": {
                "type": "boolean",
                "description": "When true, sync the fetched selected-course records into the local TIS SQLite database.",
            },
            "ownerKey": {
                "type": "string",
                "description": "Logical owner key used when persisting records. Defaults to the resolved username and requires `persist=true`.",
            },
            "dbRelativePath": {
                "type": "string",
                "description": "SQLite path relative to the host database directory for persistence. Requires `persist=true`; omit it to use the default TIS database path.",
            },
            "resetSchema": {
                "type": "boolean",
                "description": "When `persist=true`, recreate the target SQLite schema before syncing the fetched data.",
            },
            "stateKey": {
                "type": "string",
                "description": "If provided, save the result under this key in the host state store.",
            },
            "artifactName": {
                "type": "string",
                "description": "If provided, export the result JSON to the host artifact store using this artifact name.",
            },
        }
    ),
    output_schema=tools._schema(
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


class TISSelectedCoursesFetchTool(tools._TISFacadeToolBase):
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
        credentials = await tools._resolve_credentials(
            normalized_arguments,
            host,
            default_username_secret_name=tools._DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=tools._DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        persist = parsed_arguments.persist
        tools._validate_persistence_arguments(normalized_arguments, persist=persist)
        db_manager, db_path_source = tools._resolve_db_manager(
            normalized_arguments,
            host,
            persist=persist,
        )
        result = await asyncio.to_thread(
            tools.fetch_selected_courses_with_credentials,
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
        state_payload = await tools._persist_state_if_requested(
            namespace=tools._STATE_NAMESPACE_SELECTED_COURSES,
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        metadata.update(state_payload)
        artifacts = await tools._persist_artifact_if_requested(
            arguments=normalized_arguments,
            context=context,
            host=host,
            output=persisted_output,
        )
        persistence_summary = tools._build_output_persistence(
            result_persistence=result.persistence,
            state_payload=state_payload,
            artifacts=artifacts,
        )
        if persistence_summary is not None:
            output["persistence"] = persistence_summary
        return output, artifacts, metadata
