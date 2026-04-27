"""Query services for persisted chat history views."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ._queries.builders import (
    _build_diagnostic_blocks,
    _build_run_event,
    _build_run_historical_snapshot,
    _build_run_summary,
    _build_terminal_state_snapshot,
    _build_thread_configuration_snapshot,
    _build_thread_summary,
    _build_timeline_items,
    _build_tool_call_blocks,
    _copy_mapping,
    _ensure_run_projection,
    _ensure_thread_projection,
    _thread_sort_key,
)
from .drift import PersistedHistoryDriftEvaluator
from .models.chat import ThreadModel
from .query_dtos import (
    PersistedDatabaseBackupResponse,
    PersistedDatabaseRestoreResponse,
    PersistedRunReplayResponse,
    PersistedThreadDeleteResponse,
    PersistedThreadDetailResponse,
    PersistedThreadDuplicateResponse,
    PersistedThreadListResponse,
    PersistedThreadRenameResponse,
    PersistedTimelineItemDTO,
)
from .repositories import PersistenceRepositories, run_lifecycle_transaction

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
            run_summaries: list = []
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


__all__ = ["PersistedChatQueryService"]
