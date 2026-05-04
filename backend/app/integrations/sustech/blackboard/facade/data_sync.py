"""Blackboard snapshot sync tool — data_sync sub-domain of the Blackboard tool facade.

Named data_sync to avoid confusion with provider/use_cases/snapshot_sync.py.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
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


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _infer_progress_stage(message: str) -> str | None:
    normalized = message.strip()
    if not normalized:
        return None

    if "CASClient" in normalized or "认证" in normalized:
        return "authenticating"
    if (
        "基础实时数据" in normalized
        or "课程列表" in normalized
        or "当前学期" in normalized
    ):
        return "fetching_courses"
    if any(
        token in normalized for token in ("处理课程", "作业", "成绩", "公告", "资源")
    ):
        return "fetching_details"
    if any(token in normalized for token in ("构建", "同步数据库", "首次同步")):
        return "syncing_db"
    if any(token in normalized for token in ("第二次同步验证", "校验", "验证")):
        return "verifying"
    return None


def _build_snapshot_sync_status_payload(
    *,
    status: str,
    progress_messages: Sequence[str],
    last_sync_at: str | None = None,
    last_sync_error: str | None = None,
) -> dict[str, Any]:
    progress_logs = [
        str(message).strip()
        for message in progress_messages
        if str(message).strip()
    ]
    progress_message = progress_logs[-1] if progress_logs else None
    progress_stage = (
        None if progress_message is None else _infer_progress_stage(progress_message)
    )
    if status == "completed":
        progress_message = None
        progress_stage = None
    elif status == "failed" and last_sync_error:
        progress_message = last_sync_error
        progress_stage = None
        if not progress_logs or progress_logs[-1] != last_sync_error:
            progress_logs.append(last_sync_error)

    return {
        "status": status,
        "lastSyncAt": last_sync_at,
        "lastSyncError": last_sync_error,
        "progressStage": progress_stage,
        "progressMessage": progress_message,
        "progressLogs": progress_logs,
        "canCancel": False,
        "timeoutSeconds": None,
        "updatedAt": _utc_now_iso(),
    }


async def _persist_snapshot_sync_status(
    *,
    host: ToolHostCapabilities,
    value: Mapping[str, Any],
) -> None:
    state_store = host.state_store
    if state_store is None:
        return
    try:
        await state_store.put(
            namespace=tools._STATE_NAMESPACE_SNAPSHOT_SYNC,
            key=tools._LATEST_STATUS_STATE_KEY,
            value=value,
        )
    except Exception:
        return


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
        progress_messages: list[str] = []
        loop = asyncio.get_running_loop()
        pending_status_tasks: set[asyncio.Task[None]] = set()

        def _schedule_status_persist(
            status: str,
            *,
            last_sync_at: str | None = None,
            last_sync_error: str | None = None,
        ) -> None:
            payload = _build_snapshot_sync_status_payload(
                status=status,
                progress_messages=list(progress_messages),
                last_sync_at=last_sync_at,
                last_sync_error=last_sync_error,
            )
            task = loop.create_task(
                _persist_snapshot_sync_status(host=host, value=payload)
            )
            pending_status_tasks.add(task)
            task.add_done_callback(pending_status_tasks.discard)

        await _persist_snapshot_sync_status(
            host=host,
            value=_build_snapshot_sync_status_payload(
                status="running",
                progress_messages=["开始同步..."],
            ),
        )

        try:
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

            def _progress_callback(message: str) -> None:
                progress_messages.append(message)
                loop.call_soon_threadsafe(_schedule_status_persist, "running")

            report = await asyncio.to_thread(
                tools.run_blackboard_snapshot_sync,
                credentials.username,
                credentials.password,
                db_path=db_path,
                reset_schema=parsed_arguments.resetSchema,
                verify_second_sync=parsed_arguments.verifySecondSync,
                parallel_workers=parsed_arguments.parallelWorkers,
                progress=_progress_callback,
            )
            if pending_status_tasks:
                await asyncio.gather(
                    *tuple(pending_status_tasks),
                    return_exceptions=True,
                )

            output = _snapshot_sync_output(report, progress_messages=progress_messages)
            persist_details = (
                parsed_arguments.stateKey is not None
                or parsed_arguments.artifactName is not None
            )
            persisted_output = (
                _snapshot_sync_persisted_output(
                    report,
                    progress_messages=progress_messages,
                )
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
            await _persist_snapshot_sync_status(
                host=host,
                value=_build_snapshot_sync_status_payload(
                    status="completed",
                    progress_messages=progress_messages,
                    last_sync_at=(
                        report.snapshot.logs[-1].timestamp
                        if report.snapshot.logs
                        else None
                    ),
                ),
            )
            return output, artifacts, metadata
        except Exception as exc:
            if pending_status_tasks:
                await asyncio.gather(
                    *tuple(pending_status_tasks),
                    return_exceptions=True,
                )
            await _persist_snapshot_sync_status(
                host=host,
                value=_build_snapshot_sync_status_payload(
                    status="failed",
                    progress_messages=progress_messages,
                    last_sync_error=str(exc),
                ),
            )
            raise
