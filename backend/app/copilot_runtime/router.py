"""FastAPI router for the phase-1 Copilot runtime scaffold."""

from __future__ import annotations

from json import JSONDecodeError
from typing import Any, TypeAlias

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from .contracts import INFO_METHOD, RuntimeScaffold
from .errors import build_invalid_request_error, build_method_not_implemented_error

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


def build_router(scaffold: RuntimeScaffold) -> APIRouter:
    router = APIRouter()

    @router.post("/")
    async def handle_runtime_root(request: Request) -> JSONResponse:
        payload = await _read_payload(request, scaffold)
        if isinstance(payload, JSONResponse):
            return payload

        requested_method = _extract_method(payload, scaffold)
        if isinstance(requested_method, JSONResponse):
            return requested_method

        if requested_method == INFO_METHOD:
            return JSONResponse(content=scaffold.build_info_response().to_dict())

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



def _infer_implicit_method(payload: dict[str, Any]) -> str | None:
    if any(key in payload for key in RUN_LIKE_REQUEST_KEYS):
        return "run"
    return None
