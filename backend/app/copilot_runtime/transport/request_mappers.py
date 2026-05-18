"""Request parsing and request-context helpers for Copilot runtime HTTP transport."""

from __future__ import annotations

from typing import Any

from fastapi import Request

from ..protocol import RuntimeProtocolParser


async def read_runtime_payload(
    *,
    parser: RuntimeProtocolParser,
    request: Request,
) -> tuple[dict[str, Any] | None, str]:
    payload = await parser.read_payload(request)
    requested_method = parser.extract_method(payload)
    request.state.copilot_runtime_requested_method = requested_method
    return payload, requested_method


def set_runtime_request_context(
    request: Request,
    *,
    runtime_method: str | None = None,
    thread_id: str | None = None,
    agent_id: str | None = None,
    run_id: str | None = None,
    phase: str | None = None,
) -> None:
    set_request_state_text(request, "copilot_runtime_requested_method", runtime_method)
    set_request_state_text(request, "copilot_runtime_thread_id", thread_id)
    set_request_state_text(request, "copilot_runtime_session_id", thread_id)
    set_request_state_text(request, "copilot_runtime_agent_id", agent_id)
    set_request_state_text(request, "copilot_runtime_run_id", run_id)
    set_request_state_text(request, "copilot_runtime_phase", phase)


def ensure_runtime_request_id(request: Request) -> str:
    existing_request_id = get_request_state_text(request, "copilot_runtime_request_id")
    if existing_request_id is not None:
        return existing_request_id
    from uuid import uuid4

    generated_request_id = uuid4().hex
    request.state.copilot_runtime_request_id = generated_request_id
    request.scope["copilot_runtime_request_id"] = generated_request_id
    return generated_request_id


def set_request_state_text(request: Request, attr_name: str, value: str | None) -> None:
    if value is None or value == "":
        return
    setattr(request.state, attr_name, value)
    request.scope[attr_name] = value


def get_request_state_text(request: Request, attr_name: str) -> str | None:
    value = getattr(request.state, attr_name, None)
    if isinstance(value, str) and value != "":
        return value
    scope_value = request.scope.get(attr_name)
    if isinstance(scope_value, str) and scope_value != "":
        return scope_value
    return None


__all__ = [
    "ensure_runtime_request_id",
    "get_request_state_text",
    "read_runtime_payload",
    "set_request_state_text",
    "set_runtime_request_context",
]
