"""FastAPI router for the minimal Copilot runtime run bridge."""

from __future__ import annotations

import json
from collections.abc import AsyncIterable, Iterable
from typing import Any

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from .bridge import (
    AgentExecutionError,
    AgentNotFoundError,
    BoundAgentMismatchError,
    InvalidSessionHistoryError,
    ModelNotConfiguredError,
    RuntimeBridge,
    SessionNotFoundError,
    ToolNotFoundError,
)
from .contracts import (
    AGENT_CONNECT_METHOD,
    AGENT_RUN_METHOD,
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    INFO_METHOD,
    MESSAGE_SEND_METHOD,
    SESSION_CREATE_METHOD,
    RuntimeScaffold,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_execution_failed_error,
    build_agent_mismatch_error,
    build_agent_not_found_error,
    build_invalid_message_history_error,
    build_method_not_implemented_error,
    build_model_not_configured_error,
    build_session_not_found_error,
    build_tool_not_found_error,
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

        if requested_method == INFO_METHOD:
            return JSONResponse(content=scaffold.build_info_response().to_dict())

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

        if requested_method == AGENT_CONNECT_METHOD:
            return _handle_connect_request(
                parser=parser,
                payload=payload,
                scaffold=scaffold,
                session_store=session_store,
            )

        if requested_method == AGENT_RUN_METHOD:
            return await _handle_run_request(
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


def _handle_connect_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    session_store: InMemorySessionStore,
) -> JSONResponse | StreamingResponse:
    try:
        connect_request = parser.extract_connect_request(payload)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)

    try:
        session_record, newly_created = session_store.get_or_create(
            session_id=connect_request.thread_id,
            bound_agent_id=connect_request.agent_name,
            metadata={"last_connect_run_id": connect_request.run_id},
        )
    except BoundAgentMismatchError as exc:
        return _error_response(
            status.HTTP_409_CONFLICT,
            build_agent_mismatch_error(
                session_id=exc.session_id,
                bound_agent_id=exc.expected_agent_id,
                requested_agent_id=exc.actual_agent_id,
                scaffold=scaffold,
                requested_method=AGENT_CONNECT_METHOD,
            ),
        )
    session = scaffold.build_session_descriptor(
        session=session_record,
        newly_created=newly_created,
    )
    result = scaffold.build_connect_result(request=connect_request, session=session)
    return _stream_runtime_events(scaffold.build_connect_events(request=connect_request, result=result))


async def _handle_run_request(
    *,
    parser: RuntimeProtocolParser,
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> JSONResponse | StreamingResponse:
    try:
        run_request = parser.extract_run_request(payload)
    except RuntimeProtocolError as exc:
        return _error_response(exc.status_code, exc.error)

    try:
        bridge_result = await runtime_bridge.run(request=run_request)
    except AgentNotFoundError as exc:
        return _error_response(
            status.HTTP_404_NOT_FOUND,
            build_agent_not_found_error(
                agent_name=exc.agent_name,
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
            ),
        )
    except BoundAgentMismatchError as exc:
        return _error_response(
            status.HTTP_409_CONFLICT,
            build_agent_mismatch_error(
                session_id=exc.session_id,
                bound_agent_id=exc.expected_agent_id,
                requested_agent_id=exc.actual_agent_id,
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
            ),
        )
    except ModelNotConfiguredError as exc:
        return _error_response(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            build_model_not_configured_error(
                message=str(exc),
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
            ),
        )
    except InvalidSessionHistoryError as exc:
        return _error_response(
            status.HTTP_409_CONFLICT,
            build_invalid_message_history_error(
                message=str(exc),
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
            ),
        )
    except AgentExecutionError as exc:
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            build_agent_execution_failed_error(
                message=str(exc),
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
            ),
        )
    except Exception as exc:  # pragma: no cover - defensive fallback
        return _error_response(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            build_agent_execution_failed_error(
                message=f"Unexpected agent execution failure: {exc}",
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
            ),
        )

    session = scaffold.build_session_descriptor(
        session=bridge_result.session,
        newly_created=bridge_result.newly_created,
    )
    result = scaffold.build_run_result(
        request=run_request,
        assistant_text=bridge_result.assistant_text,
        session=session,
    )
    assistant_message_id = f"{run_request.run_id}:assistant"
    return _stream_runtime_events(
        scaffold.build_run_events(
            request=run_request,
            result=result,
            assistant_message_id=assistant_message_id,
        )
    )


def _stream_runtime_run_events(events: AsyncIterable[RuntimeRunEvent]) -> StreamingResponse:
    return StreamingResponse(
        encode_runtime_run_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def _stream_runtime_events(events: Iterable[dict[str, Any]]) -> StreamingResponse:
    return StreamingResponse(
        _encode_sse_events(events),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


def _encode_sse_events(events: Iterable[dict[str, Any]]) -> Iterable[str]:
    for event in events:
        yield f"data: {json.dumps(event)}\n\n"


def _error_response(status_code: int, error: RuntimeErrorResponse) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error.to_dict())
