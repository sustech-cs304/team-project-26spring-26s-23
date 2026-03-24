"""Bridge layer between the runtime protocol and the single PydanticAI agent."""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart

from .agent import AgentExecutionError, ModelNotConfiguredError, PydanticAIAgentExecutor
from .contracts import RuntimeRunRequest
from .session_store import InMemorySessionStore, RuntimeSessionRecord, RuntimeTextMessage


class InvalidSessionHistoryError(RuntimeError):
    """Raised when persisted in-memory history cannot be converted into model messages."""


@dataclass(frozen=True, slots=True)
class RuntimeBridgeResult:
    """Successful result of a bridged runtime run."""

    assistant_text: str
    session: RuntimeSessionRecord
    newly_created: bool


class RuntimeBridge:
    """Coordinates session history loading, agent execution, and success persistence."""

    def __init__(
        self,
        *,
        session_store: InMemorySessionStore,
        agent_executor: PydanticAIAgentExecutor,
    ) -> None:
        self._session_store = session_store
        self._agent_executor = agent_executor

    @property
    def model_environment_keys(self) -> tuple[str, ...]:
        return self._agent_executor.model_environment_keys

    async def run(self, *, request: RuntimeRunRequest) -> RuntimeBridgeResult:
        session, newly_created = self._session_store.get_or_create(
            thread_id=request.thread_id,
            agent_name=request.agent_name,
            metadata={"last_run_id": request.run_id},
        )
        history = self._build_message_history(session.message_history())
        assistant_text = await self._agent_executor.run(
            agent_name=request.agent_name,
            user_prompt=request.user_message_text,
            message_history=history,
        )
        persisted_session, _ = self._session_store.append_turn(
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
    "InvalidSessionHistoryError",
    "ModelNotConfiguredError",
    "RuntimeBridge",
    "RuntimeBridgeResult",
]
