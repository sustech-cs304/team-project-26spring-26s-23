from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import Mock

import pytest

from app.copilot_runtime.agent import (
    _ObservedToolCall,
    _PydanticAIEventStream,
    _PydanticAIAgentRunDeps,
)
from app.copilot_runtime.execution_event_graph import (
    DIAGNOSTIC_EVENT_TYPE,
    RuntimeExecutionEvent,
    RuntimeExecutionEventBuffer,
    RuntimeExecutionEventFactory,
)
from app.copilot_runtime.tool_registry import (
    WEATHER_CURRENT_TOOL_ID,
)
from app.copilot_runtime.tool_approval_coordinator import (
    RuntimeToolApprovalCoordinator,
)
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver


_FIXTURE_RUN_ID = "test-run-id"


def _make_event_buffer(
    *, debug_enabled: bool = False
) -> RuntimeExecutionEventBuffer:
    return RuntimeExecutionEventBuffer(
        event_factory=RuntimeExecutionEventFactory(run_id=_FIXTURE_RUN_ID),
        debug_enabled=debug_enabled,
    )


def _make_deps(
    *,
    tool_registry: Any | None = None,
    enabled_tool_ids: frozenset[str] | None = None,
    approval_coordinator: RuntimeToolApprovalCoordinator | None = None,
    tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
) -> _PydanticAIAgentRunDeps:
    tr = tool_registry
    if tr is None:
        tr = Mock()
        tr.list_tool_ids = Mock(return_value=())
        tr.resolve_tool = Mock(side_effect=LookupError("not found"))
    resolver = tool_permission_resolver or RuntimeToolPermissionResolver(
        default_mode="allow"
    )
    coordinator = approval_coordinator or RuntimeToolApprovalCoordinator()
    return _PydanticAIAgentRunDeps(
        tool_registry=tr,
        enabled_tool_ids=enabled_tool_ids or frozenset(),
        emit_tool_event=lambda _: None,
        workspace_root=".",
        default_root=".",
        tool_permission_resolver=resolver,
        approval_coordinator=coordinator,
        run_id=_FIXTURE_RUN_ID,
    )


def _make_stream(
    *,
    deps: _PydanticAIAgentRunDeps | None = None,
    event_buffer: RuntimeExecutionEventBuffer | None = None,
    model_route_summary: dict[str, Any] | None = None,
    debug_enabled: bool = False,
) -> _PydanticAIEventStream:
    return _PydanticAIEventStream(
        run_id=_FIXTURE_RUN_ID,
        agent=Mock(),
        user_prompt="hello",
        message_history=[],
        resolved_model=Mock(),
        deps=deps or _make_deps(),
        resolved_model_id="test-model",
        event_buffer=event_buffer or _make_event_buffer(),
        model_settings=None,
        model_route_summary=model_route_summary or {},
        debug_enabled=debug_enabled,
    )


# ---------------------------------------------------------------------------
# _parse_tool_call_arguments
# ---------------------------------------------------------------------------


def test_parse_tool_call_arguments_returns_none_for_none() -> None:
    stream = _make_stream()
    assert stream._parse_tool_call_arguments(None) is None


def test_parse_tool_call_arguments_returns_copy_of_dict() -> None:
    stream = _make_stream()
    value = {"key": "val"}
    result = stream._parse_tool_call_arguments(value)
    assert result == {"key": "val"}
    assert result is not value


def test_parse_tool_call_arguments_parses_valid_json() -> None:
    stream = _make_stream()
    result = stream._parse_tool_call_arguments('{"a": 1, "b": 2}')
    assert result == {"a": 1, "b": 2}


def test_parse_tool_call_arguments_returns_none_for_invalid_json() -> None:
    stream = _make_stream()
    assert stream._parse_tool_call_arguments("{bad}") is None


def test_parse_tool_call_arguments_returns_none_for_empty_string() -> None:
    stream = _make_stream()
    assert stream._parse_tool_call_arguments("") is None


def test_parse_tool_call_arguments_returns_none_for_whitespace_string() -> None:
    stream = _make_stream()
    assert stream._parse_tool_call_arguments("   \t\n  ") is None


def test_parse_tool_call_arguments_returns_none_for_json_non_dict() -> None:
    stream = _make_stream()
    assert stream._parse_tool_call_arguments("42") is None
    assert stream._parse_tool_call_arguments('"string only"') is None
    assert stream._parse_tool_call_arguments("[1, 2, 3]") is None


def test_parse_tool_call_arguments_returns_none_for_json_null() -> None:
    stream = _make_stream()
    assert stream._parse_tool_call_arguments("null") is None


# ---------------------------------------------------------------------------
# _merge_tool_call_arguments
# ---------------------------------------------------------------------------


def test_merge_tool_call_arguments_update_none_returns_current() -> None:
    stream = _make_stream()
    assert stream._merge_tool_call_arguments(current="abc", update=None) == "abc"
    assert (
        stream._merge_tool_call_arguments(current={"k": "v"}, update=None) == {"k": "v"}
    )
    assert stream._merge_tool_call_arguments(current=None, update=None) is None


def test_merge_tool_call_arguments_current_none_returns_update() -> None:
    stream = _make_stream()
    assert stream._merge_tool_call_arguments(current=None, update="hello") == "hello"
    assert stream._merge_tool_call_arguments(current=None, update={"x": 1}) == {"x": 1}


def test_merge_tool_call_arguments_both_strings_concatenates() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(current="hello", update=" world")
    assert result == "hello world"


def test_merge_tool_call_arguments_both_dicts_merges() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(
        current={"a": 1, "b": 2}, update={"b": 3, "c": 4}
    )
    assert result == {"a": 1, "b": 3, "c": 4}
    assert isinstance(result, dict)


def test_merge_tool_call_arguments_mixed_current_str_update_dict_returns_update() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(current="old", update={"new": 1})
    assert result == {"new": 1}


def test_merge_tool_call_arguments_mixed_current_dict_update_str_returns_update() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(current={"old": 1}, update="new str")
    assert result == "new str"


def test_merge_tool_call_arguments_empty_string_update() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(
        current='{"name":', update='"bob"}'
    )
    assert result == '{"name":"bob"}'


# ---------------------------------------------------------------------------
# _resolve_tool_id_from_tool_name
# ---------------------------------------------------------------------------


def test_resolve_tool_id_from_tool_name_none_returns_unknown() -> None:
    stream = _make_stream()
    assert stream._resolve_tool_id_from_tool_name(None) == "tool.unknown"


def test_resolve_tool_id_from_tool_name_empty_returns_unknown() -> None:
    stream = _make_stream()
    assert stream._resolve_tool_id_from_tool_name("") == "tool.unknown"


def test_resolve_tool_id_from_tool_name_weather_current_maps_directly() -> None:
    stream = _make_stream()
    assert stream._resolve_tool_id_from_tool_name("weather_current") == WEATHER_CURRENT_TOOL_ID


def test_resolve_tool_id_from_tool_name_strips_whitespace() -> None:
    stream = _make_stream()
    assert stream._resolve_tool_id_from_tool_name("  weather_current  ") == WEATHER_CURRENT_TOOL_ID


def test_resolve_tool_id_from_tool_name_unknown_returns_normalized_name() -> None:
    stream = _make_stream()
    assert stream._resolve_tool_id_from_tool_name("my_custom_tool") == "my_custom_tool"


def test_resolve_tool_id_from_tool_name_resolves_via_registry() -> None:
    mock_tool = Mock()
    mock_tool.function_name = "search_campus"
    mock_registry = Mock()
    mock_registry.list_tool_ids = Mock(return_value=("tool.search",))
    mock_registry.resolve_tool = Mock(return_value=mock_tool)

    deps = _make_deps(tool_registry=mock_registry)
    stream = _make_stream(deps=deps)

    result = stream._resolve_tool_id_from_tool_name("search_campus")
    assert result == "tool.search"
    mock_registry.list_tool_ids.assert_called_once()
    mock_registry.resolve_tool.assert_called_once_with("tool.search")


def test_resolve_tool_id_from_tool_name_resolve_tool_handles_lookup_error() -> None:
    mock_registry = Mock()
    mock_registry.list_tool_ids = Mock(return_value=("tool.missing",))
    mock_registry.resolve_tool = Mock(side_effect=LookupError("not found"))

    deps = _make_deps(tool_registry=mock_registry)
    stream = _make_stream(deps=deps)

    result = stream._resolve_tool_id_from_tool_name("missing_tool")
    assert result == "missing_tool"


# ---------------------------------------------------------------------------
# _is_tool_call_identified
# ---------------------------------------------------------------------------


def test_is_tool_call_identified_both_set_returns_true() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(part_index=0, tool_name="test", tool_call_id="call-1")
    assert stream._is_tool_call_identified(state) is True


def test_is_tool_call_identified_only_name_returns_false() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(part_index=0, tool_name="test", tool_call_id=None)
    assert stream._is_tool_call_identified(state) is False


def test_is_tool_call_identified_only_id_returns_false() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(part_index=0, tool_name=None, tool_call_id="call-1")
    assert stream._is_tool_call_identified(state) is False


def test_is_tool_call_identified_neither_set_returns_false() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(part_index=0, tool_name=None, tool_call_id=None)
    assert stream._is_tool_call_identified(state) is False


def test_is_tool_call_identified_empty_strings_are_falsy() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(part_index=0, tool_name="", tool_call_id="")
    assert stream._is_tool_call_identified(state) is False


# ---------------------------------------------------------------------------
# _build_tool_call_diagnostic_details
# ---------------------------------------------------------------------------


def test_build_tool_call_diagnostic_details_with_parsed_dict_args() -> None:
    stream = _make_stream(model_route_summary={"endpointType": "openai-compatible"})
    state = _ObservedToolCall(
        part_index=2, tool_name="weather_current", tool_call_id="call-xyz"
    )
    result = stream._build_tool_call_diagnostic_details(
        state=state,
        observation_kind="observed",
        parsed_arguments={"location": "Beijing"},
    )
    assert result["source"] == "pydantic_raw_stream"
    assert result["providerEndpointType"] == "openai-compatible"
    assert result["observationKind"] == "observed"
    assert result["partIndex"] == 2
    assert result["toolCallId"] == "call-xyz"
    assert result["toolName"] == "weather_current"
    assert result["argumentsComplete"] is True
    assert result["toolArguments"] == {"location": "Beijing"}
    assert "toolArgumentsJson" not in result


def test_build_tool_call_diagnostic_details_with_state_dict_args() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(
        part_index=0, tool_name="t", tool_call_id="c", args={"x": 1}
    )
    result = stream._build_tool_call_diagnostic_details(
        state=state,
        observation_kind="arguments_completed",
        parsed_arguments=None,
    )
    assert result["argumentsComplete"] is True
    assert result["toolArguments"] == {"x": 1}


def test_build_tool_call_diagnostic_details_with_state_str_args_non_empty() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(
        part_index=1, tool_name="t2", tool_call_id="c2", args='{"z": 3}'
    )
    result = stream._build_tool_call_diagnostic_details(
        state=state,
        observation_kind="observed",
        parsed_arguments=None,
    )
    assert result["argumentsComplete"] is False
    assert result["toolArgumentsJson"] == '{"z": 3}'
    assert "toolArguments" not in result


def test_build_tool_call_diagnostic_details_with_state_str_args_empty() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(
        part_index=0, tool_name="t", tool_call_id="c", args="  "
    )
    result = stream._build_tool_call_diagnostic_details(
        state=state,
        observation_kind="observed",
        parsed_arguments=None,
    )
    assert result["argumentsComplete"] is False
    assert "toolArguments" not in result
    assert "toolArgumentsJson" not in result


def test_build_tool_call_diagnostic_details_without_endpoint_type() -> None:
    stream = _make_stream(model_route_summary={})
    state = _ObservedToolCall(part_index=0, tool_name="t", tool_call_id="c")
    result = stream._build_tool_call_diagnostic_details(
        state=state,
        observation_kind="observed",
        parsed_arguments=None,
    )
    assert result["providerEndpointType"] is None


# ---------------------------------------------------------------------------
# _raise_if_raw_tool_call_left_unexecuted
# ---------------------------------------------------------------------------


def _drain_queue(stream: _PydanticAIEventStream) -> list[RuntimeExecutionEvent]:
    events: list[RuntimeExecutionEvent] = []
    while not stream._event_queue.empty():
        events.append(stream._event_queue.get_nowait())
    return events


def test_raise_if_raw_tool_call_left_unexecuted_no_tool_calls() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._raise_if_raw_tool_call_left_unexecuted()

    assert stream._raw_tool_call_observation_count == 0
    events_from_queue = _drain_queue(stream)
    assert len(events_from_queue) == 0


def test_raise_if_raw_tool_call_left_unexecuted_all_executed() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)
    stream._tool_lifecycle_emitted_ids.add("call-abc")

    state = _ObservedToolCall(
        part_index=0,
        tool_name="my_tool",
        tool_call_id="call-abc",
        args={"k": "v"},
        arguments_completed_emitted=True,
    )
    stream._observed_tool_calls[0] = state

    stream._raise_if_raw_tool_call_left_unexecuted()

    events_from_queue = _drain_queue(stream)
    diagnostic_events = [e for e in events_from_queue if e.type == DIAGNOSTIC_EVENT_TYPE]
    assert len(diagnostic_events) == 0


def test_raise_if_raw_tool_call_left_unexecuted_pending_calls_emit_diagnostic() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0,
        tool_name="search_campus",
        tool_call_id="call-unexecuted",
        args={"q": "test"},
        arguments_completed_emitted=True,
    )
    stream._observed_tool_calls[0] = state

    stream._raise_if_raw_tool_call_left_unexecuted()

    events_from_queue = _drain_queue(stream)
    diagnostic_events = [e for e in events_from_queue if e.type == DIAGNOSTIC_EVENT_TYPE]
    assert len(diagnostic_events) == 1
    diag = diagnostic_events[0]
    assert diag.payload["code"] == "raw_tool_call_unexecuted"
    assert "no actual tool execution" in diag.payload["message"]
    assert diag.payload["details"]["toolCallId"] == "call-unexecuted"

    assert "call-unexecuted" in stream._tool_lifecycle_emitted_ids


def test_raise_if_raw_tool_call_left_unexecuted_multiple_pending() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    for i in range(3):
        state = _ObservedToolCall(
            part_index=i,
            tool_name=f"tool_{i}",
            tool_call_id=f"call-{i}",
            args={"i": i},
            arguments_completed_emitted=True,
        )
        stream._observed_tool_calls[i] = state

    stream._raise_if_raw_tool_call_left_unexecuted()

    events_from_queue = _drain_queue(stream)
    diagnostic_events = [e for e in events_from_queue if e.type == DIAGNOSTIC_EVENT_TYPE]
    assert len(diagnostic_events) == 3
    for diag in diagnostic_events:
        assert diag.payload["code"] == "raw_tool_call_unexecuted"
    assert len(stream._tool_lifecycle_emitted_ids) == 3


def test_raise_if_raw_tool_call_left_unexecuted_skips_not_completed() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0,
        tool_name="tool",
        tool_call_id="call-not-ready",
        args='{"x": ',
        arguments_completed_emitted=False,
    )
    stream._observed_tool_calls[0] = state

    stream._raise_if_raw_tool_call_left_unexecuted()

    events_from_queue = _drain_queue(stream)
    assert len(events_from_queue) == 0


def test_raise_if_raw_tool_call_left_unexecuted_skips_none_tool_call_id() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0,
        tool_name="tool",
        tool_call_id=None,
        args={"k": "v"},
        arguments_completed_emitted=True,
    )
    stream._observed_tool_calls[0] = state

    stream._raise_if_raw_tool_call_left_unexecuted()

    events_from_queue = _drain_queue(stream)
    assert len(events_from_queue) == 0


# ---------------------------------------------------------------------------
# _record_text_delta
# ---------------------------------------------------------------------------


def test_record_text_delta_records_delta() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._record_text_delta("Hello")

    assert stream._text_delta_index == 1
    drain = event_buffer.drain()
    assert len(drain) > 0
    delta_events = [
        e for e in drain if e.type == "assistant_segment_delta"
    ]
    assert len(delta_events) == 1
    assert delta_events[0].payload["delta"] == "Hello"


def test_record_text_delta_empty_is_noop() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._record_text_delta("")

    assert stream._text_delta_index == 0
    drain = event_buffer.drain()
    assert len(drain) == 0


def test_record_text_delta_multiple_accumulates() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    for chunk in ("Hello", " ", "World"):
        stream._record_text_delta(chunk)

    assert stream._text_delta_index == 3
    drain = event_buffer.drain()
    delta_events = [
        e for e in drain if e.type == "assistant_segment_delta"
    ]
    assert len(delta_events) == 3
    deltas = "".join(e.payload["delta"] for e in delta_events)
    assert deltas == "Hello World"


# ---------------------------------------------------------------------------
# _record_reasoning_delta
# ---------------------------------------------------------------------------


def test_record_reasoning_delta_records_delta() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._record_reasoning_delta("Thinking...")

    assert stream._reasoning_delta_index == 1
    drain = event_buffer.drain()
    delta_events = [
        e for e in drain if e.type == "reasoning_segment_delta"
    ]
    assert len(delta_events) == 1
    assert delta_events[0].payload["delta"] == "Thinking..."


def test_record_reasoning_delta_none_is_noop() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._record_reasoning_delta(None)

    assert stream._reasoning_delta_index == 0
    drain = event_buffer.drain()
    assert len(drain) == 0


def test_record_reasoning_delta_empty_is_noop() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._record_reasoning_delta("")

    assert stream._reasoning_delta_index == 0
    drain = event_buffer.drain()
    assert len(drain) == 0


def test_record_reasoning_delta_multiple_accumulates() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    stream._record_reasoning_delta("Step 1.")
    stream._record_reasoning_delta("Step 2.")

    assert stream._reasoning_delta_index == 2
    drain = event_buffer.drain()
    delta_events = [
        e for e in drain if e.type == "reasoning_segment_delta"
    ]
    assert len(delta_events) == 2


# ---------------------------------------------------------------------------
# _require_run_task
# ---------------------------------------------------------------------------


def test_require_run_task_raises_when_not_started() -> None:
    stream = _make_stream()
    with pytest.raises(RuntimeError, match="has not been opened"):
        stream._require_run_task()


def test_require_run_task_returns_task_after_open() -> None:
    async def _main() -> None:
        stream = _make_stream()
        stream._run_task = asyncio.create_task(asyncio.sleep(0))
        try:
            task = stream._require_run_task()
            assert task is stream._run_task
        finally:
            stream._run_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await stream._run_task

    asyncio.run(_main())


# ---------------------------------------------------------------------------
# _flush_pending_events_to_queue
# ---------------------------------------------------------------------------


def test_flush_pending_events_to_queue_drains_buffer() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    event_buffer.record_event(
        event_buffer.event_factory.build_diagnostic(
            code="test",
            message="test message",
            details={},
            stage="test",
        )
    )
    stream._flush_pending_events_to_queue(reason="test_flush")

    assert not stream._event_queue.empty()
    dequeued: list[RuntimeExecutionEvent] = []
    while not stream._event_queue.empty():
        dequeued.append(stream._event_queue.get_nowait())
    assert len(dequeued) == 1
    assert dequeued[0].type == DIAGNOSTIC_EVENT_TYPE


def test_flush_pending_events_to_queue_empty_buffer_noop() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)
    stream._flush_pending_events_to_queue(reason="empty")
    assert stream._event_queue.empty()


# ---------------------------------------------------------------------------
# _emit_tool_call_observation_if_needed — identified + args complete
# ---------------------------------------------------------------------------


def test_emit_tool_call_observation_identified_with_complete_args() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0, tool_name="test_tool", tool_call_id="call-1", args={"a": 1}
    )
    stream._emit_tool_call_observation_if_needed(state=state)

    assert state.observation_emitted is True
    assert state.arguments_completed_emitted is True
    assert stream._raw_tool_call_observation_count == 1
    assert stream._raw_tool_call_arguments_completed_count == 1

    drain = event_buffer.drain()
    diagnostic_events = [e for e in drain if e.type == DIAGNOSTIC_EVENT_TYPE]
    assert len(diagnostic_events) == 1
    assert diagnostic_events[0].payload["code"] == "raw_tool_call_observed"


def test_emit_tool_call_observation_identified_with_incomplete_args() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0, tool_name="t", tool_call_id="c", args='{"x": '
    )
    stream._emit_tool_call_observation_if_needed(state=state)

    assert state.observation_emitted is True
    assert state.arguments_completed_emitted is False
    assert stream._raw_tool_call_observation_count == 1
    assert stream._raw_tool_call_arguments_completed_count == 0

    drain = event_buffer.drain()
    assert len(drain) == 1


def test_emit_tool_call_observation_arguments_complete_later() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0,
        tool_name="t",
        tool_call_id="c",
        args='{"x": ',
        observation_emitted=True,
        arguments_completed_emitted=False,
    )
    stream._raw_tool_call_observation_count = 1

    state.args = {"x": 1}

    stream._emit_tool_call_observation_if_needed(state=state)

    assert state.arguments_completed_emitted is True
    assert stream._raw_tool_call_arguments_completed_count == 1

    drain = event_buffer.drain()
    diagnostic_events = [e for e in drain if e.type == DIAGNOSTIC_EVENT_TYPE]
    assert len(diagnostic_events) == 1
    assert diagnostic_events[0].payload["code"] == "raw_tool_call_arguments_completed"


def test_emit_tool_call_observation_already_emitted_and_completed() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(
        part_index=0,
        tool_name="t",
        tool_call_id="c",
        args={"done": True},
        observation_emitted=True,
        arguments_completed_emitted=True,
    )
    stream._raw_tool_call_observation_count = 1
    stream._raw_tool_call_arguments_completed_count = 1

    stream._emit_tool_call_observation_if_needed(state=state)

    drain = event_buffer.drain()
    assert len(drain) == 0
    assert stream._raw_tool_call_observation_count == 1
    assert stream._raw_tool_call_arguments_completed_count == 1


def test_emit_tool_call_observation_not_identified_no_emit() -> None:
    event_buffer = _make_event_buffer()
    stream = _make_stream(event_buffer=event_buffer)

    state = _ObservedToolCall(part_index=0, tool_name=None, tool_call_id=None, args={"a": 1})
    stream._emit_tool_call_observation_if_needed(state=state)

    assert state.observation_emitted is False
    assert state.arguments_completed_emitted is False
    drain = event_buffer.drain()
    assert len(drain) == 0
    assert stream._raw_tool_call_observation_count == 0


# ---------------------------------------------------------------------------
# _build_tool_call_diagnostic_details edge cases
# ---------------------------------------------------------------------------


def test_build_tool_call_diagnostic_details_args_complete_with_dict() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(
        part_index=1,
        tool_name="test_tool",
        tool_call_id="call-abc",
        args={"a": 1, "b": 2},
    )
    result = stream._build_tool_call_diagnostic_details(
        state=state, observation_kind="observed", parsed_arguments=None
    )
    assert result["argumentsComplete"] is True
    assert result["toolArguments"] == {"a": 1, "b": 2}


def test_build_tool_call_diagnostic_details_with_parsed_arguments_overrides() -> None:
    stream = _make_stream()
    state = _ObservedToolCall(
        part_index=0,
        tool_name="t",
        tool_call_id="c",
        args='json str',
    )
    parsed = {"from": "json"}
    result = stream._build_tool_call_diagnostic_details(
        state=state, observation_kind="observed", parsed_arguments=parsed
    )
    assert result["toolArguments"] == parsed
    assert "toolArgumentsJson" not in result


# ---------------------------------------------------------------------------
# _merge_tool_call_arguments edge cases
# ---------------------------------------------------------------------------


def test_merge_tool_call_arguments_both_none() -> None:
    stream = _make_stream()
    assert stream._merge_tool_call_arguments(current=None, update=None) is None


def test_merge_tool_call_arguments_empty_strings() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(current="", update="")
    assert result == ""


def test_merge_tool_call_arguments_empty_dicts() -> None:
    stream = _make_stream()
    result = stream._merge_tool_call_arguments(current={}, update={})
    assert result == {}


# ---------------------------------------------------------------------------
# _resolve_tool_id_from_tool_name edge cases
# ---------------------------------------------------------------------------


def test_resolve_tool_id_from_tool_name_registry_iterates_all_ids() -> None:
    mock_tool_no_match = Mock()
    mock_tool_no_match.function_name = "unrelated"
    mock_tool_match = Mock()
    mock_tool_match.function_name = "correct_func"
    mock_registry = Mock()
    mock_registry.list_tool_ids = Mock(
        return_value=("tool.one", "tool.two", "tool.three")
    )
    resolve_calls: list[str] = []

    def side_effect(tool_id: str) -> Any:
        resolve_calls.append(tool_id)
        if tool_id == "tool.two":
            return mock_tool_match
        return mock_tool_no_match

    mock_registry.resolve_tool = Mock(side_effect=side_effect)

    deps = _make_deps(tool_registry=mock_registry)
    stream = _make_stream(deps=deps)

    result = stream._resolve_tool_id_from_tool_name("correct_func")
    assert result == "tool.two"
    assert resolve_calls == ["tool.one", "tool.two"]


def test_resolve_tool_id_from_tool_name_whitespace_only_returns_unknown() -> None:
    stream = _make_stream()
    assert stream._resolve_tool_id_from_tool_name("   ") == "tool.unknown"
