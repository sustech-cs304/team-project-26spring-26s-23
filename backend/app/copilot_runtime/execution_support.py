"""Shared runtime execution errors and session-history helpers."""

from __future__ import annotations

from typing import cast

from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse, TextPart

from .session_store import RuntimeTextMessage


class AgentNotFoundError(LookupError):
    """Raised when the requested agent is not registered in the runtime."""

    def __init__(self, agent_name: str) -> None:
        self.agent_name = agent_name
        super().__init__(f"Unknown agent '{agent_name}'.")


class InvalidSessionHistoryError(RuntimeError):
    """Raised when persisted in-memory history cannot be converted into model messages."""


class ThreadNotFoundError(LookupError):
    """Raised when a requested thread does not exist."""

    def __init__(self, thread_id: str) -> None:
        self.thread_id = thread_id
        super().__init__(f"Unknown thread '{thread_id}'.")


class SessionNotFoundError(LookupError):
    """Raised when a requested session does not exist."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(f"Unknown session '{session_id}'.")


class RunNotFoundError(LookupError):
    """Raised when a requested run does not exist."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        super().__init__(f"Unknown run '{run_id}'.")


class ToolNotFoundError(LookupError):
    """Raised when a requested tool id is not available in the registered catalog."""

    def __init__(self, tool_id: str) -> None:
        self.tool_id = tool_id
        super().__init__(f"Unknown tool '{tool_id}'.")


def build_message_history(messages: tuple[RuntimeTextMessage, ...]) -> list[ModelMessage]:
    history: list[ModelMessage] = []
    expected_roles = ("user", "assistant")
    for index, message in enumerate(messages):
        expected_role = expected_roles[index % 2]
        if message.role != expected_role:
            raise InvalidSessionHistoryError(
                "Stored message history is invalid at "
                f"index {index}: expected role '{expected_role}' but found '{message.role}'."
            )
        history.append(to_model_message(message))
    return history


def extract_unknown_tool_id(error: LookupError) -> str:
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


def to_model_message(message: RuntimeTextMessage) -> ModelMessage:
    if message.role == "user":
        return cast(ModelMessage, ModelRequest.user_text_prompt(message.content))
    if message.role == "assistant":
        return cast(ModelMessage, ModelResponse(parts=[TextPart(content=message.content)]))
    raise InvalidSessionHistoryError(f"Unsupported stored message role '{message.role}'.")


__all__ = [
    "AgentNotFoundError",
    "InvalidSessionHistoryError",
    "RunNotFoundError",
    "SessionNotFoundError",
    "ThreadNotFoundError",
    "ToolNotFoundError",
    "build_message_history",
    "extract_unknown_tool_id",
    "to_model_message",
]
