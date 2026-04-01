from __future__ import annotations

import pytest

from app.copilot_runtime import build_runtime_scaffold
from app.copilot_runtime.protocol import RuntimeProtocolError, RuntimeProtocolParser


def test_extract_method_requires_explicit_method_field() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_method(
            {
                "properties": {"mode": "desktop"},
                "frontendUrl": "http://localhost:5173",
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod is None



def test_extract_method_no_longer_normalizes_legacy_run_alias() -> None:
    parser = _build_parser()

    method = parser.extract_method({"method": "  Run  "})

    assert method == "run"


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



def test_extract_capabilities_get_request_reads_session_id() -> None:
    parser = _build_parser()

    request = parser.extract_capabilities_get_request(
        {
            "method": "capabilities/get",
            "body": {"sessionId": "session-123"},
        }
    )

    assert request.session_id == "session-123"



def test_extract_capabilities_get_request_requires_session_id() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_capabilities_get_request(
            {
                "method": "capabilities/get",
                "body": {},
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "capabilities/get"
    assert exc.error.error.details == {"field": "sessionId"}



def test_extract_message_send_request_reads_model_route_policy_fields() -> None:
    parser = _build_parser()

    request = parser.extract_message_send_request(
        {
            "method": "message/send",
            "body": {
                "sessionId": "session-123",
                "agent": "default",
                "message": {"role": "user", "content": "Hello"},
                "policy": {
                    "modelRoute": {
                        "providerProfileId": "provider-1",
                        "snapshot": {
                            "provider": "openai",
                            "endpointType": "openai-compatible",
                            "baseUrl": "https://example.com/v1",
                            "modelId": "gpt-4.1",
                        },
                    },
                    "enabledTools": ["tool.file-convert"],
                    "requestOptions": {"temperature": 0.2},
                },
            },
        }
    )

    assert request.session_id == "session-123"
    assert request.agent_id == "default"
    assert request.message.role == "user"
    assert request.message.content == "Hello"
    assert request.policy.modelRoute.provider_profile_id == "provider-1"
    assert request.policy.modelRoute.snapshot.provider == "openai"
    assert request.policy.modelRoute.snapshot.endpoint_type == "openai-compatible"
    assert request.policy.modelRoute.snapshot.base_url == "https://example.com/v1"
    assert request.policy.modelRoute.snapshot.model_id == "gpt-4.1"
    assert request.policy.enabledTools == ("tool.file-convert",)
    assert request.policy.requestOptions == {"temperature": 0.2}



def test_extract_message_send_request_requires_model_route_policy_object() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_message_send_request(
            {
                "method": "message/send",
                "body": {
                    "sessionId": "session-123",
                    "message": {"role": "user", "content": "Hello"},
                    "policy": {},
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "message/send"
    assert exc.error.error.details == {"field": "policy.modelRoute"}



def test_extract_message_send_request_requires_user_text_message() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_message_send_request(
            {
                "method": "message/send",
                "body": {
                    "sessionId": "session-123",
                    "message": {"role": "assistant", "content": "Nope"},
                    "policy": {
                        "modelRoute": {
                            "providerProfileId": "provider-1",
                            "snapshot": {
                                "provider": "openai",
                                "endpointType": "openai-compatible",
                                "baseUrl": "https://example.com/v1",
                                "modelId": "gpt-4.1",
                            },
                        }
                    },
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "unsupported_message_shape"
    assert exc.error.error.requestedMethod == "message/send"
    assert exc.error.error.details == {"field": "message.role", "role": "assistant"}



def test_extract_message_send_request_requires_explicit_body_wrapper() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_message_send_request(
            {
                "method": "message/send",
                "sessionId": "session-123",
                "message": {"role": "user", "content": "Hello"},
                "policy": {
                    "modelRoute": {
                        "providerProfileId": "provider-1",
                        "snapshot": {
                            "provider": "openai",
                            "endpointType": "openai-compatible",
                            "baseUrl": "https://example.com/v1",
                            "modelId": "gpt-4.1",
                        },
                    }
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "message/send"
    assert exc.error.error.details == {"field": "body"}



def _build_parser() -> RuntimeProtocolParser:
    return RuntimeProtocolParser(build_runtime_scaffold(model_configured=True))
