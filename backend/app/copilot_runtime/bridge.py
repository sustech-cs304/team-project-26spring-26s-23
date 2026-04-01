"""Bridge layer between the runtime protocol and registry-resolved agent executors."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable

from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import RuntimeCapabilitiesResponse, RuntimeMessageSendRequest, RuntimeScaffold
from .execution_support import AgentNotFoundError, SessionNotFoundError
from .message_runs import RuntimeMessageRunOrchestrator
from .run_events import RuntimeRunEvent
from .session_store import InMemorySessionStore


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

    def stream_message(
        self,
        *,
        request: RuntimeMessageSendRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        orchestrator = self._require_message_run_orchestrator()
        return orchestrator.stream_events(
            request=request,
            is_client_disconnected=is_client_disconnected,
        )

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

__all__ = [
    "AgentNotFoundError",
    "RuntimeBridge",
    "SessionNotFoundError",
]
