"""Query services for persisted chat history views."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .models.chat import RunEventModel, RunModel, RunProjectionModel, ThreadModel, ThreadProjectionModel
from .projections import ProjectionService
from .query_dtos import (
    PersistedDatabaseBackupResponse,
    PersistedDatabaseRestoreResponse,
    PersistedRunEventDTO,
    PersistedRunReplayResponse,
    PersistedRunSummaryDTO,
    PersistedThreadDeleteResponse,
    PersistedThreadDetailResponse,
    PersistedThreadListResponse,
    PersistedThreadPurgeResponse,
    PersistedThreadSummaryDTO,
)
from .repositories import PersistenceRepositories, run_lifecycle_transaction

if TYPE_CHECKING:
    from .store import SQLiteSessionStore


class PersistedChatQueryService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        session_store: "SQLiteSessionStore | None" = None,
    ) -> None:
        self._session_factory = session_factory
        self._session_store = session_store

    def list_threads(self) -> PersistedThreadListResponse:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_models = tuple(
                repositories.session.execute(
                    select(ThreadModel)
                    .where(ThreadModel.deleted_at.is_(None))
                    .order_by(ThreadModel.updated_at.desc(), ThreadModel.id.desc())
                ).scalars()
            )
            thread_summaries = [
                _build_thread_summary(repositories, thread_model)
                for thread_model in thread_models
            ]
            thread_summaries.sort(key=_thread_sort_key, reverse=True)
            return PersistedThreadListResponse(ok=True, threads=tuple(thread_summaries))

    def get_thread_detail(self, thread_id: str) -> PersistedThreadDetailResponse:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.require(thread_id)
            thread_summary = _build_thread_summary(repositories, thread_model)
            thread_projection = _ensure_thread_projection(repositories, thread_model.id)
            run_models = repositories.runs.list_for_thread(thread_id)
            timeline_items: list[dict[str, Any]] = []
            run_summaries: list[PersistedRunSummaryDTO] = []
            for run_model in run_models:
                run_summaries.append(_build_run_summary(run_model))
                run_projection = _ensure_run_projection(repositories, run_model.id)
                if run_projection is not None:
                    timeline_items.extend(_copy_mapping_list(run_projection.timeline_items_json))
            latest_run = run_models[-1] if run_models else None
            return PersistedThreadDetailResponse(
                ok=True,
                thread=thread_summary,
                timelineItems=tuple(timeline_items),
                runSummaries=tuple(run_summaries),
                latestConfigurationSnapshot=_build_thread_configuration_snapshot(
                    latest_run=latest_run,
                    thread_projection=thread_projection,
                ),
                availabilityDrift=_copy_mapping(
                    None if thread_projection is None else thread_projection.drift_summary_json
                ),
            )

    def get_run_replay(self, run_id: str) -> PersistedRunReplayResponse:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_model = repositories.runs.require(run_id)
            run_projection = _ensure_run_projection(repositories, run_id)
            event_models = repositories.events.list_for_run(run_id)
            return PersistedRunReplayResponse(
                ok=True,
                run=_build_run_summary(run_model),
                historicalSnapshot=_build_run_historical_snapshot(run_model),
                orderedEvents=tuple(_build_run_event(event_model) for event_model in event_models),
                toolCallBlocks=tuple(
                    _copy_mapping_list(None if run_projection is None else run_projection.tool_call_blocks_json)
                ),
                diagnosticBlocks=tuple(
                    _copy_mapping_list(None if run_projection is None else run_projection.diagnostic_blocks_json)
                ),
                terminalState=_copy_mapping(
                    None if run_projection is None else run_projection.terminal_state_json
                ),
                availabilityInterpretation=_build_run_availability_interpretation(run_model),
            )

    def delete_thread(self, thread_id: str) -> PersistedThreadDeleteResponse:
        return self._require_session_store().delete_thread(thread_id)

    def purge_thread(self, thread_id: str) -> PersistedThreadPurgeResponse:
        return self._require_session_store().purge_thread(thread_id)

    def backup_database(
        self,
        *,
        target_path: str | None = None,
    ) -> PersistedDatabaseBackupResponse:
        return self._require_session_store().backup_database(target_path=target_path)

    def restore_database(self, *, source_path: str) -> PersistedDatabaseRestoreResponse:
        return self._require_session_store().restore_database(source_path=source_path)

    def _require_session_store(self) -> "SQLiteSessionStore":
        if self._session_store is None:
            raise RuntimeError("Persistent history mutations require the SQLite chat session store.")
        return self._session_store



def _build_thread_summary(
    repositories: PersistenceRepositories,
    thread_model: ThreadModel,
) -> PersistedThreadSummaryDTO:
    thread_projection = _ensure_thread_projection(repositories, thread_model.id)
    return PersistedThreadSummaryDTO(
        threadId=thread_model.id,
        boundAgentId=thread_model.bound_agent_id,
        title=thread_model.title or _optional_projection_value(thread_projection, "display_title"),
        titleSource=thread_model.title_source,
        summary=thread_model.summary_text or _optional_projection_value(thread_projection, "display_summary"),
        summarySource=thread_model.summary_source,
        createdAt=thread_model.created_at,
        updatedAt=thread_model.updated_at,
        lastActivityAt=None if thread_projection is None else thread_projection.last_activity_at,
        lastRunId=thread_model.last_run_id,
        lastRunStatus=None if thread_projection is None else thread_projection.last_run_status,
        lastUserMessagePreview=thread_model.last_user_message_preview,
        lastAssistantMessagePreview=thread_model.last_assistant_message_preview,
        driftSummary=_copy_mapping(None if thread_projection is None else thread_projection.drift_summary_json),
    )



def _build_run_summary(run_model: RunModel) -> PersistedRunSummaryDTO:
    return PersistedRunSummaryDTO(
        runId=run_model.id,
        threadId=run_model.thread_id,
        status=run_model.status,
        createdAt=run_model.created_at,
        updatedAt=run_model.updated_at,
        startedAt=run_model.started_at,
        terminalAt=run_model.ended_at,
        resolvedModelId=run_model.resolved_model_id,
        requestedMessageText=run_model.request_message_text,
        assistantText=run_model.assistant_text,
    )



def _build_run_event(event_model: RunEventModel) -> PersistedRunEventDTO:
    return PersistedRunEventDTO(
        sequence=event_model.seq,
        eventType=event_model.event_type,
        createdAt=event_model.created_at,
        payload=dict(event_model.payload_json or {}),
        toolCallId=event_model.tool_call_id,
        toolId=event_model.tool_id,
        phase=event_model.phase,
        isRedacted=event_model.is_redacted,
        redactionVersion=event_model.redaction_version,
    )



def _build_thread_configuration_snapshot(
    *,
    latest_run: RunModel | None,
    thread_projection: ThreadProjectionModel | None,
) -> dict[str, Any] | None:
    if latest_run is None and thread_projection is None:
        return None
    return {
        "runId": None if latest_run is None else latest_run.id,
        "modelSnapshot": _copy_mapping(
            None if thread_projection is None else thread_projection.last_effective_model_snapshot_json
        ),
        "toolsSnapshot": _copy_mapping(
            None if thread_projection is None else thread_projection.last_effective_tools_snapshot_json
        ),
    }



def _build_run_historical_snapshot(run_model: RunModel) -> dict[str, Any]:
    return {
        "requestMessage": {
            "role": run_model.request_message_role,
            "content": run_model.request_message_text,
        },
        "selectedModelRoute": dict(run_model.selected_model_route_json or {}),
        "resolvedModelRoute": dict(run_model.resolved_model_route_json or {}),
        "resolvedModelId": run_model.resolved_model_id,
        "requestedThinkingSelection": _copy_mapping(run_model.requested_thinking_json),
        "appliedThinkingSelection": _copy_mapping(run_model.applied_thinking_json),
        "thinkingCapabilitySnapshot": _copy_mapping(run_model.metadata_json.get("thinkingCapabilitySnapshot")),
        "thinkingSeriesDecision": _copy_mapping(
            run_model.metadata_json.get("thinkingSeriesDecision")
            or run_model.metadata_json.get("thinkingSelectionResult")
        ),
        "reasoningSuppressionBasis": _copy_mapping(
            run_model.metadata_json.get("reasoningSuppressionBasis")
        ),
        "enabledToolIds": list(run_model.enabled_tools_json or []),
        "resolvedToolIds": list(run_model.resolved_tool_ids_json or []),
        "requestOptions": dict(run_model.request_options_json or {}),
        "debugModeEnabled": run_model.debug_mode_enabled,
    }



def _build_run_availability_interpretation(run_model: RunModel) -> dict[str, Any]:
    return {
        "status": "not_evaluated",
        "historicalModelId": run_model.resolved_model_id,
        "historicalToolIds": list(run_model.resolved_tool_ids_json or run_model.enabled_tools_json or []),
        "historicalThinkingSelection": _copy_mapping(
            run_model.applied_thinking_json or run_model.requested_thinking_json
        ),
    }



def _ensure_thread_projection(
    repositories: PersistenceRepositories,
    thread_id: str,
) -> ThreadProjectionModel | None:
    projection = repositories.projections.get_thread_projection(thread_id)
    if projection is not None:
        return projection
    ProjectionService.refresh_thread_in_transaction(repositories, thread_id)
    return repositories.projections.get_thread_projection(thread_id)



def _ensure_run_projection(
    repositories: PersistenceRepositories,
    run_id: str,
) -> RunProjectionModel | None:
    projection = repositories.projections.get_run_projection(run_id)
    if projection is not None:
        return projection
    ProjectionService.refresh_run_in_transaction(repositories, run_id, refresh_thread=True)
    return repositories.projections.get_run_projection(run_id)



def _optional_projection_value(projection: ThreadProjectionModel | None, field_name: str) -> str | None:
    if projection is None:
        return None
    value = getattr(projection, field_name)
    return value if isinstance(value, str) else None



def _copy_mapping(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, dict) else None



def _copy_mapping_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    copied_items: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            copied_items.append(dict(item))
    return copied_items



def _thread_sort_key(thread_summary: PersistedThreadSummaryDTO) -> tuple[float, float, float, str]:
    return (
        _datetime_sort_value(thread_summary.lastActivityAt),
        _datetime_sort_value(thread_summary.updatedAt),
        _datetime_sort_value(thread_summary.createdAt),
        thread_summary.threadId,
    )



def _datetime_sort_value(value: datetime | None) -> float:
    if value is None:
        return float("-inf")
    return value.timestamp()


__all__ = ["PersistedChatQueryService"]
