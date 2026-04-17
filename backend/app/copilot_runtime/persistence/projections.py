"""Projection refresh and rebuild helpers for persisted chat history."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from .models.chat import RunEventModel, RunModel, ThreadModel
from .repositories.chat import PersistenceRepositories, run_lifecycle_transaction

_USER_MESSAGE_KIND = "user_message"
_ASSISTANT_MESSAGE_KIND = "assistant_message"
_REASONING_BLOCK_KIND = "reasoning_block"
_TOOL_CALL_BLOCK_KIND = "tool_call_block"
_DIAGNOSTIC_BLOCK_KIND = "diagnostic_block"
_TERMINAL_BLOCK_KIND = "terminal_block"
_TERMINAL_EVENT_TYPES = frozenset({"run_completed", "run_failed", "run_cancelled"})
_DETERMINISTIC_SOURCE = "deterministic"
_NOT_EVALUATED_DRIFT_STATUS = "not_evaluated"


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
                repositories.session.execute(select(RunModel.id).order_by(RunModel.created_at.asc(), RunModel.id.asc()))
                .scalars()
            )
            thread_ids = tuple(
                repositories.session.execute(
                    select(ThreadModel.id).order_by(ThreadModel.created_at.asc(), ThreadModel.id.asc())
                ).scalars()
            )
            for run_id in run_ids:
                self.refresh_run_in_transaction(repositories, run_id, refresh_thread=False)
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
        latest_run = _resolve_latest_thread_run(repositories, thread_id, runs=runs, last_run_id=thread.last_run_id)
        latest_projection = None
        if latest_run is not None:
            latest_projection = repositories.projections.get_run_projection(latest_run.id)
            if latest_projection is None:
                ProjectionService.refresh_run_in_transaction(
                    repositories,
                    latest_run.id,
                    refresh_thread=False,
                )
                latest_projection = repositories.projections.get_run_projection(latest_run.id)

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
        display_summary = thread.summary_text if thread.summary_text is not None else summary_candidate
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


@dataclass(frozen=True, slots=True)
class _RunProjectionPayload:
    assistant_text_final: str | None
    timeline_items: list[dict[str, Any]]
    tool_call_blocks: list[dict[str, Any]]
    diagnostic_blocks: list[dict[str, Any]]
    terminal_state: dict[str, Any] | None


@dataclass(frozen=True, slots=True)
class _TimelineEntry:
    order_key: tuple[int, str]
    item: dict[str, Any]


def _build_run_projection_payload(
    *,
    run: RunModel,
    events: tuple[RunEventModel, ...],
) -> _RunProjectionPayload:
    timeline_entries: list[_TimelineEntry] = [
        _TimelineEntry(
            order_key=(0, _serialize_datetime(run.created_at)),
            item={
                "kind": _USER_MESSAGE_KIND,
                "runId": run.id,
                "threadId": run.thread_id,
                "sequenceStart": 0,
                "sequenceEnd": 0,
                "createdAt": _serialize_datetime(run.created_at),
                "role": run.request_message_role,
                "text": run.request_message_text,
            },
        )
    ]
    tool_call_blocks_by_key: dict[str, dict[str, Any]] = {}
    tool_call_blocks: list[dict[str, Any]] = []
    diagnostic_blocks: list[dict[str, Any]] = []
    terminal_state: dict[str, Any] | None = None
    assistant_text_segments: list[str] = []

    index = 0
    while index < len(events):
        event = events[index]
        event_type = event.event_type
        if event_type == "text_delta":
            assistant_block, next_index = _consume_delta_group(
                run=run,
                events=events,
                start_index=index,
                event_type="text_delta",
                block_kind=_ASSISTANT_MESSAGE_KIND,
            )
            if assistant_block is not None:
                text = _normalize_text(assistant_block.get("text"))
                if text is not None:
                    assistant_text_segments.append(text)
                timeline_entries.append(
                    _TimelineEntry(
                        order_key=(int(assistant_block["sequenceStart"]), str(assistant_block["createdAt"])),
                        item=assistant_block,
                    )
                )
            index = next_index
            continue
        if event_type == "reasoning_delta":
            reasoning_block, next_index = _consume_delta_group(
                run=run,
                events=events,
                start_index=index,
                event_type="reasoning_delta",
                block_kind=_REASONING_BLOCK_KIND,
            )
            if reasoning_block is not None:
                timeline_entries.append(
                    _TimelineEntry(
                        order_key=(int(reasoning_block["sequenceStart"]), str(reasoning_block["createdAt"])),
                        item=reasoning_block,
                    )
                )
            index = next_index
            continue
        if event_type == "tool_event":
            tool_call_key = _tool_call_key(event)
            block = tool_call_blocks_by_key.get(tool_call_key)
            if block is None:
                block = {
                    "kind": _TOOL_CALL_BLOCK_KIND,
                    "runId": run.id,
                    "threadId": run.thread_id,
                    "toolCallId": _normalize_optional_string(event.tool_call_id) or tool_call_key,
                    "toolId": _normalize_optional_string(event.tool_id)
                    or _normalize_optional_string(event.payload_json.get("toolId")),
                    "sequenceStart": event.seq,
                    "sequenceEnd": event.seq,
                    "createdAt": _serialize_datetime(event.created_at),
                    "title": _normalize_optional_string(event.payload_json.get("title")),
                    "summary": _normalize_optional_string(event.payload_json.get("summary")),
                    "inputSummary": _normalize_optional_string(event.payload_json.get("inputSummary")),
                    "resultSummary": _normalize_optional_string(event.payload_json.get("resultSummary")),
                    "errorSummary": _normalize_optional_string(event.payload_json.get("errorSummary")),
                    "phases": [],
                }
                tool_call_blocks_by_key[tool_call_key] = block
                tool_call_blocks.append(block)
                timeline_entries.append(
                    _TimelineEntry(
                        order_key=(event.seq, _serialize_datetime(event.created_at)),
                        item=block,
                    )
                )
            _apply_tool_event_to_block(block=block, event=event)
            index += 1
            continue
        if event_type == "run_diagnostic":
            diagnostic_block = {
                "kind": _DIAGNOSTIC_BLOCK_KIND,
                "runId": run.id,
                "threadId": run.thread_id,
                "sequenceStart": event.seq,
                "sequenceEnd": event.seq,
                "createdAt": _serialize_datetime(event.created_at),
                "code": _normalize_optional_string(event.payload_json.get("code")),
                "message": _normalize_optional_string(event.payload_json.get("message")),
                "stage": _normalize_optional_string(event.payload_json.get("stage")),
                "details": _copy_mapping(event.payload_json.get("details")),
            }
            diagnostic_blocks.append(diagnostic_block)
            timeline_entries.append(
                _TimelineEntry(
                    order_key=(event.seq, _serialize_datetime(event.created_at)),
                    item=diagnostic_block,
                )
            )
            index += 1
            continue
        if event_type in _TERMINAL_EVENT_TYPES:
            terminal_state = _build_terminal_state(run=run, event=event)
            timeline_entries.append(
                _TimelineEntry(
                    order_key=(event.seq, _serialize_datetime(event.created_at)),
                    item={
                        "kind": _TERMINAL_BLOCK_KIND,
                        "runId": run.id,
                        "threadId": run.thread_id,
                        "sequenceStart": event.seq,
                        "sequenceEnd": event.seq,
                        "createdAt": _serialize_datetime(event.created_at),
                        **terminal_state,
                    },
                )
            )
            index += 1
            continue
        index += 1

    assistant_text_final = _normalize_text(run.assistant_text) or _normalize_text("".join(assistant_text_segments))
    if terminal_state is None and run.status in {"completed", "failed", "cancelled"}:
        terminal_state = _build_terminal_state(run=run, event=None)
        timeline_entries.append(
            _TimelineEntry(
                order_key=(len(events) + 1, _serialize_datetime(run.updated_at)),
                item={
                    "kind": _TERMINAL_BLOCK_KIND,
                    "runId": run.id,
                    "threadId": run.thread_id,
                    "sequenceStart": len(events) + 1,
                    "sequenceEnd": len(events) + 1,
                    "createdAt": _serialize_datetime(run.updated_at),
                    **terminal_state,
                },
            )
        )

    ordered_timeline_items = [
        dict(entry.item)
        for entry in sorted(timeline_entries, key=lambda entry: entry.order_key)
    ]
    return _RunProjectionPayload(
        assistant_text_final=assistant_text_final,
        timeline_items=ordered_timeline_items,
        tool_call_blocks=[dict(block) for block in tool_call_blocks],
        diagnostic_blocks=[dict(block) for block in diagnostic_blocks],
        terminal_state=terminal_state,
    )


def _consume_delta_group(
    *,
    run: RunModel,
    events: tuple[RunEventModel, ...],
    start_index: int,
    event_type: str,
    block_kind: str,
) -> tuple[dict[str, Any] | None, int]:
    start_event = events[start_index]
    next_index = start_index
    text_parts: list[str] = []
    end_event = start_event
    while next_index < len(events) and events[next_index].event_type == event_type:
        current_event = events[next_index]
        text_parts.append(str(current_event.payload_json.get("delta", "")))
        end_event = current_event
        next_index += 1
    text = _normalize_text("".join(text_parts))
    if text is None:
        return None, next_index
    return {
        "kind": block_kind,
        "runId": run.id,
        "threadId": run.thread_id,
        "sequenceStart": start_event.seq,
        "sequenceEnd": end_event.seq,
        "createdAt": _serialize_datetime(start_event.created_at),
        "text": text,
    }, next_index


def _apply_tool_event_to_block(*, block: dict[str, Any], event: RunEventModel) -> None:
    block["sequenceStart"] = min(int(block["sequenceStart"]), event.seq)
    block["sequenceEnd"] = max(int(block["sequenceEnd"]), event.seq)
    block["toolId"] = block.get("toolId") or _normalize_optional_string(event.payload_json.get("toolId"))
    for field_name, payload_key in (
        ("title", "title"),
        ("summary", "summary"),
        ("inputSummary", "inputSummary"),
        ("resultSummary", "resultSummary"),
        ("errorSummary", "errorSummary"),
    ):
        next_value = _normalize_optional_string(event.payload_json.get(payload_key))
        if next_value is not None:
            block[field_name] = next_value
    phases = block.setdefault("phases", [])
    phases.append(
        {
            "phase": _normalize_optional_string(event.payload_json.get("phase")) or "unknown",
            "sequence": event.seq,
            "createdAt": _serialize_datetime(event.created_at),
            "title": _normalize_optional_string(event.payload_json.get("title")),
            "summary": _normalize_optional_string(event.payload_json.get("summary")),
            "inputSummary": _normalize_optional_string(event.payload_json.get("inputSummary")),
            "resultSummary": _normalize_optional_string(event.payload_json.get("resultSummary")),
            "errorSummary": _normalize_optional_string(event.payload_json.get("errorSummary")),
        }
    )


def _tool_call_key(event: RunEventModel) -> str:
    normalized_tool_call_id = _normalize_optional_string(event.tool_call_id)
    if normalized_tool_call_id is not None:
        return normalized_tool_call_id
    payload_tool_call_id = _normalize_optional_string(event.payload_json.get("toolCallId"))
    if payload_tool_call_id is not None:
        return payload_tool_call_id
    return f"tool-event-{event.seq}"


def _build_terminal_state(
    *,
    run: RunModel,
    event: RunEventModel | None,
) -> dict[str, Any]:
    payload = dict(event.payload_json) if event is not None else _copy_mapping(run.metadata_json.get("terminal_payload")) or {}
    event_type = event.event_type if event is not None else _normalize_optional_string(run.metadata_json.get("terminal_event"))
    return {
        "status": run.status,
        "eventType": event_type,
        "assistantText": _normalize_optional_string(payload.get("assistantText")) or _normalize_optional_string(run.assistant_text),
        "payload": payload,
        "endedAt": _serialize_datetime(run.ended_at) if run.ended_at is not None else None,
        "failureCode": _normalize_optional_string(run.failure_code),
        "failureMessage": _normalize_optional_string(run.failure_message),
        "cancelReason": _normalize_optional_string(run.cancel_reason),
    }


def _apply_thread_display_candidates(
    *,
    thread: ThreadModel,
    title_candidate: str | None,
    summary_candidate: str | None,
) -> None:
    if title_candidate is not None and _should_apply_deterministic_value(thread.title_source, thread.title):
        thread.title = title_candidate
        thread.title_source = _DETERMINISTIC_SOURCE
    if summary_candidate is not None and _should_apply_deterministic_value(
        thread.summary_source,
        thread.summary_text,
    ):
        thread.summary_text = summary_candidate
        thread.summary_source = _DETERMINISTIC_SOURCE


def _should_apply_deterministic_value(source: str | None, value: str | None) -> bool:
    normalized_source = _normalize_optional_string(source)
    normalized_value = _normalize_text(value)
    if normalized_value is None:
        return True
    return normalized_source in {None, _DETERMINISTIC_SOURCE}


def _build_title_candidate(*, thread: ThreadModel, runs: tuple[RunModel, ...]) -> str | None:
    for run in runs:
        text = _normalize_text(run.request_message_text)
        if text is not None:
            return _truncate_text(text, limit=80)
    return _truncate_text(thread.last_user_message_preview, limit=80)



def _build_summary_candidate(*, thread: ThreadModel, runs: tuple[RunModel, ...]) -> str | None:
    for run in reversed(runs):
        assistant_text = _normalize_text(run.assistant_text)
        if assistant_text is not None:
            return _truncate_text(assistant_text, limit=160)
        user_text = _normalize_text(run.request_message_text)
        if user_text is not None:
            return _truncate_text(user_text, limit=160)
    return _truncate_text(thread.last_assistant_message_preview or thread.last_user_message_preview, limit=160)

def _build_model_snapshot(run: RunModel | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "selectedModelRoute": dict(run.selected_model_route_json or {}),
        "resolvedModelRoute": dict(run.resolved_model_route_json or {}),
        "resolvedModelId": run.resolved_model_id,
        "requestedThinkingSelection": dict(run.requested_thinking_json or {}) if run.requested_thinking_json else None,
        "appliedThinkingSelection": dict(run.applied_thinking_json or {}) if run.applied_thinking_json else None,
        "thinkingCapabilityOverride": (
            dict(run.thinking_capability_override_json)
            if run.thinking_capability_override_json not in (None, {})
            else None
        ),
        "thinkingLevelIntent": run.thinking_level_intent,
        "debugModeEnabled": run.debug_mode_enabled,
    }


def _build_tools_snapshot(run: RunModel | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "enabledToolIds": list(run.enabled_tools_json or []),
        "resolvedToolIds": list(run.resolved_tool_ids_json or []),
    }


def _build_drift_placeholder(run: RunModel | None) -> dict[str, Any] | None:
    if run is None:
        return None
    return {
        "status": _NOT_EVALUATED_DRIFT_STATUS,
        "historicalModelId": run.resolved_model_id,
        "historicalToolIds": list(run.resolved_tool_ids_json or run.enabled_tools_json or []),
    }


def _build_timeline_preview(run_projection) -> list[dict[str, Any]] | None:
    if run_projection is None or not run_projection.timeline_items_json:
        return None
    preview_items = run_projection.timeline_items_json[-3:]
    return [dict(item) for item in preview_items]


def _copy_mapping(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, dict) else None


def _normalize_optional_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _truncate_text(value: Any, *, limit: int) -> str | None:
    text = _normalize_text(value)
    if text is None:
        return None
    if len(text) <= limit:
        return text
    return f"{text[: max(limit - 1, 1)].rstrip()}…"


def _serialize_datetime(value: datetime) -> str:
    normalized = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return normalized.astimezone(UTC).isoformat().replace("+00:00", "Z")


__all__ = ["ProjectionRebuildStats", "ProjectionService"]
