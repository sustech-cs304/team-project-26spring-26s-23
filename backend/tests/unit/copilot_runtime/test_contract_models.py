from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.copilot_runtime.contracts import (
    RuntimeCapabilitiesGetRequest,
    RuntimeRunStartResponse,
    RuntimeRunView,
    RuntimeThreadCreateRequest,
    RuntimeToolApprovalResolveRequest,
)
from app.copilot_runtime.model_routes import RuntimeModelRoute
from app.copilot_runtime.run_events import RuntimeRunEvent


def test_runtime_simple_request_models_accept_protocol_aliases() -> None:
    thread_create = RuntimeThreadCreateRequest.model_validate({"agentId": "default"})
    capabilities = RuntimeCapabilitiesGetRequest.model_validate(
        {
            "sessionId": "session-1",
            "toolPermissionPolicy": {
                "schemaVersion": 1,
                "defaultMode": "ask",
                "toolModes": {"tool.file-convert": "allow"},
            },
        }
    )
    approval = RuntimeToolApprovalResolveRequest.model_validate(
        {
            "runId": "run-1",
            "toolCallId": "call-1",
            "decision": "approved",
        }
    )

    assert thread_create.agent_id == "default"
    assert thread_create.to_dict() == {"agent_id": "default"}
    assert capabilities.session_id == "session-1"
    assert capabilities.tool_permission_policy is not None
    assert capabilities.tool_permission_policy.to_dict() == {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {"tool.file-convert": "allow"},
        "toolTimeoutSeconds": {},
        "toolTimeoutActions": {},
    }
    assert approval.to_dict() == {
        "run_id": "run-1",
        "tool_call_id": "call-1",
        "decision": "approved",
    }


def test_runtime_model_route_accepts_alias_input_and_preserves_public_shape() -> None:
    route = RuntimeModelRoute.model_validate(
        {
            "providerProfileId": "provider-1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
            "catalogRevision": "2026-04-06-provider-catalog-v1",
        }
    )

    assert route.provider_profile_id == "provider-1"
    assert route.route_ref.profile_id == "provider-1"
    assert route.to_dict() == {
        "routeRef": {
            "routeKind": "provider-model",
            "profileId": "provider-1",
            "modelId": "gpt-4.1",
        },
        "catalogRevision": "2026-04-06-provider-catalog-v1",
    }


def test_runtime_model_route_rejects_mismatched_route_ref_profile() -> None:
    with pytest.raises(ValidationError) as exc_info:
        RuntimeModelRoute.model_validate(
            {
                "providerProfileId": "provider-1",
                "routeRef": {
                    "routeKind": "provider-model",
                    "profileId": "provider-2",
                    "modelId": "gpt-4.1",
                },
            }
        )

    assert "must match route_ref.profile_id" in str(exc_info.value)


def test_runtime_response_and_event_models_preserve_existing_serialized_shape() -> None:
    response = RuntimeRunStartResponse(
        ok=True,
        run=RuntimeRunView(
            runId="run-1",
            threadId="thread-1",
            status="streaming",
            createdAt=datetime(2026, 4, 19, 9, 0, tzinfo=UTC),
            updatedAt=datetime(2026, 4, 19, 9, 1, tzinfo=UTC),
        ),
        assistantMessageId="run-1:assistant",
        stream={"method": "run/stream", "body": {"runId": "run-1"}},
        cancel={"method": "run/cancel", "body": {"runId": "run-1"}},
    )
    event = RuntimeRunEvent(
        type="run_started",
        runId="run-1",
        sessionId="thread-1",
        sequence=1,
        payload={"assistantMessageId": "run-1:assistant"},
    )

    assert response.to_dict() == {
        "ok": True,
        "run": {
            "runId": "run-1",
            "threadId": "thread-1",
            "status": "streaming",
            "createdAt": "2026-04-19T09:00:00+00:00",
            "updatedAt": "2026-04-19T09:01:00+00:00",
            "startedAt": None,
            "terminalAt": None,
            "cancelRequested": False,
            "requestedThinkingSelection": None,
            "appliedThinkingSelection": None,
            "thinkingCapabilitySnapshot": None,
            "thinkingSeriesDecision": None,
            "reasoningSuppressionBasis": None,
        },
        "assistantMessageId": "run-1:assistant",
        "stream": {"method": "run/stream", "body": {"runId": "run-1"}},
        "cancel": {"method": "run/cancel", "body": {"runId": "run-1"}},
    }
    assert event.to_dict() == {
        "type": "run_started",
        "runId": "run-1",
        "sessionId": "thread-1",
        "sequence": 1,
        "payload": {"assistantMessageId": "run-1:assistant"},
    }
