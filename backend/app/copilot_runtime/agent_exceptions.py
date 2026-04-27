"""Exception types for the Copilot runtime agent."""

from __future__ import annotations

from typing import Any

from collections.abc import Mapping

AWAITING_USER_INPUT_CODE = "awaiting_user_input"


class ModelNotConfiguredError(RuntimeError):
    pass


class AgentExecutionError(RuntimeError):
    pass


class ToolInvocationError(AgentExecutionError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        tool_id: str,
        tool_call_id: str | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.tool_id = tool_id
        self.tool_call_id = tool_call_id
        normalized_details: dict[str, Any] = {"toolId": tool_id}
        if tool_call_id is not None:
            normalized_details["toolCallId"] = tool_call_id
        if details is not None:
            normalized_details.update(dict(details))
        self.details = normalized_details
        super().__init__(message)


class AwaitingUserInputError(AgentExecutionError):
    def __init__(
        self,
        *,
        tool_id: str,
        tool_call_id: str,
        form_request: Mapping[str, Any],
        summary: str,
    ) -> None:
        self.code = AWAITING_USER_INPUT_CODE
        self.tool_id = tool_id
        self.tool_call_id = tool_call_id
        self.form_request = dict(form_request)
        self.summary = summary
        self.details = {
            "toolId": tool_id,
            "toolCallId": tool_call_id,
            "summary": summary,
            "formRequest": dict(form_request),
        }
        super().__init__("Run interrupted until the user submits the requested form.")


class ProviderAdapterExecutionError(AgentExecutionError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.details = dict(details or {})
        super().__init__(message)
