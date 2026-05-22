from __future__ import annotations

import asyncio
from collections.abc import Mapping, Sequence
from typing import Any, Literal, TypedDict, cast

import pytest
from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import AwaitingUserInputError, AgentExecutionError, PydanticAIAgentExecutor, RuntimeToolLifecycleEvent
from app.copilot_runtime._tool_registry.constants import INTERNAL_TOOL_IDS
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent, RuntimeExecutionEventType
from app.copilot_runtime.execution_support import ThreadNotFoundError, build_message_history, build_runtime_user_prompt
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
from app.copilot_runtime.session_store import InMemorySessionStore, RuntimeTextMessage
from app.copilot_runtime.tool_approval_coordinator import RuntimeToolApprovalCoordinator
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver
from app.copilot_runtime.tool_registry import REQUEST_USER_FORM_TOOL_ID, WEATHER_CURRENT_TOOL_ID, build_default_tool_registry


def _strip_internal_tool_ids(tool_ids: Sequence[str]) -> list[str]:
    return [tool_id for tool_id in tool_ids if tool_id not in INTERNAL_TOOL_IDS]


class _ExecutorCallRecord(TypedDict):
    run_id: str
    agent_name: str
    user_prompt: str
    message_history: list[object]
    model_id: str
    enabled_tools: list[str]
    debug_enabled: bool
    request_options: dict[str, object]
    model_settings: dict[str, object]


class _ThinkingOptionValue(TypedDict):
    valueType: str
    code: str
    labelZh: str
    mode: str | None
    budgetTokens: int | None


class _ThinkingCapabilityLog(TypedDict):
    status: str
    series: str | None
    seriesLabelZh: str | None
    providerBuilderKey: str | None
    allowedValues: list[_ThinkingOptionValue]
    defaultValue: _ThinkingOptionValue


class _ThinkingSeriesDecisionLog(TypedDict):
    reasonCode: str
    errorCode: str | None


class _ThinkingYieldedEventLog(TypedDict):
    type: str
    sequence: int
    requestedThinkingSelection: dict[str, object] | None
    appliedThinkingSelection: dict[str, object] | None
    thinkingCapability: dict[str, object]
    thinkingSeriesDecision: _ThinkingSeriesDecisionLog


class _ThinkingFailFastDiagnosticsLog(TypedDict):
    requestedSelection: dict[str, object] | None
    providerBuilderKey: str | None
    reasonCode: str
    reason: str


class _ThinkingFailFastLog(TypedDict):
    code: str
    reason: str
    diagnostics: _ThinkingFailFastDiagnosticsLog


class _ThinkingRequestValidatedLog(TypedDict):
    requestedThinkingSelection: dict[str, object] | None
    applied: bool
    reason: str


class _ThinkingProviderMappingResolvedLog(TypedDict):
    reason: str
    providerBuilderKey: str | None


class _ThinkingCapabilityResolvedLog(TypedDict):
    capability: _ThinkingCapabilityLog


def _build_executor_call_record(
    *,
    run_id: str,
    agent_name: str,
    user_prompt: str,
    message_history: Sequence[object],
    model_id: str,
    enabled_tools: Sequence[str],
    debug_enabled: bool,
    request_options: Mapping[str, object] | None,
    model_settings: Mapping[str, object] | None,
) -> _ExecutorCallRecord:
    return {
        "run_id": run_id,
        "agent_name": agent_name,
        "user_prompt": user_prompt,
        "message_history": list(message_history),
        "model_id": model_id,
        "enabled_tools": list(enabled_tools),
        "debug_enabled": debug_enabled,
        "request_options": dict(request_options or {}),
        "model_settings": dict(model_settings or {}),
    }


def _build_test_executor_factory(executor: object) -> Any:
    def _factory() -> object:
        return executor

    return _factory


def _typed_log_payload(payload: object) -> dict[str, object]:
    assert isinstance(payload, dict)
    return cast(dict[str, object], payload)


def _typed_runtime_event_type(value: str) -> RuntimeExecutionEventType:
    return value  # type: ignore[return-value]


def _typed_thinking_level_intent(value: str) -> Literal["off", "auto", "low", "medium", "high", "xhigh"]:
    return value  # type: ignore[return-value]


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
        self.calls: list[_ExecutorCallRecord] = []
        self.model_configured = True
        self.model_environment_keys: tuple[str, ...] = ()

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[object],
        model: Any | None = None,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> str:
        raise AssertionError("streaming test executor should not use run()")

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
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> _ImmediateEventStream:
        del tool_permission_resolver
        self.calls.append(
            _build_executor_call_record(
                run_id=run_id,
                agent_name=agent_name,
                user_prompt=user_prompt,
                message_history=message_history,
                model_id=model_route.model_id,
                enabled_tools=enabled_tools,
                debug_enabled=debug_enabled,
                request_options=request_options,
                model_settings=model_settings,
            )
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
        self.calls: list[_ExecutorCallRecord] = []
        self.model_configured = True
        self.model_environment_keys: tuple[str, ...] = ()

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[object],
        model: Any | None = None,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> str:
        raise AssertionError("streaming test executor should not use run()")

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
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> _ImmediateEventStream:
        del tool_permission_resolver
        self.calls.append(
            _build_executor_call_record(
                run_id=run_id,
                agent_name=agent_name,
                user_prompt=user_prompt,
                message_history=message_history,
                model_id=model_route.model_id,
                enabled_tools=enabled_tools,
                debug_enabled=debug_enabled,
                request_options=request_options,
                model_settings=model_settings,
            )
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
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> _ImmediateEventStream:
        del tool_permission_resolver
        self.calls.append(
            _build_executor_call_record(
                run_id=run_id,
                agent_name=agent_name,
                user_prompt=user_prompt,
                message_history=message_history,
                model_id=model_route.model_id,
                enabled_tools=enabled_tools,
                debug_enabled=debug_enabled,
                request_options=request_options,
                model_settings=model_settings,
            )
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
    event_type = _typed_runtime_event_type({
        "started": "tool_started",
        "waiting_approval": "tool_waiting_approval",
        "completed": "tool_completed",
        "failed": "tool_failed",
        "cancelled": "tool_cancelled",
    }[tool_event.phase])
    return RuntimeExecutionEvent(type=event_type, payload=tool_event.to_payload())



def test_stream_events_success_projects_completed_assistant_message_without_archiving_store() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    executor = _StreamingExecutor(deltas=["Hello", " world"], output="Hello world")
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    assert len(executor.calls) == 1
    call = executor.calls[0]
    assert _strip_internal_tool_ids(call["enabled_tools"]) == []
    assert {key: value for key, value in call.items() if key != "enabled_tools"} == {
        "run_id": events[0].runId,
        "agent_name": "default",
        "user_prompt": "Hello",
        "message_history": [],
        "model_id": "gpt-4.1",
        "debug_enabled": True,
        "request_options": {},
        "model_settings": {},
    }
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    assert _strip_internal_tool_ids(events[-1].payload["resolvedToolIds"]) == [
        WEATHER_CURRENT_TOOL_ID
    ]



def test_stream_events_emits_waiting_approval_tool_event_without_unsupported_error() -> None:
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
            phase="waiting_approval",
            title="工具等待审批",
            summary="工具调用正在等待审批决议。",
            input_summary='{"location": "Shenzhen"}',
            approval={
                "mode": "ask",
                "timeoutSeconds": None,
                "timeoutAction": None,
            },
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    tool_event_payloads = [event.payload for event in events if event.type == "tool_event"]
    assert [payload["phase"] for payload in tool_event_payloads] == [
        "started",
        "waiting_approval",
        "completed",
    ]
    assert tool_event_payloads[1]["approval"] == {
        "mode": "ask",
        "timeoutSeconds": None,
        "timeoutAction": None,
    }
    assert events[-1].payload["assistantText"] == "Weather answer"


def test_stream_events_delay_timeout_auto_approve_continues_tool_execution() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    tool_registry = build_default_tool_registry()
    approval_coordinator = RuntimeToolApprovalCoordinator()
    executor = PydanticAIAgentExecutor(
        model=TestModel(call_tools=["weather_current"], custom_output_text="Weather answer", seed=0),
        tool_registry=tool_registry,
        approval_coordinator=approval_coordinator,
    )
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=tool_registry,
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="thread-1",
                enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                tool_permission_policy=RuntimeToolPermissionPolicy(
                    schemaVersion=1,
                    defaultMode="allow",
                    toolModes={WEATHER_CURRENT_TOOL_ID: "delay"},
                    toolTimeoutSeconds={WEATHER_CURRENT_TOOL_ID: 1},
                    toolTimeoutActions={WEATHER_CURRENT_TOOL_ID: "approve"},
                ),
            ),
        )
    )

    tool_event_payloads = [event.payload for event in events if event.type == "tool_event"]
    assert [payload["phase"] for payload in tool_event_payloads] == [
        "started",
        "waiting_approval",
        "completed",
    ]
    assert tool_event_payloads[1]["approval"] == {
        "mode": "delay",
        "timeoutAt": tool_event_payloads[1]["approval"]["timeoutAt"],
        "timeoutSeconds": 1,
        "timeoutAction": "approve",
    }
    assert isinstance(tool_event_payloads[1]["approval"]["timeoutAt"], str)
    assert any(event.type == "text_delta" for event in events)
    assert events[-1].type == "run_completed"
    assert events[-1].payload["assistantText"] == "Weather answer"
    assert approval_coordinator.snapshot() == ()


def test_stream_events_delay_timeout_auto_deny_reinjects_failure_result() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    tool_registry = build_default_tool_registry()
    approval_coordinator = RuntimeToolApprovalCoordinator()
    executor = PydanticAIAgentExecutor(
        model=TestModel(call_tools=["weather_current"], custom_output_text="Weather answer", seed=0),
        tool_registry=tool_registry,
        approval_coordinator=approval_coordinator,
    )
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
    orchestrator = RuntimeMessageRunOrchestrator(
        session_store=store,
        agent_registry=registry,
        scaffold=build_runtime_scaffold(
            session_store_type=store.storage_type,
            model_configured=True,
            agent_registry=registry,
            tool_registry=tool_registry,
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    events = asyncio.run(
        _collect_events(
            orchestrator,
            _build_request(
                thread_id="thread-1",
                enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                tool_permission_policy=RuntimeToolPermissionPolicy(
                    schemaVersion=1,
                    defaultMode="allow",
                    toolModes={WEATHER_CURRENT_TOOL_ID: "delay"},
                    toolTimeoutSeconds={WEATHER_CURRENT_TOOL_ID: 1},
                    toolTimeoutActions={WEATHER_CURRENT_TOOL_ID: "deny"},
                ),
            ),
        )
    )

    tool_event_payloads = [event.payload for event in events if event.type == "tool_event"]
    assert [payload["phase"] for payload in tool_event_payloads] == [
        "started",
        "waiting_approval",
        "failed",
    ]
    assert tool_event_payloads[1]["approval"] == {
        "mode": "delay",
        "timeoutAt": tool_event_payloads[1]["approval"]["timeoutAt"],
        "timeoutSeconds": 1,
        "timeoutAction": "deny",
    }
    assert tool_event_payloads[2]["errorSummary"] == "Tool approval timed out and was automatically rejected."
    assert any(event.type == "text_delta" for event in events)
    assert events[-1].type == "run_completed"
    assert events[-1].payload["assistantText"] == "Weather answer"
    assert approval_coordinator.snapshot() == ()



def test_stream_events_filters_denied_tools_from_enabled_tools() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    executor = _StreamingExecutor(deltas=["Hello world"], output="Hello world")
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    assert _strip_internal_tool_ids(executor.calls[0]["enabled_tools"]) == [
        "tool.file-convert"
    ]
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    assert len(executor.calls) == 1
    call = executor.calls[0]
    assert _strip_internal_tool_ids(call["enabled_tools"]) == [
        WEATHER_CURRENT_TOOL_ID
    ]
    assert {key: value for key, value in call.items() if key != "enabled_tools"} == {
        "run_id": events[0].runId,
        "agent_name": "default",
        "user_prompt": "Hello",
        "message_history": [],
        "model_id": "gpt-4.1",
        "debug_enabled": False,
        "request_options": {},
        "model_settings": {},
    }



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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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


def test_stream_events_form_request_interrupts_run_and_ends_with_awaiting_user_input() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    executor = _EventStreamingExecutor(
        events=[
            RuntimeExecutionEvent(
                type="tool_completed",
                payload={
                    "toolCallId": f"{REQUEST_USER_FORM_TOOL_ID}:call-1",
                    "toolId": REQUEST_USER_FORM_TOOL_ID,
                    "phase": "completed",
                    "title": "请求用户表单",
                    "summary": "请填写课程编码。",
                    "resultSummary": "表单请求已发送，等待用户提交。",
                    "formRequest": {
                        "formId": "course-form",
                        "title": "请求课程表单",
                        "description": "请填写课程编码。",
                        "fields": [{
                            "name": "courseCode",
                            "label": "课程编码",
                            "type": "text",
                            "required": True,
                        }],
                    },
                },
            ),
        ],
        output=AwaitingUserInputError(
            tool_id=REQUEST_USER_FORM_TOOL_ID,
            tool_call_id=f"{REQUEST_USER_FORM_TOOL_ID}:call-1",
            form_request={
                "formId": "course-form",
                "title": "请求课程表单",
                "description": "请填写课程编码。",
                "fields": [{
                    "name": "courseCode",
                    "label": "课程编码",
                    "type": "text",
                    "required": True,
                }],
            },
            summary="请填写课程编码。",
        ),
    )
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
            _build_request(thread_id="thread-1", enabled_tools=(REQUEST_USER_FORM_TOOL_ID,)),
        )
    )

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "tool_event",
        "run_failed",
    ]
    assert events[2].payload["toolId"] == REQUEST_USER_FORM_TOOL_ID
    assert events[2].payload["summary"] == "请填写课程编码。"
    assert events[3].payload == {
        "code": "awaiting_user_input",
        "message": "Run interrupted until the user submits the requested form.",
        "details": {
            "toolId": REQUEST_USER_FORM_TOOL_ID,
            "toolCallId": f"{REQUEST_USER_FORM_TOOL_ID}:call-1",
            "summary": "请填写课程编码。",
            "formRequest": {
                "formId": "course-form",
                "title": "请求课程表单",
                "description": "请填写课程编码。",
                "fields": [{
                    "name": "courseCode",
                    "label": "课程编码",
                    "type": "text",
                    "required": True,
                }],
            },
        },
    }
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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



def test_stream_events_client_disconnect_projects_interrupted_draft_into_history() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    executor = _StreamingExecutor(deltas=["partial", "late"], output="partial late")
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
    registry = build_default_agent_registry(executor_factory=_build_test_executor_factory(executor))
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
        resolved_thinking_selection = RuntimeThinkingSelection.from_legacy_level_intent(
            _typed_thinking_level_intent(thinking_level_intent)
        )

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


def test_build_message_history_keeps_projected_structured_payload_context() -> None:
    history = build_message_history(
        (
            RuntimeTextMessage(
                role="user",
                content=(
                    "已提交表单：请求课程表单\n\n"
                    "[structured_payload]\n"
                    '{"formId": "course-form", "type": "inline_form_submission"}'
                ),
            ),
            RuntimeTextMessage(role="assistant", content="已收到课程编码。"),
        )
    )

    assert '"type": "inline_form_submission"' in str(history[0])



def test_build_runtime_user_prompt_appends_structured_payload_block() -> None:
    prompt = build_runtime_user_prompt(
        RuntimeMessagePayload(
            role="user",
            content="已提交表单：请求课程表单\n课程编码: CS304",
            structuredPayload={
                "type": "inline_form_submission",
                "formId": "course-form",
                "values": {
                    "courseCode": "CS304",
                },
            },
        )
    )

    assert "已提交表单：请求课程表单" in prompt
    assert "[structured_payload]" in prompt
    assert '"formId": "course-form"' in prompt
    assert '"courseCode": "CS304"' in prompt
