"""Response and logging helpers for Copilot runtime HTTP transport."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterable

from fastapi import Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from ..contracts import RUN_START_METHOD, RuntimeScaffold
from ..debug_logging import log_runtime_chain_debug, summarize_exception
from ..run_events import RuntimeRunEvent, encode_runtime_run_events
from ..shared.errors import internal_server_error_response
from .request_mappers import ensure_runtime_request_id, get_request_state_text

_RUNTIME_ERROR_LOGGER = logging.getLogger("uvicorn.error")



def stream_runtime_run_events(events: AsyncIterable[RuntimeRunEvent]) -> StreamingResponse:
    return StreamingResponse(
        encode_runtime_run_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )



def handle_unexpected_run_start_exception(
    *,
    request: Request,
    scaffold: RuntimeScaffold,
    exc: Exception,
) -> JSONResponse:
    request_id = ensure_runtime_request_id(request)
    runtime_method = get_request_state_text(request, "copilot_runtime_requested_method") or RUN_START_METHOD
    thread_id = get_request_state_text(request, "copilot_runtime_thread_id") or ""
    agent_id = get_request_state_text(request, "copilot_runtime_agent_id") or ""
    run_id = get_request_state_text(request, "copilot_runtime_run_id") or ""
    phase = get_request_state_text(request, "copilot_runtime_phase") or "unknown"
    origin = request.headers.get("origin")
    exception_summary = summarize_exception(exc) or {}
    exception_type = str(exception_summary.get("type") or type(exc).__name__)
    exception_message = str(exception_summary.get("message") or str(exc))
    _RUNTIME_ERROR_LOGGER.error(
        "run/start unexpected exception request_id=%s http_method=%s path=%s origin=%s runtime_method=%s thread_id=%s agent_id=%s run_id=%s phase=%s status=%s exception_type=%s exception_summary=%s",
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
        "runtime.run_start_unexpected_exception",
        enabled=True,
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
    return internal_server_error_response(
        scaffold=scaffold,
        requested_method=runtime_method,
        request_id=request_id,
    )



def log_run_start_stage(
    request: Request,
    event_name: str,
    *,
    exc: Exception | None = None,
) -> None:
    exception_summary = summarize_exception(exc) if exc is not None else None
    request_debug_enabled = getattr(request.state, "copilot_runtime_debug_mode_enabled", None)
    log_runtime_chain_debug(
        event_name,
        enabled=request_debug_enabled,
        requestId=ensure_runtime_request_id(request),
        httpMethod=request.method,
        path=request.url.path,
        origin=request.headers.get("origin"),
        runtimeMethod=get_request_state_text(request, "copilot_runtime_requested_method") or RUN_START_METHOD,
        threadId=get_request_state_text(request, "copilot_runtime_thread_id"),
        agentId=get_request_state_text(request, "copilot_runtime_agent_id"),
        runId=get_request_state_text(request, "copilot_runtime_run_id"),
        phase=get_request_state_text(request, "copilot_runtime_phase"),
        exceptionType=(
            str(exception_summary.get("type") or type(exc).__name__)
            if exception_summary is not None and exc is not None
            else None
        ),
        exception=exception_summary,
    )



def build_run_start_failed_event_name(phase: str) -> str:
    normalized_phase = phase.strip() if isinstance(phase, str) and phase.strip() != "" else "unknown"
    return f"run_start.{normalized_phase}.failed"


__all__ = [
    "build_run_start_failed_event_name",
    "handle_unexpected_run_start_exception",
    "log_run_start_stage",
    "stream_runtime_run_events",
]
