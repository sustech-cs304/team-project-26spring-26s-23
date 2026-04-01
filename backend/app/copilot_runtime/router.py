"""FastAPI router for the minimal Copilot runtime run bridge."""

from __future__ import annotations

from collections.abc import AsyncIterable
from typing import Any

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from .bridge import AgentNotFoundError, RuntimeBridge, SessionNotFoundError
from .contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    MESSAGE_SEND_METHOD,
    SESSION_CREATE_METHOD,
    RuntimeScaffold,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_execution_failed_error,
    build_agent_not_found_error,
    build_method_not_implemented_error,
    build_session_not_found_error,
)
from .protocol import RuntimeProtocolError, RuntimeProtocolParser
from .run_events import RuntimeRunEvent, encode_runtime_run_events
from .session_store import InMemorySessionStore


def build_router(
    scaffold: RuntimeScaffold,
    session_store: InMemorySessionStore,
    runtime_bridge: RuntimeBridge,
) -> APIRouter:
    router = APIRouter()
    parser = RuntimeProtocolParser(scaffold)

    @router.post("/", response_model=None)
    async def handle_runtime_root(request: Request) -> JSONResponse | StreamingResponse:
        try:
            payload = await parser.read_payload(request)
            requested_method = parser.extract_method(payload)
        except RuntimeProtocolError as exc:
            return _error_response(exc.status_code, exc.error)

        if requested_method == AGENTS_LIST_METHOD:
            return JSONResponse(content=scaffold.build_agents_list_response().to_dict())

        if requested_method == SESSION_CREATE_METHOD:
            return _handle_session_create_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                session_store=session_store,
            )

        if requested_method == CAPABILITIES_GET_METHOD:
            return _handle_capabilities_get_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
            )

        if requested_method == MESSAGE_SEND_METHOD:
            return await _handle_message_send_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
                http_request=request,
            )

        error = build_method_not_implemented_error(
            requested_method=requested_method,
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_501_NOT_IMPLEMENTED, error)

    return router


def _handle_session_create_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    session_store: InMemorySessionStore,
) -> JSONResponse:
    try:
        session_create_request = parser.extract_session_create_request(payload)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)

    session_record = session_store.create(
        bound_agent_id=session_create_request.agent_id,
    )
    return JSONResponse(content=scaffold.build_session_create_response(session=session_record).to_dict())


def _handle_capabilities_get_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        capabilities_request = parser.extract_capabilities_get_request(payload)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)

    try:
        capabilities = runtime_bridge.get_capabilities(session_id=capabilities_request.session_id)
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


async def _handle_message_send_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
    http_request: Request,
) -> JSONResponse | StreamingResponse:
    try:
        message_send_request = parser.extract_message_send_request(payload)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)

    try:
        return _stream_runtime_run_events(
            runtime_bridge.stream_message(
                request=message_send_request,
                is_client_disconnected=http_request.is_disconnected,
            )
        )
    except RuntimeError as exc:
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            build_agent_execution_failed_error(
                message=str(exc),
                scaffold=scaffold,
                requested_method=MESSAGE_SEND_METHOD,
            ),
        )


def _stream_runtime_run_events(events: AsyncIterable[RuntimeRunEvent]) -> StreamingResponse:
    return StreamingResponse(
        encode_runtime_run_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )

def _error_response(status_code: int, error: RuntimeErrorResponse) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error.to_dict())
