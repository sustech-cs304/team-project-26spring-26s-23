"""桌面运行时 HTTP 中间件。"""

from __future__ import annotations

import logging
from uuid import uuid4

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from ..copilot_runtime.debug_logging import log_runtime_chain_debug, summarize_exception
from ..copilot_runtime.errors import build_internal_server_error
from .security import (
    apply_cors_headers,
    is_cors_preflight_request,
    is_desktop_null_origin,
    is_packaged_electron_request,
)

_RUNTIME_ERROR_LOGGER = logging.getLogger("uvicorn.error")


class DesktopNullOriginMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        origin = request.headers.get("origin")
        if not is_desktop_null_origin(origin):
            return await call_next(request)

        is_preflight_request = is_cors_preflight_request(request)
        if not is_packaged_electron_request(request):
            return Response(status_code=status.HTTP_400_BAD_REQUEST, content="Disallowed CORS origin")

        if is_preflight_request:
            response = Response(status_code=status.HTTP_200_OK)
        else:
            response = await call_next(request)

        apply_cors_headers(
            response,
            origin=origin,
            requested_headers=request.headers.get("access-control-request-headers"),
            is_preflight_request=is_preflight_request,
        )
        return response


class DesktopRuntimeFailureEnvelopeMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = uuid4().hex
        request.state.copilot_runtime_request_id = request_id
        request.scope["copilot_runtime_request_id"] = request_id

        try:
            return await call_next(request)
        except Exception as exc:
            _log_unexpected_runtime_exception(request=request, request_id=request_id, exc=exc)
            error = build_internal_server_error(
                scaffold=_get_runtime_scaffold(request),
                requested_method=_get_runtime_requested_method(request),
                request_id=request_id,
            )
            return JSONResponse(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                content=error.to_dict(),
            )


def _get_runtime_scaffold(request: Request):
    return request.app.state.copilot_runtime_scaffold  # type: ignore[return-value]


def _get_runtime_requested_method(request: Request) -> str | None:
    requested_method = getattr(request.state, "copilot_runtime_requested_method", None)
    if isinstance(requested_method, str) and requested_method != "":
        return requested_method
    return None


def _log_unexpected_runtime_exception(
    *,
    request: Request,
    request_id: str,
    exc: Exception,
) -> None:
    origin = request.headers.get("origin")
    runtime_method = _get_runtime_requested_method(request) or "unknown"
    thread_id = _get_runtime_request_context_value(request, "copilot_runtime_thread_id") or ""
    agent_id = _get_runtime_request_context_value(request, "copilot_runtime_agent_id") or ""
    run_id = _get_runtime_request_context_value(request, "copilot_runtime_run_id") or ""
    phase = _get_runtime_request_context_value(request, "copilot_runtime_phase") or "unknown"
    exception_summary = summarize_exception(exc) or {}
    exception_type = str(exception_summary.get("type") or type(exc).__name__)
    exception_message = str(exception_summary.get("message") or str(exc))
    _RUNTIME_ERROR_LOGGER.error(
        "desktop-runtime unexpected exception request_id=%s http_method=%s path=%s origin=%s runtime_method=%s thread_id=%s agent_id=%s run_id=%s phase=%s status=%s exception_type=%s exception_summary=%s",
        request_id,
        request.method,
        request.url.path,
        origin or "",
        runtime_method,
        thread_id,
        agent_id,
        run_id,
        phase,
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        exception_type,
        exception_message,
    )
    log_runtime_chain_debug(
        "runtime.http_unexpected_exception",
        requestId=request_id,
        httpMethod=request.method,
        path=request.url.path,
        origin=origin,
        runtimeMethod=runtime_method,
        threadId=thread_id or None,
        agentId=agent_id or None,
        runId=run_id or None,
        phase=phase,
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        exceptionType=exception_type,
        exception=exception_summary,
    )


def _get_runtime_request_context_value(request: Request, attr_name: str) -> str | None:
    state_value = getattr(request.state, attr_name, None)
    if isinstance(state_value, str) and state_value != "":
        return state_value
    scope_value = request.scope.get(attr_name)
    if isinstance(scope_value, str) and scope_value != "":
        return scope_value
    return None


__all__ = [
    "DesktopNullOriginMiddleware",
    "DesktopRuntimeFailureEnvelopeMiddleware",
]
