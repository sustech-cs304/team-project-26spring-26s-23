"""Structured errors for the Copilot runtime run bridge."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .contracts import RuntimeContract, RuntimeScaffold

INVALID_REQUEST_CODE = "invalid_request"
METHOD_NOT_IMPLEMENTED_CODE = "method_not_implemented"
THREAD_NOT_FOUND_CODE = "thread_not_found"
RUN_NOT_FOUND_CODE = "run_not_found"
SESSION_NOT_FOUND_CODE = "session_not_found"
AGENT_NOT_FOUND_CODE = "agent_not_found"
AGENT_MISMATCH_CODE = "agent_mismatch"
TOOL_NOT_FOUND_CODE = "tool_not_found"
TOOL_APPROVAL_NOT_FOUND_CODE = "tool_approval_not_found"
UNSUPPORTED_MESSAGE_SHAPE_CODE = "unsupported_message_shape"
INVALID_MESSAGE_HISTORY_CODE = "invalid_message_history"
MODEL_NOT_CONFIGURED_CODE = "model_not_configured"
AGENT_EXECUTION_FAILED_CODE = "agent_execution_failed"
INTERNAL_SERVER_ERROR_CODE = "internal_server_error"


@dataclass(frozen=True, slots=True)
class RuntimeErrorDetail(RuntimeContract):
    code: str
    message: str
    stage: str
    requestedMethod: str | None
    supportedMethods: tuple[str, ...]
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeErrorResponse(RuntimeContract):
    ok: bool
    error: RuntimeErrorDetail


def build_invalid_request_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str | None = None,
    details: dict[str, Any] | None = None,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=INVALID_REQUEST_CODE,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details=details,
    )


def build_thread_not_found_error(
    *,
    thread_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=THREAD_NOT_FOUND_CODE,
        message=f"Unknown thread '{thread_id}'.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"threadId": thread_id},
    )


def build_run_not_found_error(
    *,
    run_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=RUN_NOT_FOUND_CODE,
        message=f"Unknown run '{run_id}'.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"runId": run_id},
    )


def build_session_not_found_error(
    *,
    session_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=SESSION_NOT_FOUND_CODE,
        message=f"Unknown session '{session_id}'.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"sessionId": session_id},
    )


def build_agent_not_found_error(
    *,
    agent_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=AGENT_NOT_FOUND_CODE,
        message=f"Unknown agent '{agent_name}'.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"agentName": agent_name},
    )


def build_agent_mismatch_error(
    *,
    session_id: str,
    bound_agent_id: str,
    requested_agent_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=AGENT_MISMATCH_CODE,
        message=(
            f"Session '{session_id}' is bound to agent '{bound_agent_id}', "
            f"cannot use agent '{requested_agent_id}'."
        ),
        scaffold=scaffold,
        requested_method=requested_method,
        details={
            "sessionId": session_id,
            "boundAgentId": bound_agent_id,
            "requestedAgentId": requested_agent_id,
        },
    )


def build_tool_not_found_error(
    *,
    tool_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=TOOL_NOT_FOUND_CODE,
        message=f"Unknown tool '{tool_id}'.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"toolId": tool_id},
    )


def build_tool_approval_not_found_error(
    *,
    run_id: str,
    tool_call_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=TOOL_APPROVAL_NOT_FOUND_CODE,
        message=f"No pending tool approval exists for run '{run_id}' and tool call '{tool_call_id}'.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"runId": run_id, "toolCallId": tool_call_id},
    )


def build_unsupported_message_shape_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
    details: dict[str, Any] | None = None,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=UNSUPPORTED_MESSAGE_SHAPE_CODE,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details=details,
    )


def build_invalid_message_history_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
    details: dict[str, Any] | None = None,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=INVALID_MESSAGE_HISTORY_CODE,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details=details,
    )


def build_model_not_configured_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=MODEL_NOT_CONFIGURED_CODE,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details={"modelEnvironmentKeys": list(scaffold.model_environment_keys)},
    )


def build_runtime_operation_error(
    *,
    code: str,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
    details: dict[str, Any] | None = None,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=code,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details=details,
    )


def build_agent_execution_failed_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
    details: dict[str, Any] | None = None,
) -> RuntimeErrorResponse:
    return build_runtime_operation_error(
        code=AGENT_EXECUTION_FAILED_CODE,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details=details,
    )


def build_internal_server_error(
    *,
    scaffold: RuntimeScaffold,
    requested_method: str | None,
    request_id: str,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=INTERNAL_SERVER_ERROR_CODE,
        message="Desktop runtime encountered an unexpected error. See runtime console logs with requestId.",
        scaffold=scaffold,
        requested_method=requested_method,
        details={"requestId": request_id},
    )


def build_method_not_implemented_error(
    *,
    requested_method: str,
    scaffold: RuntimeScaffold,
) -> RuntimeErrorResponse:
    supported_methods = _format_supported_methods_for_message(
        scaffold.supported_methods
    )
    return _build_runtime_error(
        code=METHOD_NOT_IMPLEMENTED_CODE,
        message=(
            f"Runtime method '{requested_method}' is not implemented yet in the current scaffold. "
            f"Supported methods are {supported_methods}."
        ),
        scaffold=scaffold,
        requested_method=requested_method,
        details={},
    )


def _format_supported_methods_for_message(supported_methods: tuple[str, ...]) -> str:
    if len(supported_methods) == 0:
        return "none"

    if len(supported_methods) == 1:
        return supported_methods[0]

    if len(supported_methods) == 2:
        return f"{supported_methods[0]} and {supported_methods[1]}"

    return f"{', '.join(supported_methods[:-1])}, and {supported_methods[-1]}"


def _build_runtime_error(
    *,
    code: str,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str | None,
    details: dict[str, Any] | None,
) -> RuntimeErrorResponse:
    return RuntimeErrorResponse(
        ok=False,
        error=RuntimeErrorDetail(
            code=code,
            message=message,
            stage=scaffold.stage,
            requestedMethod=requested_method,
            supportedMethods=scaffold.supported_methods,
            details=dict(details or {}),
        ),
    )
