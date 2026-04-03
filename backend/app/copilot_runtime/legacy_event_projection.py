"""Compatibility projection from unified execution events to legacy runtime run events."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from .execution_event_graph import (
    ASSISTANT_SEGMENT_COMPLETED_EVENT_TYPE,
    ASSISTANT_SEGMENT_DELTA_EVENT_TYPE,
    ASSISTANT_SEGMENT_STARTED_EVENT_TYPE,
    DIAGNOSTIC_EVENT_TYPE,
    RUN_CANCELLED_EVENT_TYPE as EXECUTION_RUN_CANCELLED_EVENT_TYPE,
    RUN_COMPLETED_EVENT_TYPE as EXECUTION_RUN_COMPLETED_EVENT_TYPE,
    RUN_FAILED_EVENT_TYPE as EXECUTION_RUN_FAILED_EVENT_TYPE,
    RuntimeExecutionEvent,
)
from .model_routes import ResolvedRuntimeModelRoute
from .run_events import (
    RUN_CANCELLED_EVENT_TYPE,
    RUN_COMPLETED_EVENT_TYPE,
    RUN_DIAGNOSTIC_EVENT_TYPE,
    RUN_FAILED_EVENT_TYPE,
    RUN_STARTED_EVENT_TYPE,
    TEXT_DELTA_EVENT_TYPE,
    TOOL_EVENT_EVENT_TYPE,
    RuntimeRunEvent,
    RuntimeRunEventFactory,
)


@dataclass(slots=True)
class LegacyRuntimeRunEventProjector:
    events: RuntimeRunEventFactory
    assistant_message_id: str
    resolved_model_route: ResolvedRuntimeModelRoute | None = None
    resolved_tool_ids: tuple[str, ...] = ()
    request_options: dict[str, Any] = field(default_factory=dict)

    def configure_completion_context(
        self,
        *,
        resolved_model_route: ResolvedRuntimeModelRoute,
        resolved_tool_ids: tuple[str, ...],
        request_options: Mapping[str, Any] | None,
    ) -> None:
        self.resolved_model_route = resolved_model_route
        self.resolved_tool_ids = tuple(resolved_tool_ids)
        self.request_options = dict(request_options or {})

    def build_run_started(self) -> RuntimeRunEvent:
        return self.events.build(
            RUN_STARTED_EVENT_TYPE,
            payload={
                "assistantMessageId": self.assistant_message_id,
            },
        )

    def project(self, event: RuntimeExecutionEvent) -> tuple[RuntimeRunEvent, ...]:
        if event.type in {
            ASSISTANT_SEGMENT_STARTED_EVENT_TYPE,
            ASSISTANT_SEGMENT_COMPLETED_EVENT_TYPE,
        }:
            return ()

        if event.type == ASSISTANT_SEGMENT_DELTA_EVENT_TYPE:
            return (
                self.events.build(
                    TEXT_DELTA_EVENT_TYPE,
                    payload={
                        "assistantMessageId": self.assistant_message_id,
                        "delta": str(event.payload.get("delta", "")),
                    },
                ),
            )

        if event.type == DIAGNOSTIC_EVENT_TYPE:
            return (
                self.events.build(
                    RUN_DIAGNOSTIC_EVENT_TYPE,
                    payload=dict(event.payload),
                ),
            )

        if event.type in {"tool_started", "tool_completed", "tool_failed"}:
            return (
                self.events.build(
                    TOOL_EVENT_EVENT_TYPE,
                    payload=dict(event.payload),
                ),
            )

        if event.type == EXECUTION_RUN_COMPLETED_EVENT_TYPE:
            payload: dict[str, Any] = {
                "assistantMessageId": self.assistant_message_id,
                "assistantText": str(event.payload.get("assistantText", "")),
                "resolvedToolIds": list(self.resolved_tool_ids),
                "requestOptions": dict(self.request_options),
            }
            if self.resolved_model_route is not None:
                payload["resolvedModelId"] = self.resolved_model_route.model_id
                payload["resolvedModelRoute"] = self.resolved_model_route.to_public_dict()
            return (
                self.events.build(
                    RUN_COMPLETED_EVENT_TYPE,
                    payload=payload,
                ),
            )

        if event.type == EXECUTION_RUN_FAILED_EVENT_TYPE:
            return (
                self.events.build(
                    RUN_FAILED_EVENT_TYPE,
                    payload=dict(event.payload),
                ),
            )

        if event.type == EXECUTION_RUN_CANCELLED_EVENT_TYPE:
            return (
                self.events.build(
                    RUN_CANCELLED_EVENT_TYPE,
                    payload={
                        "assistantMessageId": self.assistant_message_id,
                        "reason": str(event.payload.get("reason", "cancelled")),
                    },
                ),
            )

        raise ValueError(f"Unsupported execution event type '{event.type}'.")


__all__ = ["LegacyRuntimeRunEventProjector"]
