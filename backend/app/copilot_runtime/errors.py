"""Structured errors for the phase-1 Copilot runtime scaffold."""

from __future__ import annotations

from dataclasses import dataclass

from .contracts import RuntimeContract, RuntimeScaffold

INVALID_REQUEST_CODE = "invalid_runtime_request"
METHOD_NOT_IMPLEMENTED_CODE = "method_not_implemented"


@dataclass(frozen=True, slots=True)
class RuntimeErrorDetail(RuntimeContract):
    code: str
    message: str
    stage: str
    requestedMethod: str | None
    supportedMethods: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class RuntimeErrorResponse(RuntimeContract):
    ok: bool
    error: RuntimeErrorDetail


def build_invalid_request_error(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str | None = None,
) -> RuntimeErrorResponse:
    return RuntimeErrorResponse(
        ok=False,
        error=RuntimeErrorDetail(
            code=INVALID_REQUEST_CODE,
            message=message,
            stage=scaffold.stage,
            requestedMethod=requested_method,
            supportedMethods=scaffold.supported_methods,
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
                f"Runtime method '{requested_method}' is not implemented yet in the phase-1 scaffold. "
                "Only the info capability is currently available."
            ),
            stage=scaffold.stage,
            requestedMethod=requested_method,
            supportedMethods=scaffold.supported_methods,
        ),
    )
