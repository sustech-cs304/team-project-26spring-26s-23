"""Structured errors for the Copilot runtime run bridge."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .contracts import RuntimeContract, RuntimeScaffold

INVALID_REQUEST_CODE = "invalid_runtime_request"
METHOD_NOT_IMPLEMENTED_CODE = "method_not_implemented"
AGENT_NOT_FOUND_CODE = "agent_not_found"
AGENT_MISMATCH_CODE = "agent_mismatch"
UNSUPPORTED_MESSAGE_SHAPE_CODE = "unsupported_message_shape"
INVALID_MESSAGE_HISTORY_CODE = "invalid_message_history"
MODEL_NOT_CONFIGURED_CODE = "model_not_configured"
AGENT_EXECUTION_FAILED_CODE = "agent_execution_failed"


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



def build_agent_execution_failed_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
    details: dict[str, Any] | None = None,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=AGENT_EXECUTION_FAILED_CODE,
        message=message,
        scaffold=scaffold,
        requested_method=requested_method,
        details=details,
    )



def build_method_not_implemented_error(
    *,
    requested_method: str,
    scaffold: RuntimeScaffold,
) -> RuntimeErrorResponse:
    return _build_runtime_error(
        code=METHOD_NOT_IMPLEMENTED_CODE,
        message=(
            f"Runtime method '{requested_method}' is not implemented yet in the current scaffold. "
            "Supported methods are info, agents/list, session/create, capabilities/get, agent/connect, and agent/run."
        ),
        scaffold=scaffold,
        requested_method=requested_method,
        details={},
    )



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
