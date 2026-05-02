"""Blackboard snapshot sync tool — data_sync sub-domain of the Blackboard tool facade.

Named data_sync to avoid confusion with provider/use_cases/snapshot_sync.py.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any

from app.integrations.sustech.facade_contract_models import parse_tool_arguments
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardSnapshotSyncReport,
)
from app.tooling import (
    HostCapabilityRequirement,
    ToolArtifactReference,
    ToolHostCapabilities,
    ToolInvocationContext,
    ToolMetadata,
)

from . import tools


class _BlackboardSnapshotSyncArguments(tools._BlackboardToolArguments):
    resetSchema: bool = False
    verifySecondSync: bool = True
    parallelWorkers: int = 1

    @tools.field_validator("resetSchema", mode="before")
    @classmethod
    def _normalize_reset_schema(cls, value: Any) -> bool:
        return tools._normalize_bool_value(value, "resetSchema", default=False)

    @tools.field_validator("verifySecondSync", mode="before")
    @classmethod
    def _normalize_verify_second_sync(cls, value: Any) -> bool:
        return tools._normalize_bool_value(value, "verifySecondSync", default=True)

    @tools.field_validator("parallelWorkers", mode="before")
    @classmethod
    def _normalize_parallel_workers(cls, value: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 1
        return max(1, min(6, parsed))


class _BlackboardSnapshotSyncOutput(tools.SustechToolBoundaryModel):
    dbPath: str
    scrapedCounts: tools.JsonObject
    firstSyncStats: dict[str, tools._SyncStatsSummary]
    secondSyncStats: dict[str, tools._SyncStatsSummary] | None
    tableCounts: tools.JsonObject
    expectedActiveCounts: tools.JsonObject
    integrityOk: bool
    secondSyncHasNoNewRecords: bool
    secondSyncHasNoDeletedRecords: bool
    logSummary: tools.JsonObject
    persistence: tools.JsonObject | None = None


class _BlackboardSnapshotSyncPersistedOutput(tools.SustechToolBoundaryModel):
    dbPath: str
    scrapedCounts: tools.JsonObject
    firstSyncStats: tools.JsonObject
    secondSyncStats: tools.JsonObject | None
    tableCounts: tools.JsonObject
    expectedActiveCounts: tools.JsonObject
    integrityOk: bool
    secondSyncHasNoNewRecords: bool
    secondSyncHasNoDeletedRecords: bool
    logSummary: tools.JsonObject
    logs: tools.JsonArray
    progressMessages: list[str] = tools.Field(default_factory=list)

    def to_persisted_contract_dict(self) -> dict[str, Any]:
        exclude: set[str] = set()
        if not self.progressMessages:
            exclude.add("progressMessages")
        return self.to_contract_dict(exclude=exclude)


_SNAPSHOT_SYNC_METADATA = ToolMetadata(
    tool_id="blackboard.snapshot.sync",
    display_name="Blackboard Snapshot Sync",
    description="Fetch a Blackboard base snapshot and sync it into the existing SQLite store.",
    input_schema=tools._schema(
        properties={
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
                "description": "When true, recreate the target SQLite schema before running the snapshot sync.",
            },
            "verifySecondSync": {
                "type": "boolean",
                "description": "When true, run a second sync pass to verify that no unexpected new or deleted records appear. Defaults to true.",
            },
            "parallelWorkers": {
                "type": "integer",
                "minimum": 1,
                "maximum": 6,
                "description": "How many worker threads to use when fetching per-course Blackboard assignment and grade data. Defaults to 1.",
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
    ),
    output_schema=tools._schema(
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


def _snapshot_sync_output(
    report: BlackboardSnapshotSyncReport,
    *,
    progress_messages: Sequence[str],
    persistence: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    _ = progress_messages
    model = _BlackboardSnapshotSyncOutput(
        dbPath=report.db_path.as_posix(),
        scrapedCounts=tools._jsonable(report.snapshot.scraped_counts()),
        firstSyncStats=tools._sync_stats_summary_models(report.first_sync_stats),
        secondSyncStats=(
            None
            if report.second_sync_stats is None
            else tools._sync_stats_summary_models(report.second_sync_stats)
        ),
        tableCounts=tools._jsonable(report.table_counts),
        expectedActiveCounts=tools._jsonable(report.expected_active_counts),
        integrityOk=report.integrity_ok,
        secondSyncHasNoNewRecords=report.second_sync_has_no_new_records(),
        secondSyncHasNoDeletedRecords=report.second_sync_has_no_deleted_records(),
        logSummary=tools._jsonable(report.log_summary),
        persistence=tools._jsonable(persistence) if persistence else None,
    )
    exclude: set[str] = set()
    if not persistence:
        exclude.add("persistence")
    return model.to_contract_dict(exclude=exclude)


def _snapshot_sync_persisted_output(
    report: BlackboardSnapshotSyncReport,
    *,
    progress_messages: Sequence[str],
) -> dict[str, Any]:
    return _BlackboardSnapshotSyncPersistedOutput(
        dbPath=report.db_path.as_posix(),
        scrapedCounts=tools._jsonable(report.snapshot.scraped_counts()),
        firstSyncStats=tools._jsonable(report.first_sync_stats),
        secondSyncStats=tools._jsonable(report.second_sync_stats),
        tableCounts=tools._jsonable(report.table_counts),
        expectedActiveCounts=tools._jsonable(report.expected_active_counts),
        integrityOk=report.integrity_ok,
        secondSyncHasNoNewRecords=report.second_sync_has_no_new_records(),
        secondSyncHasNoDeletedRecords=report.second_sync_has_no_deleted_records(),
        logSummary=tools._jsonable(report.log_summary),
        logs=tools._jsonable(report.logs),
        progressMessages=list(progress_messages),
    ).to_persisted_contract_dict()


class BlackboardSnapshotSyncTool(tools._BlackboardFacadeToolBase):
    _metadata = _SNAPSHOT_SYNC_METADATA

    async def _invoke_impl(
        self,
        *,
        arguments: dict[str, Any],
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> tuple[dict[str, Any], tuple[ToolArtifactReference, ...], dict[str, Any]]:
        parsed_arguments = parse_tool_arguments(
            _BlackboardSnapshotSyncArguments,
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
        progress_messages: list[str] = []
        report = await asyncio.to_thread(
            tools.run_blackboard_snapshot_sync,
            credentials.username,
            credentials.password,
            db_path=db_path,
            reset_schema=parsed_arguments.resetSchema,
            verify_second_sync=parsed_arguments.verifySecondSync,
            parallel_workers=parsed_arguments.parallelWorkers,
            progress=progress_messages.append,
        )
        output = _snapshot_sync_output(report, progress_messages=progress_messages)
        persist_details = (
            parsed_arguments.stateKey is not None
            or parsed_arguments.artifactName is not None
        )
        persisted_output = (
            _snapshot_sync_persisted_output(report, progress_messages=progress_messages)
            if persist_details
            else output
        )
        metadata = {
            "credentialSource": credentials.source,
            "dbPathSource": tools._db_path_source(normalized_arguments),
        }
        state_payload = await tools._persist_state_if_requested(
            namespace=tools._STATE_NAMESPACE_SNAPSHOT_SYNC,
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
            output = _snapshot_sync_output(
                report,
                progress_messages=progress_messages,
                persistence=persistence_summary,
            )
        return output, artifacts, metadata
