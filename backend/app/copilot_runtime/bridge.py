"""Bridge layer between the runtime protocol and registry-resolved agent executors."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from .agent import AgentExecutionError, ModelNotConfiguredError, RuntimeAgentExecutor
from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import (
    RuntimeCapabilitiesResponse,
    RuntimeMessageSendRequest,
    RuntimeRunRequest,
    RuntimeScaffold,
)
from .execution_support import (
    AgentNotFoundError,
    InvalidSessionHistoryError,
    SessionNotFoundError,
    ToolNotFoundError,
    build_message_history,
)
from .message_runs import RuntimeMessageRunOrchestrator
from .run_events import RuntimeRunEvent
from .session_store import BoundAgentMismatchError, InMemorySessionStore, RuntimeSessionRecord


@dataclass(frozen=True, slots=True)
class RuntimeBridgeResult:
    """Successful result of a bridged runtime run."""

    assistant_text: str
    session: RuntimeSessionRecord
    newly_created: bool


class RuntimeBridge:
    """Coordinates session history loading, executor resolution, and success persistence."""

    def __init__(
        self,
        *,
        session_store: InMemorySessionStore,
        agent_registry: AgentRegistry,
        scaffold: RuntimeScaffold | None = None,
        message_run_orchestrator: RuntimeMessageRunOrchestrator | None = None,
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry
        self._scaffold = scaffold
        self._message_run_orchestrator = message_run_orchestrator

    async def run(self, *, request: RuntimeRunRequest) -> RuntimeBridgeResult:
        agent_descriptor = self._resolve_agent(request.agent_name)
        existing_session = self._session_store.get(request.thread_id)
        history = self._build_message_history(
            existing_session.message_history() if existing_session is not None else ()
        )
        agent_executor = self._build_executor(agent_descriptor)
        assistant_text = await agent_executor.run(
            agent_name=request.agent_name,
            user_prompt=request.user_message_text,
            message_history=history,
        )
        persisted_session, newly_created = self._session_store.append_turn(
            session_id=request.thread_id,
            bound_agent_id=request.agent_name,
            user_text=request.user_message_text,
            assistant_text=assistant_text,
            metadata={"last_run_id": request.run_id},
        )
        return RuntimeBridgeResult(
            assistant_text=assistant_text,
            session=persisted_session,
            newly_created=newly_created,
        )

    def stream_message(self, *, request: RuntimeMessageSendRequest) -> AsyncIterator[RuntimeRunEvent]:
        orchestrator = self._require_message_run_orchestrator()
        return orchestrator.stream_events(request=request)

    def get_capabilities(self, *, session_id: str) -> RuntimeCapabilitiesResponse:
        if self._scaffold is None:
            raise RuntimeError("Runtime scaffold is required for capabilities queries.")
        session = self._session_store.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        self._resolve_agent(session.bound_agent_id)
        return self._scaffold.build_capabilities_response(session=session)

    def _require_message_run_orchestrator(self) -> RuntimeMessageRunOrchestrator:
        if self._message_run_orchestrator is None:
            raise RuntimeError("Runtime message run orchestrator is not configured.")
        return self._message_run_orchestrator

    def _resolve_agent(self, agent_name: str) -> AgentDescriptor:
        descriptor = self._agent_registry.get(agent_name)
        if descriptor is None:
            raise AgentNotFoundError(agent_name)
        return descriptor

    def _build_executor(self, descriptor: AgentDescriptor) -> RuntimeAgentExecutor:
        executor_factory = descriptor.executor_factory
        if executor_factory is None:
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' has no executor factory configured."
            )
        return executor_factory()

    def _build_message_history(self, messages: tuple[Any, ...]) -> list[Any]:
        return build_message_history(messages)


__all__ = [
    "AgentExecutionError",
    "AgentNotFoundError",
    "BoundAgentMismatchError",
    "InvalidSessionHistoryError",
    "ModelNotConfiguredError",
    "RuntimeBridge",
    "RuntimeBridgeResult",
    "SessionNotFoundError",
    "ToolNotFoundError",
]
