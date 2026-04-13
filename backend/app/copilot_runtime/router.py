"""FastAPI router for the Copilot runtime thread/run bridge."""

from __future__ import annotations

from .transport.http_handlers import (
    _handle_capabilities_get_request,
    _handle_run_cancel_request,
    _handle_run_start_request,
    _handle_run_stream_request,
    _handle_thinking_capability_get_request,
    _handle_thread_create_request,
    _handle_thread_get_request,
    build_router,
)
from .transport.request_mappers import (
    ensure_runtime_request_id as _ensure_runtime_request_id,
    get_request_state_text as _get_request_state_text,
    set_request_state_text as _set_request_state_text,
    set_runtime_request_context as _set_runtime_request_context,
)
from .transport.response_mappers import (
    build_run_start_failed_event_name as _build_run_start_failed_event_name,
    handle_unexpected_run_start_exception as _handle_unexpected_run_start_exception,
    log_run_start_stage as _log_run_start_stage,
    stream_runtime_run_events as _stream_runtime_run_events,
)

__all__ = ["build_router"]
