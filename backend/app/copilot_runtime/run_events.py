"""Typed runtime run events and SSE transport encoding for streaming chat runs."""

from __future__ import annotations

import json
from collections.abc import AsyncIterable, AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal

from .contracts import RuntimeContract

RuntimeRunEventType = Literal[
    "run_started",
    "text_delta",
    "reasoning_delta",
    "run_completed",
    "run_failed",
    "run_cancelled",
    "run_diagnostic",
    "tool_event",
]

RUN_STARTED_EVENT_TYPE: RuntimeRunEventType = "run_started"
TEXT_DELTA_EVENT_TYPE: RuntimeRunEventType = "text_delta"
REASONING_DELTA_EVENT_TYPE: RuntimeRunEventType = "reasoning_delta"
RUN_COMPLETED_EVENT_TYPE: RuntimeRunEventType = "run_completed"
RUN_FAILED_EVENT_TYPE: RuntimeRunEventType = "run_failed"
RUN_CANCELLED_EVENT_TYPE: RuntimeRunEventType = "run_cancelled"
RUN_DIAGNOSTIC_EVENT_TYPE: RuntimeRunEventType = "run_diagnostic"
TOOL_EVENT_EVENT_TYPE: RuntimeRunEventType = "tool_event"
TERMINAL_RUNTIME_RUN_EVENT_TYPES = frozenset(
    {
        RUN_COMPLETED_EVENT_TYPE,
        RUN_FAILED_EVENT_TYPE,
        RUN_CANCELLED_EVENT_TYPE,
    }
)


@dataclass(frozen=True, slots=True)
class RuntimeRunEvent(RuntimeContract):
    type: RuntimeRunEventType
    runId: str
    sessionId: str
    sequence: int
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RuntimeRunEventFactory:
    session_id: str
    run_id: str
    _sequence: int = 0

    def build(
        self,
        event_type: RuntimeRunEventType,
        *,
        payload: dict[str, Any] | None = None,
    ) -> RuntimeRunEvent:
        self._sequence += 1
        return RuntimeRunEvent(
            type=event_type,
            runId=self.run_id,
            sessionId=self.session_id,
            sequence=self._sequence,
            payload=dict(payload or {}),
        )


def encode_runtime_run_event(event: RuntimeRunEvent) -> str:
    return f"data: {json.dumps(event.to_dict())}\n\n"


async def encode_runtime_run_events(events: AsyncIterable[RuntimeRunEvent]) -> AsyncIterator[str]:
    async for event in events:
        yield encode_runtime_run_event(event)


__all__ = [
    "REASONING_DELTA_EVENT_TYPE",
    "RUN_CANCELLED_EVENT_TYPE",
    "RUN_COMPLETED_EVENT_TYPE",
    "RUN_DIAGNOSTIC_EVENT_TYPE",
    "RUN_FAILED_EVENT_TYPE",
    "RUN_STARTED_EVENT_TYPE",
    "TERMINAL_RUNTIME_RUN_EVENT_TYPES",
    "TEXT_DELTA_EVENT_TYPE",
    "TOOL_EVENT_EVENT_TYPE",
    "RuntimeRunEvent",
    "RuntimeRunEventFactory",
    "RuntimeRunEventType",
    "encode_runtime_run_event",
    "encode_runtime_run_events",
]
