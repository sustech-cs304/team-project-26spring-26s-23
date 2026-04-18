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
from ..tool_approval_coordinator import ToolApprovalConflictError, ToolApprovalNotFoundError
from ..contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    GLOBAL_TOOL_CATALOG_GET_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    TOOL_APPROVAL_RESOLVE_METHOD,
    RuntimeScaffold,
)
from ..debug_log_store import DebugLogCategory, DebugLogLevel, RuntimeDebugLogWriter
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
    debug_event_logger: RuntimeDebugLogWriter | None = None,
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
                debug_event_logger=debug_event_logger,
            )

        if requested_method == RUN_STREAM_METHOD:
            return await _handle_run_stream_request(
                dependencies=dependencies,
                payload=payload,
                http_request=request,
                debug_event_logger=debug_event_logger,
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

        if requested_method == GLOBAL_TOOL_CATALOG_GET_METHOD:
            return _handle_global_tool_catalog_get_request(
                dependencies=dependencies,
                payload=payload,
            )

        if requested_method == THINKING_CAPABILITY_GET_METHOD:
            return await _handle_thinking_capability_get_request(
                dependencies=dependencies,
                payload=payload,
            )

        if requested_method == TOOL_APPROVAL_RESOLVE_METHOD:
            return _handle_tool_approval_resolve_request(
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
    debug_event_logger: RuntimeDebugLogWriter | None = None,
) -> JSONResponse:
    request_id = ensure_runtime_request_id(http_request)
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
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.INFO,
            event_name="transport.http.run_start.received",
            message="Runtime HTTP run/start request received.",
            operation="run_start",
            phase="received",
            request_id=request_id,
            thread_id=run_start_request.thread_id,
            session_id=run_start_request.thread_id,
            summary={
                "runtimeMethod": RUN_START_METHOD,
                "agentId": run_start_request.agent_id,
                "path": str(http_request.url.path),
                "status": "received",
            },
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
            request_id=request_id,
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
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.INFO,
            event_name="transport.http.run_start.succeeded",
            message="Runtime HTTP run/start request completed.",
            operation="run_start",
            phase="response",
            request_id=request_id,
            run_id=run.run_id,
            thread_id=run.thread_id,
            session_id=run.thread_id,
            summary={
                "runtimeMethod": RUN_START_METHOD,
                "status": "succeeded",
                "responseStatusCode": json_response.status_code,
            },
        )
    except RuntimeProtocolError as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.WARN,
            event_name="transport.http.run_start.failed",
            message="Runtime HTTP run/start request failed protocol validation.",
            operation="run_start",
            phase="protocol_error",
            request_id=request_id,
            summary={"runtimeMethod": RUN_START_METHOD, "status": "failed"},
            error=exc,
        )
        return protocol_error_response(exc)
    except ThreadNotFoundError as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.WARN,
            event_name="transport.http.run_start.failed",
            message="Runtime HTTP run/start request referenced a missing thread.",
            operation="run_start",
            phase="thread_lookup",
            request_id=request_id,
            thread_id=exc.thread_id,
            session_id=exc.thread_id,
            summary={"runtimeMethod": RUN_START_METHOD, "status": "failed"},
            error=exc,
        )
        return thread_not_found_response(
            thread_id=exc.thread_id,
            scaffold=dependencies.scaffold,
            requested_method=RUN_START_METHOD,
        )
    except AgentNotFoundError as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.WARN,
            event_name="transport.http.run_start.failed",
            message="Runtime HTTP run/start request referenced a missing agent.",
            operation="run_start",
            phase="agent_lookup",
            request_id=request_id,
            summary={"runtimeMethod": RUN_START_METHOD, "agentId": exc.agent_name, "status": "failed"},
            error=exc,
        )
        return agent_not_found_response(
            agent_name=exc.agent_name,
            scaffold=dependencies.scaffold,
            requested_method=RUN_START_METHOD,
        )
    except Exception as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.ERROR,
            event_name="transport.http.run_start.failed",
            message="Runtime HTTP run/start request failed unexpectedly.",
            operation="run_start",
            phase=get_request_state_text(http_request, "copilot_runtime_phase") or "unknown",
            request_id=request_id,
            run_id=get_request_state_text(http_request, "copilot_runtime_run_id"),
            thread_id=get_request_state_text(http_request, "copilot_runtime_thread_id"),
            session_id=get_request_state_text(http_request, "copilot_runtime_session_id"),
            summary={"runtimeMethod": RUN_START_METHOD, "status": "failed"},
            error=exc,
        )
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
    debug_event_logger: RuntimeDebugLogWriter | None = None,
) -> JSONResponse | StreamingResponse:
    request_id = ensure_runtime_request_id(http_request)
    try:
        run_stream_request = dependencies.parser.extract_run_stream_request(payload)
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.INFO,
            event_name="transport.http.run_stream.received",
            message="Runtime HTTP run/stream request received.",
            operation="run_stream",
            phase="received",
            request_id=request_id,
            run_id=run_stream_request.run_id,
            summary={"runtimeMethod": RUN_STREAM_METHOD, "status": "received"},
        )
        events = dependencies.runtime_bridge.stream_run(
            run_id=run_stream_request.run_id,
            is_client_disconnected=http_request.is_disconnected,
        )
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.INFO,
            event_name="transport.http.run_stream.succeeded",
            message="Runtime HTTP run/stream response opened.",
            operation="run_stream",
            phase="response",
            request_id=request_id,
            run_id=run_stream_request.run_id,
            summary={"runtimeMethod": RUN_STREAM_METHOD, "status": "streaming"},
        )
        return stream_runtime_run_events(events)
    except RuntimeProtocolError as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.WARN,
            event_name="transport.http.run_stream.failed",
            message="Runtime HTTP run/stream request failed protocol validation.",
            operation="run_stream",
            phase="protocol_error",
            request_id=request_id,
            summary={"runtimeMethod": RUN_STREAM_METHOD, "status": "failed"},
            error=exc,
        )
        return protocol_error_response(exc)
    except RunNotFoundError as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.WARN,
            event_name="transport.http.run_stream.failed",
            message="Runtime HTTP run/stream request referenced a missing run.",
            operation="run_stream",
            phase="run_lookup",
            request_id=request_id,
            run_id=exc.run_id,
            summary={"runtimeMethod": RUN_STREAM_METHOD, "status": "failed"},
            error=exc,
        )
        return run_not_found_response(
            run_id=exc.run_id,
            scaffold=dependencies.scaffold,
            requested_method=RUN_STREAM_METHOD,
        )
    except RuntimeError as exc:
        _write_transport_event(
            debug_event_logger,
            level=DebugLogLevel.ERROR,
            event_name="transport.http.run_stream.failed",
            message="Runtime HTTP run/stream request failed before streaming started.",
            operation="run_stream",
            phase="stream_setup",
            request_id=request_id,
            summary={"runtimeMethod": RUN_STREAM_METHOD, "status": "failed"},
            error=exc,
        )
        return agent_execution_failed_response(
            message=str(exc),
            scaffold=dependencies.scaffold,
            requested_method=RUN_STREAM_METHOD,
        )


def _write_transport_event(
    logger: RuntimeDebugLogWriter | None,
    *,
    level: DebugLogLevel,
    event_name: str,
    message: str,
    operation: str,
    phase: str,
    summary: dict[str, Any],
    request_id: str | None = None,
    run_id: str | None = None,
    thread_id: str | None = None,
    session_id: str | None = None,
    error: BaseException | None = None,
) -> None:
    if logger is None:
        return
    logger.write(
        category=DebugLogCategory.TRANSPORT,
        level=level,
        event_name=event_name,
        message=message,
        component="copilot_runtime.http_transport",
        operation=operation,
        phase=phase,
        request_id=request_id,
        run_id=run_id,
        thread_id=thread_id,
        session_id=session_id,
        summary=summary,
        error=error,
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



def _handle_tool_approval_resolve_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        approval_request = dependencies.parser.extract_tool_approval_resolve_request(payload)
        response = dependencies.runtime_bridge.resolve_tool_approval(request=approval_request)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)
    except ToolApprovalNotFoundError as exc:
        return run_not_found_response(
            run_id=exc.run_id,
            scaffold=dependencies.scaffold,
            requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
        )
    except ToolApprovalConflictError as exc:
        return runtime_operation_conflict_response(
            code="tool_approval_conflict",
            message=str(exc),
            scaffold=dependencies.scaffold,
            requested_method=TOOL_APPROVAL_RESOLVE_METHOD,
            details={
                "runId": exc.run_id,
                "toolCallId": exc.tool_call_id,
                "status": exc.status,
            },
        )

    return JSONResponse(content=response.to_dict())



def _handle_capabilities_get_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None,
) -> JSONResponse:
    try:
        capabilities_request = dependencies.parser.extract_capabilities_get_request(payload)
        capabilities = dependencies.runtime_bridge.get_capabilities(
            session_id=capabilities_request.session_id,
            tool_permission_policy=capabilities_request.tool_permission_policy,
        )
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



def _handle_global_tool_catalog_get_request(
    *,
    dependencies: RuntimeTransportDependencies,
    payload: dict[str, Any] | None = None,
) -> JSONResponse:
    try:
        language = dependencies.parser.extract_global_tool_catalog_get_request(payload)
    except RuntimeProtocolError as exc:
        return protocol_error_response(exc)

    return JSONResponse(
        content=dependencies.scaffold.build_global_tool_catalog_response(language=language).to_dict()
    )



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
