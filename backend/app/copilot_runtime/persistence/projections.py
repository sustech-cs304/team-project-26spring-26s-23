"""Projection refresh and rebuild helpers for persisted chat history."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from ._projections.helpers import (
    _apply_thread_display_candidates,
    _build_drift_placeholder,
    _build_model_snapshot,
    _build_run_projection_payload,
    _build_summary_candidate,
    _build_timeline_preview,
    _build_title_candidate,
    _build_tools_snapshot,
)
from .models.chat import RunModel, ThreadModel
from .repositories.chat import PersistenceRepositories, run_lifecycle_transaction

if TYPE_CHECKING:
    pass


@dataclass(frozen=True, slots=True)
class ProjectionRebuildStats:
    rebuilt_run_count: int
    rebuilt_thread_count: int


class ProjectionService:
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def refresh_run(self, run_id: str) -> None:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            self.refresh_run_in_transaction(repositories, run_id)

    def refresh_thread(self, thread_id: str) -> None:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            self.refresh_thread_in_transaction(repositories, thread_id)

    def rebuild_all(self) -> ProjectionRebuildStats:
        with run_lifecycle_transaction(self._session_factory) as repositories:
            run_ids = tuple(
                repositories.session.execute(
                    select(RunModel.id).order_by(
                        RunModel.created_at.asc(), RunModel.id.asc()
                    )
                ).scalars()
            )
            thread_ids = tuple(
                repositories.session.execute(
                    select(ThreadModel.id).order_by(
                        ThreadModel.created_at.asc(), ThreadModel.id.asc()
                    )
                ).scalars()
            )
            for run_id in run_ids:
                self.refresh_run_in_transaction(
                    repositories, run_id, refresh_thread=False
                )
            for thread_id in thread_ids:
                self.refresh_thread_in_transaction(repositories, thread_id)
            return ProjectionRebuildStats(
                rebuilt_run_count=len(run_ids),
                rebuilt_thread_count=len(thread_ids),
            )

    @staticmethod
    def refresh_run_in_transaction(
        repositories: PersistenceRepositories,
        run_id: str,
        *,
        refresh_thread: bool = True,
    ) -> None:
        run = repositories.runs.require(run_id)
        events = repositories.events.list_for_run(run_id)
        projection_payload = _build_run_projection_payload(run=run, events=events)
        repositories.projections.upsert_run_projection(
            run_id=run_id,
            assistant_text_final=projection_payload.assistant_text_final,
            timeline_items_json=projection_payload.timeline_items,
            tool_call_blocks_json=projection_payload.tool_call_blocks,
            diagnostic_blocks_json=projection_payload.diagnostic_blocks,
            terminal_state_json=projection_payload.terminal_state,
        )
        if refresh_thread:
            ProjectionService.refresh_thread_in_transaction(repositories, run.thread_id)

    @staticmethod
    def refresh_thread_in_transaction(
        repositories: PersistenceRepositories,
        thread_id: str,
    ) -> None:
        thread = repositories.threads.require(thread_id)
        runs = repositories.runs.list_for_thread(thread_id)
        latest_run = _resolve_latest_thread_run(
            repositories, thread_id, runs=runs, last_run_id=thread.last_run_id
        )
        latest_projection = None
        if latest_run is not None:
            latest_projection = repositories.projections.get_run_projection(
                latest_run.id
            )
            if latest_projection is None:
                ProjectionService.refresh_run_in_transaction(
                    repositories,
                    latest_run.id,
                    refresh_thread=False,
                )
                latest_projection = repositories.projections.get_run_projection(
                    latest_run.id
                )

        title_candidate = _build_title_candidate(thread=thread, runs=runs)
        summary_candidate = _build_summary_candidate(thread=thread, runs=runs)
        _apply_thread_display_candidates(
            thread=thread,
            title_candidate=title_candidate,
            summary_candidate=summary_candidate,
        )
        repositories.session.flush()

        last_activity_at = (
            latest_run.ended_at
            if latest_run is not None and latest_run.ended_at is not None
            else latest_run.updated_at
            if latest_run is not None
            else thread.updated_at
        )
        display_title = thread.title if thread.title is not None else title_candidate
        display_summary = (
            thread.summary_text
            if thread.summary_text is not None
            else summary_candidate
        )
        repositories.projections.upsert_thread_projection(
            thread_id=thread_id,
            last_run_status=None if latest_run is None else latest_run.status,
            last_activity_at=last_activity_at,
            display_title=display_title,
            display_summary=display_summary,
            last_effective_model_snapshot_json=_build_model_snapshot(latest_run),
            last_effective_tools_snapshot_json=_build_tools_snapshot(latest_run),
            drift_summary_json=_build_drift_placeholder(latest_run),
            timeline_preview_json=_build_timeline_preview(latest_projection),
        )


def _resolve_latest_thread_run(
    repositories: PersistenceRepositories,
    thread_id: str,
    *,
    runs: tuple[RunModel, ...],
    last_run_id: str | None,
) -> RunModel | None:
    if last_run_id is not None:
        pointed_run = repositories.runs.get(last_run_id)
        if pointed_run is not None and pointed_run.thread_id == thread_id:
            return pointed_run

    if len(runs) == 0:
        return None

    return max(
        runs,
        key=lambda run: (
            run.ended_at or run.updated_at or run.created_at,
            run.updated_at,
            run.created_at,
            run.id,
        ),
    )


__all__ = ["ProjectionRebuildStats", "ProjectionService"]
