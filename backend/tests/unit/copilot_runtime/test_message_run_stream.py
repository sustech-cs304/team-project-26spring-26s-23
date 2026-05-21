from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any

import pytest

from app.copilot_runtime.agent import AgentExecutionError
from app.copilot_runtime.execution_event_graph import (
    RuntimeExecutionEvent,
    RuntimeExecutionEventFactory,
)
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.runs.message_run_stream import (
    build_failed_execution_events,
    next_run_id,
    open_execution_stream,
    raise_if_client_disconnected,
)
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver


def _route(model_id: str = "gpt-4.1") -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id=model_id,
        api_key="test-api-key",
    )


class _SimpleStream:
    def __init__(self) -> None:
        self.resolved_model_id = "gpt-4.1"

    async def __aenter__(self) -> _SimpleStream:
        return self

    async def __aexit__(self, *args: object) -> None:
        pass

    async def iter_events(self):  # type: ignore[return]
        if False:
            yield

    async def get_output(self) -> str:
        return ""


class _MinimalExecutor:
    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: Sequence[str] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
        **kwargs: object,
    ) -> _SimpleStream:
        del kwargs
        self._last_call = {  # type: ignore[attr-defined]
            "run_id": run_id,
            "agent_name": agent_name,
            "user_prompt": user_prompt,
            "message_history": message_history,
            "model_route": model_route,
            "enabled_tools": enabled_tools,
            "debug_enabled": debug_enabled,
            "request_options": request_options,
            "model_settings": model_settings,
        }
        return _SimpleStream()


class _NoOpenEventStreamExecutor:
    pass


class _LimitedSignatureExecutor:
    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        debug_enabled: bool = False,
    ) -> _SimpleStream:
        del run_id, agent_name, user_prompt, debug_enabled
        return _SimpleStream()


class TestNextRunId:
    def test_generates_unique_ids(self) -> None:
        ids = {next_run_id() for _ in range(100)}
        assert len(ids) == 100

    def test_has_run_prefix(self) -> None:
        run_id = next_run_id()
        assert run_id.startswith("run-")

    def test_has_32_hex_chars_after_prefix(self) -> None:
        run_id = next_run_id()
        hex_part = run_id[len("run-"):]
        assert len(hex_part) == 32
        assert all(c in "0123456789abcdef" for c in hex_part)


class TestBuildFailedExecutionEvents:
    def test_without_diagnostic_stage_returns_single_event(self) -> None:
        factory = RuntimeExecutionEventFactory(run_id="run-1")
        events = build_failed_execution_events(
            execution_events=factory,
            code="test_error",
            message="Something went wrong",
            details={"key": "value"},
        )
        assert len(events) == 1
        assert events[0].type == "run_failed"
        assert events[0].payload["code"] == "test_error"
        assert events[0].payload["message"] == "Something went wrong"
        assert events[0].payload["details"] == {"key": "value"}

    def test_with_diagnostic_stage_returns_two_events(self) -> None:
        factory = RuntimeExecutionEventFactory(run_id="run-2")
        events = build_failed_execution_events(
            execution_events=factory,
            code="preflight_error",
            message="Preflight check failed",
            details={"step": "validation"},
            diagnostic_stage="adapt_thinking",
        )
        assert len(events) == 2
        assert events[0].type == "diagnostic"
        assert events[0].payload["code"] == "preflight_error"
        assert events[0].payload["stage"] == "adapt_thinking"
        assert events[1].type == "run_failed"
        assert events[1].payload["code"] == "preflight_error"

    def test_diagnostic_event_has_all_fields(self) -> None:
        factory = RuntimeExecutionEventFactory(run_id="run-3")
        events = build_failed_execution_events(
            execution_events=factory,
            code="CODE",
            message="MSG",
            details={"d": 1},
            diagnostic_stage="resolve_model_route",
        )
        diagnostic = events[0]
        assert diagnostic.type == "diagnostic"
        assert diagnostic.payload["code"] == "CODE"
        assert diagnostic.payload["message"] == "MSG"
        assert diagnostic.payload["details"] == {"d": 1}
        assert diagnostic.payload["stage"] == "resolve_model_route"

    def test_events_are_runtime_execution_events(self) -> None:
        factory = RuntimeExecutionEventFactory(run_id="run-4")
        events = build_failed_execution_events(
            execution_events=factory,
            code="err",
            message="msg",
            details={},
        )
        for event in events:
            assert isinstance(event, RuntimeExecutionEvent)

    def test_empty_details_dict(self) -> None:
        factory = RuntimeExecutionEventFactory(run_id="run-5")
        events = build_failed_execution_events(
            execution_events=factory,
            code="empty_details",
            message="No details",
            details={},
        )
        assert events[0].payload["details"] == {}


class TestRaiseIfClientDisconnected:
    def test_none_checker_does_not_raise(self) -> None:
        async def _run() -> None:
            await raise_if_client_disconnected(
                None,
                run_id="run-1",
                thread_id="thread-1",
            )

        asyncio.run(_run())

    def test_checker_returns_false_does_not_raise(self) -> None:
        async def is_connected() -> bool:
            return False

        async def _run() -> None:
            await raise_if_client_disconnected(
                is_connected,
                run_id="run-1",
                thread_id="thread-1",
            )

        asyncio.run(_run())

    def test_checker_returns_true_raises_cancelled_error(self) -> None:
        async def is_disconnected() -> bool:
            return True

        async def _run() -> None:
            with pytest.raises(asyncio.CancelledError):
                await raise_if_client_disconnected(
                    is_disconnected,
                    run_id="run-1",
                    thread_id="thread-1",
                )

        asyncio.run(_run())

    def test_checker_returns_true_raises_asyncio_cancelled_error(self) -> None:
        async def is_disconnected() -> bool:
            return True

        async def _run() -> None:
            try:
                await raise_if_client_disconnected(
                    is_disconnected,
                    run_id="run-1",
                    thread_id="thread-1",
                )
            except asyncio.CancelledError:
                return
            raise AssertionError("Expected CancelledError")

        asyncio.run(_run())


class TestOpenExecutionStream:
    def test_raises_when_no_open_event_stream(self) -> None:
        executor = _NoOpenEventStreamExecutor()
        with pytest.raises(AgentExecutionError, match="open_event_stream"):
            open_execution_stream(
                agent_executor=executor,
                run_id="run-1",
                agent_name="test-agent",
                user_prompt="Hello",
                message_history=(),
                model_route=_route(),
                enabled_tools=(),
                debug_enabled=False,
                request_options=None,
                model_settings=None,
                tool_permission_resolver=None,
            )

    def test_raises_when_attr_is_not_callable(self) -> None:
        executor = _NoOpenEventStreamExecutor()
        executor.open_event_stream = "not_callable"  # type: ignore[attr-defined]
        with pytest.raises(AgentExecutionError):
            open_execution_stream(
                agent_executor=executor,
                run_id="run-1",
                agent_name="test-agent",
                user_prompt="Hello",
                message_history=(),
                model_route=_route(),
                enabled_tools=(),
                debug_enabled=False,
                request_options=None,
                model_settings=None,
                tool_permission_resolver=None,
            )

    def test_calls_open_event_stream_with_correct_kwargs(self) -> None:
        executor = _MinimalExecutor()
        route = _route()
        message_history: list[object] = [{"role": "user", "content": "Hi"}]
        resolver = RuntimeToolPermissionResolver(
            default_mode="allow",
        )

        stream = open_execution_stream(
            agent_executor=executor,
            run_id="run-123",
            agent_name="my-agent",
            user_prompt="Test prompt",
            message_history=message_history,
            model_route=route,
            enabled_tools=("tool-a", "tool-b"),
            debug_enabled=True,
            request_options={"temperature": 0.7},
            model_settings={"max_tokens": 100},
            tool_permission_resolver=resolver,
        )

        last_call = executor._last_call  # type: ignore[attr-defined]
        assert last_call["run_id"] == "run-123"
        assert last_call["agent_name"] == "my-agent"
        assert last_call["user_prompt"] == "Test prompt"
        assert list(last_call["message_history"]) == message_history
        assert last_call["model_route"] is route
        assert tuple(last_call["enabled_tools"]) == ("tool-a", "tool-b")
        assert last_call["debug_enabled"] is True
        assert last_call["request_options"] == {"temperature": 0.7}
        assert last_call["model_settings"] == {"max_tokens": 100}
        assert isinstance(stream, _SimpleStream)

    def test_filters_kwargs_to_match_signature(self) -> None:
        executor = _LimitedSignatureExecutor()

        open_execution_stream(
            agent_executor=executor,
            run_id="run-1",
            agent_name="limited",
            user_prompt="Prompt",
            message_history=(),
            model_route=_route(),
            enabled_tools=(),
            debug_enabled=False,
            request_options={},
            model_settings={},
            tool_permission_resolver=None,
        )

    def test_tool_permission_resolver_passed_when_var_kwargs(self) -> None:
        executor = _MinimalExecutor()
        resolver = RuntimeToolPermissionResolver(default_mode="allow")

        stream = open_execution_stream(
            agent_executor=executor,
            run_id="run-1",
            agent_name="agent",
            user_prompt="P",
            message_history=(),
            model_route=_route(),
            enabled_tools=(),
            debug_enabled=False,
            request_options=None,
            model_settings=None,
            tool_permission_resolver=resolver,
        )

        assert stream is not None

    def test_returns_agent_execution_event_stream(self) -> None:
        executor = _MinimalExecutor()

        stream = open_execution_stream(
            agent_executor=executor,
            run_id="run-1",
            agent_name="agent",
            user_prompt="P",
            message_history=(),
            model_route=_route(),
            enabled_tools=(),
            debug_enabled=False,
            request_options=None,
            model_settings=None,
            tool_permission_resolver=None,
        )

        assert stream is not None
        assert hasattr(stream, "resolved_model_id")
        assert hasattr(stream, "iter_events")
        assert hasattr(stream, "get_output")
