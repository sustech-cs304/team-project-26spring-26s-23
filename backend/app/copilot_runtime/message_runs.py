"""Run orchestration for streamed [`message/send`](docs/system/chat-runtime-contract.md:268) execution."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Protocol, cast
from uuid import uuid4

from pydantic_ai.messages import ModelMessage

from .agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    RuntimeToolLifecycleEvent,
    ToolInvocationError,
)
from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import RuntimeMessageSendRequest, RuntimeScaffold
from .execution_support import (
    AgentNotFoundError,
    InvalidSessionHistoryError,
    SessionNotFoundError,
    ToolNotFoundError,
    build_message_history,
    extract_unknown_tool_id,
)
from .model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
)
from .run_events import (
    RUN_CANCELLED_EVENT_TYPE,
    RUN_COMPLETED_EVENT_TYPE,
    RUN_DIAGNOSTIC_EVENT_TYPE,
    RUN_FAILED_EVENT_TYPE,
    RUN_STARTED_EVENT_TYPE,
    TEXT_DELTA_EVENT_TYPE,
    TOOL_EVENT_EVENT_TYPE,
    RuntimeRunEvent,
    RuntimeRunEventFactory,
)
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


class RuntimeStreamingAgentExecutor(Protocol):
    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> RuntimeAgentTextStream: ...


@dataclass(frozen=True, slots=True)
class RuntimeMessageRunSuccess:
    assistant_text: str
    session: RuntimeSessionRecord
    resolved_model_route: ResolvedRuntimeModelRoute
    resolved_tool_ids: tuple[str, ...]
    request_options: dict[str, Any]


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
    ) -> AsyncIterator[RuntimeRunEvent]:
        run_id = _next_run_id()
        assistant_message_id = f"{run_id}:assistant"
        events = RuntimeRunEventFactory(session_id=request.session_id, run_id=run_id)
        yield events.build(
            RUN_STARTED_EVENT_TYPE,
            payload={
                "assistantMessageId": assistant_message_id,
            },
        )

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
            async for event in self._build_failed_events(
                events=events,
                code=exc.code,
                message=str(exc),
                details=exc.details,
                diagnostic_stage="resolve_model_route",
            ):
                yield event
            return
        except SessionNotFoundError as exc:
            yield self._build_failed_event(
                events=events,
                code="session_not_found",
                message=str(exc),
                details={"sessionId": exc.session_id},
            )
            return
        except BoundAgentMismatchError as exc:
            yield self._build_failed_event(
                events=events,
                code="agent_mismatch",
                message=str(exc),
                details={
                    "sessionId": exc.session_id,
                    "boundAgentId": exc.expected_agent_id,
                    "requestedAgentId": exc.actual_agent_id,
                },
            )
            return
        except ToolNotFoundError as exc:
            yield self._build_failed_event(
                events=events,
                code="tool_not_found",
                message=str(exc),
                details={"toolId": exc.tool_id},
            )
            return
        except AgentNotFoundError as exc:
            yield self._build_failed_event(
                events=events,
                code="agent_not_found",
                message=str(exc),
                details={"agentName": exc.agent_name},
            )
            return
        except InvalidSessionHistoryError as exc:
            yield self._build_failed_event(
                events=events,
                code="invalid_message_history",
                message=str(exc),
                details={},
            )
            return
        except ModelNotConfiguredError as exc:
            yield self._build_failed_event(
                events=events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            )
            return
        except AgentExecutionError as exc:
            async for event in self._build_failed_events(
                events=events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="prepare_execution",
            ):
                yield event
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            async for event in self._build_failed_events(
                events=events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="prepare_execution",
            ):
                yield event
            return

        active_stream: RuntimeAgentTextStream | None = None
        try:
            async with agent_executor.open_text_stream(
                agent_name=session.bound_agent_id,
                user_prompt=request.message.content,
                message_history=message_history,
                model_route=resolved_model_route,
                enabled_tools=resolved_tool_ids,
                request_options=request.policy.requestOptions,
            ) as stream:
                active_stream = cast(RuntimeAgentTextStream, stream)
                async for tool_event in self._emit_pending_tool_events(events=events, stream=active_stream):
                    yield tool_event
                async for delta in active_stream.iter_deltas():
                    await self._raise_if_client_disconnected(is_client_disconnected)
                    async for tool_event in self._emit_pending_tool_events(
                        events=events,
                        stream=active_stream,
                    ):
                        yield tool_event
                    if delta == "":
                        continue
                    yield events.build(
                        TEXT_DELTA_EVENT_TYPE,
                        payload={
                            "assistantMessageId": assistant_message_id,
                            "delta": delta,
                        },
                    )
                await self._raise_if_client_disconnected(is_client_disconnected)
                async for tool_event in self._emit_pending_tool_events(events=events, stream=active_stream):
                    yield tool_event
                assistant_text = await active_stream.get_output()
                async for tool_event in self._emit_pending_tool_events(events=events, stream=active_stream):
                    yield tool_event
                await self._raise_if_client_disconnected(is_client_disconnected)
        except asyncio.CancelledError:
            yield events.build(
                RUN_CANCELLED_EVENT_TYPE,
                payload={
                    "assistantMessageId": assistant_message_id,
                    "reason": "cancelled",
                },
            )
            return
        except ToolInvocationError as exc:
            async for tool_event in self._emit_pending_tool_events(events=events, stream=active_stream):
                yield tool_event
            yield self._build_failed_event(
                events=events,
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
            )
            return
        except ModelNotConfiguredError as exc:
            yield self._build_failed_event(
                events=events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            )
            return
        except AgentExecutionError as exc:
            async for tool_event in self._emit_pending_tool_events(events=events, stream=active_stream):
                yield tool_event
            async for event in self._build_failed_events(
                events=events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="execute_model",
            ):
                yield event
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            async for tool_event in self._emit_pending_tool_events(events=events, stream=active_stream):
                yield tool_event
            async for event in self._build_failed_events(
                events=events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="execute_model",
            ):
                yield event
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
        yield events.build(
            RUN_COMPLETED_EVENT_TYPE,
            payload={
                "assistantMessageId": assistant_message_id,
                "assistantText": success.assistant_text,
                "resolvedModelId": success.resolved_model_route.model_id,
                "resolvedModelRoute": success.resolved_model_route.to_public_dict(),
                "resolvedToolIds": list(success.resolved_tool_ids),
                "requestOptions": dict(success.request_options),
            },
        )

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

    def _build_streaming_executor(self, descriptor: AgentDescriptor) -> RuntimeStreamingAgentExecutor:
        executor_factory = descriptor.executor_factory
        if executor_factory is None:
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' has no executor factory configured."
            )
        executor = executor_factory()
        if not hasattr(executor, "open_text_stream"):
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' does not support streamed text execution."
            )
        return executor  # type: ignore[return-value]

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

    async def _emit_pending_tool_events(
        self,
        *,
        events: RuntimeRunEventFactory,
        stream: RuntimeAgentTextStream | None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        if stream is None:
            return
        for tool_event in self._drain_tool_events(stream):
            yield events.build(
                TOOL_EVENT_EVENT_TYPE,
                payload=tool_event.to_payload(),
            )

    def _drain_tool_events(
        self,
        stream: RuntimeAgentTextStream,
    ) -> tuple[RuntimeToolLifecycleEvent, ...]:
        drain = getattr(stream, "drain_tool_events", None)
        if drain is None:
            return ()
        drained = drain()
        if not isinstance(drained, tuple):
            return tuple(drained)
        return drained

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

    async def _build_failed_events(
        self,
        *,
        events: RuntimeRunEventFactory,
        code: str,
        message: str,
        details: dict[str, Any],
        diagnostic_stage: str,
    ) -> AsyncIterator[RuntimeRunEvent]:
        yield events.build(
            RUN_DIAGNOSTIC_EVENT_TYPE,
            payload={
                "code": code,
                "message": message,
                "details": dict(details),
                "stage": diagnostic_stage,
            },
        )
        yield self._build_failed_event(
            events=events,
            code=code,
            message=message,
            details=details,
        )

    def _build_failed_event(
        self,
        *,
        events: RuntimeRunEventFactory,
        code: str,
        message: str,
        details: dict[str, Any],
    ) -> RuntimeRunEvent:
        return events.build(
            RUN_FAILED_EVENT_TYPE,
            payload={
                "code": code,
                "message": message,
                "details": dict(details),
            },
        )


def _next_run_id() -> str:
    return f"run-{uuid4().hex}"


__all__ = [
    "RuntimeAgentTextStream",
    "RuntimeMessageRunOrchestrator",
    "RuntimeMessageRunSuccess",
    "RuntimeStreamingAgentExecutor",
]
