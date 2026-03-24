"""FastAPI router for the minimal Copilot runtime run bridge."""

from __future__ import annotations

import json
from json import JSONDecodeError
from typing import Any, Iterable, TypeAlias

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from .bridge import AgentExecutionError, InvalidSessionHistoryError, ModelNotConfiguredError, RuntimeBridge
from .contracts import (
    AGENT_CONNECT_METHOD,
    AGENT_RUN_METHOD,
    INFO_METHOD,
    RuntimeConnectRequest,
    RuntimeRunRequest,
    RuntimeScaffold,
)
from .errors import (
    RuntimeErrorResponse,
    build_agent_execution_failed_error,
    build_agent_not_found_error,
    build_invalid_message_history_error,
    build_invalid_request_error,
    build_method_not_implemented_error,
    build_model_not_configured_error,
    build_unsupported_message_shape_error,
)
from .session_store import InMemorySessionStore

INFO_REQUEST_KEYS = frozenset({"properties", "frontendUrl", "method"})
RUN_LIKE_REQUEST_KEYS = frozenset(
    {
        "threadId",
        "runId",
        "messages",
        "state",
        "actions",
        "metaEvents",
        "nodeName",
        "agentName",
        "name",
    }
)

PayloadResult: TypeAlias = dict[str, Any] | None | JSONResponse
MethodResult: TypeAlias = str | JSONResponse
ConnectRequestResult: TypeAlias = RuntimeConnectRequest | JSONResponse
RunRequestResult: TypeAlias = RuntimeRunRequest | JSONResponse


def build_router(
    scaffold: RuntimeScaffold,
    session_store: InMemorySessionStore,
    runtime_bridge: RuntimeBridge,
) -> APIRouter:
    router = APIRouter()

    @router.post("/", response_model=None)
    async def handle_runtime_root(request: Request) -> JSONResponse | StreamingResponse:
        payload = await _read_payload(request, scaffold)
        if isinstance(payload, JSONResponse):
            return payload

        requested_method = _extract_method(payload, scaffold)
        if isinstance(requested_method, JSONResponse):
            return requested_method

        if requested_method == INFO_METHOD:
            return JSONResponse(content=scaffold.build_info_response().to_dict())

        if requested_method == AGENT_CONNECT_METHOD:
            connect_request = _extract_connect_request(payload, scaffold)
            if isinstance(connect_request, JSONResponse):
                return connect_request

            session_record, newly_created = session_store.get_or_create(
                thread_id=connect_request.thread_id,
                agent_name=connect_request.agent_name,
                metadata={"last_connect_run_id": connect_request.run_id},
            )
            session = scaffold.build_session_descriptor(
                session=session_record,
                newly_created=newly_created,
            )
            result = scaffold.build_connect_result(request=connect_request, session=session)
            return StreamingResponse(
                _encode_sse_events(scaffold.build_connect_events(request=connect_request, result=result)),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache"},
            )

        if requested_method == AGENT_RUN_METHOD:
            run_request = _extract_run_request(payload, scaffold)
            if isinstance(run_request, JSONResponse):
                return run_request

            try:
                bridge_result = await runtime_bridge.run(request=run_request)
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
            return StreamingResponse(
                _encode_sse_events(
                    scaffold.build_run_events(
                        request=run_request,
                        result=result,
                        assistant_message_id=assistant_message_id,
                    )
                ),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache"},
            )

        error = build_method_not_implemented_error(
            requested_method=requested_method,
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_501_NOT_IMPLEMENTED, error)

    return router


async def _read_payload(request: Request, scaffold: RuntimeScaffold) -> PayloadResult:
    raw_body = await request.body()
    if raw_body == b"":
        return None

    try:
        payload = await request.json()
    except JSONDecodeError:
        error = build_invalid_request_error(
            message="Runtime request body must be valid JSON.",
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    if payload is None:
        return None

    if not isinstance(payload, dict):
        error = build_invalid_request_error(
            message="Runtime request body must be a JSON object.",
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    return payload


def _extract_method(payload: dict[str, Any] | None, scaffold: RuntimeScaffold) -> MethodResult:
    if payload is None or payload == {}:
        return INFO_METHOD

    request_keys = set(payload)
    if request_keys.issubset(INFO_REQUEST_KEYS) and request_keys <= {"properties", "frontendUrl"}:
        return INFO_METHOD

    method = payload.get("method")
    if method is None:
        inferred_method = _infer_implicit_method(payload)
        if inferred_method is not None:
            return inferred_method

        error = build_invalid_request_error(
            message=(
                "Runtime request must provide a supported info shape or an explicit 'method' field."
            ),
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    if not isinstance(method, str):
        error = build_invalid_request_error(
            message="Runtime request field 'method' must be a non-empty string.",
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    normalized_method = method.strip().lower()
    if normalized_method == "":
        error = build_invalid_request_error(
            message="Runtime request field 'method' must be a non-empty string.",
            scaffold=scaffold,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    if normalized_method == "run":
        return AGENT_RUN_METHOD

    return normalized_method


def _extract_connect_request(
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
) -> ConnectRequestResult:
    if payload is None:
        error = build_invalid_request_error(
            message="Runtime method 'agent/connect' requires a JSON payload.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    params = _extract_params(payload, scaffold, requested_method=AGENT_CONNECT_METHOD)
    if isinstance(params, JSONResponse):
        return params

    connect_body = _extract_body(payload, scaffold, requested_method=AGENT_CONNECT_METHOD)
    if isinstance(connect_body, JSONResponse):
        return connect_body

    agent_name = _resolve_agent_name(
        payload,
        params,
        connect_body,
        scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(agent_name, JSONResponse):
        return agent_name

    thread_id = _require_non_empty_string(
        connect_body.get("threadId"),
        field_name="threadId",
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(thread_id, JSONResponse):
        return thread_id

    run_id = _require_non_empty_string(
        connect_body.get("runId"),
        field_name="runId",
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(run_id, JSONResponse):
        return run_id

    messages = _require_list_of_objects(
        connect_body.get("messages"),
        field_name="messages",
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(messages, JSONResponse):
        return messages

    tools = _optional_list_of_objects(
        connect_body.get("tools"),
        field_name="tools",
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(tools, JSONResponse):
        return tools

    context = _optional_list_of_objects(
        connect_body.get("context"),
        field_name="context",
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(context, JSONResponse):
        return context

    forwarded_props = _optional_object(
        connect_body.get("forwardedProps"),
        field_name="forwardedProps",
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    if isinstance(forwarded_props, JSONResponse):
        return forwarded_props

    return RuntimeConnectRequest(
        agent_name=agent_name,
        thread_id=thread_id,
        run_id=run_id,
        state=connect_body.get("state", {}),
        messages=messages,
        tools=tools,
        context=context,
        forwarded_props=forwarded_props,
        metadata={},
    )


def _extract_run_request(
    payload: dict[str, Any] | None,
    scaffold: RuntimeScaffold,
) -> RunRequestResult:
    if payload is None:
        error = build_invalid_request_error(
            message="Runtime method 'agent/run' requires a JSON payload.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    params = _extract_params(payload, scaffold, requested_method=AGENT_RUN_METHOD)
    if isinstance(params, JSONResponse):
        return params

    run_body = _extract_body(payload, scaffold, requested_method=AGENT_RUN_METHOD)
    if isinstance(run_body, JSONResponse):
        return run_body

    agent_name = _resolve_agent_name(
        payload,
        params,
        run_body,
        scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(agent_name, JSONResponse):
        return agent_name

    thread_id = _require_non_empty_string(
        run_body.get("threadId"),
        field_name="threadId",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(thread_id, JSONResponse):
        return thread_id

    run_id = _require_non_empty_string(
        run_body.get("runId"),
        field_name="runId",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(run_id, JSONResponse):
        return run_id

    messages = _require_list_of_objects(
        run_body.get("messages"),
        field_name="messages",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(messages, JSONResponse):
        return messages

    actions = _optional_list_of_objects(
        run_body.get("actions"),
        field_name="actions",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(actions, JSONResponse):
        return actions

    meta_events = _optional_list_of_objects(
        run_body.get("metaEvents"),
        field_name="metaEvents",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(meta_events, JSONResponse):
        return meta_events

    forwarded_props = _optional_object(
        run_body.get("forwardedProps"),
        field_name="forwardedProps",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
    )
    if isinstance(forwarded_props, JSONResponse):
        return forwarded_props

    node_name = run_body.get("nodeName")
    if node_name is not None and (not isinstance(node_name, str) or node_name.strip() == ""):
        error = build_invalid_request_error(
            message="Runtime request field 'nodeName' must be a non-empty string when provided.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": "nodeName"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    user_message_text = _extract_latest_user_message_text(messages, scaffold)
    if isinstance(user_message_text, JSONResponse):
        return user_message_text

    return RuntimeRunRequest(
        agent_name=agent_name,
        thread_id=thread_id,
        run_id=run_id,
        user_message_text=user_message_text,
        state=run_body.get("state", {}),
        messages=messages,
        actions=actions,
        meta_events=meta_events,
        node_name=node_name.strip() if isinstance(node_name, str) else None,
        forwarded_props=forwarded_props,
        metadata={},
    )


def _extract_params(
    payload: dict[str, Any],
    scaffold: RuntimeScaffold,
    *,
    requested_method: str,
) -> dict[str, Any] | JSONResponse:
    params = payload.get("params")
    if params is None:
        return {}
    if not isinstance(params, dict):
        error = build_invalid_request_error(
            message="Runtime request field 'params' must be an object when provided.",
            scaffold=scaffold,
            requested_method=requested_method,
            details={"field": "params"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)
    return dict(params)


def _extract_body(
    payload: dict[str, Any],
    scaffold: RuntimeScaffold,
    *,
    requested_method: str,
) -> dict[str, Any] | JSONResponse:
    raw_body = payload.get("body")
    request_body = payload if raw_body is None else raw_body
    if not isinstance(request_body, dict):
        error = build_invalid_request_error(
            message=f"Runtime request field 'body' must be an object for method '{requested_method}'.",
            scaffold=scaffold,
            requested_method=requested_method,
            details={"field": "body"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)
    return dict(request_body)


def _resolve_agent_name(
    payload: dict[str, Any],
    params: dict[str, Any],
    request_body: dict[str, Any],
    scaffold: RuntimeScaffold,
    *,
    requested_method: str,
) -> str | JSONResponse:
    raw_agent_name = params.get(
        "agentId",
        request_body.get(
            "agentName",
            request_body.get(
                "name",
                payload.get("agentName", payload.get("name", scaffold.default_agent)),
            ),
        ),
    )
    if not isinstance(raw_agent_name, str) or raw_agent_name.strip() == "":
        error = build_invalid_request_error(
            message="Runtime request must resolve a non-empty agent name.",
            scaffold=scaffold,
            requested_method=requested_method,
            details={"field": "agentId"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    agent_name = raw_agent_name.strip()
    if scaffold.supports_agent(agent_name):
        return agent_name

    error = build_agent_not_found_error(
        agent_name=agent_name,
        scaffold=scaffold,
        requested_method=requested_method,
    )
    return _error_response(status.HTTP_404_NOT_FOUND, error)


def _require_non_empty_string(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> str | JSONResponse:
    if not isinstance(value, str) or value.strip() == "":
        error = build_invalid_request_error(
            message=f"Runtime request field '{field_name}' must be a non-empty string.",
            scaffold=scaffold,
            requested_method=requested_method,
            details={"field": field_name},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)
    return value.strip()


def _require_list_of_objects(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> tuple[dict[str, Any], ...] | JSONResponse:
    if not isinstance(value, list):
        error = build_invalid_request_error(
            message=f"Runtime request field '{field_name}' must be an array of objects.",
            scaffold=scaffold,
            requested_method=requested_method,
            details={"field": field_name},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    normalized_items: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            error = build_invalid_request_error(
                message=(f"Runtime request field '{field_name}' must contain only JSON objects."),
                scaffold=scaffold,
                requested_method=requested_method,
                details={"field": f"{field_name}[{index}]"},
            )
            return _error_response(status.HTTP_400_BAD_REQUEST, error)
        normalized_items.append(dict(item))

    return tuple(normalized_items)


def _optional_list_of_objects(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> tuple[dict[str, Any], ...] | JSONResponse:
    if value is None:
        return ()
    return _require_list_of_objects(
        value,
        field_name=field_name,
        scaffold=scaffold,
        requested_method=requested_method,
    )


def _optional_object(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
    requested_method: str,
) -> dict[str, Any] | JSONResponse:
    if value is None:
        return {}
    if not isinstance(value, dict):
        error = build_invalid_request_error(
            message=f"Runtime request field '{field_name}' must be an object when provided.",
            scaffold=scaffold,
            requested_method=requested_method,
            details={"field": field_name},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)
    return dict(value)


def _extract_latest_user_message_text(
    messages: tuple[dict[str, Any], ...],
    scaffold: RuntimeScaffold,
) -> str | JSONResponse:
    if not messages:
        error = build_invalid_request_error(
            message="Runtime method 'agent/run' requires at least one message.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": "messages"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    for index, message in enumerate(messages):
        shape_result = _validate_supported_message_shape(message, index=index, scaffold=scaffold)
        if isinstance(shape_result, JSONResponse):
            return shape_result

    last_message = messages[-1]
    last_role = str(last_message["role"]).strip().lower()
    if last_role != "user":
        error = build_unsupported_message_shape_error(
            message="Runtime method 'agent/run' requires the last message to be a text user message.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": f"messages[{len(messages) - 1}]", "role": last_role},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    return _extract_user_text_content(
        last_message.get("content"),
        scaffold=scaffold,
        field_name=f"messages[{len(messages) - 1}].content",
    )


def _validate_supported_message_shape(
    message: dict[str, Any],
    *,
    index: int,
    scaffold: RuntimeScaffold,
) -> None | JSONResponse:
    role = message.get("role")
    if not isinstance(role, str) or role.strip() == "":
        error = build_invalid_request_error(
            message="Runtime run message role must be a non-empty string.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": f"messages[{index}].role"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    normalized_role = role.strip().lower()
    if normalized_role not in {"user", "assistant", "system", "developer"}:
        error = build_unsupported_message_shape_error(
            message=f"Runtime run message role '{normalized_role}' is not supported in the MVP text-only bridge.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": f"messages[{index}].role", "role": normalized_role},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    tool_calls = message.get("toolCalls", message.get("tool_calls"))
    if tool_calls not in (None, [], ()):  # pragma: no branch - simple MVP guard
        error = build_unsupported_message_shape_error(
            message="Runtime run does not support assistant tool calls in request messages.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": f"messages[{index}].toolCalls"},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)

    content = message.get("content")
    if normalized_role == "user":
        extracted = _extract_user_text_content(
            content,
            scaffold=scaffold,
            field_name=f"messages[{index}].content",
        )
        if isinstance(extracted, JSONResponse):
            return extracted
        return None

    if normalized_role in {"system", "developer"}:
        if not isinstance(content, str) or content.strip() == "":
            error = build_unsupported_message_shape_error(
                message=f"Runtime run message '{normalized_role}' must contain non-empty text content.",
                scaffold=scaffold,
                requested_method=AGENT_RUN_METHOD,
                details={"field": f"messages[{index}].content", "role": normalized_role},
            )
            return _error_response(status.HTTP_400_BAD_REQUEST, error)
        return None

    if content is None:
        return None
    if not isinstance(content, str):
        error = build_unsupported_message_shape_error(
            message="Runtime run assistant history must contain plain text content when provided.",
            scaffold=scaffold,
            requested_method=AGENT_RUN_METHOD,
            details={"field": f"messages[{index}].content", "role": normalized_role},
        )
        return _error_response(status.HTTP_400_BAD_REQUEST, error)
    return None


def _extract_user_text_content(
    content: Any,
    *,
    scaffold: RuntimeScaffold,
    field_name: str,
) -> str | JSONResponse:
    if isinstance(content, str):
        normalized_text = content.strip()
        if normalized_text != "":
            return normalized_text

    if isinstance(content, list):
        text_parts: list[str] = []
        for index, item in enumerate(content):
            if not isinstance(item, dict) or item.get("type") != "text":
                error = build_unsupported_message_shape_error(
                    message="Runtime run supports only text user message parts in the MVP bridge.",
                    scaffold=scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"{field_name}[{index}]"},
                )
                return _error_response(status.HTTP_400_BAD_REQUEST, error)
            text = item.get("text")
            if not isinstance(text, str) or text.strip() == "":
                error = build_unsupported_message_shape_error(
                    message="Runtime run text message parts must include a non-empty 'text' field.",
                    scaffold=scaffold,
                    requested_method=AGENT_RUN_METHOD,
                    details={"field": f"{field_name}[{index}].text"},
                )
                return _error_response(status.HTTP_400_BAD_REQUEST, error)
            text_parts.append(text.strip())
        if text_parts:
            return "\n".join(text_parts)

    error = build_unsupported_message_shape_error(
        message="Runtime run currently supports only non-empty text user messages.",
        scaffold=scaffold,
        requested_method=AGENT_RUN_METHOD,
        details={"field": field_name},
    )
    return _error_response(status.HTTP_400_BAD_REQUEST, error)


def _infer_implicit_method(payload: dict[str, Any]) -> str | None:
    body = payload.get("body")
    if any(key in payload for key in RUN_LIKE_REQUEST_KEYS):
        return AGENT_RUN_METHOD
    if isinstance(body, dict) and any(key in body for key in RUN_LIKE_REQUEST_KEYS):
        return AGENT_RUN_METHOD
    return None


def _encode_sse_events(events: Iterable[dict[str, Any]]) -> Iterable[str]:
    for event in events:
        yield f"data: {json.dumps(event)}\n\n"


def _error_response(status_code: int, error: RuntimeErrorResponse) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=error.to_dict())
