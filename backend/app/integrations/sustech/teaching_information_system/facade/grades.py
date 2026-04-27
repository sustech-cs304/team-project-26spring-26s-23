"""Personal grades fetch tool — grades sub-domain of the TIS tool facade."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any, cast

from pydantic import field_validator

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.teaching_information_system.api.dto import TISGradeQueryResult
from app.integrations.sustech.teaching_information_system.data import TISDatabaseManager
from app.integrations.sustech.teaching_information_system.shared import TISLogEvent
from app.tooling import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
    ToolSchema,
)

from . import tools
from .result_mapping import (
    _common_metadata,
    _detail_export_requested,
    _summarize_logs,
)


class _TISPersonalGradesFetchArguments(tools._TISToolArguments):
    pass


class _TISPersonalGradesOutput(tools.SustechToolBoundaryModel):
    sourceUrl: str
    totalRecords: int
    terms: list[str]
    counts: tools.JsonObject
    resolvedRoleCode: str | None = None
    logSummary: tools.JsonObject
    persistence: tools.JsonObject | None = None


class _TISPersonalGradesPersistedOutput(tools.SustechToolBoundaryModel):
    sourceUrl: str
    totalRecords: int
    resolvedRoleCode: str | None = None
    homepage: tools.JsonObject
    gradeRecords: tools.JsonArray
    probes: tools.JsonArray
    logSummary: tools.JsonObject
    logs: tools.JsonArray
    persistence: tools.JsonObject | None = None


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
            cast(tools.JsonObject, tools._jsonable(result.persistence))
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
        homepage=cast(tools.JsonObject, tools._jsonable(result.homepage)),
        gradeRecords=cast(tools.JsonArray, tools._jsonable(result.grade_records)),
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


_PERSONAL_GRADES_FETCH_METADATA = ToolMetadata(
    tool_id="tis.personal_grades.fetch",
    display_name="TIS Personal Grades Fetch",
    description="Fetch personal grade records from TIS with optional persistence and host-managed state or artifact export.",
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
            "roleCode": {
                "type": "string",
                "description": "Optional TIS RoleCode header. Leave empty to let the tool derive the first available role from the homepage, falling back to `01` when needed.",
            },
            "persist": {
                "type": "boolean",
                "description": "When true, sync the fetched records into the local TIS SQLite database.",
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


class TISPersonalGradesFetchTool(tools._TISFacadeToolBase):
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
            tools.fetch_personal_grades_with_credentials,
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
        state_payload = await tools._persist_state_if_requested(
            namespace=tools._STATE_NAMESPACE_PERSONAL_GRADES,
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
