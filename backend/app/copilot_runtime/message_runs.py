"""Run orchestration for streamed [`message/send`](docs/system/chat-runtime-contract.md:268) execution."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from types import TracebackType
from typing import Any, Protocol, cast
from uuid import uuid4

from pydantic_ai.messages import ModelMessage

from .agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    RuntimeToolLifecycleEvent,
    ToolInvocationError,
    tool_lifecycle_event_to_execution_event,
)
from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import RuntimeMessageSendRequest, RuntimeScaffold
from .execution_event_graph import RuntimeExecutionEvent, RuntimeExecutionEventBuffer, RuntimeExecutionEventFactory
from .execution_support import (
    AgentNotFoundError,
    InvalidSessionHistoryError,
    SessionNotFoundError,
    ToolNotFoundError,
    build_message_history,
    extract_unknown_tool_id,
)
from .legacy_event_projection import LegacyRuntimeRunEventProjector
from .model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
)
from .run_events import RuntimeRunEvent, RuntimeRunEventFactory
from .session_store import BoundAgentMismatchError, InMemorySessionStore, RuntimeSessionRecord


class RuntimeAgentTextStream(Protocol):
    resolved_model_id: str

    async def __aenter__(self) -> "RuntimeAgentTextStream": ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool | None: ...

    def iter_deltas(self) -> AsyncIterator[str]: ...

    async def get_output(self) -> str: ...

    def drain_tool_events(self) -> tuple[RuntimeToolLifecycleEvent, ...]: ...


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
        request_options: Mapping[str, Any] | None = None,
    ) -> RuntimeAgentExecutionEventStream: ...


@dataclass(frozen=True, slots=True)
class RuntimeMessageRunSuccess:
    assistant_text: str
    session: RuntimeSessionRecord
    resolved_model_route: ResolvedRuntimeModelRoute
    resolved_tool_ids: tuple[str, ...]
    request_options: dict[str, Any]


@dataclass(slots=True)
class _LegacyTextExecutionEventStreamAdapter:
    stream: RuntimeAgentTextStream
    run_id: str
    resolved_model_id: str = field(init=False)
    _event_buffer: RuntimeExecutionEventBuffer = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.resolved_model_id = self.stream.resolved_model_id
        self._event_buffer = RuntimeExecutionEventBuffer(
            event_factory=RuntimeExecutionEventFactory(run_id=self.run_id)
        )

    async def __aenter__(self) -> "_LegacyTextExecutionEventStreamAdapter":
        await self.stream.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool | None:
        return await self.stream.__aexit__(exc_type, exc, tb)

    async def iter_events(self) -> AsyncIterator[RuntimeExecutionEvent]:
        try:
            async for event in self._emit_pending_tool_events():
                yield event
            async for delta in self.stream.iter_deltas():
                async for event in self._emit_pending_tool_events():
                    yield event
                self._event_buffer.record_assistant_delta(delta)
                for event in self._event_buffer.drain():
                    yield event
            async for event in self._emit_pending_tool_events():
                yield event
        except Exception:
            async for event in self._emit_pending_tool_events():
                yield event
            self._event_buffer.finish_assistant_segment()
            for event in self._event_buffer.drain():
                yield event
            raise

        self._event_buffer.finish_assistant_segment()
        for event in self._event_buffer.drain():
            yield event

    async def get_output(self) -> str:
        return await self.stream.get_output()

    async def _emit_pending_tool_events(self) -> AsyncIterator[RuntimeExecutionEvent]:
        for tool_event in self._drain_tool_events():
            self._event_buffer.record_event(tool_lifecycle_event_to_execution_event(tool_event))
        for event in self._event_buffer.drain():
            yield event

    def _drain_tool_events(self) -> tuple[RuntimeToolLifecycleEvent, ...]:
        drain = getattr(self.stream, "drain_tool_events", None)
        if drain is None:
            return ()
        drained = drain()
        if not isinstance(drained, tuple):
            return tuple(drained)
        return drained


class RuntimeMessageRunOrchestrator:
    """Coordinates request-scoped route resolution, streaming execution, and final archival."""

    def __init__(
        self,
        *,
        session_store: InMemorySessionStore,
        agent_registry: AgentRegistry,
        scaffold: RuntimeScaffold,
        model_route_resolver: RuntimeModelRouteResolver,
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry
        self._scaffold = scaffold
        self._model_route_resolver = model_route_resolver

    async def stream_events(
        self,
        *,
        request: RuntimeMessageSendRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
        run_id: str | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        resolved_run_id = run_id or _next_run_id()
        assistant_message_id = f"{resolved_run_id}:assistant"
        events = RuntimeRunEventFactory(session_id=request.session_id, run_id=resolved_run_id)
        projector = LegacyRuntimeRunEventProjector(
            events=events,
            assistant_message_id=assistant_message_id,
        )
        execution_events = RuntimeExecutionEventFactory(run_id=resolved_run_id)

        yield projector.build_run_started()

        try:
            session = self._require_session(request)
            agent_descriptor = self._resolve_agent(session.bound_agent_id)
            resolved_tool_ids = self._resolve_enabled_tools(
                agent_id=session.bound_agent_id,
                enabled_tools=request.policy.enabledTools,
            )
            message_history = build_message_history(session.message_history())
            resolved_model_route = await self._model_route_resolver.resolve(request.policy.modelRoute)
            agent_executor = self._build_streaming_executor(agent_descriptor)
        except RuntimeModelRouteResolutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code=exc.code,
                message=str(exc),
                details=exc.details,
                diagnostic_stage="resolve_model_route",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except SessionNotFoundError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="session_not_found",
                message=str(exc),
                details={"sessionId": exc.session_id},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except BoundAgentMismatchError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_mismatch",
                message=str(exc),
                details={
                    "sessionId": exc.session_id,
                    "boundAgentId": exc.expected_agent_id,
                    "requestedAgentId": exc.actual_agent_id,
                },
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except ToolNotFoundError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="tool_not_found",
                message=str(exc),
                details={"toolId": exc.tool_id},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except AgentNotFoundError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_not_found",
                message=str(exc),
                details={"agentName": exc.agent_name},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except InvalidSessionHistoryError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="invalid_message_history",
                message=str(exc),
                details={},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except ModelNotConfiguredError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except AgentExecutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="prepare_execution",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="prepare_execution",
            ):
                for projected in projector.project(event):
                    yield projected
            return

        projector.configure_completion_context(
            resolved_model_route=resolved_model_route,
            resolved_tool_ids=resolved_tool_ids,
            request_options=request.policy.requestOptions,
        )

        assistant_text: str
        try:
            async with self._open_execution_stream(
                agent_executor=agent_executor,
                run_id=resolved_run_id,
                agent_name=session.bound_agent_id,
                user_prompt=request.message.content,
                message_history=message_history,
                model_route=resolved_model_route,
                enabled_tools=resolved_tool_ids,
                request_options=request.policy.requestOptions,
            ) as stream:
                async for event in stream.iter_events():
                    projected_events = projector.project(event)
                    if len(projected_events) == 0:
                        continue
                    await self._raise_if_client_disconnected(is_client_disconnected)
                    for projected in projected_events:
                        yield projected
                await self._raise_if_client_disconnected(is_client_disconnected)
                assistant_text = await stream.get_output()
                await self._raise_if_client_disconnected(is_client_disconnected)
        except asyncio.CancelledError:
            for projected in projector.project(
                execution_events.build_run_cancelled(reason="cancelled")
            ):
                yield projected
            return
        except ToolInvocationError as exc:
            for projected in projector.project(
                execution_events.build_run_failed(
                    code=exc.code,
                    message=str(exc),
                    details=dict(exc.details),
                )
            ):
                yield projected
            return
        except ModelNotConfiguredError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except AgentExecutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="execute_model",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="execute_model",
            ):
                for projected in projector.project(event):
                    yield projected
            return

        await self._raise_if_client_disconnected(is_client_disconnected)
        persisted_session, _created = self._session_store.append_turn(
            session_id=session.session_id,
            bound_agent_id=session.bound_agent_id,
            user_text=request.message.content,
            assistant_text=assistant_text,
            metadata={"last_model_id": resolved_model_route.model_id},
        )
        success = RuntimeMessageRunSuccess(
            assistant_text=assistant_text,
            session=persisted_session,
            resolved_model_route=resolved_model_route,
            resolved_tool_ids=resolved_tool_ids,
            request_options=dict(request.policy.requestOptions),
        )
        for projected in projector.project(
            execution_events.build_run_completed(assistant_text=success.assistant_text)
        ):
            yield projected

    def _require_session(self, request: RuntimeMessageSendRequest) -> RuntimeSessionRecord:
        session = self._session_store.get(request.session_id)
        if session is None:
            raise SessionNotFoundError(request.session_id)
        if request.agent_id is not None and request.agent_id != session.bound_agent_id:
            raise BoundAgentMismatchError(
                session_id=session.session_id,
                expected_agent_id=session.bound_agent_id,
                actual_agent_id=request.agent_id,
            )
        return session

    def _resolve_agent(self, agent_name: str) -> AgentDescriptor:
        descriptor = self._agent_registry.get(agent_name)
        if descriptor is None:
            raise AgentNotFoundError(agent_name)
        return descriptor

    def _build_streaming_executor(self, descriptor: AgentDescriptor) -> Any:
        executor_factory = descriptor.executor_factory
        if executor_factory is None:
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' has no executor factory configured."
            )
        executor = executor_factory()
        if not hasattr(executor, "open_event_stream") and not hasattr(executor, "open_text_stream"):
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' does not support streamed execution."
            )
        return executor

    def _open_execution_stream(
        self,
        *,
        agent_executor: Any,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...],
        request_options: Mapping[str, Any] | None,
    ) -> RuntimeAgentExecutionEventStream:
        open_event_stream = getattr(agent_executor, "open_event_stream", None)
        if callable(open_event_stream):
            return cast(
                RuntimeAgentExecutionEventStream,
                open_event_stream(
                    run_id=run_id,
                    agent_name=agent_name,
                    user_prompt=user_prompt,
                    message_history=message_history,
                    model_route=model_route,
                    enabled_tools=enabled_tools,
                    request_options=request_options,
                ),
            )

        open_text_stream = getattr(agent_executor, "open_text_stream", None)
        if callable(open_text_stream):
            legacy_stream = cast(
                RuntimeAgentTextStream,
                open_text_stream(
                    agent_name=agent_name,
                    user_prompt=user_prompt,
                    message_history=message_history,
                    model_route=model_route,
                    enabled_tools=enabled_tools,
                    request_options=request_options,
                ),
            )
            return _LegacyTextExecutionEventStreamAdapter(stream=legacy_stream, run_id=run_id)

        raise AgentExecutionError(
            f"Agent '{agent_name}' does not support streamed execution."
        )

    def _resolve_enabled_tools(
        self,
        *,
        agent_id: str,
        enabled_tools: tuple[str, ...],
    ) -> tuple[str, ...]:
        try:
            return self._scaffold.resolve_enabled_tool_ids(
                agent_id=agent_id,
                enabled_tools=enabled_tools,
            )
        except LookupError as exc:
            raise ToolNotFoundError(extract_unknown_tool_id(exc)) from exc

    async def _raise_if_client_disconnected(
        self,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> None:
        if await self._is_client_disconnected(is_client_disconnected):
            raise asyncio.CancelledError()

    async def _is_client_disconnected(
        self,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> bool:
        if is_client_disconnected is None:
            return False
        return await is_client_disconnected()

    def _build_failed_execution_events(
        self,
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


def _next_run_id() -> str:
    return f"run-{uuid4().hex}"


__all__ = [
    "RuntimeAgentExecutionEventStream",
    "RuntimeAgentTextStream",
    "RuntimeMessageRunOrchestrator",
    "RuntimeMessageRunSuccess",
    "RuntimeStreamingAgentExecutor",
]
