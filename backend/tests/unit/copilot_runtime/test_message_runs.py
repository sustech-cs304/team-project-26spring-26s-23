from __future__ import annotations

import asyncio

import pytest

from app.copilot_runtime.agent import AgentExecutionError, RuntimeToolLifecycleEvent
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
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeRunStartRequest,
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
    RuntimeToolPermissionPolicy,
    build_runtime_scaffold,
)
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
    def __init__(
        self,
        *,
        message: str,
        tool_id: str,
        assistant_text: str = "Tool failed but I can still help.",
    ) -> None:
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
            deltas=[assistant_text],
            output=assistant_text,
            tool_events=tool_events,
        )



def _build_tool_execution_event(
    tool_event: RuntimeToolLifecycleEvent,
) -> RuntimeExecutionEvent:
    event_type = {
        "started": "tool_started",
        "waiting_approval": "tool_waiting_approval",
        "completed": "tool_completed",
        "failed": "tool_failed",
        "cancelled": "tool_cancelled",
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



def test_stream_events_filters_denied_tools_from_enabled_tools() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
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

    request = _build_request(
        thread_id="thread-1",
        enabled_tools=("tool.file-convert",),
        tool_permission_policy=RuntimeToolPermissionPolicy(
            schemaVersion=1,
            defaultMode="allow",
            toolModes={WEATHER_CURRENT_TOOL_ID: "deny"},
        ),
    )
    events = asyncio.run(_collect_events(orchestrator, request))

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_completed"]
    assert executor.calls[0]["enabled_tools"] == ["tool.file-convert"]
    assert not any(WEATHER_CURRENT_TOOL_ID in call["enabled_tools"] for call in executor.calls)



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
            RuntimeExecutionEvent(
                type="tool_failed",
                payload={
                    "toolCallId": tool_call_id,
                    "toolId": WEATHER_CURRENT_TOOL_ID,
                    "phase": "failed",
                    "title": "工具调用失败",
                    "summary": "模型产生了工具调用，但运行时未真正执行该调用。",
                    "inputSummary": '{"location": "Shenzhen"}',
                    "errorSummary": "Provider tool call arguments became complete, but no actual tool execution followed.",
                },
            ),
        ],
        output="我先查一下。",
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
        "tool_event",
        "run_completed",
    ]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[3].payload["code"] == "raw_tool_call_observed"
    assert events[4].payload["code"] == "raw_tool_call_arguments_completed"
    assert events[5].payload["code"] == "raw_tool_call_unexecuted"
    assert events[5].payload["details"]["toolCallId"] == tool_call_id
    assert events[6].payload == {
        "toolCallId": tool_call_id,
        "toolId": WEATHER_CURRENT_TOOL_ID,
        "phase": "failed",
        "title": "工具调用失败",
        "summary": "模型产生了工具调用，但运行时未真正执行该调用。",
        "inputSummary": '{"location": "Shenzhen"}',
        "errorSummary": "Provider tool call arguments became complete, but no actual tool execution followed.",
    }
    assert events[7].payload["assistantText"] == "我先查一下。"
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



def test_stream_events_tool_failure_emits_failed_tool_event_and_run_completes() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    executor = _ToolFailingExecutor(
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

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert events[3].payload["phase"] == "failed"
    assert events[-1].payload["assistantText"] == "Tool failed but I can still help."
    assert "run_failed" not in [event.type for event in events]
    assert store.list_messages("thread-1") == ()



def test_stream_events_recoverable_tool_failure_allows_run_completion() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    tool_call_id = f"{WEATHER_CURRENT_TOOL_ID}:call-1"
    tool_events = [
        RuntimeToolLifecycleEvent(
            tool_call_id=tool_call_id,
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="started",
            title="调用天气工具",
            summary="正在获取天气。",
            input_summary='{"location": "Shenzhen"}',
        ),
        RuntimeToolLifecycleEvent(
            tool_call_id=tool_call_id,
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="failed",
            title="工具调用失败",
            summary="工具执行失败。",
            input_summary='{"location": "Shenzhen"}',
            error_summary="temporary backend issue",
        ),
    ]
    executor = _StreamingExecutor(
        deltas=["Tool failed but I can still help."],
        output="Tool failed but I can still help.",
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
    assert [event.payload["phase"] for event in events if event.type == "tool_event"] == [
        "started",
        "failed",
    ]
    assert "run_failed" not in [event.type for event in events]
    assert events[-1].payload["assistantText"] == "Tool failed but I can still help."
    assert store.list_messages("thread-1") == ()



def test_stream_events_tool_failure_can_be_followed_by_true_non_tool_fatal_failure() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    tool_call_id = f"{WEATHER_CURRENT_TOOL_ID}:call-1"
    tool_events = [
        RuntimeToolLifecycleEvent(
            tool_call_id=tool_call_id,
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="started",
            title="调用天气工具",
            summary="正在获取天气。",
            input_summary='{"location": "Shenzhen"}',
        ),
        RuntimeToolLifecycleEvent(
            tool_call_id=tool_call_id,
            tool_id=WEATHER_CURRENT_TOOL_ID,
            phase="failed",
            title="工具调用失败",
            summary="工具执行失败。",
            input_summary='{"location": "Shenzhen"}',
            error_summary="boom",
        ),
    ]
    executor = _StreamingExecutor(
        deltas=[],
        output=AgentExecutionError("model stream collapsed"),
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
        "run_diagnostic",
        "run_failed",
    ]
    _assert_unknown_route_run_metadata(events[1], requested_thinking_level=None, applied_thinking_level=None)
    assert [event.payload["phase"] for event in events if event.type == "tool_event"] == [
        "started",
        "failed",
    ]
    assert events[4].payload == {
        "code": "agent_execution_failed",
        "message": "model stream collapsed",
        "details": {},
        "stage": "execute_model",
    }
    assert events[5].payload == {
        "code": "agent_execution_failed",
        "message": "model stream collapsed",
        "details": {},
    }
    assert "run_completed" not in [event.type for event in events]
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



def test_to_runtime_thinking_selection_maps_budget_kind_to_structured_budget_value() -> None:
    module = __import__("app.copilot_runtime.message_runs", fromlist=["_to_runtime_thinking_selection"])

    result = module._to_runtime_thinking_selection(
        selection=type("BudgetSelection", (), {"kind": "budget", "budget_tokens": 4096})(),
        series="gemini-2.5-budget-v1",
    )

    assert result == RuntimeThinkingSelection(
        series="gemini-2.5-budget-v1",
        value=RuntimeThinkingValue(
            valueType="budget",
            mode="budget",
            budgetTokens=4096,
        ),
    )



def test_to_runtime_thinking_selection_maps_preset_kind_to_structured_code_value() -> None:
    module = __import__("app.copilot_runtime.message_runs", fromlist=["_to_runtime_thinking_selection"])

    result = module._to_runtime_thinking_selection(
        selection=type("PresetSelection", (), {"kind": "preset", "value": "medium"})(),
        series="openai-4-level-minimal-v1",
    )

    assert result == RuntimeThinkingSelection(
        series="openai-4-level-minimal-v1",
        value=RuntimeThinkingValue(
            valueType="code",
            code="medium",
        ),
    )



def test_to_runtime_thinking_selection_returns_none_for_invalid_canonical_payloads() -> None:
    module = __import__("app.copilot_runtime.message_runs", fromlist=["_to_runtime_thinking_selection"])

    assert module._to_runtime_thinking_selection(
        selection=type("BudgetSelection", (), {"kind": "budget", "budget_tokens": True})(),
        series="gemini-2.5-budget-v1",
    ) is None
    assert module._to_runtime_thinking_selection(
        selection=type("PresetSelection", (), {"kind": "preset", "value": 1})(),
        series="openai-4-level-minimal-v1",
    ) is None



def test_stream_events_applies_verified_openai_series_settings_for_gpt5_route() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="session-1")
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
        series="openai-6-level-superset-v1",
        value=RuntimeThinkingValue(valueType="code", code="high", labelZh="高"),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="session-1",
                thinking_selection=thinking_selection,
                route_model_id="gpt-5",
            ),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_completed"]
    assert executor.calls[0]["model_settings"] == {
        "reasoning_effort": "high",
    }
    metadata = events[1].payload
    assert metadata["requestedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["appliedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "verified-supported"
    assert metadata["thinkingCapabilitySnapshot"]["series"] == "openai-6-level-superset-v1"
    assert metadata["thinkingCapabilitySnapshot"]["seriesLabelZh"] == "OpenAI 6 档总超集"
    assert metadata["thinkingSeriesDecision"]["applied"] is True
    assert metadata["thinkingSeriesDecision"]["reasonCode"] == "verified_series_builder_applied"
    assert metadata["thinkingSeriesDecision"]["errorCode"] is None
    assert metadata["thinkingSeriesDecision"]["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert metadata["thinkingSeriesDecision"]["mappingReasonCode"] == "openai_reasoning_effort_high"
    assert metadata["thinkingSeriesDecision"]["capabilitySeries"] == "openai-6-level-superset-v1"
    assert metadata["thinkingSeriesDecision"]["capabilitySeriesLabelZh"] == "OpenAI 6 档总超集"



def test_stream_events_applies_structured_selection_for_verified_route() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="session-1")
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
        series="openai-4-level-minimal-v1",
        value=RuntimeThinkingValue(valueType="code", code="medium", labelZh="中"),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="session-1",
                thinking_selection=thinking_selection,
                route_model_id="gpt-4.1",
            ),
        )
    )

    metadata = events[1].payload
    assert metadata["requestedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["appliedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "verified-supported"
    assert metadata["thinkingCapabilitySnapshot"]["series"] == "openai-4-level-minimal-v1"
    assert metadata["thinkingSeriesDecision"]["reasonCode"] == "verified_series_builder_applied"
    assert metadata["thinkingSeriesDecision"]["mappingReasonCode"] == "openai_reasoning_effort_medium"
    assert metadata["thinkingSeriesDecision"]["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert executor.calls[0]["model_settings"] == {
        "reasoning_effort": "medium",
    }



def test_stream_events_unknown_with_override_applies_when_mapping_exists() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="session-1")
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
        series="qwen-thinking-switch-v1",
        value=RuntimeThinkingValue(valueType="code", code="true", labelZh="开启"),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="session-1",
                route_profile_id="openai-response",
                route_model_id="unknown-model",
                thinking_selection=thinking_selection,
                thinking_capability_override={
                    "supported": True,
                    "series": "qwen-thinking-switch-v1",
                    "template": {
                        "editorType": "discrete",
                        "allowedValues": [
                            {"valueType": "code", "code": "false", "labelZh": "关闭"},
                            {"valueType": "code", "code": "true", "labelZh": "开启"},
                        ],
                        "defaultValue": {"valueType": "code", "code": "true", "labelZh": "开启"},
                    },
                    "source": "settings-page",
                },
            ),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "text_delta", "run_completed"]
    metadata = events[1].payload
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "unknown-with-override"
    assert metadata["thinkingCapabilitySnapshot"]["source"] == "override"
    assert metadata["thinkingCapabilitySnapshot"]["series"] == "qwen-thinking-switch-v1"
    assert metadata["thinkingCapabilitySnapshot"]["seriesLabelZh"] == "Qwen Thinking 开关"
    assert metadata["appliedThinkingSelection"] == thinking_selection.to_dict()
    assert metadata["thinkingSeriesDecision"]["reasonCode"] == "override_series_builder_applied"
    assert metadata["thinkingSeriesDecision"]["mappingReasonCode"] == "qwen_switch_true"
    assert metadata["thinkingSeriesDecision"]["providerBuilderKey"] == "qwen_switch_v1"
    assert executor.calls[0]["model_settings"] == {
        "extra_body": {
            "enable_thinking": True,
        }
    }



def test_stream_events_unknown_with_override_fails_fast_when_mapping_missing() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="session-1")
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
        value=RuntimeThinkingValue(valueType="code", code="high", labelZh="高"),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="session-1",
                route_profile_id="openai-response",
                route_model_id="unknown-model",
                thinking_selection=thinking_selection,
                thinking_capability_override={
                    "supported": True,
                    "series": "compat-discrete-levels-v1",
                    "template": {
                        "editorType": "discrete",
                        "allowedValues": [
                            {"valueType": "code", "code": "high", "labelZh": "高"},
                        ],
                        "defaultValue": {"valueType": "code", "code": "high", "labelZh": "高"},
                    },
                    "source": "settings-page",
                },
            ),
        )
    )

    assert [event.type for event in events] == ["run_started", "run_metadata", "run_diagnostic", "run_failed"]
    metadata = events[1].payload
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "unknown-with-override"
    assert metadata["thinkingCapabilitySnapshot"]["source"] == "override"
    assert metadata["thinkingCapabilitySnapshot"]["series"] == "compat-discrete-levels-v1"
    assert metadata["appliedThinkingSelection"] is None
    assert metadata["thinkingSeriesDecision"]["reasonCode"] == "provider_builder_missing"
    assert metadata["thinkingSeriesDecision"]["errorCode"] == "thinking_series_builder_missing"
    assert metadata["thinkingSeriesDecision"]["mappingReasonCode"] == "provider_builder_missing"
    assert events[2].payload["code"] == "thinking_series_builder_missing"
    assert events[2].payload["details"]["mappingReasonCode"] == "provider_builder_missing"
    assert events[2].payload["details"]["providerBuilderKey"] is None
    assert executor.calls == []



def test_stream_events_fails_when_thinking_intent_targets_unverified_route_without_override() -> None:
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
    metadata = events[1].payload
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "unknown-without-override"
    assert metadata["thinkingCapabilitySnapshot"]["source"] == "unknown"
    assert metadata["thinkingCapabilitySnapshot"]["series"] is None
    assert metadata["thinkingSeriesDecision"]["reasonCode"] == "thinking_series_unknown_without_override"
    assert metadata["thinkingSeriesDecision"]["errorCode"] == "thinking_series_unknown_without_override"
    assert metadata["thinkingSeriesDecision"]["mappingReasonCode"] == "series_unresolved"
    assert events[2].payload["code"] == "thinking_series_unknown_without_override"
    assert events[2].payload["details"]["reasonCode"] == "route_not_verified"
    assert events[2].payload["details"]["mappingReasonCode"] == "series_unresolved"
    assert events[3].payload["code"] == "thinking_series_unknown_without_override"
    assert executor.calls == []



def test_stream_events_fails_when_legacy_thinking_intent_maps_to_unsupported_series() -> None:
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

    assert [event.type for event in events] == ["run_started", "run_metadata", "run_diagnostic", "run_failed"]
    metadata = events[1].payload
    assert metadata["thinkingCapabilitySnapshot"]["status"] == "verified-supported"
    assert metadata["thinkingCapabilitySnapshot"]["series"] == "openai-4-level-minimal-v1"
    assert metadata["requestedThinkingSelection"] == _compat_thinking_selection("medium")
    assert metadata["appliedThinkingSelection"] is None
    assert metadata["thinkingSeriesDecision"]["reasonCode"] == "requested_series_mismatch"
    assert metadata["thinkingSeriesDecision"]["errorCode"] == "thinking_series_not_supported_for_route"
    assert metadata["thinkingSeriesDecision"]["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert metadata["thinkingSeriesDecision"]["mappingReasonCode"] == "requested_series_mismatch"

    assert events[2].payload["code"] == "thinking_series_not_supported_for_route"
    assert events[2].payload["stage"] == "adapt_thinking"
    assert "compat-discrete-selection-v1" in events[2].payload["message"]
    assert events[2].payload["details"]["series"] == "openai-4-level-minimal-v1"
    assert events[2].payload["details"]["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert events[2].payload["details"]["mappingReasonCode"] == "requested_series_mismatch"
    assert events[2].payload["details"]["requestedSelection"] == _compat_thinking_selection("medium")
    assert events[2].payload["details"]["reason"] == "requested_series_mismatch"
    assert events[3].payload["code"] == "thinking_series_not_supported_for_route"
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
    module = __import__(
        "app.copilot_runtime.runs.message_run_services",
        fromlist=["log_runtime_chain_debug"],
    )

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
    capability_log = thinking_logs["thinking.capability_resolved"]["capability"]
    assert capability_log["status"] == "verified-supported"
    assert capability_log["series"] == "openai-4-level-minimal-v1"
    assert capability_log["seriesLabelZh"] == "OpenAI 4 档 Minimal 系"
    assert capability_log["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert capability_log["allowedValues"][0]["code"] == "minimal"
    assert capability_log["defaultValue"]["code"] == "medium"

    assert thinking_logs["thinking.request_validated"]["requestedThinkingSelection"] == _compat_thinking_selection("medium")
    assert thinking_logs["thinking.request_validated"]["applied"] is False
    assert thinking_logs["thinking.request_validated"]["reason"] == "requested_series_mismatch"
    assert thinking_logs["thinking.provider_mapping_resolved"]["reason"] == "requested_series_mismatch"
    assert thinking_logs["thinking.provider_mapping_resolved"]["providerBuilderKey"] == "openai_reasoning_effort_v1"

    yielded_event = thinking_logs["thinking.run_metadata_attached"]["yieldedEvent"]
    assert yielded_event["type"] == "run_metadata"
    assert yielded_event["sequence"] == 2
    assert yielded_event["requestedThinkingSelection"] == _compact_code_selection("medium")
    assert yielded_event["appliedThinkingSelection"] is None
    assert yielded_event["thinkingCapability"]["series"] == "openai-4-level-minimal-v1"
    assert yielded_event["thinkingSeriesDecision"]["reasonCode"] == "requested_series_mismatch"
    assert yielded_event["thinkingSeriesDecision"]["errorCode"] == "thinking_series_not_supported_for_route"

    assert thinking_logs["thinking.fail_fast"]["code"] == "thinking_series_not_supported_for_route"
    assert thinking_logs["thinking.fail_fast"]["reason"] == "requested_series_mismatch"
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["requestedSelection"] == _compat_thinking_selection("medium")
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["providerBuilderKey"] == "openai_reasoning_effort_v1"
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["reasonCode"] == "verified_series_resolved"
    assert thinking_logs["thinking.fail_fast"]["diagnostics"]["reason"] == "requested_series_mismatch"



def test_stream_events_logs_reasoning_suppression_when_hidden_reasoning_delta_arrives(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="session-1")
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
    module = __import__(
        "app.copilot_runtime.runs.message_run_services",
        fromlist=["log_runtime_chain_debug"],
    )

    def _capture_log(event_name: str, *, enabled: bool | None = None, **payload: object) -> None:
        captured_logs.append((event_name, payload))

    monkeypatch.setattr(module, "log_runtime_chain_debug", _capture_log)

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="session-1",
                debug_mode_enabled=True,
                thinking_capability_override={
                    "supported": True,
                    "series": "qwen-thinking-switch-v1",
                    "template": {
                        "editorType": "discrete",
                        "allowedValues": [
                            {"valueType": "code", "code": "false", "labelZh": "关闭"},
                            {"valueType": "code", "code": "true", "labelZh": "开启"},
                        ],
                        "defaultValue": {"valueType": "code", "code": "true", "labelZh": "开启"},
                    },
                    "visibility": {
                        "reasoning": "suppressed",
                        "supportsSuppression": True,
                    },
                    "source": "settings-page",
                },
                thinking_selection=RuntimeThinkingSelection(
                    series="qwen-thinking-switch-v1",
                    value=RuntimeThinkingValue(valueType="code", code="true", labelZh="开启"),
                ),
                route_model_id="unknown-model",
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
    assert suppression_logs[0]["reasoningSuppressionBasis"] == {
        "shouldSuppress": True,
        "source": "capability-visibility",
        "reasonCode": "capability_visibility_suppressed",
        "reasoningVisibility": "suppressed",
        "supportsSuppression": True,
        "capabilitySource": "override",
        "capabilitySeries": "qwen-thinking-switch-v1",
        "appliedThinkingSelection": {
            "series": "qwen-thinking-switch-v1",
            "value": {
                "valueType": "code",
                "code": "true",
                "labelZh": "开启",
            },
        },
    }
    assert suppression_logs[0]["projectedEventTypes"] == ["reasoning_delta"]



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
        "status": "verified-supported",
        "source": "verified",
        "series": "openai-4-level-minimal-v1",
        "seriesLabelZh": "OpenAI 4 档 Minimal 系",
        "editorType": "discrete",
        "allowedValues": [
            {"valueType": "code", "code": "minimal", "labelZh": "极简", "mode": None, "budgetTokens": None},
            {"valueType": "code", "code": "low", "labelZh": "低", "mode": None, "budgetTokens": None},
            {"valueType": "code", "code": "medium", "labelZh": "中", "mode": None, "budgetTokens": None},
            {"valueType": "code", "code": "high", "labelZh": "高", "mode": None, "budgetTokens": None},
        ],
        "defaultValue": {
            "valueType": "code",
            "code": "medium",
            "labelZh": "中",
            "mode": None,
            "budgetTokens": None,
        },
        "providerBuilderKey": "openai_reasoning_effort_v1",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
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
        "thinkingSeriesDecision": _thinking_selection_result_payload(
            requested_thinking_level=requested_thinking_level,
            applied_thinking_level=applied_thinking_level,
            applied=False,
            reason_code=(
                "selection_missing"
                if requested_thinking_level is None
                else "requested_series_mismatch"
            ),
            error_code=(
                None
                if requested_thinking_level is None
                else "thinking_series_not_supported_for_route"
            ),
            mapping_reason_code=(
                "selection_missing"
                if requested_thinking_level is None
                else "requested_series_mismatch"
            ),
            capability_status="verified-supported",
            capability_source="verified",
            override_present=False,
            override_applied=False,
        ),
        "reasoningSuppressionBasis": _reasoning_suppression_basis_payload(
            applied_thinking_level=applied_thinking_level,
            capability_source="verified",
            capability_series="openai-4-level-minimal-v1",
        ),
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
        "thinkingCapabilitySnapshot": _unknown_route_thinking_snapshot(),
        "thinkingSeriesDecision": (
            thinking_selection_result
            if thinking_selection_result is not None
            else _thinking_selection_result_payload(
                requested_thinking_level=requested_thinking_level,
                applied_thinking_level=applied_thinking_level,
                applied=False,
                reason_code=(
                    "selection_missing"
                    if requested_thinking_level is None
                    else "requested_series_mismatch"
                ),
                error_code=(
                    None
                    if requested_thinking_level is None
                    else "thinking_series_not_supported_for_route"
                ),
                mapping_reason_code=(
                    "selection_missing"
                    if requested_thinking_level is None
                    else "requested_series_mismatch"
                ),
                capability_status="verified-supported",
                capability_source="verified",
                override_present=False,
                override_applied=False,
            )
        ),
        "reasoningSuppressionBasis": _reasoning_suppression_basis_payload(
            applied_thinking_level=applied_thinking_level,
            capability_source="verified",
            capability_series="openai-4-level-minimal-v1",
            include_empty_fields=applied_thinking_level is None,
        ),
    }
    assert event.payload == expected_payload



def _compat_thinking_selection(level: str | None) -> dict[str, object] | None:
    if level is None:
        return None
    return {
        "series": "compat-discrete-selection-v1",
        "value": {
            "valueType": "code",
            "code": level,
            "mode": None,
            "budgetTokens": None,
            "labelZh": level,
        },
    }



def _compact_code_selection(level: str | None, *, series: str = "compat-discrete-selection-v1") -> dict[str, object] | None:
    if level is None:
        return None
    return {
        "series": series,
        "value": {
            "valueType": "code",
            "code": level,
            "labelZh": level,
        },
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
    provider_builder_key: str | None = None,
    model_settings: dict[str, object] | None = None,
    capability_series: str | None = None,
    capability_series_label_zh: str | None = None,
    capability_reason_code: str | None = None,
    override_source: str | None = None,
    reasoning_visibility: str | None = "visible",
    supports_suppression: bool | None = True,
    include_empty_fields: bool = False,
) -> dict[str, object]:
    resolved_capability_series = capability_series
    if resolved_capability_series is None:
        if capability_status == "unknown-without-override":
            resolved_capability_series = None
        elif capability_source == "verified":
            resolved_capability_series = "openai-4-level-minimal-v1"
        elif capability_source == "override":
            resolved_capability_series = "qwen-thinking-switch-v1"

    resolved_capability_series_label_zh = capability_series_label_zh
    if resolved_capability_series_label_zh is None:
        if resolved_capability_series == "openai-4-level-minimal-v1":
            resolved_capability_series_label_zh = "OpenAI 4 档 Minimal 系"
        elif resolved_capability_series == "openai-6-level-superset-v1":
            resolved_capability_series_label_zh = "OpenAI 6 档总超集"
        elif resolved_capability_series == "qwen-thinking-switch-v1":
            resolved_capability_series_label_zh = "Qwen Thinking 开关"

    resolved_capability_reason_code = capability_reason_code
    if resolved_capability_reason_code is None:
        if capability_status == "unknown-without-override":
            resolved_capability_reason_code = "route_not_verified"
        elif capability_source == "verified":
            resolved_capability_reason_code = "verified_series_resolved"
        elif capability_source == "override":
            resolved_capability_reason_code = "override_series_template_applied"

    resolved_provider_builder_key = provider_builder_key
    if resolved_provider_builder_key is None:
        if resolved_capability_series in {
            "openai-6-level-superset-v1",
            "openai-4-level-minimal-v1",
            "openai-4-level-none-v1",
        } and (applied or error_code in {"thinking_series_not_supported_for_route", "thinking_series_value_not_allowed", "thinking_series_mapping_failed"}):
            resolved_provider_builder_key = "openai_reasoning_effort_v1"
        elif resolved_capability_series == "qwen-thinking-switch-v1":
            resolved_provider_builder_key = "qwen_switch_v1"
        elif resolved_capability_series == "gemini-2.5-budget-v1":
            resolved_provider_builder_key = "gemini_budget_v1"
        elif resolved_capability_series == "anthropic-budget-v1":
            resolved_provider_builder_key = "anthropic_budget_v1"
        elif resolved_capability_series == "deepseek-fixed-reasoning-v1":
            resolved_provider_builder_key = "fixed_reasoning_v1"

    payload: dict[str, object] = {
        "requestedSelection": _compat_thinking_selection(requested_thinking_level),
        "appliedSelection": _compat_thinking_selection(applied_thinking_level),
        "applied": applied,
        "reasonCode": reason_code,
        "errorCode": error_code,
        "providerBuilderKey": resolved_provider_builder_key,
        "mappingReasonCode": mapping_reason_code,
        "capabilityStatus": capability_status,
        "capabilitySource": capability_source,
        "capabilitySeries": resolved_capability_series,
        "capabilitySeriesLabelZh": resolved_capability_series_label_zh,
        "capabilityReasonCode": resolved_capability_reason_code,
    }
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
        reason_code = "applied_selection_suppressed"
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
        payload["appliedThinkingSelection"] = _compact_code_selection(
            applied_thinking_level,
            series=capability_series,
        )
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
    return [
        event
        async for event in orchestrator.stream_events(
            request=request,
            run_id="run-fixed",
        )
    ]



def _build_request(
    *,
    thread_id: str,
    route_profile_id: str = "provider-1",
    route_model_id: str = "gpt-4.1",
    enabled_tools: tuple[str, ...] = (),
    debug_mode_enabled: bool | None = None,
    thinking_level_intent: str | None = None,
    thinking_selection: RuntimeThinkingSelection | None = None,
    thinking_capability_override: dict[str, object] | None = None,
    tool_permission_policy: RuntimeToolPermissionPolicy | None = None,
) -> RuntimeRunStartRequest:
    resolved_thinking_selection = thinking_selection
    if resolved_thinking_selection is None and thinking_level_intent is not None:
        resolved_thinking_selection = RuntimeThinkingSelection.from_legacy_level_intent(thinking_level_intent)

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
            thinkingSelection=resolved_thinking_selection,
            thinkingCapabilityOverride=thinking_capability_override,
            enabledTools=enabled_tools,
            toolPermissionPolicy=tool_permission_policy,
            debugModeEnabled=debug_mode_enabled,
            requestOptions={},
        ),
        agent_id="default",
    )
