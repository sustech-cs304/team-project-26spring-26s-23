from __future__ import annotations

import pytest

from app.copilot_runtime import build_runtime_scaffold
from app.copilot_runtime.protocol import RuntimeProtocolError, RuntimeProtocolParser


def test_extract_method_recognizes_info_shape_without_explicit_method() -> None:
    parser = _build_parser()

    method = parser.extract_method(
        {
            "properties": {"mode": "desktop"},
            "frontendUrl": "http://localhost:5173",
        }
    )

    assert method == "info"


def test_extract_method_normalizes_legacy_run_alias_to_agent_run() -> None:
    parser = _build_parser()

    method = parser.extract_method({"method": "  Run  "})

    assert method == "agent/run"


def test_extract_session_create_request_validates_known_agent() -> None:
    parser = _build_parser()

    request = parser.extract_session_create_request(
        {
            "method": "session/create",
            "body": {"agentId": "default"},
        }
    )

    assert request.agent_id == "default"


def test_extract_session_create_request_unknown_agent_raises_structured_protocol_error() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_session_create_request(
            {
                "method": "session/create",
                "body": {"agentId": "missing-agent"},
            }
        )

    exc = exc_info.value
    assert exc.status_code == 404
    assert exc.error.error.code == "agent_not_found"
    assert exc.error.error.requestedMethod == "session/create"
    assert exc.error.error.details == {"agentName": "missing-agent"}


def test_extract_run_request_normalizes_latest_user_message_text_parts() -> None:
    parser = _build_parser()

    request = parser.extract_run_request(
        {
            "method": "agent/run",
            "params": {"agentId": "default"},
            "body": {
                "threadId": "thread-1",
                "runId": "run-1",
                "messages": [
                    {
                        "id": "assistant-1",
                        "role": "assistant",
                        "content": "Earlier reply",
                    },
                    {
                        "id": "user-1",
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "  hello  "},
                            {"type": "text", "text": "world "},
                        ],
                    },
                ],
                "state": {"mode": "chat"},
                "actions": [],
                "metaEvents": [],
                "forwardedProps": {},
            },
        }
    )

    assert request.agent_name == "default"
    assert request.thread_id == "thread-1"
    assert request.run_id == "run-1"
    assert request.user_message_text == "hello\nworld"
    assert request.state == {"mode": "chat"}


def test_extract_run_request_unknown_agent_raises_structured_protocol_error() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_run_request(
            {
                "method": "agent/run",
                "params": {"agentId": "missing-agent"},
                "body": {
                    "threadId": "thread-1",
                    "runId": "run-1",
                    "messages": [{"id": "user-1", "role": "user", "content": "Hello"}],
                    "state": {},
                    "actions": [],
                    "metaEvents": [],
                    "forwardedProps": {},
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 404
    assert exc.error.error.code == "agent_not_found"
    assert exc.error.error.requestedMethod == "agent/run"
    assert exc.error.error.details == {"agentName": "missing-agent"}


def test_extract_run_request_rejects_assistant_tool_calls_in_history() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_run_request(
            {
                "method": "agent/run",
                "params": {"agentId": "default"},
                "body": {
                    "threadId": "thread-1",
                    "runId": "run-1",
                    "messages": [
                        {
                            "id": "assistant-1",
                            "role": "assistant",
                            "content": "I called a tool.",
                            "toolCalls": [{"name": "search"}],
                        },
                        {"id": "user-1", "role": "user", "content": "Hello"},
                    ],
                    "state": {},
                    "actions": [],
                    "metaEvents": [],
                    "forwardedProps": {},
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "unsupported_message_shape"
    assert exc.error.error.requestedMethod == "agent/run"
    assert exc.error.error.details == {"field": "messages[0].toolCalls"}


def test_extract_connect_request_defaults_to_scaffold_agent_and_preserves_optional_fields() -> None:
    parser = _build_parser()

    request = parser.extract_connect_request(
        {
            "method": "agent/connect",
            "body": {
                "threadId": "thread-1",
                "runId": "run-1",
                "messages": [],
                "state": {"mode": "connect"},
                "tools": [{"name": "noop"}],
                "context": [{"kind": "preview"}],
                "forwardedProps": {"source": "desktop"},
            },
        }
    )

    assert request.agent_name == "default"
    assert request.thread_id == "thread-1"
    assert request.run_id == "run-1"
    assert request.state == {"mode": "connect"}
    assert request.messages == ()
    assert request.tools == ({"name": "noop"},)
    assert request.context == ({"kind": "preview"},)
    assert request.forwarded_props == {"source": "desktop"}


def _build_parser() -> RuntimeProtocolParser:
    return RuntimeProtocolParser(build_runtime_scaffold(model_configured=True))
