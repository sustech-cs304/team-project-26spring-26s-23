"""HTTP handler implementations for the Copilot runtime router."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..bridge import (
    AgentNotFoundError,
    RunNotFoundError,
    RuntimeBridge,
    SessionNotFoundError,
    ThreadNotFoundError,
)
from ..contracts import (
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
from ..model_routes import RuntimeModelRouteResolutionError
from ..protocol import RuntimeProtocolError
from ..provider_adapter_registry import RuntimeProviderAdapterError
from ..shared.dependencies import RuntimeTransportDependencies, build_runtime_transport_dependencies
from ..shared.errors import (
    agent_execution_failed_response,
    agent_not_found_response,
    method_not_implemented_response,
    protocol_error_response,
    run_not_found_response,
    runtime_operation_conflict_response,
    session_not_found_response,
    thread_not_found_response,
)
from .request_mappers import (
    ensure_runtime_request_id,
    get_request_state_text,
    read_runtime_payload,
    set_runtime_request_context,
)
from .response_mappers import (
    build_run_start_failed_event_name,
    handle_unexpected_run_start_exception,
    log_run_start_stage,
    stream_runtime_run_events,
)



def build_router(
    scaffold: RuntimeScaffold,
    runtime_bridge: RuntimeBridge,
) -> APIRouter:
    dependencies = build_runtime_transport_dependencies(scaffold, runtime_bridge)
    router = APIRouter()

    @router.post("/", response_model=None)
    async def handle_runtime_root(request: Request) -> JSONResponse | StreamingResponse:
        try:
            payload, requested_method = await read_runtime_payload(
                parser=dependencies.parser,
                request=request,
            )
        except RuntimeProtocolError as exc:
            return protocol_error_response(exc)

        if requested_method == AGENTS_LIST_METHOD:
            return JSONResponse(content=dependencies.scaffold.build_agents_list_response().to_dict())

        if requested_method == THREAD_CREATE_METHOD:
            return _handle_thread_create_request(
                dependencies=dependencies,
                payload=payload,
            )

        if requested_method == THREAD_GET_METHOD:
            return _handle_thread_get_request(
                dependencies=dependencies,
                payload=payload,
            )

        if requested_method == RUN_START_METHOD:
            return await _handle_run_start_request(
                dependencies=dependencies,
                payload=payload,
                http_request=request,
            )

        if requested_method == RUN_STREAM_METHOD:
            return await _handle_run_stream_request(
                dependencies=dependencies,
                payload=payload,
                http_request=request,
            )

        if requested_method == RUN_CANCEL_METHOD:
            return _handle_run_cancel_request(
                dependencies=dependencies,
                payload=payload,
            )

        if requested_method == CAPABILITIES_GET_METHOD:
            return _handle_capabilities_get_request(
                dependencies=dependencies,
                payload=payload,
            )

        if requested_method == THINKING_CAPABILITY_GET_METHOD:
            return await _handle_thinking_capability_get_request(
                dependencies=dependencies,
                payload=payload,
            )

        return method_not_implemented_response(
            requested_method=requested_method,
            scaffold=dependencies.scaffold,
        )

    return router



def _handle_thread_create_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        thread_create_request = dependencies.parser.extract_thread_create_request(payload)
        thread_record = dependencies.runtime_bridge.create_thread(agent_id=thread_create_request.agent_id)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except AgentNotFoundError as exc:
        return agent_not_found_response(
            agent_name=exc.agent_name,
            scaffold=dependencies.scaffold,
            requested_method=THREAD_CREATE_METHOD,
        )

    return JSONResponse(
        content=dependencies.scaffold.build_thread_create_response(thread=thread_record).to_dict()
    )



def _handle_thread_get_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        thread_get_request = dependencies.parser.extract_thread_get_request(payload)
        thread = dependencies.runtime_bridge.get_thread(thread_id=thread_get_request.thread_id)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except ThreadNotFoundError as exc:
        return thread_not_found_response(
            thread_id=exc.thread_id,
            scaffold=dependencies.scaffold,
            requested_method=THREAD_GET_METHOD,
        )
    except AgentNotFoundError as exc:
        return agent_not_found_response(
            agent_name=exc.agent_name,
            scaffold=dependencies.scaffold,
            requested_method=THREAD_GET_METHOD,
        )

    return JSONResponse(content=dependencies.scaffold.build_thread_get_response(thread=thread).to_dict())



async def _handle_run_start_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
    http_request: Request,
) -> JSONResponse:
    try:
        run_start_request = dependencies.parser.extract_run_start_request(payload)
        http_request.state.copilot_runtime_debug_mode_enabled = run_start_request.policy.debugModeEnabled
        set_runtime_request_context(
            http_request,
            runtime_method=RUN_START_METHOD,
            thread_id=run_start_request.thread_id,
            agent_id=run_start_request.agent_id,
            phase="create_run_record",
        )
        log_run_start_stage(http_request, "run_start.request_received")
        log_run_start_stage(http_request, "run_start.create_run_record.enter")
        run = dependencies.runtime_bridge.start_run(request=run_start_request)
        set_runtime_request_context(http_request, run_id=run.run_id)
        log_run_start_stage(http_request, "run_start.create_run_record.succeeded")
        set_runtime_request_context(http_request, phase="prime_run_metadata")
        log_run_start_stage(http_request, "run_start.prime_run_metadata.enter")
        run = await dependencies.runtime_bridge.prime_run_metadata(
            run_id=run.run_id,
            runtime_method=RUN_START_METHOD,
            request_id=ensure_runtime_request_id(http_request),
        )
        log_run_start_stage(http_request, "run_start.prime_run_metadata.succeeded")
        set_runtime_request_context(http_request, phase="build_run_start_response")
        log_run_start_stage(http_request, "run_start.build_run_start_response.enter")
        response = dependencies.scaffold.build_run_start_response(run=run)
        log_run_start_stage(http_request, "run_start.build_run_start_response.succeeded")
        set_runtime_request_context(http_request, phase="serialize_run_start_response")
        log_run_start_stage(http_request, "run_start.serialize_run_start_response.enter")
        serialized_response = response.to_dict()
        json_response = JSONResponse(content=serialized_response)
        log_run_start_stage(http_request, "run_start.serialize_run_start_response.succeeded")
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except ThreadNotFoundError as exc:
        return thread_not_found_response(
            thread_id=exc.thread_id,
            scaffold=dependencies.scaffold,
            requested_method=RUN_START_METHOD,
        )
    except AgentNotFoundError as exc:
        return agent_not_found_response(
            agent_name=exc.agent_name,
            scaffold=dependencies.scaffold,
            requested_method=RUN_START_METHOD,
        )
    except Exception as exc:
        log_run_start_stage(
            http_request,
            build_run_start_failed_event_name(
                get_request_state_text(http_request, "copilot_runtime_phase") or "unknown"
            ),
            exc=exc,
        )
        return handle_unexpected_run_start_exception(
            request=http_request,
            scaffold=dependencies.scaffold,
            exc=exc,
        )

    return json_response



async def _handle_run_stream_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
    http_request: Request,
) -> JSONResponse | StreamingResponse:
    try:
        run_stream_request = dependencies.parser.extract_run_stream_request(payload)
        events = dependencies.runtime_bridge.stream_run(
            run_id=run_stream_request.run_id,
            is_client_disconnected=http_request.is_disconnected,
        )
        return stream_runtime_run_events(events)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except RunNotFoundError as exc:
        return run_not_found_response(
            run_id=exc.run_id,
            scaffold=dependencies.scaffold,
            requested_method=RUN_STREAM_METHOD,
        )
    except RuntimeError as exc:
        return agent_execution_failed_response(
            message=str(exc),
            scaffold=dependencies.scaffold,
            requested_method=RUN_STREAM_METHOD,
        )



def _handle_run_cancel_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        run_cancel_request = dependencies.parser.extract_run_cancel_request(payload)
        run, cancel_accepted = dependencies.runtime_bridge.cancel_run(run_id=run_cancel_request.run_id)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except RunNotFoundError as exc:
        return run_not_found_response(
            run_id=exc.run_id,
            scaffold=dependencies.scaffold,
            requested_method=RUN_CANCEL_METHOD,
        )

    return JSONResponse(
        content=dependencies.scaffold.build_run_cancel_response(
            run=run,
            cancel_accepted=cancel_accepted,
        ).to_dict()
    )



def _handle_capabilities_get_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        capabilities_request = dependencies.parser.extract_capabilities_get_request(payload)
        capabilities = dependencies.runtime_bridge.get_capabilities(session_id=capabilities_request.session_id)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except SessionNotFoundError as exc:
        return session_not_found_response(
            session_id=exc.session_id,
            scaffold=dependencies.scaffold,
            requested_method=CAPABILITIES_GET_METHOD,
        )
    except AgentNotFoundError as exc:
        return agent_not_found_response(
            agent_name=exc.agent_name,
            scaffold=dependencies.scaffold,
            requested_method=CAPABILITIES_GET_METHOD,
        )

    return JSONResponse(content=capabilities.to_dict())



async def _handle_thinking_capability_get_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        thinking_request = dependencies.parser.extract_thinking_capability_get_request(payload)
        response = await dependencies.runtime_bridge.get_thinking_capability(
            session_id=thinking_request.session_id,
            model_route=thinking_request.model_route,
            thinking_capability_override=thinking_request.thinking_capability_override,
        )
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except SessionNotFoundError as exc:
        return session_not_found_response(
            session_id=exc.session_id,
            scaffold=dependencies.scaffold,
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )
    except AgentNotFoundError as exc:
        return agent_not_found_response(
            agent_name=exc.agent_name,
            scaffold=dependencies.scaffold,
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )
    except RuntimeModelRouteResolutionError as exc:
        return runtime_operation_conflict_response(
            code=exc.code,
            message=str(exc),
            scaffold=dependencies.scaffold,
            requested_method=THINKING_CAPABILITY_GET_METHOD,
            details=exc.details,
        )
    except RuntimeProviderAdapterError as exc:
        return runtime_operation_conflict_response(
            code=exc.code,
            message=str(exc),
            scaffold=dependencies.scaffold,
            requested_method=THINKING_CAPABILITY_GET_METHOD,
            details=exc.details,
        )
    except RuntimeError as exc:
        return agent_execution_failed_response(
            message=str(exc),
            scaffold=dependencies.scaffold,
            requested_method=THINKING_CAPABILITY_GET_METHOD,
        )

    return JSONResponse(content=response.to_dict())


__all__ = [
    "_handle_capabilities_get_request",
    "_handle_run_cancel_request",
    "_handle_run_start_request",
    "_handle_run_stream_request",
    "_handle_thinking_capability_get_request",
    "_handle_thread_create_request",
    "_handle_thread_get_request",
    "build_router",
]
