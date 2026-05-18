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
    assert request.tool_permission_policy is None



def test_extract_capabilities_get_request_reads_optional_tool_permission_policy() -> None:
    parser = _build_parser()

    request = parser.extract_capabilities_get_request(
        {
            "method": "capabilities/get",
            "body": {
                "sessionId": "session-123",
                "toolPermissionPolicy": {
                    "schemaVersion": 1,
                    "defaultMode": "allow",
                    "toolModes": {"tool.fs.read": "deny"},
                },
            },
        }
    )

    assert request.session_id == "session-123"
    assert request.tool_permission_policy is not None
    assert request.tool_permission_policy.to_dict() == {
        "schemaVersion": 1,
        "defaultMode": "allow",
        "toolModes": {"tool.fs.read": "deny"},
        "toolTimeoutSeconds": {},
        "toolTimeoutActions": {},
    }



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



def test_extract_global_tool_catalog_get_request_accepts_empty_body_object() -> None:
    parser = _build_parser()

    assert parser.extract_global_tool_catalog_get_request(
        {
            "method": "tools/catalog/get",
            "body": {},
        }
    ) is None



def test_extract_global_tool_catalog_get_request_reads_optional_language() -> None:
    parser = _build_parser()

    assert parser.extract_global_tool_catalog_get_request(
        {
            "method": "tools/catalog/get",
            "body": {"language": "en-US"},
        }
    ) == "en-US"



def test_extract_global_tool_catalog_get_request_requires_explicit_body_wrapper() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_global_tool_catalog_get_request(
            {
                "method": "tools/catalog/get",
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "tools/catalog/get"
    assert exc.error.error.details == {"field": "body"}



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
    thinking_selection = request.policy.resolve_thinking_selection()
    assert thinking_selection is not None
    assert thinking_selection.to_dict() == {
        "series": "compat-discrete-selection-v1",
        "value": {
            "valueType": "code",
            "code": "auto",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "自动",
        },
    }
    assert request.policy.enabledTools == ("tool.fs.read",)
    assert request.policy.toolPermissionPolicy is None
    assert request.policy.debugModeEnabled is True
    assert request.policy.requestOptions == {"temperature": 0.2}


def test_extract_run_start_request_accepts_optional_structured_message_payload() -> None:
    parser = _build_parser()

    request = parser.extract_run_start_request(
        {
            "method": "run/start",
            "body": {
                "threadId": "thread-123",
                "message": {
                    "role": "user",
                    "content": "已提交表单：请求课程表单\n课程编码: CS304",
                    "structuredPayload": {
                        "type": "inline_form_submission",
                        "formId": "course-form",
                        "values": {
                            "courseCode": "CS304",
                        },
                    },
                },
                "policy": _build_policy_payload(),
            },
        }
    )

    assert request.message.structuredPayload == {
        "type": "inline_form_submission",
        "formId": "course-form",
        "values": {
            "courseCode": "CS304",
        },
    }



def test_extract_run_start_request_accepts_series_based_budget_selection() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["thinkingSelection"] = {
        "series": "gemini-2.5-budget-v1",
        "value": {
            "valueType": "budget",
            "mode": "budget",
            "budgetTokens": 512,
            "labelZh": "512 Tokens",
        },
    }

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

    assert request.policy.thinkingSelection is not None
    assert request.policy.thinkingSelection.to_dict() == {
        "series": "gemini-2.5-budget-v1",
        "value": {
            "valueType": "budget",
            "code": None,
            "mode": "budget",
            "budgetTokens": 512,
            "labelZh": "512 Tokens",
        },
    }
    assert request.policy.resolve_thinking_level_intent() is None



def test_extract_run_start_request_rejects_removed_thinking_level_intent_entry() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["thinkingLevelIntent"] = "turbo"

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
    assert exc.error.error.details == {"field": "policy.thinkingLevelIntent"}
    assert "has been removed" in exc.error.error.message



def test_extract_run_start_request_rejects_legacy_snapshot_model_route_fields() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["modelRoute"] = {
        "routeRef": {
            "routeKind": "provider-model",
            "profileId": "provider-1",
            "modelId": "gpt-4.1",
        },
        "catalogRevision": "2026-04-06-provider-catalog-v1",
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



def test_extract_run_start_request_reads_tool_permission_policy() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["toolPermissionPolicy"] = {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {
            "tool.fs.read": "allow",
        },
    }

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

    assert request.policy.toolPermissionPolicy is not None
    assert request.policy.toolPermissionPolicy.to_dict() == {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {
            "tool.fs.read": "allow",
        },
        "toolTimeoutSeconds": {},
        "toolTimeoutActions": {},
    }


def test_extract_run_start_request_reads_delay_tool_permission_policy_timeout_fields() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["toolPermissionPolicy"] = {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {
            "tool.fs.read": "delay",
        },
        "toolTimeoutSeconds": {
            "tool.fs.read": 27,
        },
        "toolTimeoutActions": {
            "tool.fs.read": "deny",
        },
    }

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

    assert request.policy.toolPermissionPolicy is not None
    assert request.policy.toolPermissionPolicy.to_dict() == {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {
            "tool.fs.read": "delay",
        },
        "toolTimeoutSeconds": {
            "tool.fs.read": 27,
        },
        "toolTimeoutActions": {
            "tool.fs.read": "deny",
        },
    }


def test_extract_run_start_request_rejects_invalid_tool_timeout_seconds() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["toolPermissionPolicy"] = {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {"tool.fs.read": "delay"},
        "toolTimeoutSeconds": {"tool.fs.read": 0},
        "toolTimeoutActions": {"tool.fs.read": "deny"},
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

    assert exc_info.value.error.error.details == {"field": "policy.toolPermissionPolicy.toolTimeoutSeconds.tool.fs.read"}


@pytest.mark.parametrize(
    "timeout_value",
    ["abc", "1.5", "0", "-5", "   ", "15s"],
)
def test_extract_run_start_request_rejects_non_numeric_tool_timeout_seconds_strings(timeout_value: str) -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["toolPermissionPolicy"] = {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {"tool.fs.read": "delay"},
        "toolTimeoutSeconds": {"tool.fs.read": timeout_value},
        "toolTimeoutActions": {"tool.fs.read": "deny"},
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

    assert exc_info.value.error.error.details == {"field": "policy.toolPermissionPolicy.toolTimeoutSeconds.tool.fs.read"}


def test_extract_run_start_request_rejects_invalid_tool_timeout_action() -> None:
    parser = _build_parser()
    policy = _build_policy_payload()
    policy["toolPermissionPolicy"] = {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {"tool.fs.read": "delay"},
        "toolTimeoutSeconds": {"tool.fs.read": 27},
        "toolTimeoutActions": {"tool.fs.read": "later"},
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

    assert exc_info.value.error.error.details == {"field": "policy.toolPermissionPolicy.toolTimeoutActions.tool.fs.read"}



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



def test_extract_tool_approval_resolve_request_reads_payload() -> None:
    parser = _build_parser()

    request = parser.extract_tool_approval_resolve_request(
        {
            "method": "tool-approval/resolve",
            "body": {
                "runId": "run-123",
                "toolCallId": "call-123",
                "decision": "approved",
            },
        }
    )

    assert request.to_dict() == {
        "run_id": "run-123",
        "tool_call_id": "call-123",
        "decision": "approved",
    }



def test_extract_tool_approval_resolve_request_rejects_invalid_decision() -> None:
    parser = _build_parser()

    with pytest.raises(RuntimeProtocolError) as exc_info:
        parser.extract_tool_approval_resolve_request(
            {
                "method": "tool-approval/resolve",
                "body": {
                    "runId": "run-123",
                    "toolCallId": "call-123",
                    "decision": "maybe",
                },
            }
        )

    exc = exc_info.value
    assert exc.status_code == 400
    assert exc.error.error.code == "invalid_request"
    assert exc.error.error.requestedMethod == "tool-approval/resolve"
    assert exc.error.error.details == {"field": "decision"}



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
        "thinkingSelection": {
            "series": "compat-discrete-selection-v1",
            "value": {
                "valueType": "code",
                "code": "auto",
                "labelZh": "自动",
            },
        },
        "enabledTools": ["tool.fs.read"],
        "debugModeEnabled": True,
        "requestOptions": {"temperature": 0.2},
    }
