from __future__ import annotations

import pytest

from app.copilot_runtime.execution_event_graph import (
    TOOL_COMPLETED_EVENT_TYPE,
    TOOL_STARTED_EVENT_TYPE,
    RuntimeExecutionEvent,
    RuntimeExecutionEventBuffer,
    RuntimeExecutionEventFactory,
)
from app.copilot_runtime.legacy_event_projection import LegacyRuntimeRunEventProjector
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.run_events import TERMINAL_RUNTIME_RUN_EVENT_TYPES, RuntimeRunEventFactory


def test_execution_event_buffer_represents_interleaved_assistant_tool_assistant_chain() -> None:
    factory = RuntimeExecutionEventFactory(run_id="run-1")
    buffer = RuntimeExecutionEventBuffer(event_factory=factory)

    buffer.record_assistant_delta("Before ")
    buffer.record_event(
        RuntimeExecutionEvent(
            type=TOOL_STARTED_EVENT_TYPE,
            payload=_build_tool_payload(phase="started"),
        )
    )
    buffer.record_event(
        RuntimeExecutionEvent(
            type=TOOL_COMPLETED_EVENT_TYPE,
            payload=_build_tool_payload(
                phase="completed",
                result_summary="done",
            ),
        )
    )
    buffer.record_assistant_delta("After")
    buffer.finish_assistant_segment()

    events = buffer.drain()

    assert [event.type for event in events] == [
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
        "tool_started",
        "tool_completed",
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
    ]
    assert events[0].payload["segmentId"] == "run-1:assistant-segment-1"
    assert events[5].payload["segmentId"] == "run-1:assistant-segment-2"
    assert buffer.observed_assistant_text == "Before After"



def test_execution_event_buffer_keeps_reasoning_distinct_from_tool_and_assistant_segments() -> None:
    factory = RuntimeExecutionEventFactory(run_id="run-1")
    buffer = RuntimeExecutionEventBuffer(event_factory=factory)

    buffer.record_reasoning_delta("先思考。")
    buffer.record_event(
        RuntimeExecutionEvent(
            type=TOOL_STARTED_EVENT_TYPE,
            payload=_build_tool_payload(phase="started"),
        )
    )
    buffer.record_event(
        RuntimeExecutionEvent(
            type=TOOL_COMPLETED_EVENT_TYPE,
            payload=_build_tool_payload(
                phase="completed",
                result_summary="done",
            ),
        )
    )
    buffer.record_assistant_delta("再回答。")
    buffer.finish_assistant_segment()

    events = buffer.drain()

    assert [event.type for event in events] == [
        "reasoning_segment_started",
        "reasoning_segment_delta",
        "reasoning_segment_completed",
        "tool_started",
        "tool_completed",
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
    ]
    assert buffer.observed_reasoning_text == "先思考。"
    assert buffer.observed_assistant_text == "再回答。"



def test_legacy_runtime_projector_projects_interleaved_chain_without_early_terminal() -> None:
    execution_factory = RuntimeExecutionEventFactory(run_id="run-1")
    events = RuntimeRunEventFactory(session_id="session-1", run_id="run-1")
    projector = LegacyRuntimeRunEventProjector(
        events=events,
        assistant_message_id="run-1:assistant",
    )
    projector.configure_completion_context(
        resolved_model_route=_build_resolved_route(),
        resolved_tool_ids=("tool.weather-current",),
        request_options={"temperature": 0.2},
    )

    segment_a = execution_factory.next_assistant_segment_id()
    segment_b = execution_factory.next_assistant_segment_id()
    execution_events = [
        execution_factory.build_assistant_segment_started(segment_id=segment_a),
        execution_factory.build_assistant_segment_delta(segment_id=segment_a, delta="Before "),
        execution_factory.build_assistant_segment_completed(segment_id=segment_a),
        execution_factory.build(
            TOOL_STARTED_EVENT_TYPE,
            payload=_build_tool_payload(phase="started"),
        ),
        execution_factory.build(
            TOOL_COMPLETED_EVENT_TYPE,
            payload=_build_tool_payload(
                phase="completed",
                result_summary="done",
            ),
        ),
        execution_factory.build_assistant_segment_started(segment_id=segment_b),
        execution_factory.build_assistant_segment_delta(segment_id=segment_b, delta="After"),
        execution_factory.build_assistant_segment_completed(segment_id=segment_b),
        execution_factory.build_run_completed(assistant_text="Before After"),
    ]

    projected = [projector.build_run_started()]
    for event in execution_events:
        projected.extend(projector.project(event))

    assert [event.type for event in projected] == [
        "run_started",
        "text_delta",
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    assert projected[1].payload["delta"] == "Before "
    assert projected[4].payload["delta"] == "After"
    assert projected[-1].payload["assistantText"] == "Before After"
    assert projected[-1].type in TERMINAL_RUNTIME_RUN_EVENT_TYPES
    assert all(event.type != "run_completed" for event in projected[:-1])
    assert [event.sequence for event in projected] == [1, 2, 3, 4, 5, 6]



def test_legacy_runtime_projector_projects_reasoning_as_standalone_delta_event() -> None:
    execution_factory = RuntimeExecutionEventFactory(run_id="run-1")
    events = RuntimeRunEventFactory(session_id="session-1", run_id="run-1")
    projector = LegacyRuntimeRunEventProjector(
        events=events,
        assistant_message_id="run-1:assistant",
    )
    projector.configure_completion_context(
        resolved_model_route=_build_resolved_route(),
        resolved_tool_ids=(),
        request_options={},
    )

    reasoning_segment = execution_factory.next_reasoning_segment_id()
    assistant_segment = execution_factory.next_assistant_segment_id()
    execution_events = [
        execution_factory.build_reasoning_segment_started(segment_id=reasoning_segment),
        execution_factory.build_reasoning_segment_delta(segment_id=reasoning_segment, delta="先思考。"),
        execution_factory.build_reasoning_segment_completed(segment_id=reasoning_segment),
        execution_factory.build_assistant_segment_started(segment_id=assistant_segment),
        execution_factory.build_assistant_segment_delta(segment_id=assistant_segment, delta="再回答。"),
        execution_factory.build_assistant_segment_completed(segment_id=assistant_segment),
        execution_factory.build_run_completed(assistant_text="再回答。"),
    ]

    projected = [projector.build_run_started()]
    for event in execution_events:
        projected.extend(projector.project(event))

    assert [event.type for event in projected] == [
        "run_started",
        "reasoning_delta",
        "text_delta",
        "run_completed",
    ]
    assert projected[1].payload == {"delta": "先思考。"}
    assert projected[2].payload == {
        "assistantMessageId": "run-1:assistant",
        "delta": "再回答。",
    }



def test_legacy_runtime_projector_preserves_failed_terminal_after_diagnostic() -> None:
    execution_factory = RuntimeExecutionEventFactory(run_id="run-1")
    events = RuntimeRunEventFactory(session_id="session-1", run_id="run-1")
    projector = LegacyRuntimeRunEventProjector(
        events=events,
        assistant_message_id="run-1:assistant",
    )

    projected = []
    for event in (
        execution_factory.build_diagnostic(
            code="agent_execution_failed",
            message="boom",
            details={"stage": "execute_model"},
            stage="execute_model",
        ),
        execution_factory.build_run_failed(
            code="agent_execution_failed",
            message="boom",
            details={"stage": "execute_model"},
        ),
    ):
        projected.extend(projector.project(event))

    assert [event.type for event in projected] == ["run_diagnostic", "run_failed"]
    assert projected[-1].type in TERMINAL_RUNTIME_RUN_EVENT_TYPES
    assert projected[-1].payload == {
        "code": "agent_execution_failed",
        "message": "boom",
        "details": {"stage": "execute_model"},
    }


@pytest.mark.parametrize("reason", ["cancelled", "client_disconnected"])
def test_legacy_runtime_projector_preserves_cancelled_terminal_reason(reason: str) -> None:
    execution_factory = RuntimeExecutionEventFactory(run_id="run-1")
    events = RuntimeRunEventFactory(session_id="session-1", run_id="run-1")
    projector = LegacyRuntimeRunEventProjector(
        events=events,
        assistant_message_id="run-1:assistant",
    )

    projected = projector.project(execution_factory.build_run_cancelled(reason=reason))

    assert [event.type for event in projected] == ["run_cancelled"]
    assert projected[0].type in TERMINAL_RUNTIME_RUN_EVENT_TYPES
    assert projected[0].payload == {
        "assistantMessageId": "run-1:assistant",
        "reason": reason,
    }



def _build_tool_payload(*, phase: str, result_summary: str | None = None) -> dict[str, str]:
    payload = {
        "toolCallId": "tool.weather-current:call-1",
        "toolId": "tool.weather-current",
        "phase": phase,
        "title": "天气工具",
        "summary": "tool summary",
    }
    if result_summary is not None:
        payload["resultSummary"] = result_summary
    return payload



def _build_resolved_route() -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id="gpt-4.1",
        api_key="test-api-key",
    )
