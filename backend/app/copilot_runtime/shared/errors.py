"""HTTP error response helpers shared by Copilot runtime transport modules."""

from __future__ import annotations

from typing import Any

from fastapi import status
from fastapi.responses import JSONResponse

from ..contracts import RuntimeScaffold
from ..errors import (
    RuntimeErrorResponse,
    build_agent_execution_failed_error,
    build_agent_not_found_error,
    build_internal_server_error,
    build_method_not_implemented_error,
    build_run_not_found_error,
    build_runtime_operation_error,
    build_session_not_found_error,
    build_thread_not_found_error,
)
from ..protocol import RuntimeProtocolError



def error_response(status_code: int, error: RuntimeErrorResponse) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error.to_dict())



def protocol_error_response(exc: RuntimeProtocolError) -> JSONResponse:
    return error_response(exc.status_code, exc.error)



def agent_not_found_response(
    *,
    agent_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> JSONResponse:
    return error_response(
        status.HTTP_404_NOT_FOUND,
        build_agent_not_found_error(
            agent_name=agent_name,
            scaffold=scaffold,
            requested_method=requested_method,
        ),
    )



def thread_not_found_response(
    *,
    thread_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> JSONResponse:
    return error_response(
        status.HTTP_404_NOT_FOUND,
        build_thread_not_found_error(
            thread_id=thread_id,
            scaffold=scaffold,
            requested_method=requested_method,
        ),
    )



def run_not_found_response(
    *,
    run_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> JSONResponse:
    return error_response(
        status.HTTP_404_NOT_FOUND,
        build_run_not_found_error(
            run_id=run_id,
            scaffold=scaffold,
            requested_method=requested_method,
        ),
    )



def session_not_found_response(
    *,
    session_id: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> JSONResponse:
    return error_response(
        status.HTTP_404_NOT_FOUND,
        build_session_not_found_error(
            session_id=session_id,
            scaffold=scaffold,
            requested_method=requested_method,
        ),
    )



def runtime_operation_conflict_response(
    *,
    code: str,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
    details: dict[str, Any],
) -> JSONResponse:
    return error_response(
        status.HTTP_409_CONFLICT,
        build_runtime_operation_error(
            code=code,
            message=message,
            scaffold=scaffold,
            requested_method=requested_method,
            details=details,
        ),
    )



def agent_execution_failed_response(
    *,
    message: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> JSONResponse:
    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        build_agent_execution_failed_error(
            message=message,
            scaffold=scaffold,
            requested_method=requested_method,
        ),
    )



def method_not_implemented_response(
    *,
    requested_method: str,
    scaffold: RuntimeScaffold,
) -> JSONResponse:
    return error_response(
        status.HTTP_501_NOT_IMPLEMENTED,
        build_method_not_implemented_error(
            requested_method=requested_method,
            scaffold=scaffold,
        ),
    )



def internal_server_error_response(
    *,
    scaffold: RuntimeScaffold,
    requested_method: str,
    request_id: str,
) -> JSONResponse:
    return error_response(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        build_internal_server_error(
            scaffold=scaffold,
            requested_method=requested_method,
            request_id=request_id,
        ),
    )


__all__ = [
    "agent_execution_failed_response",
    "agent_not_found_response",
    "error_response",
    "internal_server_error_response",
    "method_not_implemented_response",
    "protocol_error_response",
    "run_not_found_response",
    "runtime_operation_conflict_response",
    "session_not_found_response",
    "thread_not_found_response",
]
