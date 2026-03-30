"""Bridge layer between the runtime protocol and registry-resolved agent executors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart

from .agent import AgentExecutionError, ModelNotConfiguredError, RuntimeAgentExecutor
from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import (
    RuntimeCapabilitiesResponse,
    RuntimeMessageSendRequest,
    RuntimeRunRequest,
    RuntimeScaffold,
)
from .session_store import (
    BoundAgentMismatchError,
    InMemorySessionStore,
    RuntimeSessionRecord,
    RuntimeTextMessage,
)


class AgentNotFoundError(LookupError):
    """Raised when the requested agent is not registered in the runtime."""

    def __init__(self, agent_name: str) -> None:
        self.agent_name = agent_name
        super().__init__(f"Unknown agent '{agent_name}'.")


class InvalidSessionHistoryError(RuntimeError):
    """Raised when persisted in-memory history cannot be converted into model messages."""


class SessionNotFoundError(LookupError):
    """Raised when a requested session does not exist."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(f"Unknown session '{session_id}'.")


class ToolNotFoundError(LookupError):
    """Raised when a requested tool id is not available in the registered catalog."""

    def __init__(self, tool_id: str) -> None:
        self.tool_id = tool_id
        super().__init__(f"Unknown tool '{tool_id}'.")


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
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry
        self._scaffold = scaffold

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

    async def send_message(self, *, request: RuntimeMessageSendRequest) -> RuntimeMessageSendResult:
        if self._scaffold is None:
            raise RuntimeError("Runtime scaffold is required for request-scoped message sends.")

        session = self._session_store.get(request.session_id)
        if session is None:
            raise SessionNotFoundError(request.session_id)

        if request.agent_id is not None and request.agent_id != session.bound_agent_id:
            raise BoundAgentMismatchError(
                session_id=session.session_id,
                expected_agent_id=session.bound_agent_id,
                actual_agent_id=request.agent_id,
            )

        agent_descriptor = self._resolve_agent(session.bound_agent_id)
        history = self._build_message_history(session.message_history())
        agent_executor = self._build_executor(agent_descriptor)
        try:
            resolved_tool_ids = self._scaffold.resolve_enabled_tool_ids(
                agent_id=session.bound_agent_id,
                enabled_tools=request.policy.enabledTools,
            )
        except LookupError as exc:
            raise ToolNotFoundError(_extract_unknown_tool_id(exc)) from exc

        assistant_text = await agent_executor.run(
            agent_name=session.bound_agent_id,
            user_prompt=request.message.content,
            message_history=history,
            model=request.policy.model,
            enabled_tools=resolved_tool_ids,
            request_options=request.policy.requestOptions,
        )
        persisted_session, _created = self._session_store.append_turn(
            session_id=session.session_id,
            bound_agent_id=session.bound_agent_id,
            user_text=request.message.content,
            assistant_text=assistant_text,
            metadata={"last_model_id": request.policy.model},
        )
        return RuntimeMessageSendResult(
            assistant_text=assistant_text,
            session=persisted_session,
            resolved_model_id=request.policy.model,
            resolved_tool_ids=resolved_tool_ids,
            request_options=dict(request.policy.requestOptions),
        )

    def get_capabilities(self, *, session_id: str) -> RuntimeCapabilitiesResponse:
        if self._scaffold is None:
            raise RuntimeError("Runtime scaffold is required for capabilities queries.")
        session = self._session_store.get(session_id)
        if session is None:
            raise LookupError(f"Unknown session '{session_id}'.")
        self._resolve_agent(session.bound_agent_id)
        return self._scaffold.build_capabilities_response(session=session)

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

    def _build_message_history(
        self,
        messages: tuple[RuntimeTextMessage, ...],
    ) -> list[ModelMessage]:
        history: list[ModelMessage] = []
        expected_roles = ("user", "assistant")
        for index, message in enumerate(messages):
            expected_role = expected_roles[index % 2]
            if message.role != expected_role:
                raise InvalidSessionHistoryError(
                    "Stored message history is invalid at "
                    f"index {index}: expected role '{expected_role}' but found '{message.role}'."
                )
            history.append(_to_model_message(message))
        return history


def _extract_unknown_tool_id(error: LookupError) -> str:
    structured_tool_id = getattr(error, "tool_id", None)
    if isinstance(structured_tool_id, str):
        normalized_tool_id = structured_tool_id.strip()
        if normalized_tool_id != "":
            return normalized_tool_id

    message = str(error).strip()
    if message == "":
        return "unknown"

    prefix = "Unknown tool '"
    suffix = "'."
    if message.startswith(prefix) and message.endswith(suffix) and len(message) > len(prefix) + len(suffix):
        return message[len(prefix) : -len(suffix)]

    return message


def _to_model_message(message: RuntimeTextMessage) -> ModelMessage:
    if message.role == "user":
        return cast(ModelMessage, ModelRequest.user_text_prompt(message.content))
    if message.role == "assistant":
        return cast(ModelMessage, ModelResponse(parts=[TextPart(content=message.content)]))
    raise InvalidSessionHistoryError(f"Unsupported stored message role '{message.role}'.")


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
