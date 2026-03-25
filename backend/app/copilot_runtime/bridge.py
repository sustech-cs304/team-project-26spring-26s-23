"""Bridge layer between the runtime protocol and registry-resolved agent executors."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart

from .agent import AgentExecutionError, ModelNotConfiguredError, RuntimeAgentExecutor
from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import RuntimeRunRequest
from .session_store import InMemorySessionStore, RuntimeSessionRecord, RuntimeTextMessage


class AgentNotFoundError(LookupError):
    """Raised when the requested agent is not registered in the runtime."""

    def __init__(self, agent_name: str) -> None:
        self.agent_name = agent_name
        super().__init__(f"Unknown agent '{agent_name}'.")


class InvalidSessionHistoryError(RuntimeError):
    """Raised when persisted in-memory history cannot be converted into model messages."""


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
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry

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
            thread_id=request.thread_id,
            agent_name=request.agent_name,
            user_text=request.user_message_text,
            assistant_text=assistant_text,
            metadata={"last_run_id": request.run_id},
        )
        return RuntimeBridgeResult(
            assistant_text=assistant_text,
            session=persisted_session,
            newly_created=newly_created,
        )

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


def _to_model_message(message: RuntimeTextMessage) -> ModelMessage:
    if message.role == "user":
        return cast(ModelMessage, ModelRequest.user_text_prompt(message.content))
    if message.role == "assistant":
        return cast(ModelMessage, ModelResponse(parts=[TextPart(content=message.content)]))
    raise InvalidSessionHistoryError(f"Unsupported stored message role '{message.role}'.")


__all__ = [
    "AgentExecutionError",
    "AgentNotFoundError",
    "InvalidSessionHistoryError",
    "ModelNotConfiguredError",
    "RuntimeBridge",
    "RuntimeBridgeResult",
]
