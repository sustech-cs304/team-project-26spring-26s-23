"""FastAPI router for the Copilot runtime thread/run bridge."""

from __future__ import annotations

from collections.abc import AsyncIterable
from typing import Any

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
    MESSAGE_SEND_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    SESSION_CREATE_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    RuntimeScaffold,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_execution_failed_error,
    build_agent_not_found_error,
    build_method_not_implemented_error,
    build_run_not_found_error,
    build_session_not_found_error,
    build_thread_not_found_error,
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
            return _handle_run_start_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
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

        if requested_method == SESSION_CREATE_METHOD:
            return _handle_session_create_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                runtime_bridge=runtime_bridge,
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



def _handle_run_start_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse:
    try:
        run_start_request = parser.extract_run_start_request(payload)
        run = runtime_bridge.start_run(request=run_start_request)
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

    return JSONResponse(content=scaffold.build_run_start_response(run=run).to_dict())



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
    except RuntimeError as exc:
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            build_agent_execution_failed_error(
                message=str(exc),
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



def _handle_session_create_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
    session_store: InMemorySessionStore,
) -> JSONResponse:
    del session_store
    try:
        session_create_request = parser.extract_session_create_request(payload)
        thread_record = runtime_bridge.create_session(agent_id=session_create_request.agent_id)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=SESSION_CREATE_METHOD,
            ),
        )

    return JSONResponse(content=scaffold.build_session_create_response(session=thread_record).to_dict())



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
        return _stream_runtime_run_events(
            runtime_bridge.stream_message(
                request=message_send_request,
                is_client_disconnected=http_request.is_disconnected,
            )
        )
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)
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
