"""FastAPI router for the minimal Copilot runtime scaffold."""

from __future__ import annotations

import json
from json import JSONDecodeError
from typing import Any, Iterable, TypeAlias

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from .contracts import AGENT_CONNECT_METHOD, INFO_METHOD, RuntimeConnectRequest, RuntimeScaffold
from .errors import (
    build_agent_not_found_error,
    build_invalid_request_error,
    build_method_not_implemented_error,
)
from .session_store import InMemorySessionStore

INFO_REQUEST_KEYS = frozenset({"properties", "frontendUrl", "method"})
RUN_LIKE_REQUEST_KEYS = frozenset({
    "threadId",
    "runId",
    "messages",
    "state",
    "actions",
    "metaEvents",
    "nodeName",
    "agentName",
    "name",
})

PayloadResult: TypeAlias = dict[str, Any] | None | JSONResponse
MethodResult: TypeAlias = str | JSONResponse
ConnectRequestResult: TypeAlias = RuntimeConnectRequest | JSONResponse


def build_router(scaffold: RuntimeScaffold, session_store: InMemorySessionStore) -> APIRouter:
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

        error = build_method_not_implemented_error(
            requested_method=requested_method,
            scaffold=scaffold,
        )
        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content=error.to_dict(),
        )

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
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    if payload is None:
        return None

    if not isinstance(payload, dict):
        error = build_invalid_request_error(
            message="Runtime request body must be a JSON object.",
            scaffold=scaffold,
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

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
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    if not isinstance(method, str):
        error = build_invalid_request_error(
            message="Runtime request field 'method' must be a non-empty string.",
            scaffold=scaffold,
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    normalized_method = method.strip().lower()
    if normalized_method == "":
        error = build_invalid_request_error(
            message="Runtime request field 'method' must be a non-empty string.",
            scaffold=scaffold,
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

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
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    params = payload.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        error = build_invalid_request_error(
            message="Runtime request field 'params' must be an object when provided.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
            details={"field": "params"},
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    raw_body = payload.get("body")
    connect_body = payload if raw_body is None else raw_body
    if not isinstance(connect_body, dict):
        error = build_invalid_request_error(
            message="Runtime request field 'body' must be an object for method 'agent/connect'.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
            details={"field": "body"},
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    agent_name = _resolve_agent_name(payload, params, connect_body, scaffold)
    if isinstance(agent_name, JSONResponse):
        return agent_name

    thread_id = _require_non_empty_string(
        connect_body.get("threadId"),
        field_name="threadId",
        scaffold=scaffold,
    )
    if isinstance(thread_id, JSONResponse):
        return thread_id

    run_id = _require_non_empty_string(
        connect_body.get("runId"),
        field_name="runId",
        scaffold=scaffold,
    )
    if isinstance(run_id, JSONResponse):
        return run_id

    messages = _require_list_of_objects(
        connect_body.get("messages"),
        field_name="messages",
        scaffold=scaffold,
    )
    if isinstance(messages, JSONResponse):
        return messages

    tools = _optional_list_of_objects(
        connect_body.get("tools"),
        field_name="tools",
        scaffold=scaffold,
    )
    if isinstance(tools, JSONResponse):
        return tools

    context = _optional_list_of_objects(
        connect_body.get("context"),
        field_name="context",
        scaffold=scaffold,
    )
    if isinstance(context, JSONResponse):
        return context

    forwarded_props = connect_body.get("forwardedProps", {})
    if not isinstance(forwarded_props, dict):
        error = build_invalid_request_error(
            message="Runtime request field 'forwardedProps' must be an object when provided.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
            details={"field": "forwardedProps"},
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    return RuntimeConnectRequest(
        agent_name=agent_name,
        thread_id=thread_id,
        run_id=run_id,
        state=connect_body.get("state", {}),
        messages=messages,
        tools=tools,
        context=context,
        forwarded_props=dict(forwarded_props),
        metadata={},
    )


def _resolve_agent_name(
    payload: dict[str, Any],
    params: dict[str, Any],
    connect_body: dict[str, Any],
    scaffold: RuntimeScaffold,
) -> str | JSONResponse:
    raw_agent_name = params.get(
        "agentId",
        connect_body.get("agentName", payload.get("agentName", scaffold.default_agent)),
    )
    if not isinstance(raw_agent_name, str) or raw_agent_name.strip() == "":
        error = build_invalid_request_error(
            message="Runtime request must resolve a non-empty agent name.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
            details={"field": "agentId"},
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    agent_name = raw_agent_name.strip()
    if scaffold.supports_agent(agent_name):
        return agent_name

    error = build_agent_not_found_error(
        agent_name=agent_name,
        scaffold=scaffold,
        requested_method=AGENT_CONNECT_METHOD,
    )
    return JSONResponse(status_code=status.HTTP_404_NOT_FOUND, content=error.to_dict())


def _require_non_empty_string(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
) -> str | JSONResponse:
    if not isinstance(value, str) or value.strip() == "":
        error = build_invalid_request_error(
            message=f"Runtime request field '{field_name}' must be a non-empty string.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
            details={"field": field_name},
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())
    return value.strip()


def _require_list_of_objects(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
) -> tuple[dict[str, Any], ...] | JSONResponse:
    if not isinstance(value, list):
        error = build_invalid_request_error(
            message=f"Runtime request field '{field_name}' must be an array of objects.",
            scaffold=scaffold,
            requested_method=AGENT_CONNECT_METHOD,
            details={"field": field_name},
        )
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())

    normalized_items: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            error = build_invalid_request_error(
                message=(
                    f"Runtime request field '{field_name}' must contain only JSON objects."
                ),
                scaffold=scaffold,
                requested_method=AGENT_CONNECT_METHOD,
                details={"field": f"{field_name}[{index}]"},
            )
            return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content=error.to_dict())
        normalized_items.append(dict(item))

    return tuple(normalized_items)


def _optional_list_of_objects(
    value: Any,
    *,
    field_name: str,
    scaffold: RuntimeScaffold,
) -> tuple[dict[str, Any], ...] | JSONResponse:
    if value is None:
        return ()
    return _require_list_of_objects(value, field_name=field_name, scaffold=scaffold)


def _infer_implicit_method(payload: dict[str, Any]) -> str | None:
    if any(key in payload for key in RUN_LIKE_REQUEST_KEYS):
        return "run"
    return None


def _encode_sse_events(events: Iterable[dict[str, Any]]) -> Iterable[str]:
    for event in events:
        yield f"data: {json.dumps(event)}\n\n"
