"""FastAPI router for the Copilot runtime thread/run bridge."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterable
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from .bridge import (
    AgentNotFoundError,
    RunNotFoundError,
    RuntimeBridge,
    SessionNotFoundError,
    ThreadNotFoundError,
)
from .contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    RuntimeScaffold,
)
from .debug_logging import log_runtime_chain_debug, summarize_exception
from .errors import (
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
from .protocol import RuntimeProtocolError, RuntimeProtocolParser
from .run_events import RuntimeRunEvent, encode_runtime_run_events
from .model_routes import RuntimeModelRouteResolutionError
from .provider_adapter_registry import RuntimeProviderAdapterError


_RUNTIME_ERROR_LOGGER = logging.getLogger("uvicorn.error")


def build_router(
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> APIRouter:
    router = APIRouter()
    parser = RuntimeProtocolParser(scaffold)

    @router.post("/", response_model=None)
    async def handle_runtime_root(request: Request) -> JSONResponse | StreamingResponse:
        try:
            payload = await parser.read_payload(request)
            requested_method = parser.extract_method(payload)
            request.state.copilot_runtime_requested_method = requested_method
        except RuntimeProtocolError as exc:
            return _error_response(exc.status_code, exc.error)

        if requested_method == AGENTS_LIST_METHOD:
            return JSONResponse(content=scaffold.build_agents_list_response().to_dict())

        if requested_method == THREAD_CREATE_METHOD:
            return _handle_thread_create_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
            )

        if requested_method == THREAD_GET_METHOD:
            return _handle_thread_get_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
            )

        if requested_method == RUN_START_METHOD:
            return await _handle_run_start_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
                http_request=request,
            )

        if requested_method == RUN_STREAM_METHOD:
            return await _handle_run_stream_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
                http_request=request,
            )

        if requested_method == RUN_CANCEL_METHOD:
            return _handle_run_cancel_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
            )

        if requested_method == CAPABILITIES_GET_METHOD:
            return _handle_capabilities_get_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
            )

        if requested_method == THINKING_CAPABILITY_GET_METHOD:
            return await _handle_thinking_capability_get_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
            )

        error = build_method_not_implemented_error(
            requested_method=requested_method,
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_501_NOT_IMPLEMENTED, error)

    return router



def _handle_thread_create_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        thread_create_request = parser.extract_thread_create_request(payload)
        thread_record = runtime_bridge.create_thread(agent_id=thread_create_request.agent_id)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=THREAD_CREATE_METHOD,
            ),
        )

    return JSONResponse(content=scaffold.build_thread_create_response(thread=thread_record).to_dict())



def _handle_thread_get_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        thread_get_request = parser.extract_thread_get_request(payload)
        thread = runtime_bridge.get_thread(thread_id=thread_get_request.thread_id)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except ThreadNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_thread_not_found_error(
                thread_id=exc.thread_id,
                scaffold=scaffold,
                requested_method=THREAD_GET_METHOD,
            ),
        )
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=THREAD_GET_METHOD,
            ),
        )

    return JSONResponse(content=scaffold.build_thread_get_response(thread=thread).to_dict())



async def _handle_run_start_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
    http_request: Request,
) -> JSONResponse:
    try:
        run_start_request = parser.extract_run_start_request(payload)
        _set_runtime_request_context(
            http_request,
            runtime_method=RUN_START_METHOD,
            thread_id=run_start_request.thread_id,
            agent_id=run_start_request.agent_id,
            phase="create_run_record",
        )
        _log_run_start_stage(http_request, "run_start.request_received")
        _log_run_start_stage(http_request, "run_start.create_run_record.enter")
        run = runtime_bridge.start_run(request=run_start_request)
        _set_runtime_request_context(http_request, run_id=run.run_id)
        _log_run_start_stage(http_request, "run_start.create_run_record.succeeded")
        _set_runtime_request_context(http_request, phase="prime_run_metadata")
        _log_run_start_stage(http_request, "run_start.prime_run_metadata.enter")
        run = await runtime_bridge.prime_run_metadata(
            run_id=run.run_id,
            runtime_method=RUN_START_METHOD,
            request_id=_ensure_runtime_request_id(http_request),
        )
        _log_run_start_stage(http_request, "run_start.prime_run_metadata.succeeded")
        _set_runtime_request_context(http_request, phase="build_run_start_response")
        _log_run_start_stage(http_request, "run_start.build_run_start_response.enter")
        response = scaffold.build_run_start_response(run=run)
        _log_run_start_stage(http_request, "run_start.build_run_start_response.succeeded")
        _set_runtime_request_context(http_request, phase="serialize_run_start_response")
        _log_run_start_stage(http_request, "run_start.serialize_run_start_response.enter")
        serialized_response = response.to_dict()
        json_response = JSONResponse(content=serialized_response)
        _log_run_start_stage(http_request, "run_start.serialize_run_start_response.succeeded")
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except ThreadNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_thread_not_found_error(
                thread_id=exc.thread_id,
                scaffold=scaffold,
                requested_method=RUN_START_METHOD,
            ),
        )
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=RUN_START_METHOD,
            ),
        )
    except Exception as exc:
        _log_run_start_stage(
            http_request,
            _build_run_start_failed_event_name(
                _get_request_state_text(http_request, "copilot_runtime_phase") or "unknown"
            ),
            exc=exc,
        )
        return _handle_unexpected_run_start_exception(
            request=http_request,
            scaffold=scaffold,
            exc=exc,
        )

    return json_response



async def _handle_run_stream_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
    http_request: Request,
) -> JSONResponse | StreamingResponse:
    try:
        run_stream_request = parser.extract_run_stream_request(payload)
        events = runtime_bridge.stream_run(
            run_id=run_stream_request.run_id,
            is_client_disconnected=http_request.is_disconnected,
        )
        return _stream_runtime_run_events(events)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except RunNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_run_not_found_error(
                run_id=exc.run_id,
                scaffold=scaffold,
                requested_method=RUN_STREAM_METHOD,
            ),
        )



def _handle_run_cancel_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        run_cancel_request = parser.extract_run_cancel_request(payload)
        run, cancel_accepted = runtime_bridge.cancel_run(run_id=run_cancel_request.run_id)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except RunNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_run_not_found_error(
                run_id=exc.run_id,
                scaffold=scaffold,
                requested_method=RUN_CANCEL_METHOD,
            ),
        )

    return JSONResponse(
        content=scaffold.build_run_cancel_response(
            run=run,
            cancel_accepted=cancel_accepted,
        ).to_dict()
    )



def _handle_capabilities_get_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        capabilities_request = parser.extract_capabilities_get_request(payload)
        capabilities = runtime_bridge.get_capabilities(session_id=capabilities_request.session_id)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except SessionNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_session_not_found_error(
                session_id=exc.session_id,
                scaffold=scaffold,
                requested_method=CAPABILITIES_GET_METHOD,
            ),
        )
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=CAPABILITIES_GET_METHOD,
            ),
        )

    return JSONResponse(content=capabilities.to_dict())


async def _handle_thinking_capability_get_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        thinking_request = parser.extract_thinking_capability_get_request(payload)
        response = await runtime_bridge.get_thinking_capability(
            session_id=thinking_request.session_id,
            model_route=thinking_request.model_route,
            thinking_capability_override=thinking_request.thinking_capability_override,
        )
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except SessionNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_session_not_found_error(
                session_id=exc.session_id,
                scaffold=scaffold,
                requested_method=THINKING_CAPABILITY_GET_METHOD,
            ),
        )
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=THINKING_CAPABILITY_GET_METHOD,
            ),
        )
    except RuntimeModelRouteResolutionError as exc:
        return _error_response(
            status.HTTP_409_CONFLICT,
            build_runtime_operation_error(
                code=exc.code,
                message=str(exc),
                scaffold=scaffold,
                requested_method=THINKING_CAPABILITY_GET_METHOD,
                details=exc.details,
            ),
        )
    except RuntimeProviderAdapterError as exc:
        return _error_response(
            status.HTTP_409_CONFLICT,
            build_runtime_operation_error(
                code=exc.code,
                message=str(exc),
                scaffold=scaffold,
                requested_method=THINKING_CAPABILITY_GET_METHOD,
                details=exc.details,
            ),
        )
    except RuntimeError as exc:
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            build_agent_execution_failed_error(
                message=str(exc),
                scaffold=scaffold,
                requested_method=THINKING_CAPABILITY_GET_METHOD,
            ),
        )

    return JSONResponse(content=response.to_dict())


def _stream_runtime_run_events(events: AsyncIterable[RuntimeRunEvent]) -> StreamingResponse:
    return StreamingResponse(
        encode_runtime_run_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )



def _error_response(status_code: int, error: RuntimeErrorResponse) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error.to_dict())



def _handle_unexpected_run_start_exception(
    *,
    request: Request,
    scaffold: RuntimeScaffold,
    exc: Exception,
) -> JSONResponse:
    request_id = _ensure_runtime_request_id(request)
    runtime_method = _get_request_state_text(request, "copilot_runtime_requested_method") or RUN_START_METHOD
    thread_id = _get_request_state_text(request, "copilot_runtime_thread_id") or ""
    agent_id = _get_request_state_text(request, "copilot_runtime_agent_id") or ""
    run_id = _get_request_state_text(request, "copilot_runtime_run_id") or ""
    phase = _get_request_state_text(request, "copilot_runtime_phase") or "unknown"
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
    error = build_internal_server_error(
        scaffold=scaffold,
        requested_method=runtime_method,
        request_id=request_id,
    )
    return _error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, error)



def _set_runtime_request_context(
    request: Request,
    *,
    runtime_method: str | None = None,
    thread_id: str | None = None,
    agent_id: str | None = None,
    run_id: str | None = None,
    phase: str | None = None,
) -> None:
    _set_request_state_text(request, "copilot_runtime_requested_method", runtime_method)
    _set_request_state_text(request, "copilot_runtime_thread_id", thread_id)
    _set_request_state_text(request, "copilot_runtime_session_id", thread_id)
    _set_request_state_text(request, "copilot_runtime_agent_id", agent_id)
    _set_request_state_text(request, "copilot_runtime_run_id", run_id)
    _set_request_state_text(request, "copilot_runtime_phase", phase)



def _log_run_start_stage(request: Request, event_name: str, *, exc: Exception | None = None) -> None:
    exception_summary = summarize_exception(exc) if exc is not None else None
    log_runtime_chain_debug(
        event_name,
        enabled=True,
        requestId=_ensure_runtime_request_id(request),
        httpMethod=request.method,
        path=request.url.path,
        origin=request.headers.get("origin"),
        runtimeMethod=_get_request_state_text(request, "copilot_runtime_requested_method") or RUN_START_METHOD,
        threadId=_get_request_state_text(request, "copilot_runtime_thread_id"),
        agentId=_get_request_state_text(request, "copilot_runtime_agent_id"),
        runId=_get_request_state_text(request, "copilot_runtime_run_id"),
        phase=_get_request_state_text(request, "copilot_runtime_phase"),
        exceptionType=(
            str(exception_summary.get("type") or type(exc).__name__)
            if exception_summary is not None and exc is not None
            else None
        ),
        exception=exception_summary,
    )



def _build_run_start_failed_event_name(phase: str) -> str:
    normalized_phase = phase.strip() if isinstance(phase, str) and phase.strip() != "" else "unknown"
    return f"run_start.{normalized_phase}.failed"



def _ensure_runtime_request_id(request: Request) -> str:
    existing_request_id = _get_request_state_text(request, "copilot_runtime_request_id")
    if existing_request_id is not None:
        return existing_request_id
    generated_request_id = uuid4().hex
    request.state.copilot_runtime_request_id = generated_request_id
    request.scope["copilot_runtime_request_id"] = generated_request_id
    return generated_request_id



def _set_request_state_text(request: Request, attr_name: str, value: str | None) -> None:
    if value is None or value == "":
        return
    setattr(request.state, attr_name, value)
    request.scope[attr_name] = value



def _get_request_state_text(request: Request, attr_name: str) -> str | None:
    value = getattr(request.state, attr_name, None)
    if isinstance(value, str) and value != "":
        return value
    scope_value = request.scope.get(attr_name)
    if isinstance(scope_value, str) and scope_value != "":
        return scope_value
    return None
