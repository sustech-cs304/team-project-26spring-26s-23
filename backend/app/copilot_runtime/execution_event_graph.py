"""Unified internal execution event graph for Copilot runtime runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .debug_logging import (
    is_runtime_chain_debug_enabled,
    log_runtime_chain_debug,
    summarize_event_types,
    summarize_runtime_execution_event,
)

RuntimeExecutionEventType = Literal[
    "assistant_segment_started",
    "assistant_segment_delta",
    "assistant_segment_completed",
    "tool_started",
    "tool_completed",
    "tool_failed",
    "diagnostic",
    "run_completed",
    "run_failed",
    "run_cancelled",
]

ASSISTANT_SEGMENT_STARTED_EVENT_TYPE: RuntimeExecutionEventType = "assistant_segment_started"
ASSISTANT_SEGMENT_DELTA_EVENT_TYPE: RuntimeExecutionEventType = "assistant_segment_delta"
ASSISTANT_SEGMENT_COMPLETED_EVENT_TYPE: RuntimeExecutionEventType = "assistant_segment_completed"
TOOL_STARTED_EVENT_TYPE: RuntimeExecutionEventType = "tool_started"
TOOL_COMPLETED_EVENT_TYPE: RuntimeExecutionEventType = "tool_completed"
TOOL_FAILED_EVENT_TYPE: RuntimeExecutionEventType = "tool_failed"
DIAGNOSTIC_EVENT_TYPE: RuntimeExecutionEventType = "diagnostic"
RUN_COMPLETED_EVENT_TYPE: RuntimeExecutionEventType = "run_completed"
RUN_FAILED_EVENT_TYPE: RuntimeExecutionEventType = "run_failed"
RUN_CANCELLED_EVENT_TYPE: RuntimeExecutionEventType = "run_cancelled"

TERMINAL_RUNTIME_EXECUTION_EVENT_TYPES = frozenset(
    {
        RUN_COMPLETED_EVENT_TYPE,
        RUN_FAILED_EVENT_TYPE,
        RUN_CANCELLED_EVENT_TYPE,
    }
)
TOOL_RUNTIME_EXECUTION_EVENT_TYPES = frozenset(
    {
        TOOL_STARTED_EVENT_TYPE,
        TOOL_COMPLETED_EVENT_TYPE,
        TOOL_FAILED_EVENT_TYPE,
    }
)


@dataclass(frozen=True, slots=True)
class RuntimeExecutionEvent:
    type: RuntimeExecutionEventType
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RuntimeExecutionEventFactory:
    run_id: str
    _assistant_segment_sequence: int = 0

    def build(
        self,
        event_type: RuntimeExecutionEventType,
        *,
        payload: dict[str, Any] | None = None,
    ) -> RuntimeExecutionEvent:
        return RuntimeExecutionEvent(type=event_type, payload=dict(payload or {}))

    def next_assistant_segment_id(self) -> str:
        self._assistant_segment_sequence += 1
        return f"{self.run_id}:assistant-segment-{self._assistant_segment_sequence}"

    def build_assistant_segment_started(
        self,
        *,
        segment_id: str | None = None,
    ) -> RuntimeExecutionEvent:
        resolved_segment_id = segment_id or self.next_assistant_segment_id()
        return self.build(
            ASSISTANT_SEGMENT_STARTED_EVENT_TYPE,
            payload={"segmentId": resolved_segment_id},
        )

    def build_assistant_segment_delta(
        self,
        *,
        segment_id: str,
        delta: str,
    ) -> RuntimeExecutionEvent:
        return self.build(
            ASSISTANT_SEGMENT_DELTA_EVENT_TYPE,
            payload={
                "segmentId": segment_id,
                "delta": delta,
            },
        )

    def build_assistant_segment_completed(
        self,
        *,
        segment_id: str,
    ) -> RuntimeExecutionEvent:
        return self.build(
            ASSISTANT_SEGMENT_COMPLETED_EVENT_TYPE,
            payload={"segmentId": segment_id},
        )

    def build_diagnostic(
        self,
        *,
        code: str,
        message: str,
        details: dict[str, Any],
        stage: str,
    ) -> RuntimeExecutionEvent:
        return self.build(
            DIAGNOSTIC_EVENT_TYPE,
            payload={
                "code": code,
                "message": message,
                "details": dict(details),
                "stage": stage,
            },
        )

    def build_run_completed(self, *, assistant_text: str) -> RuntimeExecutionEvent:
        return self.build(
            RUN_COMPLETED_EVENT_TYPE,
            payload={"assistantText": assistant_text},
        )

    def build_run_failed(
        self,
        *,
        code: str,
        message: str,
        details: dict[str, Any],
    ) -> RuntimeExecutionEvent:
        return self.build(
            RUN_FAILED_EVENT_TYPE,
            payload={
                "code": code,
                "message": message,
                "details": dict(details),
            },
        )

    def build_run_cancelled(self, *, reason: str) -> RuntimeExecutionEvent:
        return self.build(
            RUN_CANCELLED_EVENT_TYPE,
            payload={"reason": reason},
        )


@dataclass(slots=True)
class RuntimeExecutionEventBuffer:
    event_factory: RuntimeExecutionEventFactory
    _pending_events: list[RuntimeExecutionEvent] = field(default_factory=list)
    _assistant_segment_id: str | None = None
    _assistant_text_chunks: list[str] = field(default_factory=list)

    @property
    def observed_assistant_text(self) -> str:
        return "".join(self._assistant_text_chunks)

    def record_assistant_delta(self, delta: str) -> None:
        if delta == "":
            return

        if self._assistant_segment_id is None:
            self._assistant_segment_id = self.event_factory.next_assistant_segment_id()
            self._pending_events.append(
                self.event_factory.build_assistant_segment_started(
                    segment_id=self._assistant_segment_id,
                )
            )

        self._pending_events.append(
            self.event_factory.build_assistant_segment_delta(
                segment_id=self._assistant_segment_id,
                delta=delta,
            )
        )
        self._assistant_text_chunks.append(delta)

    def record_event(self, event: RuntimeExecutionEvent) -> None:
        if event.type != ASSISTANT_SEGMENT_DELTA_EVENT_TYPE:
            self.finish_assistant_segment()
        self._pending_events.append(event)
        log_runtime_chain_debug(
            "execution_buffer.record_event",
            enabled=is_runtime_chain_debug_enabled(),
            runId=self.event_factory.run_id,
            recordedEvent=summarize_runtime_execution_event(event),
            pendingEventTypes=summarize_event_types(self._pending_events),
        )

    def finish_assistant_segment(self) -> None:
        if self._assistant_segment_id is None:
            return

        segment_id = self._assistant_segment_id
        self._assistant_segment_id = None
        self._pending_events.append(
            self.event_factory.build_assistant_segment_completed(segment_id=segment_id)
        )

    def drain(self) -> tuple[RuntimeExecutionEvent, ...]:
        drained = tuple(self._pending_events)
        self._pending_events.clear()
        return drained


__all__ = [
    "ASSISTANT_SEGMENT_COMPLETED_EVENT_TYPE",
    "ASSISTANT_SEGMENT_DELTA_EVENT_TYPE",
    "ASSISTANT_SEGMENT_STARTED_EVENT_TYPE",
    "DIAGNOSTIC_EVENT_TYPE",
    "RUN_CANCELLED_EVENT_TYPE",
    "RUN_COMPLETED_EVENT_TYPE",
    "RUN_FAILED_EVENT_TYPE",
    "RuntimeExecutionEvent",
    "RuntimeExecutionEventBuffer",
    "RuntimeExecutionEventFactory",
    "RuntimeExecutionEventType",
    "TERMINAL_RUNTIME_EXECUTION_EVENT_TYPES",
    "TOOL_COMPLETED_EVENT_TYPE",
    "TOOL_FAILED_EVENT_TYPE",
    "TOOL_RUNTIME_EXECUTION_EVENT_TYPES",
    "TOOL_STARTED_EVENT_TYPE",
]
