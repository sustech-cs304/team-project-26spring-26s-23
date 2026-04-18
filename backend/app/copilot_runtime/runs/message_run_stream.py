"""Streaming protocols and helpers for runtime message runs."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from types import TracebackType
from typing import Any, Protocol, cast
from uuid import uuid4

from pydantic_ai.messages import ModelMessage

from ..agent import AgentExecutionError
from ..debug_logging import log_runtime_chain_debug, summarize_runtime_model_route
from ..execution_event_graph import RuntimeExecutionEvent, RuntimeExecutionEventFactory
from ..model_routes import ResolvedRuntimeModelRoute
from ..tool_permissions import RuntimeToolPermissionResolver


class RuntimeAgentExecutionEventStream(Protocol):
    resolved_model_id: str

    async def __aenter__(self) -> "RuntimeAgentExecutionEventStream":
        raise NotImplementedError

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool | None:
        raise NotImplementedError

    def iter_events(self) -> AsyncIterator[RuntimeExecutionEvent]:
        raise NotImplementedError

    async def get_output(self) -> str:
        raise NotImplementedError


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
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> RuntimeAgentExecutionEventStream:
        raise NotImplementedError


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
    tool_permission_resolver: RuntimeToolPermissionResolver | None,
) -> RuntimeAgentExecutionEventStream:
    open_event_stream = getattr(agent_executor, "open_event_stream", None)
    if not callable(open_event_stream):
        raise AgentExecutionError(
            f"Agent '{agent_name}' must provide open_event_stream() for streamed execution."
        )
    log_runtime_chain_debug(
        "orchestrator.open_execution_stream",
        enabled=debug_enabled,
        runId=run_id,
        agentName=agent_name,
        streamKind="event_stream",
        enabledToolIds=list(enabled_tools),
        modelRoute=summarize_runtime_model_route(model_route),
        toolPermissionResolverProvided=tool_permission_resolver is not None,
    )
    stream_kwargs: dict[str, Any] = {
        "run_id": run_id,
        "agent_name": agent_name,
        "user_prompt": user_prompt,
        "message_history": message_history,
        "model_route": model_route,
        "enabled_tools": enabled_tools,
        "debug_enabled": debug_enabled,
        "request_options": request_options,
        "model_settings": model_settings,
        "tool_permission_resolver": tool_permission_resolver,
    }
    supports_tool_permission_resolver: bool | None = None
    try:
        signature = inspect.signature(open_event_stream)
    except (TypeError, ValueError):
        supported_stream_kwargs = stream_kwargs
    else:
        supports_var_kwargs = any(
            parameter.kind == inspect.Parameter.VAR_KEYWORD
            for parameter in signature.parameters.values()
        )
        supports_tool_permission_resolver = (
            supports_var_kwargs or "tool_permission_resolver" in signature.parameters
        )
        if supports_var_kwargs:
            supported_stream_kwargs = stream_kwargs
        else:
            supported_stream_kwargs = {
                key: value
                for key, value in stream_kwargs.items()
                if key in signature.parameters
            }
    log_runtime_chain_debug(
        "orchestrator.open_execution_stream.forwarded_kwargs",
        enabled=debug_enabled,
        runId=run_id,
        agentName=agent_name,
        forwardedKwargKeys=sorted(supported_stream_kwargs.keys()),
        executorSupportsToolPermissionResolver=supports_tool_permission_resolver,
        toolPermissionResolver=(
            None
            if tool_permission_resolver is None
            else {
                "defaultMode": tool_permission_resolver.default_mode,
                "toolModes": dict(tool_permission_resolver.tool_modes or {}),
                "toolTimeoutSeconds": dict(
                    tool_permission_resolver.tool_timeout_seconds or {}
                ),
                "toolTimeoutActions": dict(
                    tool_permission_resolver.tool_timeout_actions or {}
                ),
            }
        ),
    )
    stream = open_event_stream(**supported_stream_kwargs)
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
