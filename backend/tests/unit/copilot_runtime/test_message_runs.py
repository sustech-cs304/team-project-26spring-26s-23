from __future__ import annotations

import asyncio

import pytest

from app.copilot_runtime.agent import AgentExecutionError, RuntimeToolLifecycleEvent, ToolInvocationError
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.execution_support import SessionNotFoundError
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.run_events import encode_runtime_run_event
from app.copilot_runtime.model_routes import (
    ProviderProfileNotFoundError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteSnapshot,
)
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeThinkingSelection,
    build_runtime_scaffold,
)
from app.copilot_runtime.agent_registry import build_default_agent_registry
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID, build_default_tool_registry


class _ImmediateTextStream:
    def __init__(
        self,
        *,
        deltas: list[str],
        output: str | Exception,
        tool_events: list[RuntimeToolLifecycleEvent] | None = None,
    ) -> None:
        self.resolved_model_id = "gpt-4.1"
        self._deltas = list(deltas)
        self._output = output
        self._tool_events = list(tool_events or [])

    async def __aenter__(self) -> _ImmediateTextStream:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_deltas(self):
        for delta in self._deltas:
            yield delta

    async def get_output(self) -> str:
        if isinstance(self._output, Exception):
            raise self._output
        return self._output

    def drain_tool_events(self) -> tuple[RuntimeToolLifecycleEvent, ...]:
        drained = tuple(self._tool_events)
        self._tool_events.clear()
        return drained


class _ImmediateEventStream:
    def __init__(
        self,
        *,
        events: list[RuntimeExecutionEvent],
        output: str | Exception,
    ) -> None:
        self.resolved_model_id = "gpt-4.1"
        self._events = list(events)
        self._output = output

    async def __aenter__(self) -> _ImmediateEventStream:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_events(self):
        for event in self._events:
            yield event

    async def get_output(self) -> str:
        if isinstance(self._output, Exception):
            raise self._output
        return self._output


class _StreamingExecutor:
    def __init__(
        self,
        *,
        deltas: list[str],
        output: str | Exception,
        tool_events: list[RuntimeToolLifecycleEvent] | None = None,
    ) -> None:
        self._deltas = deltas
        self._output = output
        self._tool_events = list(tool_events or [])
        self.calls: list[dict[str, object]] = []
        self.model_configured = True
        self.model_environment_keys: tuple[str, ...] = ()

    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "debug_enabled": debug_enabled,
                "request_options": dict(request_options or {}),
                "model_settings": dict(model_settings or {}),
            }
        )
        return _ImmediateTextStream(
            deltas=self._deltas,
            output=self._output,
            tool_events=self._tool_events,
        )


class _EventStreamingExecutor:
    def __init__(
        self,
        *,
        events: list[RuntimeExecutionEvent],
        output: str | Exception,
    ) -> None:
        self._events = list(events)
        self._output = output
        self.calls: list[dict[str, object]] = []
        self.model_configured = True
        self.model_environment_keys: tuple[str, ...] = ()

    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateEventStream:
        self.calls.append(
            {
                "run_id": run_id,
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "debug_enabled": debug_enabled,
                "request_options": dict(request_options or {}),
                "model_settings": dict(model_settings or {}),
            }
        )
        return _ImmediateEventStream(events=self._events, output=self._output)


class _ResolvedRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider=model_route.snapshot.provider,
            endpoint_type=model_route.snapshot.endpoint_type,
            base_url=model_route.snapshot.base_url,
            model_id=model_route.snapshot.model_id,
            api_key="test-api-key",
        )


class _MissingProviderResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        raise ProviderProfileNotFoundError(provider_profile_id=model_route.provider_profile_id)


class _CancellingStream(_ImmediateTextStream):
    async def get_output(self) -> str:
        raise asyncio.CancelledError()


class _CancellingExecutor(_StreamingExecutor):
    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "debug_enabled": debug_enabled,
                "request_options": dict(request_options or {}),
                "model_settings": dict(model_settings or {}),
            }
        )
        return _CancellingStream(deltas=self._deltas, output="unused")


class _ToolFailingExecutor(_StreamingExecutor):
    def __init__(self, *, code: str, message: str, tool_id: str) -> None:
        tool_call_id = f"{tool_id}:call-1"
        tool_events = [
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="started",
                title="调用天气工具",
                summary="正在获取天气。",
                input_summary='{"location": "Shenzhen"}',
            ),
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="failed",
                title="工具调用失败",
                summary="工具执行失败。",
                input_summary='{"location": "Shenzhen"}',
                error_summary=message,
            ),
        ]
        super().__init__(
            deltas=[],
            output=ToolInvocationError(
                code=code,
                message=message,
                tool_id=tool_id,
                tool_call_id=tool_call_id,
            ),
            tool_events=tool_events,
        )



def test_stream_events_success_archives_only_completed_assistant_message() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello", " world"], output="Hello world")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(_collect_events(orchestrator, _build_request(session_id="session-1", debug_mode_enabled=True)))

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "text_delta", "run_completed"]
    assert [event.sequence for event in events] == [1, 2, 3, 4, 5]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[-1].payload["assistantText"] == "Hello world"
    assert executor.calls == [
        {
            "agent_name": "default",
            "user_prompt": "Hello",
            "message_history": [],
            "model_id": "gpt-4.1",
            "enabled_tools": [],
            "debug_enabled": True,
            "request_options": {},
            "model_settings": {},
        }
    ]
    assert [(message.role, message.content) for message in store.list_messages("session-1")] == [
        ("user", "Hello"),
        ("assistant", "Hello world"),
    ]



def test_stream_events_emits_tool_started_completed_before_terminal_success() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    tool_events = [
        RuntimeToolLifecycleEvent(
            tool_call_id="tool.weather-current:call-1",
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="started",
            title="调用天气工具",
            summary="正在获取 Shenzhen 的天气。",
            input_summary='{"location": "Shenzhen"}',
        ),
        RuntimeToolLifecycleEvent(
            tool_call_id="tool.weather-current:call-1",
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="completed",
            title="天气工具已返回结果",
            summary="Shenzhen：晴 / 24°C / 湿度 60%",
            input_summary='{"location": "Shenzhen"}',
            result_summary="Shenzhen：晴 / 24°C / 湿度 60%",
        ),
    ]
    executor = _StreamingExecutor(
        deltas=["Weather answer"],
        output="Weather answer",
        tool_events=tool_events,
    )
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
        )
    )

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[2].payload["phase"] == "started"
    assert events[3].payload["phase"] == "completed"
    assert events[3].payload["toolId"] == WEATHER_CURRENT_TOOL_ID
    assert events[-1].payload["resolvedToolIds"] == [WEATHER_CURRENT_TOOL_ID]



def test_stream_events_projects_raw_tool_call_diagnostics_and_tool_events() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    tool_call_id = "tool.weather-current:call-1"
    executor = _EventStreamingExecutor(
        events=[
            RuntimeExecutionEvent(
                type="assistant_segment_started",
                payload={"segmentId": "run-test:assistant-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_delta",
                payload={
                    "segmentId": "run-test:assistant-segment-1",
                    "delta": "我先查一下。",
                },
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_completed",
                payload={"segmentId": "run-test:assistant-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="diagnostic",
                payload={
                    "code": "raw_tool_call_observed",
                    "message": "Observed provider tool call in raw collector.",
                    "details": {
                        "source": "pydantic_raw_stream",
                        "providerEndpointType": "openai-compatible",
                        "observationKind": "observed",
                        "partIndex": 1,
                        "toolCallId": tool_call_id,
                        "toolName": "weather_current",
                        "argumentsComplete": False,
                        "toolArgumentsJson": '{"location":"Shen',
                    },
                    "stage": "collect_raw_stream",
                },
            ),
            RuntimeExecutionEvent(
                type="diagnostic",
                payload={
                    "code": "raw_tool_call_arguments_completed",
                    "message": "Provider tool call arguments became complete in raw collector.",
                    "details": {
                        "source": "pydantic_raw_stream",
                        "providerEndpointType": "openai-compatible",
                        "observationKind": "arguments_completed",
                        "partIndex": 1,
                        "toolCallId": tool_call_id,
                        "toolName": "weather_current",
                        "argumentsComplete": True,
                        "toolArguments": {"location": "Shenzhen"},
                    },
                    "stage": "collect_raw_stream",
                },
            ),
            RuntimeExecutionEvent(
                type="tool_started",
                payload={
                    "toolCallId": tool_call_id,
                    "toolId": WEATHER_CURRENT_TOOL_ID,
                    "phase": "started",
                    "title": "调用天气工具",
                    "summary": "正在获取 Shenzhen 的天气。",
                    "inputSummary": '{"location": "Shenzhen"}',
                },
            ),
            RuntimeExecutionEvent(
                type="tool_completed",
                payload={
                    "toolCallId": tool_call_id,
                    "toolId": WEATHER_CURRENT_TOOL_ID,
                    "phase": "completed",
                    "title": "天气工具已返回结果",
                    "summary": "Shenzhen：晴 / 24°C / 湿度 60%",
                    "inputSummary": '{"location": "Shenzhen"}',
                    "resultSummary": "Shenzhen：晴 / 24°C / 湿度 60%",
                },
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_started",
                payload={"segmentId": "run-test:assistant-segment-2"},
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_delta",
                payload={
                    "segmentId": "run-test:assistant-segment-2",
                    "delta": "查到了。",
                },
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_completed",
                payload={"segmentId": "run-test:assistant-segment-2"},
            ),
        ],
        output="我先查一下。查到了。",
    )
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
        )
    )

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_diagnostic",
        "run_diagnostic",
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[3].payload["code"] == "raw_tool_call_observed"
    assert events[3].payload["details"]["toolCallId"] == tool_call_id
    assert events[4].payload["code"] == "raw_tool_call_arguments_completed"
    assert events[5].payload["phase"] == "started"
    assert events[6].payload["phase"] == "completed"
    assert events[-1].payload["assistantText"] == "我先查一下。查到了。"
    assert executor.calls == [
        {
            "run_id": events[0].runId,
            "agent_name": "default",
            "user_prompt": "Hello",
            "message_history": [],
            "model_id": "gpt-4.1",
            "enabled_tools": [WEATHER_CURRENT_TOOL_ID],
            "debug_enabled": False,
            "request_options": {},
            "model_settings": {},
        }
    ]



def test_stream_events_emits_explicit_diagnostic_when_raw_tool_call_never_executes() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    tool_call_id = "tool.weather-current:call-unexecuted"
    executor = _EventStreamingExecutor(
        events=[
            RuntimeExecutionEvent(
                type="assistant_segment_started",
                payload={"segmentId": "run-test:assistant-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_delta",
                payload={
                    "segmentId": "run-test:assistant-segment-1",
                    "delta": "我先查一下。",
                },
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_completed",
                payload={"segmentId": "run-test:assistant-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="diagnostic",
                payload={
                    "code": "raw_tool_call_observed",
                    "message": "Observed provider tool call in raw collector.",
                    "details": {
                        "source": "pydantic_raw_stream",
                        "providerEndpointType": "openai-compatible",
                        "observationKind": "observed",
                        "partIndex": 1,
                        "toolCallId": tool_call_id,
                        "toolName": "weather_current",
                        "argumentsComplete": False,
                        "toolArgumentsJson": '{"location":"Shen',
                    },
                    "stage": "collect_raw_stream",
                },
            ),
            RuntimeExecutionEvent(
                type="diagnostic",
                payload={
                    "code": "raw_tool_call_arguments_completed",
                    "message": "Provider tool call arguments became complete in raw collector.",
                    "details": {
                        "source": "pydantic_raw_stream",
                        "providerEndpointType": "openai-compatible",
                        "observationKind": "arguments_completed",
                        "partIndex": 1,
                        "toolCallId": tool_call_id,
                        "toolName": "weather_current",
                        "argumentsComplete": True,
                        "toolArguments": {"location": "Shenzhen"},
                    },
                    "stage": "collect_raw_stream",
                },
            ),
            RuntimeExecutionEvent(
                type="diagnostic",
                payload={
                    "code": "raw_tool_call_unexecuted",
                    "message": "Provider tool call arguments became complete, but no actual tool execution followed.",
                    "details": {
                        "source": "pydantic_raw_stream",
                        "providerEndpointType": "openai-compatible",
                        "observationKind": "execution_missing",
                        "partIndex": 1,
                        "toolCallId": tool_call_id,
                        "toolName": "weather_current",
                        "argumentsComplete": True,
                        "toolArguments": {"location": "Shenzhen"},
                    },
                    "stage": "drive_raw_tool_call",
                },
            ),
        ],
        output=AgentExecutionError(
            "Observed provider tool call arguments became complete, but no actual tool execution followed."
        ),
    )
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
        )
    )

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_diagnostic",
        "run_diagnostic",
        "run_diagnostic",
        "run_diagnostic",
        "run_failed",
    ]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[3].payload["code"] == "raw_tool_call_observed"
    assert events[4].payload["code"] == "raw_tool_call_arguments_completed"
    assert events[5].payload["code"] == "raw_tool_call_unexecuted"
    assert events[5].payload["details"]["toolCallId"] == tool_call_id
    assert events[6].payload == {
        "code": "agent_execution_failed",
        "message": "Observed provider tool call arguments became complete, but no actual tool execution followed.",
        "details": {},
        "stage": "execute_model",
    }
    assert events[7].payload == {
        "code": "agent_execution_failed",
        "message": "Observed provider tool call arguments became complete, but no actual tool execution followed.",
        "details": {},
    }
    assert store.list_messages("session-1") == ()



def test_stream_events_host_resolution_failure_emits_diagnostic_and_failed_without_archive() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["should-not-run"], output="should-not-run")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_MissingProviderResolver(),
    )

    events = asyncio.run(_collect_events(orchestrator, _build_request(session_id="session-1")))

    assert [event.type for event in events] == ["run_started", "run_diagnostic", "run_failed"]
    assert events[1].payload["code"] == "provider_profile_not_found"
    assert events[2].payload["code"] == "provider_profile_not_found"
    assert executor.calls == []
    assert store.list_messages("session-1") == ()



def test_stream_events_tool_failure_emits_failed_tool_event_then_failed_terminal_event() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _ToolFailingExecutor(
        code="tool_execution_failed",
        message="Tool 'tool.weather-current' failed: boom",
        tool_id=WEATHER_CURRENT_TOOL_ID,
    )
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "tool_event", "tool_event", "run_failed"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[3].payload["phase"] == "failed"
    assert events[-1].payload["code"] == "tool_execution_failed"
    assert events[-1].payload["details"]["toolId"] == WEATHER_CURRENT_TOOL_ID
    assert store.list_messages("session-1") == ()



def test_stream_events_cancelled_run_discards_draft_and_does_not_archive() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _CancellingExecutor(deltas=["partial"], output="unused")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(_collect_events(orchestrator, _build_request(session_id="session-1")))

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_cancelled"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[-1].payload == {
        "assistantMessageId": events[0].payload["assistantMessageId"],
        "reason": "cancelled",
    }
    assert store.list_messages("session-1") == ()



def test_stream_events_client_disconnect_cancels_run_and_does_not_archive() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["partial", "late"], output="partial late")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    disconnect_checks = 0

    async def is_client_disconnected() -> bool:
        nonlocal disconnect_checks
        disconnect_checks += 1
        return disconnect_checks >= 2

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1"),
            is_client_disconnected=is_client_disconnected,
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_cancelled"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[-1].payload == {
        "assistantMessageId": events[0].payload["assistantMessageId"],
        "reason": "cancelled",
    }
    assert store.list_messages("session-1") == ()



def test_stream_events_explicit_false_overrides_runtime_debug_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_CHAIN_DEBUG", "1")
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", debug_mode_enabled=False),
        )
    )

    assert executor.calls[0]["debug_enabled"] is False



def test_stream_events_uses_runtime_debug_env_when_request_debug_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_CHAIN_DEBUG", "1")
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", debug_mode_enabled=None),
        )
    )

    assert executor.calls[0]["debug_enabled"] is True



def test_stream_events_applies_glm_5_turbo_thinking_settings_for_mapped_routes() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                session_id="session-1",
                thinking_level_intent="auto",
                route_snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://api.z.ai/api/paas/v4",
                    model_id="glm-5-turbo",
                ),
            ),
        )
    )

    assert executor.calls[0]["model_settings"] == {
        "extra_body": {
            "thinking": {
                "type": "enabled",
            }
        }
    }
    metadata = events[1].payload
    assert metadata["requestedThinkingSelection"] == {
        "series": "compat-discrete-selection-v1",
        "mode": "preset",
        "level": "auto",
        "budgetTokens": None,
    }
    assert metadata["appliedThinkingSelection"] == {
        "series": "compat-discrete-selection-v1",
        "mode": "preset",
        "level": "auto",
        "budgetTokens": None,
    }
    assert metadata["requestedThinkingLevel"] == "auto"
    assert metadata["appliedThinkingLevel"] == "auto"
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "verified-supported"
    assert metadata["thinkingSelectionResult"] == _thinking_selection_result_payload(
        requested_thinking_level="auto",
        applied_thinking_level="auto",
        applied=True,
        reason_code="verified_provider_mapping_applied",
        error_code=None,
        mapping_reason_code="zai_glm_series_auto",
        capability_status="verified-supported",
        capability_source="verified",
        override_present=False,
        override_applied=False,
        provider_mapping="zai_glm_openai_compatible",
        model_settings={
            "extra_body": {
                "thinking": {
                    "type": "enabled",
                }
            }
        },
        include_empty_fields=True,
    )



def test_stream_events_applies_structured_selection_for_verified_route() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    thinking_selection = RuntimeThinkingSelection(
        series="zai-glm-thinking-v1",
        mode="preset",
        level="auto",
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                session_id="session-1",
                thinking_selection=thinking_selection,
                route_snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://api.z.ai/api/paas/v4",
                    model_id="glm-5-turbo",
                ),
            ),
        )
    )

    metadata = events[1].payload
    assert metadata["requestedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["appliedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["requestedThinkingLevel"] == "auto"
    assert metadata["appliedThinkingLevel"] == "auto"
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "verified-supported"
    assert metadata["thinkingSelectionResult"]["reasonCode"] == "verified_provider_mapping_applied"
    assert metadata["thinkingSelectionResult"]["mappingReasonCode"] == "zai_glm_series_auto"
    assert executor.calls[0]["model_settings"] == {
        "extra_body": {
            "thinking": {
                "type": "enabled",
            }
        }
    }



def test_stream_events_unknown_with_override_applies_when_mapping_exists() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    thinking_selection = RuntimeThinkingSelection(
        series="zai-glm-thinking-v1",
        mode="preset",
        level="auto",
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                session_id="session-1",
                thinking_selection=thinking_selection,
                thinking_capability_override={
                    "supported": True,
                    "series": "zai-glm-thinking-v1",
                    "input": {
                        "kind": "discrete",
                        "levels": ["auto"],
                    },
                    "defaultSelection": {"mode": "preset", "level": "auto"},
                    "source": "settings-page",
                },
                route_snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://api.z.ai/api/paas/v4",
                    model_id="glm-5-experimental",
                ),
            ),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_completed"]
    metadata = events[1].payload
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "unknown-with-override"
    assert metadata["thinkingCapabilitySnapshot"]["source"] == "override"
    assert metadata["appliedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["thinkingSelectionResult"]["reasonCode"] == "override_provider_mapping_applied"
    assert metadata["thinkingSelectionResult"]["mappingReasonCode"] == "zai_glm_series_auto"
    assert executor.calls[0]["model_settings"] == {
        "extra_body": {
            "thinking": {
                "type": "enabled",
            }
        }
    }



def test_stream_events_unknown_with_override_fails_fast_when_mapping_missing() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    thinking_selection = RuntimeThinkingSelection(
        series="compat-discrete-levels-v1",
        mode="preset",
        level="high",
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                session_id="session-1",
                thinking_selection=thinking_selection,
                thinking_capability_override={
                    "supported": True,
                    "series": "compat-discrete-levels-v1",
                    "input": {
                        "kind": "discrete",
                        "levels": ["high"],
                    },
                    "defaultSelection": {"mode": "preset", "level": "high"},
                    "source": "settings-page",
                },
            ),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "run_diagnostic", "run_failed"]
    metadata = events[1].payload
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "unknown-with-override"
    assert metadata["thinkingCapabilitySnapshot"]["source"] == "override"
    assert metadata["appliedThinkingSelection"] is None
    assert metadata["thinkingSelectionResult"]["reasonCode"] == "requested_selection_not_mappable_for_provider"
    assert metadata["thinkingSelectionResult"]["errorCode"] == "thinking_not_supported_for_route"
    assert events[2].payload["code"] == "thinking_not_supported_for_route"
    assert events[2].payload["details"]["mappingReasonCode"] == "provider_mapping_missing_for_selection"
    assert executor.calls == []



def test_stream_events_fails_when_thinking_intent_cannot_be_mapped() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(session_id="session-1", thinking_level_intent="medium"),
        )
    )

    expected_message = (
        "Selected thinking level 'medium' is not supported by the current model route. "
        "This request was cancelled instead of continuing without provider thinking parameters."
    )
    expected_details = {
        "providerProfileId": "provider-1",
        "provider": "openai",
        "endpointType": "openai-compatible",
        "baseUrl": "https://example.com/v1",
        "modelId": "gpt-4.1",
        "status": "unknown-without-override",
        "source": "unknown",
        "supported": False,
        "series": "fixed-off-v1",
        "controlSpec": {
            "kind": "fixed",
            "selectionKind": "preset",
            "presetOptions": [{"kind": "preset", "value": "off"}],
            "fixedSelection": {"kind": "preset", "value": "off"},
        },
        "defaultSelection": {"kind": "preset", "value": "off"},
        "supportedLevels": [],
        "defaultLevel": None,
        "reasonCode": "route_not_verified",
        "providerHint": "unknown-route",
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": False,
                "applied": False,
                "source": None,
                "format": None,
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "requestedSelection": {"kind": "preset", "value": "medium"},
        "appliedSelection": None,
        "requestedThinkingLevel": "medium",
        "appliedThinkingLevel": None,
        "providerMapping": None,
        "mappingReasonCode": "selection_not_allowed_by_capability",
        "errorCode": "thinking_not_supported_for_route",
        "intent": "medium",
        "reason": "requested_level_not_in_capability",
    }

    assert [event.type for event in events] == ["run_started", "run_metadata", "run_diagnostic", "run_failed"]
    _assert_unknown_route_run_metadata(
        events[1],
        requested_thinking_level="medium",
        applied_thinking_level=None,
        thinking_selection_result=_thinking_selection_result_payload(
            requested_thinking_level="medium",
            applied_thinking_level=None,
            applied=False,
            reason_code="requested_level_not_in_capability",
            error_code="thinking_not_supported_for_route",
            mapping_reason_code="selection_not_allowed_by_capability",
            capability_status="unknown-without-override",
            capability_source="unknown",
            override_present=False,
            override_applied=False,
            include_empty_fields=True,
        ),
    )
    assert events[2].payload == {
        "code": "thinking_not_supported_for_route",
        "message": expected_message,
        "details": expected_details,
        "stage": "adapt_thinking",
    }
    assert events[3].payload == {
        "code": "thinking_not_supported_for_route",
        "message": expected_message,
        "details": expected_details,
    }
    assert executor.calls == []



def test_stream_events_logs_thinking_diagnostics_when_debug_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _StreamingExecutor(deltas=["Hello"], output="Hello")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    captured_logs: list[tuple[str, dict[str, object]]] = []
    module = __import__("app.copilot_runtime.message_runs", fromlist=["log_runtime_chain_debug"])

    def _capture_log(event_name: str, *, enabled: bool | None = None, **payload: object) -> None:
        captured_logs.append((event_name, payload))

    monkeypatch.setattr(module, "log_runtime_chain_debug", _capture_log)

    asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                session_id="session-1",
                thinking_level_intent="medium",
                debug_mode_enabled=True,
            ),
        )
    )

    thinking_logs = {
        name: payload
        for name, payload in captured_logs
        if name.startswith("thinking.")
    }

    assert set(thinking_logs) >= {
        "thinking.capability_resolved",
        "thinking.request_validated",
        "thinking.provider_mapping_resolved",
        "thinking.run_metadata_attached",
        "thinking.fail_fast",
    }
    assert thinking_logs["thinking.capability_resolved"]["capability"] == _unknown_route_thinking_snapshot()
    assert thinking_logs["thinking.request_validated"]["requestedThinkingLevel"] == "medium"
    assert thinking_logs["thinking.request_validated"]["applied"] is False
    assert thinking_logs["thinking.request_validated"]["reason"] == "requested_level_not_in_capability"
    assert thinking_logs["thinking.provider_mapping_resolved"]["reason"] == "requested_level_not_in_capability"
    assert thinking_logs["thinking.run_metadata_attached"]["yieldedEvent"] == _unknown_route_run_metadata_summary(
        sequence=2,
        requested_thinking_level="medium",
        applied_thinking_level=None,
    )
    assert thinking_logs["thinking.fail_fast"]["code"] == "thinking_not_supported_for_route"
    assert thinking_logs["thinking.fail_fast"]["reason"] == "requested_level_not_in_capability"
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["requestedThinkingLevel"] == "medium"
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["reasonCode"] == "route_not_verified"



def test_stream_events_logs_reasoning_suppression_when_hidden_reasoning_delta_arrives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id="session-1")
    executor = _EventStreamingExecutor(
        events=[
            RuntimeExecutionEvent(
                type="reasoning_segment_started",
                payload={"segmentId": "run-hidden:reasoning-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="reasoning_segment_delta",
                payload={
                    "segmentId": "run-hidden:reasoning-segment-1",
                    "delta": "这段推理应被抑制。",
                },
            ),
            RuntimeExecutionEvent(
                type="reasoning_segment_completed",
                payload={"segmentId": "run-hidden:reasoning-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_started",
                payload={"segmentId": "run-hidden:assistant-segment-1"},
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_delta",
                payload={
                    "segmentId": "run-hidden:assistant-segment-1",
                    "delta": "最终回答。",
                },
            ),
            RuntimeExecutionEvent(
                type="assistant_segment_completed",
                payload={"segmentId": "run-hidden:assistant-segment-1"},
            ),
        ],
        output="最终回答。",
    )
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    captured_logs: list[tuple[str, dict[str, object]]] = []
    module = __import__("app.copilot_runtime.message_runs", fromlist=["log_runtime_chain_debug"])

    def _capture_log(event_name: str, *, enabled: bool | None = None, **payload: object) -> None:
        captured_logs.append((event_name, payload))

    monkeypatch.setattr(module, "log_runtime_chain_debug", _capture_log)

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                session_id="session-1",
                debug_mode_enabled=True,
                thinking_capability_override={
                    "supported": True,
                    "series": "zai-glm-thinking-v1",
                    "input": {
                        "kind": "discrete",
                        "levels": ["auto"],
                    },
                    "defaultSelection": {"mode": "preset", "level": "auto"},
                    "visibility": {
                        "reasoning": "suppressed",
                        "supportsSuppression": True,
                    },
                    "source": "settings-page",
                },
                thinking_selection=RuntimeThinkingSelection(
                    series="zai-glm-thinking-v1",
                    mode="preset",
                    level="auto",
                ),
                route_snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://api.z.ai/api/paas/v4",
                    model_id="glm-5-experimental",
                ),
            ),
        )
    )

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "reasoning_delta",
        "text_delta",
        "run_completed",
    ]
    suppression_logs = [payload for name, payload in captured_logs if name == "thinking.reasoning_suppressed"]
    assert len(suppression_logs) == 1
    assert suppression_logs[0]["suppressionEnabled"] is True
    assert suppression_logs[0]["suppressionSource"] == "capability-visibility"
    assert suppression_logs[0]["suppressionReasonCode"] == "capability_visibility_suppressed"
    assert suppression_logs[0]["reasoningSuppressionBasis"] == _reasoning_suppression_basis_payload(
        applied_thinking_level="auto",
        capability_source="override",
        capability_series="zai-glm-thinking-v1",
        reasoning_visibility="suppressed",
    )
    assert suppression_logs[0]["projectedEventTypes"] == ["reasoning_delta"]



def test_encode_runtime_run_event_renders_sse_payload() -> None:
    request = _build_request(session_id="session-1")
    event = asyncio.run(_collect_events_from_request(request))[0]

    assert encode_runtime_run_event(event) == (
        'data: {"type": "run_started", "runId": "run-fixed", "sessionId": "session-1", '
        '"sequence": 1, "payload": {"assistantMessageId": "run-fixed:assistant"}}\n\n'
    )



def test_stream_events_missing_session_emits_failed_terminal_event() -> None:
    store = InMemorySessionStore()
    executor = _StreamingExecutor(deltas=["unused"], output="unused")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(_collect_events(orchestrator, _build_request(session_id="missing-session")))

    assert [event.type for event in events] == ["run_started", "run_failed"]
    assert events[-1].payload == {
        "code": "session_not_found",
        "message": str(SessionNotFoundError("missing-session")),
        "details": {"sessionId": "missing-session"},
    }



def _unknown_route_thinking_snapshot() -> dict[str, object]:
    return {
        "status": "unknown-without-override",
        "source": "unknown",
        "supported": False,
        "series": "fixed-off-v1",
        "controlSpec": {
            "kind": "fixed",
            "selectionKind": "preset",
            "presetOptions": [{"kind": "preset", "value": "off"}],
            "fixedSelection": {"kind": "preset", "value": "off"},
        },
        "defaultSelection": {"kind": "preset", "value": "off"},
        "supportedLevels": [],
        "defaultLevel": None,
        "reasonCode": "route_not_verified",
        "providerHint": "unknown-route",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": False,
                "applied": False,
                "source": None,
                "format": None,
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
        },
        "overrideLevels": [],
    }



def _unknown_route_run_metadata_summary(
    *,
    sequence: int,
    requested_thinking_level: str | None,
    applied_thinking_level: str | None,
) -> dict[str, object]:
    return {
        "type": "run_metadata",
        "sequence": sequence,
        "thinkingCapability": _unknown_route_thinking_snapshot(),
        "requestedThinkingSelection": _compat_thinking_selection(requested_thinking_level),
        "appliedThinkingSelection": _compat_thinking_selection(applied_thinking_level),
        "thinkingSelectionResult": _thinking_selection_result_payload(
            requested_thinking_level=requested_thinking_level,
            applied_thinking_level=applied_thinking_level,
            applied=False,
            reason_code=(
                "intent_missing"
                if requested_thinking_level is None
                else "requested_level_not_in_capability"
            ),
            error_code=(
                None
                if requested_thinking_level is None
                else "thinking_not_supported_for_route"
            ),
            mapping_reason_code=(
                "selection_missing"
                if requested_thinking_level is None
                else "selection_not_allowed_by_capability"
            ),
            capability_status="unknown-without-override",
            capability_source="unknown",
            override_present=False,
            override_applied=False,
            include_empty_fields=requested_thinking_level is None,
        ),
        "reasoningSuppressionBasis": _reasoning_suppression_basis_payload(
            applied_thinking_level=applied_thinking_level,
            capability_source="unknown",
            capability_series="fixed-off-v1",
        ),
        **({"requestedThinkingLevel": requested_thinking_level} if requested_thinking_level is not None else {}),
        **({"appliedThinkingLevel": applied_thinking_level} if applied_thinking_level is not None else {}),
    }



def _assert_unknown_route_run_metadata(
    event,
    *,
    requested_thinking_level: str | None,
    applied_thinking_level: str | None,
    thinking_selection_result: dict[str, object] | None = None,
) -> None:
    assert event.type == "run_metadata"
    expected_payload = {
        "requestedThinkingSelection": _compat_thinking_selection(requested_thinking_level),
        "appliedThinkingSelection": _compat_thinking_selection(applied_thinking_level),
        "requestedThinkingLevel": requested_thinking_level,
        "appliedThinkingLevel": applied_thinking_level,
        "thinkingCapabilitySnapshot": _unknown_route_thinking_snapshot(),
        "thinkingSelectionResult": (
            thinking_selection_result
            if thinking_selection_result is not None
            else _thinking_selection_result_payload(
                requested_thinking_level=requested_thinking_level,
                applied_thinking_level=applied_thinking_level,
                applied=False,
                reason_code=(
                    "intent_missing"
                    if requested_thinking_level is None
                    else "requested_level_not_in_capability"
                ),
                error_code=(
                    None
                    if requested_thinking_level is None
                    else "thinking_not_supported_for_route"
                ),
                mapping_reason_code=(
                    "selection_missing"
                    if requested_thinking_level is None
                    else "selection_not_allowed_by_capability"
                ),
                capability_status="unknown-without-override",
                capability_source="unknown",
                override_present=False,
                override_applied=False,
                include_empty_fields=requested_thinking_level is None,
            )
        ),
        "reasoningSuppressionBasis": _reasoning_suppression_basis_payload(
            applied_thinking_level=applied_thinking_level,
            capability_source="unknown",
            capability_series="fixed-off-v1",
            include_empty_fields=applied_thinking_level is None,
        ),
    }
    assert event.payload == expected_payload



def _compat_thinking_selection(level: str | None) -> dict[str, object] | None:
    if level is None:
        return None
    return {
        "series": "compat-discrete-selection-v1",
        "mode": "preset",
        "level": level,
        "budgetTokens": None,
    }


def _thinking_selection_result_payload(
    *,
    requested_thinking_level: str | None,
    applied_thinking_level: str | None,
    applied: bool,
    reason_code: str,
    error_code: str | None,
    mapping_reason_code: str | None,
    capability_status: str,
    capability_source: str,
    override_present: bool,
    override_applied: bool,
    provider_mapping: str | None = None,
    model_settings: dict[str, object] | None = None,
    capability_series: str | None = None,
    capability_reason_code: str | None = None,
    override_source: str | None = None,
    reasoning_visibility: str | None = "visible",
    supports_suppression: bool | None = True,
    include_empty_fields: bool = False,
) -> dict[str, object]:
    resolved_capability_series = capability_series
    if resolved_capability_series is None:
        if capability_status == "unknown-without-override":
            resolved_capability_series = "fixed-off-v1"
        elif capability_source in {"verified", "override"}:
            resolved_capability_series = "zai-glm-thinking-v1"
    resolved_capability_reason_code = capability_reason_code
    if resolved_capability_reason_code is None:
        if capability_status == "unknown-without-override":
            resolved_capability_reason_code = "route_not_verified"
        elif capability_source == "verified":
            resolved_capability_reason_code = "zai_glm_verified_supported"
        elif capability_source == "override":
            resolved_capability_reason_code = "override_candidate_control_applied"
    payload: dict[str, object] = {
        "applied": applied,
        "reasonCode": reason_code,
        "mappingReasonCode": mapping_reason_code,
        "capabilityStatus": capability_status,
        "capabilitySource": capability_source,
        "capabilitySeries": resolved_capability_series,
        "capabilityReasonCode": resolved_capability_reason_code,
        "overridePresent": override_present,
        "overrideApplied": override_applied,
        "reasoningVisibility": reasoning_visibility,
        "supportsSuppression": supports_suppression,
    }
    if include_empty_fields or requested_thinking_level is not None:
        payload["requestedSelection"] = _canonical_preset_selection(requested_thinking_level)
        payload["requestedThinkingLevel"] = requested_thinking_level
    if include_empty_fields or applied_thinking_level is not None:
        payload["appliedSelection"] = _canonical_preset_selection(applied_thinking_level)
        payload["appliedThinkingLevel"] = applied_thinking_level
    if include_empty_fields or error_code is not None:
        payload["errorCode"] = error_code
    if include_empty_fields or provider_mapping is not None:
        payload["providerMapping"] = provider_mapping
    if include_empty_fields or override_source is not None:
        payload["overrideSource"] = override_source
    if model_settings is not None:
        payload["modelSettings"] = model_settings
    return payload



def _reasoning_suppression_basis_payload(
    *,
    applied_thinking_level: str | None,
    capability_source: str,
    capability_series: str,
    reasoning_visibility: str = "visible",
    supports_suppression: bool = True,
    include_empty_fields: bool = False,
) -> dict[str, object]:
    should_suppress = reasoning_visibility == "suppressed" or applied_thinking_level == "off"
    if reasoning_visibility == "suppressed":
        source = "capability-visibility"
        reason_code = "capability_visibility_suppressed"
    elif applied_thinking_level == "off":
        source = "applied-selection"
        reason_code = "applied_selection_off"
    else:
        source = "none"
        reason_code = None
    payload: dict[str, object] = {
        "shouldSuppress": should_suppress,
        "source": source,
        "reasoningVisibility": reasoning_visibility,
        "supportsSuppression": supports_suppression,
        "capabilitySource": capability_source,
        "capabilitySeries": capability_series,
    }
    if include_empty_fields or reason_code is not None:
        payload["reasonCode"] = reason_code
    if include_empty_fields or applied_thinking_level is not None:
        payload["appliedThinkingLevel"] = applied_thinking_level
    return payload



def _canonical_preset_selection(level: str | None) -> dict[str, object] | None:
    if level is None:
        return None
    return {
        "kind": "preset",
        "value": level,
    }



async def _collect_events(
    orchestrator: RuntimeMessageRunOrchestrator,
    request: RuntimeMessageSendRequest,
    is_client_disconnected=None,
):
    return [
        event
        async for event in orchestrator.stream_events(
            request=request,
            is_client_disconnected=is_client_disconnected,
        )
    ]


async def _collect_events_from_request(request: RuntimeMessageSendRequest):
    store = InMemorySessionStore()
    store.create(bound_agent_id="default", session_id=request.session_id)
    executor = _StreamingExecutor(deltas=["Hello world"], output="Hello world")
    registry = build_default_agent_registry(executor_factory=lambda: executor)
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=build_default_tool_registry(),
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    original_next_run_id = __import__("app.copilot_runtime.message_runs", fromlist=["_next_run_id"])._next_run_id
    module = __import__("app.copilot_runtime.message_runs", fromlist=["_next_run_id"])
    module._next_run_id = lambda: "run-fixed"
    try:
        return [event async for event in orchestrator.stream_events(request=request)]
    finally:
        module._next_run_id = original_next_run_id



def _build_request(
    *,
    session_id: str,
    enabled_tools: tuple[str, ...] = (),
    debug_mode_enabled: bool | None = None,
    thinking_level_intent: str | None = None,
    thinking_selection: RuntimeThinkingSelection | None = None,
    thinking_capability_override: dict[str, object] | None = None,
    route_snapshot: RuntimeModelRouteSnapshot | None = None,
) -> RuntimeMessageSendRequest:
    return RuntimeMessageSendRequest(
        session_id=session_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=route_snapshot
                or RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            thinkingSelection=thinking_selection,
            thinkingLevelIntent=thinking_level_intent,
            thinkingCapabilityOverride=thinking_capability_override,
            enabledTools=enabled_tools,
            debugModeEnabled=debug_mode_enabled,
            requestOptions={},
        ),
        agent_id="default",
    )
