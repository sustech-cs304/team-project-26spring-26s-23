"""Streaming protocols and helpers for runtime message runs."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from types import TracebackType
from typing import Any, Protocol, cast
from uuid import uuid4

from pydantic_ai.messages import ModelMessage

from ..agent import AgentExecutionError
from ..debug_logging import log_runtime_chain_debug, summarize_runtime_model_route
from ..execution_event_graph import RuntimeExecutionEvent, RuntimeExecutionEventFactory
from ..model_routes import ResolvedRuntimeModelRoute


class RuntimeAgentExecutionEventStream(Protocol):
    resolved_model_id: str

    async def __aenter__(self) -> "RuntimeAgentExecutionEventStream": ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool | None: ...

    def iter_events(self) -> AsyncIterator[RuntimeExecutionEvent]: ...

    async def get_output(self) -> str: ...


class RuntimeStreamingAgentExecutor(Protocol):
    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: Sequence[str] = (),
        debug_enabled: bool = False,
        request_options: Mapping[str, Any] | None = None,
        model_settings: Mapping[str, Any] | None = None,
    ) -> RuntimeAgentExecutionEventStream: ...


def open_execution_stream(
    *,
    agent_executor: Any,
    run_id: str,
    agent_name: str,
    user_prompt: str,
    message_history: Sequence[ModelMessage],
    model_route: ResolvedRuntimeModelRoute,
    enabled_tools: tuple[str, ...],
    debug_enabled: bool,
    request_options: Mapping[str, Any] | None,
    model_settings: Mapping[str, Any] | None,
) -> RuntimeAgentExecutionEventStream:
    open_event_stream = getattr(agent_executor, "open_event_stream", None)
    if not callable(open_event_stream):
        raise AgentExecutionError(
            f"Agent '{agent_name}' must provide open_event_stream() for streamed execution."
        )
    log_runtime_chain_debug(
        "orchestrator.open_execution_stream",
        runId=run_id,
        agentName=agent_name,
        streamKind="event_stream",
        enabledToolIds=list(enabled_tools),
        modelRoute=summarize_runtime_model_route(model_route),
    )
    try:
        stream = open_event_stream(
            run_id=run_id,
            agent_name=agent_name,
            user_prompt=user_prompt,
            message_history=message_history,
            model_route=model_route,
            enabled_tools=enabled_tools,
            debug_enabled=debug_enabled,
            request_options=request_options,
            model_settings=model_settings,
        )
    except TypeError as exc:
        if "model_settings" not in str(exc):
            raise
        stream = open_event_stream(
            run_id=run_id,
            agent_name=agent_name,
            user_prompt=user_prompt,
            message_history=message_history,
            model_route=model_route,
            enabled_tools=enabled_tools,
            debug_enabled=debug_enabled,
            request_options=request_options,
        )
    return cast(RuntimeAgentExecutionEventStream, stream)


async def raise_if_client_disconnected(
    is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    *,
    run_id: str,
    thread_id: str,
) -> None:
    if await _is_client_disconnected(is_client_disconnected):
        log_runtime_chain_debug(
            "orchestrator.client_disconnected",
            runId=run_id,
            threadId=thread_id,
        )
        raise asyncio.CancelledError()


async def _is_client_disconnected(
    is_client_disconnected: Callable[[], Awaitable[bool]] | None,
) -> bool:
    if is_client_disconnected is None:
        return False
    return await is_client_disconnected()


def build_failed_execution_events(
    *,
    execution_events: RuntimeExecutionEventFactory,
    code: str,
    message: str,
    details: dict[str, Any],
    diagnostic_stage: str | None = None,
) -> tuple[RuntimeExecutionEvent, ...]:
    if diagnostic_stage is None:
        return (
            execution_events.build_run_failed(
                code=code,
                message=message,
                details=details,
            ),
        )
    return (
        execution_events.build_diagnostic(
            code=code,
            message=message,
            details=details,
            stage=diagnostic_stage,
        ),
        execution_events.build_run_failed(
            code=code,
            message=message,
            details=details,
        ),
    )


def next_run_id() -> str:
    return f"run-{uuid4().hex}"


__all__ = [
    "RuntimeAgentExecutionEventStream",
    "RuntimeStreamingAgentExecutor",
    "build_failed_execution_events",
    "next_run_id",
    "open_execution_stream",
    "raise_if_client_disconnected",
]
