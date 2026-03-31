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
from .run_events import (
    RUN_CANCELLED_EVENT_TYPE,
    RUN_COMPLETED_EVENT_TYPE,
    RUN_FAILED_EVENT_TYPE,
    RuntimeRunEvent,
)
from .session_store import BoundAgentMismatchError, InMemorySessionStore, RuntimeSessionRecord


@dataclass(frozen=True, slots=True)
class RuntimeBridgeResult:
    """Successful result of a bridged runtime run."""

    assistant_text: str
    session: RuntimeSessionRecord
    newly_created: bool


@dataclass(frozen=True, slots=True)
class RuntimeMessageSendResult:
    """Successful result of a request-scoped message send."""

    assistant_text: str
    session: RuntimeSessionRecord
    resolved_model_id: str
    resolved_tool_ids: tuple[str, ...]
    request_options: dict[str, object]


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

    async def send_message(self, *, request: RuntimeMessageSendRequest) -> RuntimeMessageSendResult:
        completed_payload: dict[str, Any] | None = None
        async for event in self.stream_message(request=request):
            if event.type == RUN_COMPLETED_EVENT_TYPE:
                completed_payload = dict(event.payload)
                continue
            if event.type == RUN_FAILED_EVENT_TYPE:
                raise _compat_exception_from_failed_event(event)
            if event.type == RUN_CANCELLED_EVENT_TYPE:
                raise AgentExecutionError("Message run was cancelled.")

        if completed_payload is None:
            raise AgentExecutionError("Message run finished without a completion event.")

        session = self._session_store.get(request.session_id)
        if session is None:
            raise SessionNotFoundError(request.session_id)

        assistant_text = completed_payload.get("assistantText")
        if not isinstance(assistant_text, str) or assistant_text.strip() == "":
            raise AgentExecutionError("Message run completion event did not include assistant text.")

        resolved_model_id = completed_payload.get("resolvedModelId")
        if not isinstance(resolved_model_id, str) or resolved_model_id.strip() == "":
            raise AgentExecutionError("Message run completion event did not include a resolved model id.")

        resolved_tool_ids_value = completed_payload.get("resolvedToolIds")
        resolved_tool_ids = tuple(
            item.strip()
            for item in resolved_tool_ids_value
            if isinstance(item, str) and item.strip() != ""
        ) if isinstance(resolved_tool_ids_value, list) else ()
        request_options_value = completed_payload.get("requestOptions")
        request_options = (
            dict(request_options_value)
            if isinstance(request_options_value, dict)
            else {}
        )

        return RuntimeMessageSendResult(
            assistant_text=assistant_text,
            session=session,
            resolved_model_id=resolved_model_id.strip(),
            resolved_tool_ids=resolved_tool_ids,
            request_options=request_options,
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

    def _build_executor(self, descriptor: AgentDescriptor) -> RuntimeAgentExecutor:
        executor_factory = descriptor.executor_factory
        if executor_factory is None:
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' has no executor factory configured."
            )
        return executor_factory()

    def _build_message_history(self, messages: tuple[Any, ...]) -> list[Any]:
        return build_message_history(messages)


def _compat_exception_from_failed_event(event: RuntimeRunEvent) -> Exception:
    payload = dict(event.payload)
    code = payload.get("code")
    message = payload.get("message")
    details = payload.get("details")
    normalized_message = message if isinstance(message, str) and message.strip() != "" else "Message run failed."
    normalized_details = details if isinstance(details, dict) else {}

    if code == "session_not_found":
        return SessionNotFoundError(str(normalized_details.get("sessionId", event.sessionId)))
    if code == "agent_mismatch":
        return BoundAgentMismatchError(
            session_id=str(normalized_details.get("sessionId", event.sessionId)),
            expected_agent_id=str(normalized_details.get("boundAgentId", "unknown")),
            actual_agent_id=str(normalized_details.get("requestedAgentId", "unknown")),
        )
    if code == "tool_not_found":
        return ToolNotFoundError(str(normalized_details.get("toolId", "unknown")))
    if code == "agent_not_found":
        return AgentNotFoundError(str(normalized_details.get("agentName", "unknown")))
    if code == "invalid_message_history":
        return InvalidSessionHistoryError(normalized_message)
    if code == "model_not_configured":
        return ModelNotConfiguredError(normalized_message)
    return AgentExecutionError(normalized_message)


__all__ = [
    "AgentExecutionError",
    "AgentNotFoundError",
    "BoundAgentMismatchError",
    "InvalidSessionHistoryError",
    "ModelNotConfiguredError",
    "RuntimeBridge",
    "RuntimeBridgeResult",
    "RuntimeMessageSendResult",
    "SessionNotFoundError",
    "ToolNotFoundError",
]
