from __future__ import annotations

import asyncio

from app.copilot_runtime.agent import RuntimeToolLifecycleEvent, ToolInvocationError
from app.copilot_runtime.execution_support import SessionNotFoundError
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.run_events import encode_runtime_run_event
from app.copilot_runtime.model_routes import (
    ProviderProfileNotFoundError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteSnapshot,
)
from app.copilot_runtime.contracts import RuntimeMessageExecutionPolicy, RuntimeMessagePayload, RuntimeMessageSendRequest, build_runtime_scaffold
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
        request_options: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "request_options": dict(request_options or {}),
            }
        )
        return _ImmediateTextStream(
            deltas=self._deltas,
            output=self._output,
            tool_events=self._tool_events,
        )


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
        request_options: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        self.calls.append(
            {
                "agent_name": agent_name,
                "user_prompt": user_prompt,
                "message_history": list(message_history),
                "model_id": model_route.model_id,
                "enabled_tools": list(enabled_tools),
                "request_options": dict(request_options or {}),
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

    events = asyncio.run(_collect_events(orchestrator, _build_request(session_id="session-1")))

    assert [event.type for event in events] == ["run_started", "text_delta", "text_delta", "run_completed"]
    assert [event.sequence for event in events] == [1, 2, 3, 4]
    assert events[-1].payload["assistantText"] == "Hello world"
    assert executor.calls == [
        {
            "agent_name": "default",
            "user_prompt": "Hello",
            "message_history": [],
            "model_id": "gpt-4.1",
            "enabled_tools": [],
            "request_options": {},
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
        "tool_event",
        "tool_event",
        "text_delta",
        "run_completed",
    ]
    assert events[1].payload["phase"] == "started"
    assert events[2].payload["phase"] == "completed"
    assert events[2].payload["toolId"] == WEATHER_CURRENT_TOOL_ID
    assert events[-1].payload["resolvedToolIds"] == [WEATHER_CURRENT_TOOL_ID]



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

    assert [event.type for event in events] == ["run_started", "tool_event", "tool_event", "run_failed"]
    assert events[2].payload["phase"] == "failed"
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

    assert [event.type for event in events] == ["run_started", "text_delta", "run_cancelled"]
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

    assert [event.type for event in events] == ["run_started", "text_delta", "run_cancelled"]
    assert events[-1].payload == {
        "assistantMessageId": events[0].payload["assistantMessageId"],
        "reason": "cancelled",
    }
    assert store.list_messages("session-1") == ()



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
) -> RuntimeMessageSendRequest:
    return RuntimeMessageSendRequest(
        session_id=session_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            enabledTools=enabled_tools,
            requestOptions={},
        ),
        agent_id="default",
    )
