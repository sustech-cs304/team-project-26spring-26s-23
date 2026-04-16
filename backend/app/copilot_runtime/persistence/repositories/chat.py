"""Repository layer for Copilot runtime persistence."""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.session_store import (
    RuntimeMessageRole,
    RuntimeRunEventRecord,
    RuntimeRunRecord,
    RuntimeRunStatus,
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
    RuntimeStoredThinkingSelection,
    RuntimeThreadRecord,
)

from ..db import session_scope
from ..models.chat import RunEventModel, RunModel, RunProjectionModel, ThreadModel, ThreadProjectionModel
from ..redaction import redact_payload


@dataclass(frozen=True, slots=True)
class PersistenceRepositories:
    session: Session
    threads: "ThreadRepository"
    runs: "RunRepository"
    events: "RunEventRepository"
    projections: "ProjectionRepository"


@contextmanager
def run_lifecycle_transaction(
    session_factory: sessionmaker[Session],
) -> Iterator[PersistenceRepositories]:
    with session_scope(session_factory) as session:
        yield PersistenceRepositories(
            session=session,
            threads=ThreadRepository(session),
            runs=RunRepository(session),
            events=RunEventRepository(session),
            projections=ProjectionRepository(session),
        )


class ThreadRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, thread_id: str) -> ThreadModel | None:
        return self._session.get(ThreadModel, thread_id)

    def require(self, thread_id: str) -> ThreadModel:
        thread = self.get(thread_id)
        if thread is None:
            raise LookupError(f"Thread '{thread_id}' does not exist.")
        return thread

    def create_from_runtime_record(self, thread: RuntimeThreadRecord) -> ThreadModel:
        model = ThreadModel(
            id=thread.thread_id,
            bound_agent_id=thread.bound_agent_id,
            metadata_json=dict(thread.metadata),
            last_run_id=thread.last_run_id,
            created_at=_coerce_datetime(thread.created_at),
            updated_at=_coerce_datetime(thread.updated_at),
        )
        self._session.add(model)
        self._session.flush()
        return model

    def apply_runtime_record(self, model: ThreadModel, thread: RuntimeThreadRecord) -> ThreadModel:
        model.bound_agent_id = thread.bound_agent_id
        model.metadata_json = dict(thread.metadata)
        model.last_run_id = thread.last_run_id
        model.created_at = _coerce_datetime(thread.created_at)
        model.updated_at = _coerce_datetime(thread.updated_at)
        return model

    def soft_delete(self, thread_id: str, *, deleted_at: datetime) -> ThreadModel:
        model = self.require(thread_id)
        resolved_deleted_at = _coerce_datetime(deleted_at)
        model.deleted_at = resolved_deleted_at
        model.updated_at = resolved_deleted_at
        self._session.flush()
        return model

    def hard_delete(self, thread_id: str) -> ThreadModel:
        model = self.require(thread_id)
        self._session.delete(model)
        self._session.flush()
        return model

    def touch_for_run(self, model: ThreadModel, run: RuntimeRunRecord) -> ThreadModel:
        metadata = dict(model.metadata_json or {})
        metadata["last_run_id"] = run.run_id
        model.metadata_json = metadata
        model.last_run_id = run.run_id
        model.last_user_message_preview = _build_preview(run.request.message_content)
        model.last_assistant_message_preview = _build_preview(run.assistant_text)
        model.updated_at = _coerce_datetime(run.updated_at)
        return model

    def to_runtime_record(self, model: ThreadModel) -> RuntimeThreadRecord:
        return RuntimeThreadRecord(
            thread_id=model.id,
            bound_agent_id=model.bound_agent_id,
            metadata=dict(model.metadata_json or {}),
            last_run_id=model.last_run_id,
            created_at=_coerce_datetime(model.created_at),
            updated_at=_coerce_datetime(model.updated_at),
        )


class RunRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, run_id: str) -> RunModel | None:
        return self._session.get(RunModel, run_id)

    def require(self, run_id: str) -> RunModel:
        run = self.get(run_id)
        if run is None:
            raise LookupError(f"Run '{run_id}' does not exist.")
        return run

    def list_for_thread(self, thread_id: str) -> tuple[RunModel, ...]:
        result = self._session.execute(
            select(RunModel)
            .where(RunModel.thread_id == thread_id)
            .order_by(RunModel.created_at.asc(), RunModel.id.asc())
        )
        return tuple(result.scalars())

    def latest_for_thread(self, thread_id: str) -> RunModel | None:
        result = self._session.execute(
            select(RunModel)
            .where(RunModel.thread_id == thread_id)
            .order_by(RunModel.created_at.desc(), RunModel.id.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    def create_from_runtime_record(self, run: RuntimeRunRecord) -> RunModel:
        model = RunModel(
            id=run.run_id,
            thread_id=run.thread_id,
            created_at=_coerce_datetime(run.created_at),
            updated_at=_coerce_datetime(run.updated_at),
            **_build_run_column_values(run),
        )
        self._session.add(model)
        self._session.flush()
        return model

    def apply_runtime_record(self, model: RunModel, run: RuntimeRunRecord) -> RunModel:
        values = _build_run_column_values(run)
        for field_name, value in values.items():
            setattr(model, field_name, value)
        model.created_at = _coerce_datetime(run.created_at)
        model.updated_at = _coerce_datetime(run.updated_at)
        return model

    def to_runtime_record(self, model: RunModel) -> RuntimeRunRecord:
        return RuntimeRunRecord(
            run_id=model.id,
            thread_id=model.thread_id,
            request=RuntimeStoredRunInput(
                message_role=_coerce_runtime_message_role(model.request_message_role),
                message_content=model.request_message_text,
                policy=RuntimeStoredRunPolicy(
                    model_route=_deserialize_model_route(model.selected_model_route_json),
                    thinking_selection=_deserialize_thinking_selection(model.requested_thinking_json),
                    thinking_level_intent=model.thinking_level_intent,
                    thinking_capability_override=_copy_mapping(model.thinking_capability_override_json),
                    enabled_tools=_deserialize_string_tuple(model.enabled_tools_json),
                    debug_mode_enabled=model.debug_mode_enabled,
                    request_options=_copy_mapping(model.request_options_json),
                ),
                agent_id=model.agent_id,
            ),
            status=_coerce_runtime_run_status(model.status),
            metadata=_copy_mapping(model.metadata_json),
            cancel_requested=model.cancel_requested,
            assistant_text=model.assistant_text,
            event_log=[],
            created_at=_coerce_datetime(model.created_at),
            updated_at=_coerce_datetime(model.updated_at),
            started_at=_coerce_optional_datetime(model.started_at),
            terminal_at=_coerce_optional_datetime(model.ended_at),
        )


class RunEventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def list_for_run(self, run_id: str) -> tuple[RunEventModel, ...]:
        result = self._session.execute(
            select(RunEventModel)
            .where(RunEventModel.run_id == run_id)
            .order_by(RunEventModel.seq.asc(), RunEventModel.id.asc())
        )
        return tuple(result.scalars())

    def append_event(
        self,
        *,
        run_id: str,
        event_type: str,
        payload: Mapping[str, Any] | None = None,
    ) -> RunEventModel:
        next_sequence = self._next_sequence(run_id)
        redaction = redact_payload(payload)
        payload_json = dict(redaction.value)
        model = RunEventModel(
            run_id=run_id,
            seq=next_sequence,
            event_type=event_type,
            payload_json=payload_json,
            payload_text_search=_build_payload_text_search(payload_json),
            tool_call_id=_extract_optional_string(payload_json, "toolCallId", "tool_call_id"),
            tool_id=_extract_optional_string(payload_json, "toolId", "tool_id"),
            phase=_extract_optional_string(payload_json, "phase"),
            created_at=datetime.now(UTC),
            redaction_version=redaction.redaction_version,
            is_redacted=redaction.is_redacted,
        )
        self._session.add(model)
        self._session.flush()
        return model

    def to_runtime_record(self, model: RunEventModel) -> RuntimeRunEventRecord:
        return RuntimeRunEventRecord(
            event_type=model.event_type,
            payload=_copy_mapping(model.payload_json),
            sequence=model.seq,
            created_at=_coerce_datetime(model.created_at),
        )

    def clone_for_run(
        self,
        source_event: RunEventModel,
        *,
        run_id: str,
        created_at: datetime,
    ) -> RunEventModel:
        payload_json = dict(source_event.payload_json or {})
        model = RunEventModel(
            run_id=run_id,
            seq=source_event.seq,
            event_type=source_event.event_type,
            payload_json=payload_json,
            payload_text_search=_build_payload_text_search(payload_json),
            tool_call_id=source_event.tool_call_id,
            tool_id=source_event.tool_id,
            phase=source_event.phase,
            created_at=_coerce_datetime(created_at),
            redaction_version=source_event.redaction_version,
            is_redacted=source_event.is_redacted,
        )
        self._session.add(model)
        self._session.flush()
        return model

    def _next_sequence(self, run_id: str) -> int:
        result = self._session.execute(
            select(func.coalesce(func.max(RunEventModel.seq), 0)).where(RunEventModel.run_id == run_id)
        )
        current_max = int(result.scalar_one())
        return current_max + 1


class ProjectionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get_thread_projection(self, thread_id: str) -> ThreadProjectionModel | None:
        return self._session.get(ThreadProjectionModel, thread_id)

    def get_run_projection(self, run_id: str) -> RunProjectionModel | None:
        return self._session.get(RunProjectionModel, run_id)

    def upsert_thread_projection(
        self,
        *,
        thread_id: str,
        last_run_status: str | None = None,
        last_activity_at: datetime | None = None,
        display_title: str | None = None,
        display_summary: str | None = None,
        last_effective_model_snapshot_json: Mapping[str, Any] | None = None,
        last_effective_tools_snapshot_json: Mapping[str, Any] | None = None,
        drift_summary_json: Mapping[str, Any] | None = None,
        timeline_preview_json: Sequence[Mapping[str, Any]] | None = None,
    ) -> ThreadProjectionModel:
        projection = self.get_thread_projection(thread_id)
        if projection is None:
            projection = ThreadProjectionModel(thread_id=thread_id)
            self._session.add(projection)
        projection.last_run_status = last_run_status
        projection.last_activity_at = _coerce_optional_datetime(last_activity_at)
        projection.display_title = display_title
        projection.display_summary = display_summary
        projection.last_effective_model_snapshot_json = _copy_mapping(last_effective_model_snapshot_json)
        projection.last_effective_tools_snapshot_json = _copy_mapping(last_effective_tools_snapshot_json)
        projection.drift_summary_json = _copy_mapping(drift_summary_json)
        projection.timeline_preview_json = _copy_mapping_list(timeline_preview_json)
        projection.updated_at = datetime.now(UTC)
        self._session.flush()
        return projection

    def upsert_run_projection(
        self,
        *,
        run_id: str,
        assistant_text_final: str | None = None,
        timeline_items_json: Sequence[Mapping[str, Any]] | None = None,
        tool_call_blocks_json: Sequence[Mapping[str, Any]] | None = None,
        diagnostic_blocks_json: Sequence[Mapping[str, Any]] | None = None,
        terminal_state_json: Mapping[str, Any] | None = None,
    ) -> RunProjectionModel:
        projection = self.get_run_projection(run_id)
        if projection is None:
            projection = RunProjectionModel(run_id=run_id)
            self._session.add(projection)
        projection.assistant_text_final = assistant_text_final
        projection.timeline_items_json = _copy_mapping_list(timeline_items_json)
        projection.tool_call_blocks_json = _copy_mapping_list(tool_call_blocks_json)
        projection.diagnostic_blocks_json = _copy_mapping_list(diagnostic_blocks_json)
        projection.terminal_state_json = _copy_mapping(terminal_state_json)
        projection.updated_at = datetime.now(UTC)
        self._session.flush()
        return projection



def _build_run_column_values(run: RuntimeRunRecord) -> dict[str, Any]:
    terminal_payload = run.metadata.get("terminal_payload")
    terminal_payload_dict = terminal_payload if isinstance(terminal_payload, Mapping) else {}
    resolved_model_route = run.metadata.get("resolvedModelRoute")
    resolved_model_route_json = _copy_mapping(resolved_model_route)
    selected_model_route_json = _serialize_model_route(run.request.policy.model_route)
    requested_thinking_json = _normalize_dict(
        run.metadata.get("requestedThinkingSelection")
    ) or _serialize_thinking_selection(run.request.policy.thinking_selection)
    applied_thinking_json = _normalize_dict(run.metadata.get("appliedThinkingSelection"))
    request_options_json = _normalize_dict(terminal_payload_dict.get("requestOptions")) or dict(
        run.request.policy.request_options
    )
    resolved_tool_ids_json = _normalize_string_list(terminal_payload_dict.get("resolvedToolIds"))
    failure_details_json = _normalize_dict(terminal_payload_dict.get("details"))
    return {
        "agent_id": run.request.agent_id,
        "status": run.status,
        "request_message_text": run.request.message_content,
        "request_message_role": run.request.message_role,
        "selected_model_route_json": selected_model_route_json,
        "resolved_model_route_json": resolved_model_route_json,
        "resolved_model_id": _resolve_model_id(
            resolved_model_route_json,
            run.request.policy.model_route.route_ref.model_id,
        ),
        "requested_thinking_json": requested_thinking_json,
        "applied_thinking_json": applied_thinking_json,
        "thinking_capability_override_json": _copy_mapping(
            run.request.policy.thinking_capability_override
        ),
        "thinking_level_intent": run.request.policy.thinking_level_intent,
        "enabled_tools_json": list(run.request.policy.enabled_tools),
        "resolved_tool_ids_json": resolved_tool_ids_json,
        "request_options_json": request_options_json,
        "debug_mode_enabled": run.request.policy.debug_mode_enabled,
        "metadata_json": dict(run.metadata),
        "cancel_requested": run.cancel_requested,
        "assistant_text": run.assistant_text,
        "failure_code": _extract_failure_code(run.status, terminal_payload_dict),
        "failure_message": _extract_failure_message(run.status, terminal_payload_dict),
        "failure_details_json": failure_details_json,
        "cancel_reason": _extract_cancel_reason(run.status, terminal_payload_dict),
        "started_at": _coerce_optional_datetime(run.started_at),
        "ended_at": _coerce_optional_datetime(run.terminal_at),
    }



def _serialize_model_route(model_route: RuntimeStoredModelRoute) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "providerProfileId": model_route.provider_profile_id,
        "routeRef": model_route.route_ref.to_dict(),
    }
    if model_route.catalog_revision is not None and model_route.catalog_revision.strip() != "":
        payload["catalogRevision"] = model_route.catalog_revision.strip()
    return payload



def _deserialize_model_route(payload: Mapping[str, Any] | None) -> RuntimeStoredModelRoute:
    normalized_payload = dict(payload or {})
    route_ref_payload = normalized_payload.get("routeRef")
    if not isinstance(route_ref_payload, Mapping):
        raise ValueError("Stored selected_model_route_json is missing routeRef.")
    provider_profile_id = str(
        normalized_payload.get("providerProfileId")
        or route_ref_payload.get("profileId")
        or ""
    ).strip()
    if provider_profile_id == "":
        raise ValueError("Stored selected_model_route_json is missing providerProfileId.")
    route_ref = RuntimeModelRouteRef(
        route_kind=str(route_ref_payload.get("routeKind") or "provider-model"),
        profile_id=provider_profile_id,
        model_id=str(route_ref_payload.get("modelId") or "").strip(),
    )
    return RuntimeStoredModelRoute(
        provider_profile_id=provider_profile_id,
        route_ref=route_ref,
        catalog_revision=_normalize_optional_string(normalized_payload.get("catalogRevision")),
    )



def _serialize_thinking_selection(
    selection: RuntimeStoredThinkingSelection | None,
) -> dict[str, Any] | None:
    if selection is None:
        return None
    return {
        "series": selection.series,
        "mode": selection.mode,
        "level": selection.level,
        "budgetTokens": selection.budget_tokens,
        "value": None if selection.value_payload is None else dict(selection.value_payload),
    }



def _deserialize_thinking_selection(
    payload: Mapping[str, Any] | None,
) -> RuntimeStoredThinkingSelection | None:
    if payload is None:
        return None
    series = _normalize_optional_string(payload.get("series"))
    if series is None:
        return None
    value_payload = payload.get("value")
    return RuntimeStoredThinkingSelection(
        series=series,
        mode=_normalize_optional_string(payload.get("mode")),
        level=_normalize_optional_string(payload.get("level")),
        budget_tokens=_normalize_optional_int(payload.get("budgetTokens")),
        value_payload=dict(value_payload) if isinstance(value_payload, Mapping) else None,
    )



def _resolve_model_id(payload: Mapping[str, Any] | None, fallback: str) -> str:
    if isinstance(payload, Mapping):
        model_id = _normalize_optional_string(payload.get("modelId"))
        if model_id is not None:
            return model_id
        route_ref = payload.get("routeRef")
        if isinstance(route_ref, Mapping):
            route_ref_model_id = _normalize_optional_string(route_ref.get("modelId"))
            if route_ref_model_id is not None:
                return route_ref_model_id
    return fallback



def _extract_failure_code(status: str, terminal_payload: Mapping[str, Any]) -> str | None:
    if status != "failed":
        return None
    return _normalize_optional_string(terminal_payload.get("code"))



def _extract_failure_message(status: str, terminal_payload: Mapping[str, Any]) -> str | None:
    if status != "failed":
        return None
    return _normalize_optional_string(terminal_payload.get("message"))



def _extract_cancel_reason(status: str, terminal_payload: Mapping[str, Any]) -> str | None:
    if status != "cancelled":
        return None
    return _normalize_optional_string(terminal_payload.get("reason"))



def _build_payload_text_search(payload: Mapping[str, Any]) -> str:
    flattened = _flatten_payload_values(payload)
    if len(flattened) == 0:
        return ""
    return " ".join(flattened)



def _flatten_payload_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, Mapping):
        flattened: list[str] = []
        for nested_value in value.values():
            flattened.extend(_flatten_payload_values(nested_value))
        return flattened
    if isinstance(value, (list, tuple, set, frozenset)):
        flattened: list[str] = []
        for item in value:
            flattened.extend(_flatten_payload_values(item))
        return flattened
    if isinstance(value, (bool, int, float, str)):
        text = str(value).strip()
        return [] if text == "" else [text]
    try:
        text = json.dumps(value, ensure_ascii=False, sort_keys=True)
    except TypeError:
        text = str(value)
    text = text.strip()
    return [] if text == "" else [text]



def _extract_optional_string(payload: Mapping[str, Any], *keys: str) -> str | None:
    for key in keys:
        normalized = _normalize_optional_string(payload.get(key))
        if normalized is not None:
            return normalized
    return None



def _normalize_dict(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, Mapping) else None



def _normalize_string_list(value: Any) -> list[str] | None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        return None
    normalized: list[str] = []
    for item in value:
        text = _normalize_optional_string(item)
        if text is not None:
            normalized.append(text)
    return normalized



def _deserialize_string_tuple(value: Any) -> tuple[str, ...]:
    normalized = _normalize_string_list(value)
    return tuple(normalized or [])



def _copy_mapping(value: Mapping[str, Any] | None) -> dict[str, Any]:
    return {} if value is None else dict(value)



def _copy_mapping_list(value: Sequence[Mapping[str, Any]] | None) -> list[dict[str, Any]] | None:
    if value is None:
        return None
    return [dict(item) for item in value]



def _coerce_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)



def _coerce_optional_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return _coerce_datetime(value)



def _normalize_optional_string(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None



def _coerce_runtime_message_role(value: object | None) -> RuntimeMessageRole:
    normalized = _normalize_optional_string(value)
    if normalized in {"user", "assistant"}:
        return cast(RuntimeMessageRole, normalized)
    raise ValueError(f"Stored request_message_role is invalid: {value!r}")



def _coerce_runtime_run_status(value: object | None) -> RuntimeRunStatus:
    normalized = _normalize_optional_string(value)
    if normalized in {"pending", "streaming", "cancellation_requested", "completed", "failed", "cancelled"}:
        return cast(RuntimeRunStatus, normalized)
    raise ValueError(f"Stored run status is invalid: {value!r}")



def _normalize_optional_int(value: object | None) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str):
        normalized = value.strip()
        if normalized == "":
            return None
        try:
            return int(normalized)
        except ValueError:
            return None
    return None



def _build_preview(value: str | None, *, limit: int = 160) -> str | None:
    normalized = _normalize_optional_string(value)
    if normalized is None:
        return None
    return normalized if len(normalized) <= limit else normalized[:limit].rstrip()


__all__ = [
    "PersistenceRepositories",
    "ProjectionRepository",
    "RunEventRepository",
    "RunRepository",
    "ThreadRepository",
    "run_lifecycle_transaction",
]
