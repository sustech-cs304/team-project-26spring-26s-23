from __future__ import annotations

import asyncio

import pytest

from app.copilot_runtime.agent import AgentExecutionError, RuntimeToolLifecycleEvent, ToolInvocationError
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.execution_support import ThreadNotFoundError
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.run_events import encode_runtime_run_event
from app.copilot_runtime.model_routes import (
    ProviderProfileNotFoundError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
)
from app.copilot_runtime.contracts import RuntimeMessageExecutionPolicy, RuntimeMessagePayload, RuntimeRunStartRequest, build_runtime_scaffold
from app.copilot_runtime.agent_registry import build_default_agent_registry
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID, build_default_tool_registry


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
        self._deltas = list(deltas)
        self._output = output
        self._tool_events = list(tool_events or [])
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
        return _ImmediateEventStream(
            events=self._build_events(run_id=run_id),
            output=self._output,
        )

    def _build_events(self, *, run_id: str) -> list[RuntimeExecutionEvent]:
        segment_id = f"{run_id}:assistant-segment-1"
        events = [
            _build_tool_execution_event(tool_event)
            for tool_event in self._tool_events
        ]
        events.extend(
            RuntimeExecutionEvent(
                type="assistant_segment_delta",
                payload={
                    "segmentId": segment_id,
                    "delta": delta,
                },
            )
            for delta in self._deltas
        )
        return events


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
        return _build_resolved_route_from_runtime_model_route(model_route)



def _build_resolved_route_from_runtime_model_route(
    model_route: RuntimeModelRoute,
) -> ResolvedRuntimeModelRoute:
    provider_id = "openai"
    endpoint_type = "openai-compatible"
    base_url = "https://example.com/v1"
    adapter_id = provider_id
    runtime_status = "enabled"
    auth_kind = "api-key"
    api_key = "test-api-key"
    model_id = model_route.route_ref.model_id

    if model_route.provider_profile_id == "ollama":
        provider_id = "ollama"
        endpoint_type = "ollama-native"
        base_url = "http://127.0.0.1:11434/v1"
        adapter_id = provider_id
        auth_kind = "none"
        api_key = ""
    elif model_route.provider_profile_id == "openai-response":
        provider_id = "openai-response"
        endpoint_type = "openai-response"
        adapter_id = provider_id
        runtime_status = "legacy-unsupported"
    elif model_id == "openrouter/auto":
        provider_id = "openrouter"
        adapter_id = provider_id
        runtime_status = "catalog-only"
    elif model_id == "glm-5-turbo":
        base_url = "https://api.z.ai/api/paas/v4"

    return ResolvedRuntimeModelRoute(
        provider_profile_id=model_route.provider_profile_id,
        provider=provider_id,
        provider_id=provider_id,
        adapter_id=adapter_id,
        runtime_status=runtime_status,
        endpoint_type=endpoint_type,
        base_url=base_url,
        model_id=model_id,
        auth_kind=auth_kind,
        api_key=api_key,
        route_ref=model_route.route_ref,
    )


class _MissingProviderResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        raise ProviderProfileNotFoundError(provider_profile_id=model_route.provider_profile_id)


class _CancellingStream(_ImmediateEventStream):
    async def get_output(self) -> str:
        raise asyncio.CancelledError()


class _CancellingExecutor(_StreamingExecutor):
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
        return _CancellingStream(events=self._build_events(run_id=run_id), output="unused")


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



def _build_tool_execution_event(
    tool_event: RuntimeToolLifecycleEvent,
) -> RuntimeExecutionEvent:
    event_type = {
        "started": "tool_started",
        "completed": "tool_completed",
        "failed": "tool_failed",
    }[tool_event.phase]
    return RuntimeExecutionEvent(type=event_type, payload=tool_event.to_payload())



def test_stream_events_success_projects_completed_assistant_message_without_archiving_store() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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

    events = asyncio.run(_collect_events(orchestrator, _build_request(thread_id="thread-1", debug_mode_enabled=True)))

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "text_delta", "run_completed"]
    assert [event.sequence for event in events] == [1, 2, 3, 4, 5]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[-1].payload["assistantText"] == "Hello world"
    assert executor.calls == [
        {
            "run_id": events[0].runId,
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
    assert store.list_messages("thread-1") == ()



def test_stream_events_emits_tool_started_completed_before_terminal_success() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
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
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
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
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
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
    assert store.list_messages("thread-1") == ()



def test_stream_events_host_resolution_failure_emits_diagnostic_and_failed_without_archive() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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

    events = asyncio.run(_collect_events(orchestrator, _build_request(thread_id="thread-1")))

    assert [event.type for event in events] == ["run_started", "run_diagnostic", "run_failed"]
    assert events[1].payload["code"] == "provider_profile_not_found"
    assert events[2].payload["code"] == "provider_profile_not_found"
    assert executor.calls == []
    assert store.list_messages("thread-1") == ()



def test_stream_events_tool_failure_emits_failed_tool_event_then_failed_terminal_event() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", enabled_tools=(WEATHER_CURRENT_TOOL_ID,)),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "tool_event", "tool_event", "run_failed"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[3].payload["phase"] == "failed"
    assert events[-1].payload["code"] == "tool_execution_failed"
    assert events[-1].payload["details"]["toolId"] == WEATHER_CURRENT_TOOL_ID
    assert store.list_messages("thread-1") == ()



def test_stream_events_cancelled_run_discards_draft_and_does_not_archive() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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

    events = asyncio.run(_collect_events(orchestrator, _build_request(thread_id="thread-1")))

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_cancelled"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[-1].payload == {
        "assistantMessageId": events[0].payload["assistantMessageId"],
        "reason": "cancelled",
    }
    assert store.list_messages("thread-1") == ()



def test_stream_events_client_disconnect_cancels_run_and_does_not_archive() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1"),
            is_client_disconnected=is_client_disconnected,
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_cancelled"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[-1].payload == {
        "assistantMessageId": events[0].payload["assistantMessageId"],
        "reason": "cancelled",
    }
    assert store.list_messages("thread-1") == ()



def test_stream_events_explicit_false_overrides_runtime_debug_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_CHAIN_DEBUG", "1")
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", debug_mode_enabled=False),
        )
    )

    assert executor.calls[0]["debug_enabled"] is False



def test_stream_events_uses_runtime_debug_env_when_request_debug_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_CHAIN_DEBUG", "1")
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", debug_mode_enabled=None),
        )
    )

    assert executor.calls[0]["debug_enabled"] is True



def test_stream_events_no_longer_applies_legacy_glm_openai_compatible_thinking_settings() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
                thread_id="thread-1",
                thinking_level_intent="auto",
                route_model_id="glm-5-turbo",
            ),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "run_diagnostic", "run_failed"]
    assert events[2].payload["code"] == "thinking_not_supported_for_route"
    assert events[2].payload["details"]["reasonCode"] == "openai_thinking_not_supported_for_model"
    assert executor.calls == []



def test_stream_events_fails_when_thinking_intent_cannot_be_mapped() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
            _build_request(thread_id="thread-1", thinking_level_intent="medium"),
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
        "status": "verified-unsupported",
        "source": "verified",
        "supported": False,
        "supportedLevels": [],
        "defaultLevel": None,
        "reasonCode": "openai_thinking_not_supported_for_model",
        "providerHint": "openai",
        "requestedThinkingLevel": "medium",
        "appliedThinkingLevel": None,
        "providerMapping": None,
        "intent": "medium",
        "reason": "requested_level_not_in_capability",
    }

    assert [event.type for event in events] == ["run_started", "run_metadata", "run_diagnostic", "run_failed"]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level="medium", applied_thinking_level=None)
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
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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
                thread_id="thread-1",
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
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["reasonCode"] == "openai_thinking_not_supported_for_model"



def test_encode_runtime_run_event_renders_sse_payload() -> None:
    request = _build_request(thread_id="thread-1")
    event = asyncio.run(_collect_events_from_request(request))[0]

    assert encode_runtime_run_event(event) == (
        'data: {"type": "run_started", "runId": "run-fixed", "sessionId": "thread-1", '
        '"sequence": 1, "payload": {"assistantMessageId": "run-fixed:assistant"}}\n\n'
    )



def test_stream_events_missing_thread_emits_failed_terminal_event() -> None:
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

    events = asyncio.run(_collect_events(orchestrator, _build_request(thread_id="missing-thread")))

    assert [event.type for event in events] == ["run_started", "run_failed"]
    assert events[-1].payload == {
        "code": "thread_not_found",
        "message": str(ThreadNotFoundError("missing-thread")),
        "details": {"threadId": "missing-thread"},
    }



def _unknown_route_thinking_snapshot() -> dict[str, object]:
    return {
        "status": "verified-unsupported",
        "source": "verified",
        "supported": False,
        "supportedLevels": [],
        "defaultLevel": None,
        "reasonCode": "openai_thinking_not_supported_for_model",
        "providerHint": "openai",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "overrideLevels": [],
    }



def _unknown_route_run_metadata_summary(
    *,
    sequence: int,
    requested_thinking_level: str | None,
    applied_thinking_level: str | None,
) -> dict[str, object]:
    summary: dict[str, object] = {
        "type": "run_metadata",
        "sequence": sequence,
        "thinkingCapability": _unknown_route_thinking_snapshot(),
    }
    if requested_thinking_level is not None:
        summary["requestedThinkingLevel"] = requested_thinking_level
    if applied_thinking_level is not None:
        summary["appliedThinkingLevel"] = applied_thinking_level
    return summary



def _assert_unknown_route_run_metadata(
    event,
    *,
    requested_thinking_level: str | None,
    applied_thinking_level: str | None,
) -> None:
    assert event.type == "run_metadata"
    assert event.payload == {
        "requestedThinkingLevel": requested_thinking_level,
        "appliedThinkingLevel": applied_thinking_level,
        "thinkingCapabilitySnapshot": _unknown_route_thinking_snapshot(),
    }


async def _collect_events(
    orchestrator: RuntimeMessageRunOrchestrator,
    request: RuntimeRunStartRequest,
    is_client_disconnected=None,
):
    return [
        event
        async for event in orchestrator.stream_events(
            request=request,
            is_client_disconnected=is_client_disconnected,
        )
    ]


async def _collect_events_from_request(request: RuntimeRunStartRequest):
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id=request.thread_id)
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
    thread_id: str,
    enabled_tools: tuple[str, ...] = (),
    debug_mode_enabled: bool | None = None,
    thinking_level_intent: str | None = None,
    route_profile_id: str = "provider-1",
    route_model_id: str = "gpt-4.1",
) -> RuntimeRunStartRequest:
    return RuntimeRunStartRequest(
        thread_id=thread_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id=route_profile_id,
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id=route_profile_id,
                    model_id=route_model_id,
                ),
            ),
            thinkingLevelIntent=thinking_level_intent,
            enabledTools=enabled_tools,
            debugModeEnabled=debug_mode_enabled,
            requestOptions={},
        ),
        agent_id="default",
    )
