"""Structured errors for the minimal Copilot runtime scaffold."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .contracts import RuntimeContract, RuntimeScaffold

INVALID_REQUEST_CODE = "invalid_runtime_request"
METHOD_NOT_IMPLEMENTED_CODE = "method_not_implemented"
AGENT_NOT_FOUND_CODE = "agent_not_found"


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
    return RuntimeErrorResponse(
        ok=False,
        error=RuntimeErrorDetail(
            code=INVALID_REQUEST_CODE,
            message=message,
            stage=scaffold.stage,
            requestedMethod=requested_method,
            supportedMethods=scaffold.supported_methods,
            details=dict(details or {}),
        ),
    )


def build_agent_not_found_error(
    *,
    agent_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> RuntimeErrorResponse:
    return RuntimeErrorResponse(
        ok=False,
        error=RuntimeErrorDetail(
            code=AGENT_NOT_FOUND_CODE,
            message=f"Unknown agent '{agent_name}'.",
            stage=scaffold.stage,
            requestedMethod=requested_method,
            supportedMethods=scaffold.supported_methods,
            details={"agentName": agent_name},
        ),
    )


def build_method_not_implemented_error(
    *,
    requested_method: str,
    scaffold: RuntimeScaffold,
) -> RuntimeErrorResponse:
    return RuntimeErrorResponse(
        ok=False,
        error=RuntimeErrorDetail(
            code=METHOD_NOT_IMPLEMENTED_CODE,
            message=(
                f"Runtime method '{requested_method}' is not implemented yet in the current scaffold. "
                "Only the info and agent/connect capabilities are currently available."
            ),
            stage=scaffold.stage,
            requestedMethod=requested_method,
            supportedMethods=scaffold.supported_methods,
            details={},
        ),
    )
