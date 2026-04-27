"""Blackboard course resources sync tool — course_resources sub-domain of the Blackboard tool facade."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardCourseResourcesSyncReport,
)
from app.tooling import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
)

from . import tools


class _BlackboardCourseResourcesSyncArguments(tools._BlackboardToolArguments):
    courseIds: list[str] | None = tools.Field(default=None, validate_default=True)
    resetSchema: bool = False

    @tools.field_validator("courseIds", mode="before")
    @classmethod
    def _normalize_course_ids(cls, value: Any) -> list[str]:
        return tools._normalize_required_string_list_value(value, "courseIds")

    @tools.field_validator("resetSchema", mode="before")
    @classmethod
    def _normalize_reset_schema(cls, value: Any) -> bool:
        return tools._normalize_bool_value(value, "resetSchema", default=False)


class _BlackboardCourseResourcesSyncOutput(tools.SustechToolBoundaryModel):
    dbPath: str
    requestedCourseIds: list[str]
    processedCourseIds: list[str]
    missingCourseIds: list[str]
    failedCourseIds: list[str]
    scrapedCounts: tools.JsonObject
    syncStats: dict[str, tools._SyncStatsSummary]
    tableCounts: tools.JsonObject
    logSummary: tools.JsonObject
    persistence: tools.JsonObject | None = None


class _BlackboardCourseResourcesSyncPersistedOutput(tools.SustechToolBoundaryModel):
    dbPath: str
    requestedCourseIds: list[str]
    processedCourseIds: list[str]
    missingCourseIds: list[str]
    failedCourseIds: list[str]
    scrapedCounts: tools.JsonObject
    syncStats: tools.JsonObject
    tableCounts: tools.JsonObject
    resourcePayloadsByCourse: tools.JsonObject
    logSummary: tools.JsonObject
    logs: tools.JsonArray
    progressMessages: list[str] = tools.Field(default_factory=list)

    def to_persisted_contract_dict(self) -> dict[str, Any]:
        exclude: set[str] = set()
        if not self.progressMessages:
            exclude.add("progressMessages")
        return self.to_contract_dict(exclude=exclude)


_RESOURCE_SYNC_METADATA = ToolMetadata(
    tool_id="blackboard.course_resources.sync",
    display_name="Blackboard Course Resources Sync",
    description="Sync Blackboard resources for explicit course IDs into the existing SQLite store.",
    input_schema=tools._schema(
        properties={
            "courseIds": {
                "type": "array",
                "items": {"type": "string", "minLength": 1},
                "minItems": 1,
                "uniqueItems": True,
                "description": "Explicit Blackboard course IDs whose resources should be fetched and synced.",
            },
            "username": {
                "type": "string",
                "description": "Blackboard/CAS username. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "password": {
                "type": "string",
                "description": "Blackboard/CAS password. Usually omit it to use the host's default secret; provide it only when secret lookup is unavailable or credentials are requested explicitly.",
            },
            "usernameSecretName": {
                "type": "string",
                "description": "Host secret name that stores the Blackboard/CAS username. Usually omit it to use the default secret `sustech.username`.",
            },
            "passwordSecretName": {
                "type": "string",
                "description": "Host secret name that stores the Blackboard/CAS password. Usually omit it to use the default secret `sustech.casPassword`.",
            },
            "dbRelativePath": {
                "type": "string",
                "description": "SQLite path relative to the host database directory. Omit it to use the default Blackboard database path.",
            },
            "resetSchema": {
                "type": "boolean",
                "description": "When true, recreate the target SQLite schema before syncing course resources.",
            },
            "stateKey": {
                "type": "string",
                "description": "If provided, save the sync result under this key in the host state store.",
            },
            "artifactName": {
                "type": "string",
                "description": "If provided, export the sync result JSON to the host artifact store using this artifact name.",
            },
        },
        required=("courseIds",),
    ),
    output_schema=tools._schema(
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


def _course_resources_sync_output(
    report: BlackboardCourseResourcesSyncReport,
    *,
    progress_messages: Sequence[str],
    persistence: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    _ = progress_messages
    model = _BlackboardCourseResourcesSyncOutput(
        dbPath=report.db_path.as_posix(),
        requestedCourseIds=list(report.requested_course_ids),
        processedCourseIds=list(report.processed_course_ids),
        missingCourseIds=list(report.missing_course_ids),
        failedCourseIds=list(report.failed_course_ids),
        scrapedCounts=tools._jsonable(report.scraped_counts()),
        syncStats=tools._sync_stats_summary_models(report.sync_stats),
        tableCounts=tools._jsonable(report.table_counts),
        logSummary=tools._jsonable(report.log_summary),
        persistence=tools._jsonable(persistence) if persistence else None,
    )
    exclude: set[str] = set()
    if not persistence:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _course_resources_sync_persisted_output(
    report: BlackboardCourseResourcesSyncReport,
    *,
    progress_messages: Sequence[str],
) -> dict[str, Any]:
    return _BlackboardCourseResourcesSyncPersistedOutput(
        dbPath=report.db_path.as_posix(),
        requestedCourseIds=list(report.requested_course_ids),
        processedCourseIds=list(report.processed_course_ids),
        missingCourseIds=list(report.missing_course_ids),
        failedCourseIds=list(report.failed_course_ids),
        scrapedCounts=tools._jsonable(report.scraped_counts()),
        syncStats=tools._jsonable(report.sync_stats),
        tableCounts=tools._jsonable(report.table_counts),
        resourcePayloadsByCourse=tools._jsonable(report.resource_payloads_by_course),
        logSummary=tools._jsonable(report.log_summary),
        logs=tools._jsonable(report.logs),
        progressMessages=list(progress_messages),
    ).to_persisted_contract_dict()


class BlackboardCourseResourcesSyncTool(tools._BlackboardFacadeToolBase):
    _metadata = _RESOURCE_SYNC_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _BlackboardCourseResourcesSyncArguments,
            arguments,
        )
        normalized_arguments = parsed_arguments.to_contract_dict()
        credentials = await tools._resolve_credentials(
            normalized_arguments,
            host,
            default_username_secret_name=tools._DEFAULT_SUSTECH_USERNAME_SECRET_NAME,
            default_password_secret_name=tools._DEFAULT_SUSTECH_PASSWORD_SECRET_NAME,
        )
        db_path = tools._resolve_db_path(normalized_arguments, host)
        course_ids = parsed_arguments.courseIds
        if course_ids is None:  # pragma: no cover - guarded by Pydantic validation
            raise ValueError("courseIds must be an array of non-empty strings.")
        progress_messages: list[str] = []
        report = await asyncio.to_thread(
            tools.run_blackboard_course_resources_sync,
            credentials.username,
            credentials.password,
            course_ids=course_ids,
            db_path=db_path,
            reset_schema=parsed_arguments.resetSchema,
            progress=progress_messages.append,
        )
        output = _course_resources_sync_output(
            report, progress_messages=progress_messages
        )
        persist_details = (
            parsed_arguments.stateKey is not None
            or parsed_arguments.artifactName is not None
        )
        persisted_output = (
            _course_resources_sync_persisted_output(
                report, progress_messages=progress_messages
            )
            if persist_details
            else output
        )
        metadata = {
            "credentialSource": credentials.source,
            "dbPathSource": tools._db_path_source(normalized_arguments),
        }
        state_payload = await tools._persist_state_if_requested(
            namespace=tools._STATE_NAMESPACE_COURSE_RESOURCES_SYNC,
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
        persistence_summary = tools._build_output_persistence_summary(
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
