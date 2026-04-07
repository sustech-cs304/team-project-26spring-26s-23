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



def test_extract_thread_create_request_validates_known_agent() -> None:
    parser = _build_parser()

    request = parser.extract_thread_create_request(
        {
            "method": "thread/create",
            "body": {"agentId": "default"},
        }
    )

    assert request.agent_id == "default"



def test_extract_thread_create_request_unknown_agent_raises_structured_protocol_error() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_thread_create_request(
            {
                "method": "thread/create",
                "body": {"agentId": "missing-agent"},
            }
        )

    exc = exc_info.value
    assert exc.status_code == 404
    assert exc.error.error.code == "agent_not_found"
    assert exc.error.error.requestedMethod == "thread/create"
    assert exc.error.error.details == {"agentName": "missing-agent"}



def test_extract_thread_get_request_reads_thread_id() -> None:
    parser = _build_parser()

    request = parser.extract_thread_get_request(
        {
            "method": "thread/get",
            "body": {"threadId": "thread-123"},
        }
    )

    assert request.thread_id == "thread-123"



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



def test_extract_run_start_request_reads_thread_message_and_policy_fields() -> None:
    parser = _build_parser()

    request = parser.extract_run_start_request(
        {
            "method": "run/start",
            "body": {
                "threadId": "thread-123",
                "agent": "default",
                "message": {"role": "user", "content": "Hello"},
                "policy": _build_policy_payload(),
            },
        }
    )

    assert request.thread_id == "thread-123"
    assert request.agent_id == "default"
    assert request.message.role == "user"
    assert request.message.content == "Hello"
    assert request.policy.modelRoute.provider_profile_id == "provider-1"
    assert request.policy.modelRoute.route_ref is not None
    assert request.policy.modelRoute.route_ref.route_kind == "provider-model"
    assert request.policy.modelRoute.route_ref.profile_id == "provider-1"
    assert request.policy.modelRoute.route_ref.model_id == "gpt-4.1"
    assert request.policy.modelRoute.catalog_revision == "2026-04-06-provider-catalog-v1"
    assert request.policy.thinkingLevelIntent == "auto"
    assert request.policy.enabledTools == ("tool.file-convert",)
    assert request.policy.debugModeEnabled is True
    assert request.policy.requestOptions == {"temperature": 0.2}



def test_extract_run_start_request_rejects_legacy_snapshot_model_route_fields() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["modelRoute"] = {
        **policy["modelRoute"],
        "snapshot": {
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
    }

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_run_start_request(
            {
                "method": "run/start",
                "body": {
                    "threadId": "thread-123",
                    "message": {"role": "user", "content": "Hello"},
                    "policy": policy,
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "run/start"
    assert exc.error.error.details == {"field": "policy.modelRoute.snapshot"}



def test_extract_run_start_request_leaves_debug_mode_unset_when_field_omitted() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy.pop("debugModeEnabled")

    request = parser.extract_run_start_request(
        {
            "method": "run/start",
            "body": {
                "threadId": "thread-123",
                "message": {"role": "user", "content": "Hello"},
                "policy": policy,
            },
        }
    )

    assert request.policy.debugModeEnabled is None



def test_extract_run_start_request_requires_model_route_policy_object() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_run_start_request(
            {
                "method": "run/start",
                "body": {
                    "threadId": "thread-123",
                    "message": {"role": "user", "content": "Hello"},
                    "policy": {},
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "run/start"
    assert exc.error.error.details == {"field": "policy.modelRoute"}



def test_extract_run_start_request_requires_user_text_message() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_run_start_request(
            {
                "method": "run/start",
                "body": {
                    "threadId": "thread-123",
                    "message": {"role": "assistant", "content": "Nope"},
                    "policy": _build_policy_payload(),
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "unsupported_message_shape"
    assert exc.error.error.requestedMethod == "run/start"
    assert exc.error.error.details == {"field": "message.role", "role": "assistant"}



def test_extract_run_stream_request_reads_run_id() -> None:
    parser = _build_parser()

    request = parser.extract_run_stream_request(
        {
            "method": "run/stream",
            "body": {"runId": "run-123"},
        }
    )

    assert request.run_id == "run-123"



def test_extract_run_cancel_request_reads_run_id() -> None:
    parser = _build_parser()

    request = parser.extract_run_cancel_request(
        {
            "method": "run/cancel",
            "body": {"runId": "run-123"},
        }
    )

    assert request.run_id == "run-123"



def test_extract_run_start_request_requires_explicit_body_wrapper() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_run_start_request(
            {
                "method": "run/start",
                "threadId": "thread-123",
                "message": {"role": "user", "content": "Hello"},
                "policy": _build_policy_payload(),
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "run/start"
    assert exc.error.error.details == {"field": "body"}



def _build_parser() -> RuntimeProtocolParser:
    return RuntimeProtocolParser(build_runtime_scaffold(model_configured=True))



def _build_policy_payload() -> dict[str, object]:
    return {
        "modelRoute": {
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
            "catalogRevision": "2026-04-06-provider-catalog-v1",
        },
        "thinkingLevelIntent": "auto",
        "enabledTools": ["tool.file-convert"],
        "debugModeEnabled": True,
        "requestOptions": {"temperature": 0.2},
    }
