"""Query services for persisted chat history views."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .drift import PersistedHistoryDriftEvaluator
from .models.chat import (
    RunEventModel,
    RunModel,
    RunProjectionModel,
    ThreadModel,
    ThreadProjectionModel,
)
from .projections import ProjectionService, _resolve_latest_thread_run
from .query_dtos import (
    PersistedDatabaseBackupResponse,
    PersistedDatabaseRestoreResponse,
    PersistedDiagnosticBlockDTO,
    PersistedRunEventDTO,
    PersistedRunHistoricalSnapshotDTO,
    PersistedRunReplayResponse,
    PersistedRunSummaryDTO,
    PersistedTerminalBlockDTO,
    PersistedTerminalStateDTO,
    PersistedThreadConfigurationSnapshotDTO,
    PersistedThreadDeleteResponse,
    PersistedThreadDetailResponse,
    PersistedThreadDuplicateResponse,
    PersistedThreadListResponse,
    PersistedThreadRenameResponse,
    PersistedThreadSummaryDTO,
    PersistedTimelineItemDTO,
    PersistedTimelineMessageItemDTO,
    PersistedToolCallBlockDTO,
)
from .repositories import PersistenceRepositories, run_lifecycle_transaction

_HISTORY_QUERY_LOGGER = logging.getLogger("uvicorn.error")

if TYPE_CHECKING:
    from ..agent_registry import AgentRegistry
    from ..model_routes import RuntimeModelRouteResolver
    from ..provider_adapter_registry import RuntimeProviderAdapterRegistry
    from ..tool_registry import ToolRegistry
    from .store import SQLiteSessionStore


class PersistedChatQueryService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        session_store: "SQLiteSessionStore | None" = None,
        agent_registry: "AgentRegistry | None" = None,
        tool_registry: "ToolRegistry | None" = None,
        model_route_resolver: "RuntimeModelRouteResolver | None" = None,
        provider_adapter_registry: "RuntimeProviderAdapterRegistry | None" = None,
    ) -> None:
        self._session_factory = session_factory
        self._session_store = session_store
        self._drift_evaluator = PersistedHistoryDriftEvaluator(
            agent_registry=agent_registry,
            tool_registry=tool_registry,
            model_route_resolver=model_route_resolver,
            provider_adapter_registry=provider_adapter_registry,
        )

    def list_threads(self) -> PersistedThreadListResponse:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_models = tuple(
                repositories.session.execute(
                    select(ThreadModel).order_by(
                        ThreadModel.updated_at.desc(), ThreadModel.id.desc()
                    )
                ).scalars()
            )
            thread_summaries = [
                _build_thread_summary(
                    repositories,
                    thread_model,
                    drift_evaluator=self._drift_evaluator,
                )
                for thread_model in thread_models
            ]
            thread_summaries.sort(key=_thread_sort_key, reverse=True)
            return PersistedThreadListResponse(ok=True, threads=tuple(thread_summaries))

    def get_thread_detail(self, thread_id: str) -> PersistedThreadDetailResponse:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.require(thread_id)
            thread_summary = _build_thread_summary(
                repositories,
                thread_model,
                drift_evaluator=self._drift_evaluator,
            )
            thread_projection = _ensure_thread_projection(repositories, thread_model.id)
            run_models = repositories.runs.list_for_thread(thread_id)
            timeline_items: list[PersistedTimelineItemDTO] = []
            run_summaries: list[PersistedRunSummaryDTO] = []
            for run_model in run_models:
                run_summaries.append(_build_run_summary(run_model))
                run_projection = _ensure_run_projection(repositories, run_model.id)
                if run_projection is not None:
                    timeline_items.extend(
                        _build_timeline_items(run_projection.timeline_items_json)
                    )
            latest_run = run_models[-1] if run_models else None
            availability_drift = None
            if latest_run is not None:
                availability_drift = self._drift_evaluator.evaluate(
                    run=latest_run,
                    bound_agent_id=thread_model.bound_agent_id,
                )
            return PersistedThreadDetailResponse(
                ok=True,
                thread=thread_summary,
                timelineItems=tuple(timeline_items),
                runSummaries=tuple(run_summaries),
                latestConfigurationSnapshot=_build_thread_configuration_snapshot(
                    latest_run=latest_run,
                    thread_projection=thread_projection,
                ),
                availabilityDrift=_copy_mapping(availability_drift),
            )

    def get_run_replay(self, run_id: str) -> PersistedRunReplayResponse:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_model = repositories.runs.require(run_id)
            thread_model = repositories.threads.require(run_model.thread_id)
            run_projection = _ensure_run_projection(repositories, run_id)
            event_models = repositories.events.list_for_run(run_id)
            availability_interpretation = self._drift_evaluator.evaluate(
                run=run_model,
                bound_agent_id=thread_model.bound_agent_id,
            )
            return PersistedRunReplayResponse(
                ok=True,
                run=_build_run_summary(run_model),
                historicalSnapshot=_build_run_historical_snapshot(run_model),
                orderedEvents=tuple(
                    _build_run_event(event_model) for event_model in event_models
                ),
                toolCallBlocks=_build_tool_call_blocks(
                    None
                    if run_projection is None
                    else run_projection.tool_call_blocks_json
                ),
                diagnosticBlocks=_build_diagnostic_blocks(
                    None
                    if run_projection is None
                    else run_projection.diagnostic_blocks_json
                ),
                terminalState=_build_terminal_state_snapshot(
                    None
                    if run_projection is None
                    else run_projection.terminal_state_json
                ),
                availabilityInterpretation=_copy_mapping(availability_interpretation),
            )

    def delete_thread(self, thread_id: str) -> PersistedThreadDeleteResponse:
        return self._require_session_store().delete_thread(thread_id)

    def rename_thread(
        self, thread_id: str, *, title: str
    ) -> PersistedThreadRenameResponse:
        renamed_thread_id = self._require_session_store().rename_thread(
            thread_id, title=title
        )
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.require(renamed_thread_id)
            return PersistedThreadRenameResponse(
                ok=True,
                thread=_build_thread_summary(
                    repositories,
                    thread_model,
                    drift_evaluator=self._drift_evaluator,
                ),
            )

    def duplicate_thread(
        self,
        thread_id: str,
        *,
        title: str | None = None,
    ) -> PersistedThreadDuplicateResponse:
        duplicated_thread_id = self._require_session_store().duplicate_thread(
            thread_id, title=title
        )
        with run_lifecycle_transaction(self._session_factory) as repositories:
            thread_model = repositories.threads.require(duplicated_thread_id)
            return PersistedThreadDuplicateResponse(
                ok=True,
                thread=_build_thread_summary(
                    repositories,
                    thread_model,
                    drift_evaluator=self._drift_evaluator,
                ),
            )

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
            raise RuntimeError(
                "Persistent history mutations require the SQLite chat session store."
            )
        return self._session_store


def _build_thread_summary(
    repositories: PersistenceRepositories,
    thread_model: ThreadModel,
    *,
    drift_evaluator: PersistedHistoryDriftEvaluator | None = None,
) -> PersistedThreadSummaryDTO:
    thread_projection = _ensure_thread_projection(repositories, thread_model.id)
    run_models = repositories.runs.list_for_thread(thread_model.id)
    latest_run = _resolve_latest_thread_run(
        repositories,
        thread_model.id,
        runs=run_models,
        last_run_id=thread_model.last_run_id,
    )
    availability_drift = None
    if drift_evaluator is not None and latest_run is not None:
        availability_drift = drift_evaluator.evaluate(
            run=latest_run,
            bound_agent_id=thread_model.bound_agent_id,
        )
    return PersistedThreadSummaryDTO(
        threadId=thread_model.id,
        boundAgentId=thread_model.bound_agent_id,
        title=thread_model.title
        or _optional_projection_value(thread_projection, "display_title"),
        titleSource=thread_model.title_source,
        summary=thread_model.summary_text
        or _optional_projection_value(thread_projection, "display_summary"),
        summarySource=thread_model.summary_source,
        createdAt=thread_model.created_at,
        updatedAt=thread_model.updated_at,
        lastActivityAt=None
        if thread_projection is None
        else thread_projection.last_activity_at,
        lastRunId=thread_model.last_run_id,
        lastRunStatus=None
        if thread_projection is None
        else thread_projection.last_run_status,
        lastUserMessagePreview=thread_model.last_user_message_preview,
        lastAssistantMessagePreview=thread_model.last_assistant_message_preview,
        driftSummary=_copy_mapping(availability_drift),
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
) -> PersistedThreadConfigurationSnapshotDTO | None:
    if latest_run is None and thread_projection is None:
        return None
    return PersistedThreadConfigurationSnapshotDTO.model_validate(
        {
            "runId": None if latest_run is None else latest_run.id,
            "modelSnapshot": _copy_mapping(
                None
                if thread_projection is None
                else thread_projection.last_effective_model_snapshot_json
            ),
            "toolsSnapshot": _copy_mapping(
                None
                if thread_projection is None
                else thread_projection.last_effective_tools_snapshot_json
            ),
        }
    )


def _build_run_historical_snapshot(
    run_model: RunModel,
) -> PersistedRunHistoricalSnapshotDTO:
    return PersistedRunHistoricalSnapshotDTO.model_validate(
        {
            "requestMessage": {
                "role": run_model.request_message_role,
                "content": run_model.request_message_text,
                "structuredPayload": _copy_mapping(
                    run_model.metadata_json.get("requestStructuredPayload")
                ),
            },
            "selectedModelRoute": dict(run_model.selected_model_route_json or {}),
            "resolvedModelRoute": dict(run_model.resolved_model_route_json or {}),
            "resolvedModelId": run_model.resolved_model_id,
            "requestedThinkingSelection": _copy_mapping(
                run_model.requested_thinking_json
            ),
            "appliedThinkingSelection": _copy_mapping(run_model.applied_thinking_json),
            "thinkingCapabilitySnapshot": _copy_mapping(
                run_model.metadata_json.get("thinkingCapabilitySnapshot")
            ),
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
    )


def _build_timeline_items(value: Any) -> tuple[PersistedTimelineItemDTO, ...]:
    if not isinstance(value, list):
        return ()

    timeline_items: list[PersistedTimelineItemDTO] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            _log_skipped_timeline_item(
                index, item, reason="timeline item is not an object"
            )
            continue
        try:
            timeline_items.append(_build_timeline_item(item))
        except Exception as exc:  # noqa: BLE001 - legacy history reads must fail soft.
            _log_skipped_timeline_item(index, item, reason=str(exc), exc_info=exc)
    return tuple(timeline_items)


def _build_timeline_item(item: dict[str, Any]) -> PersistedTimelineItemDTO:
    kind = _normalize_optional_string(item.get("kind"))
    if kind in {"user_message", "assistant_message", "reasoning_block"}:
        return cast(
            PersistedTimelineItemDTO,
            PersistedTimelineMessageItemDTO.model_validate(item),
        )
    if kind == "tool_call_block":
        return cast(
            PersistedTimelineItemDTO,
            PersistedToolCallBlockDTO.model_validate(item),
        )
    if kind == "diagnostic_block":
        return cast(
            PersistedTimelineItemDTO,
            PersistedDiagnosticBlockDTO.model_validate(item),
        )
    if kind == "terminal_block":
        return cast(
            PersistedTimelineItemDTO,
            PersistedTerminalBlockDTO.model_validate(item),
        )
    raise ValueError(f"Unsupported timeline item kind: {kind!r}")


def _build_tool_call_blocks(value: Any) -> tuple[PersistedToolCallBlockDTO, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        PersistedToolCallBlockDTO.model_validate(item)
        for item in value
        if isinstance(item, dict)
    )


def _build_diagnostic_blocks(value: Any) -> tuple[PersistedDiagnosticBlockDTO, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        PersistedDiagnosticBlockDTO.model_validate(item)
        for item in value
        if isinstance(item, dict)
    )


def _build_terminal_state_snapshot(value: Any) -> PersistedTerminalStateDTO | None:
    if not isinstance(value, dict):
        return None
    return PersistedTerminalStateDTO.model_validate(value)


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
    ProjectionService.refresh_run_in_transaction(
        repositories, run_id, refresh_thread=True
    )
    return repositories.projections.get_run_projection(run_id)


def _optional_projection_value(
    projection: ThreadProjectionModel | None, field_name: str
) -> str | None:
    if projection is None:
        return None
    value = getattr(projection, field_name)
    return value if isinstance(value, str) else None


def _log_skipped_timeline_item(
    index: int,
    item: Any,
    *,
    reason: str,
    exc_info: BaseException | None = None,
) -> None:
    kind = item.get("kind") if isinstance(item, dict) else None
    _HISTORY_QUERY_LOGGER.warning(
        "chat history timeline item skipped: index=%s kind=%r reason=%s",
        index,
        kind,
        reason,
        exc_info=exc_info,
    )


def _copy_mapping(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, dict) else None


def _normalize_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _copy_mapping_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    copied_items: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            copied_items.append(dict(item))
    return copied_items


def _thread_sort_key(
    thread_summary: PersistedThreadSummaryDTO,
) -> tuple[float, float, float, str]:
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
