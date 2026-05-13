from __future__ import annotations

import pytest

from app.desktop_runtime.capability_bridge_protocol import (
    DESKTOP_CAPABILITY_BRIDGE_REQUEST_ENVELOPE_SCHEMA,
    DESKTOP_CAPABILITY_BRIDGE_RESPONSE_ENVELOPE_SCHEMA,
    DESKTOP_CAPABILITY_NAMES,
    DESKTOP_CAPABILITY_OPERATIONS,
    DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY,
    DesktopCapabilityArtifactDescriptor,
    DesktopCapabilityBridgeError,
    DesktopCapabilityBridgeRequest,
    DesktopCapabilityBridgeResponse,
    get_desktop_capability_bridge_request_payload_schema,
    get_desktop_capability_bridge_result_schema,
    get_desktop_capability_operations,
    is_supported_desktop_capability_operation,
    validate_desktop_capability_bridge_payload,
    validate_desktop_capability_bridge_result,
)
from app.tooling.contract.results import ToolArtifactReference


def test_capability_bridge_protocol_covers_all_whitelisted_capabilities() -> None:
    assert DESKTOP_CAPABILITY_NAMES == (
        "secret",
        "workspace",
        "database",
        "artifact",
        "state",
        "event",
        "mcp",
        "browser",
    )
    assert DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY == {
        "secret": ("get_secret", "has_secret"),
        "workspace": ("resolve_path", "ensure_directory"),
        "database": ("resolve_path",),
        "artifact": ("save_text", "save_bytes", "describe_artifact"),
        "state": ("get_value", "put_value", "delete_value"),
        "event": ("emit_event",),
        "mcp": ("call_tool",),
        "browser": ("open", "screenshot"),
    }
    assert get_desktop_capability_operations("secret") == ("get_secret", "has_secret")
    assert get_desktop_capability_operations("workspace") == (
        "resolve_path",
        "ensure_directory",
    )
    assert get_desktop_capability_operations("database") == ("resolve_path",)
    assert get_desktop_capability_operations("artifact") == (
        "save_text",
        "save_bytes",
        "describe_artifact",
    )
    assert get_desktop_capability_operations("state") == (
        "get_value",
        "put_value",
        "delete_value",
    )
    assert get_desktop_capability_operations("event") == ("emit_event",)
    assert get_desktop_capability_operations("mcp") == ("call_tool",)
    assert get_desktop_capability_operations("browser") == ("open", "screenshot")
    assert {
        operation
        for operations in DESKTOP_CAPABILITY_OPERATIONS_BY_CAPABILITY.values()
        for operation in operations
    } == set(DESKTOP_CAPABILITY_OPERATIONS)
    assert (
        is_supported_desktop_capability_operation(
            capability="secret",
            operation="get_secret",
        )
        is True
    )
    assert (
        is_supported_desktop_capability_operation(
            capability="secret",
            operation="resolve_path",
        )
        is False
    )


def test_capability_bridge_envelopes_serialize_expected_shape() -> None:
    request = DesktopCapabilityBridgeRequest(
        request_id="request-1",
        capability="artifact",
        operation="save_text",
        tool_id="tool.snapshot-sync",
        run_id="run-1",
        tool_call_id="tool-call-1",
        payload={
            "name": " report.md ",
            "text": "",
            "contentType": " text/markdown ",
            "metadata": {"kind": "report"},
        },
    )
    result = validate_desktop_capability_bridge_result(
        capability="artifact",
        operation="save_text",
        result={
            "artifactId": "artifact-1",
            "name": "report.md",
            "contentType": "text/markdown",
            "uri": "artifact://report.md",
            "metadata": {"kind": "report"},
        },
    )
    response = DesktopCapabilityBridgeResponse.success(
        request_id="request-1",
        result=result,
    )

    assert request.to_dict() == {
        "requestId": "request-1",
        "capability": "artifact",
        "operation": "save_text",
        "toolId": "tool.snapshot-sync",
        "runId": "run-1",
        "toolCallId": "tool-call-1",
        "payload": {
            "name": "report.md",
            "text": "",
            "contentType": "text/markdown",
            "metadata": {"kind": "report"},
        },
    }
    assert response.to_dict() == {
        "requestId": "request-1",
        "ok": True,
        "result": {
            "artifactId": "artifact-1",
            "name": "report.md",
            "contentType": "text/markdown",
            "uri": "artifact://report.md",
            "metadata": {"kind": "report"},
        },
    }
    assert DESKTOP_CAPABILITY_BRIDGE_REQUEST_ENVELOPE_SCHEMA["required"] == [
        "requestId",
        "capability",
        "operation",
        "toolId",
        "runId",
        "toolCallId",
        "payload",
    ]
    assert DESKTOP_CAPABILITY_BRIDGE_RESPONSE_ENVELOPE_SCHEMA["required"] == [
        "requestId",
        "ok",
    ]


def test_capability_bridge_models_parse_wire_aliases_and_flat_error_shape() -> None:
    request = DesktopCapabilityBridgeRequest.model_validate(
        {
            "requestId": " request-2 ",
            "capability": " workspace ",
            "operation": " resolve_path ",
            "toolId": " tool.snapshot-sync ",
            "runId": " run-2 ",
            "toolCallId": " tool-call-2 ",
            "payload": {"relativePath": " docs/output "},
        }
    )
    failure_response = DesktopCapabilityBridgeResponse.model_validate(
        {
            "requestId": " request-2 ",
            "ok": False,
            "errorCode": "timeout",
            "errorMessage": " Host bridge timed out. ",
            "errorRetryable": True,
            "details": {"timeoutMs": 5000},
        }
    )

    assert request.to_dict() == {
        "requestId": "request-2",
        "capability": "workspace",
        "operation": "resolve_path",
        "toolId": "tool.snapshot-sync",
        "runId": "run-2",
        "toolCallId": "tool-call-2",
        "payload": {"relativePath": "docs/output"},
    }
    assert failure_response.to_dict() == {
        "requestId": "request-2",
        "ok": False,
        "errorCode": "timeout",
        "errorMessage": "Host bridge timed out.",
        "errorRetryable": True,
        "details": {"timeoutMs": 5000},
    }

    with pytest.raises(
        ValueError, match=r"response has unexpected fields: extra"
    ):
        DesktopCapabilityBridgeResponse.model_validate(
            {
                "requestId": "request-3",
                "ok": True,
                "extra": True,
            }
        )


def test_capability_bridge_schema_accessors_return_defensive_copies() -> None:
    request_schema = get_desktop_capability_bridge_request_payload_schema(
        capability="secret",
        operation="get_secret",
    )
    result_schema = get_desktop_capability_bridge_result_schema(
        capability="artifact",
        operation="describe_artifact",
    )

    request_schema["properties"]["secretName"]["minLength"] = 99
    result_schema["properties"]["artifactId"]["minLength"] = 99

    assert (
        get_desktop_capability_bridge_request_payload_schema(
            capability="secret",
            operation="get_secret",
        )["properties"]["secretName"]["minLength"]
        == 1
    )
    assert (
        get_desktop_capability_bridge_result_schema(
            capability="artifact",
            operation="describe_artifact",
        )["properties"]["artifactId"]["minLength"]
        == 1
    )


def test_payload_and_result_validation_enforce_operation_routing_and_invariants() -> (
    None
):
    assert validate_desktop_capability_bridge_payload(
        capability="workspace",
        operation="resolve_path",
        payload={"relativePath": " docs/output "},
    ) == {"relativePath": "docs/output"}
    assert validate_desktop_capability_bridge_payload(
        capability="database",
        operation="resolve_path",
        payload={"relativePath": " blackboard/snapshot.db "},
    ) == {"relativePath": "blackboard/snapshot.db"}
    assert validate_desktop_capability_bridge_result(
        capability="database",
        operation="resolve_path",
        result={"path": "database-root/blackboard/snapshot.db"},
    ) == {"path": "database-root/blackboard/snapshot.db"}
    assert validate_desktop_capability_bridge_result(
        capability="state",
        operation="get_value",
        result={"found": False, "value": None},
    ) == {"found": False, "value": None}
    assert validate_desktop_capability_bridge_payload(
        capability="mcp",
        operation="call_tool",
        payload={
            "serverId": " mcp-stdio-stub ",
            "remoteToolName": " search-campus ",
            "arguments": {"keyword": "library"},
            "snapshotRevision": 8,
        },
    ) == {
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "arguments": {"keyword": "library"},
        "snapshotRevision": 8,
    }
    assert validate_desktop_capability_bridge_result(
        capability="mcp",
        operation="call_tool",
        result={
            "ok": True,
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "content": [{"type": "text", "text": "search-campus completed"}],
            "structuredContent": {"echoedArguments": {"keyword": "library"}},
            "snapshotRevision": 8,
            "isError": False,
        },
    ) == {
        "ok": True,
        "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "content": [{"type": "text", "text": "search-campus completed"}],
        "structuredContent": {"echoedArguments": {"keyword": "library"}},
        "snapshotRevision": 8,
        "isError": False,
    }
    assert validate_desktop_capability_bridge_result(
        capability="mcp",
        operation="call_tool",
        result={
            "ok": False,
            "toolId": "mcp.missing.tool.00000000",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "missing-tool",
            "snapshotRevision": 8,
            "error": {
                "code": "directory_drift",
                "message": "The requested MCP tool no longer exists in the current snapshot.",
                "retryable": False,
                "observedAt": "2026-04-21T12:00:00.000Z",
                "details": {"snapshotRevision": 8},
            },
        },
    ) == {
        "ok": False,
        "toolId": "mcp.missing.tool.00000000",
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "missing-tool",
        "snapshotRevision": 8,
        "error": {
            "code": "directory_drift",
            "message": "The requested MCP tool no longer exists in the current snapshot.",
            "retryable": False,
            "observedAt": "2026-04-21T12:00:00.000Z",
            "details": {"snapshotRevision": 8},
        },
    }

    with pytest.raises(
        ValueError,
        match="Operation 'resolve_path' is not supported for capability 'secret'",
    ):
        validate_desktop_capability_bridge_payload(
            capability="secret",
            operation="resolve_path",
            payload={},
        )

    with pytest.raises(
        ValueError, match=r"payload has unexpected fields: channel"
    ):
        validate_desktop_capability_bridge_payload(
            capability="event",
            operation="emit_event",
            payload={
                "eventType": "tool.completed",
                "channel": "frontend-sse",
            },
        )

    assert validate_desktop_capability_bridge_result(
        capability="browser",
        operation="screenshot",
        result={
            "tabId": "browser-tab-1",
            "currentUrl": "https://example.com/",
            "title": "Example Domain",
            "windowVisible": False,
            "artifactId": "artifact-browser-screenshot",
            "uri": "artifact://desktop/browser-screenshot.png",
            "name": "browser-screenshot.png",
            "contentType": "image/png",
            "metadata": {"source": "browser.screenshot"},
        },
    ) == {
        "tabId": "browser-tab-1",
        "currentUrl": "https://example.com/",
        "title": "Example Domain",
        "windowVisible": False,
        "artifactId": "artifact-browser-screenshot",
        "uri": "artifact://desktop/browser-screenshot.png",
        "name": "browser-screenshot.png",
        "contentType": "image/png",
        "metadata": {"source": "browser.screenshot"},
    }


def test_state_get_value_result_rejects_non_null_value_when_not_found() -> None:
    with pytest.raises(
        ValueError,
        match="result field 'value' must be null when 'found' is false",
    ):
        validate_desktop_capability_bridge_result(
            capability="state",
            operation="get_value",
            result={
                "found": False,
                "value": {"unexpected": True},
            },
        )


def test_artifact_describe_result_requires_metadata() -> None:
    with pytest.raises(ValueError, match="Field required"):
        validate_desktop_capability_bridge_result(
            capability="artifact",
            operation="describe_artifact",
            result={
                "artifactId": "artifact-1",
                "name": "diagnostic.json",
                "contentType": "application/json",
                "uri": "artifact://diagnostic.json",
            },
        )


def test_artifact_descriptor_round_trips_with_tool_artifact_reference() -> None:
    descriptor = DesktopCapabilityArtifactDescriptor(
        artifact_id="artifact-1",
        name="diagnostic.json",
        content_type="application/json",
        uri="artifact://diagnostic.json",
        metadata={"kind": "diagnostic"},
    )

    reference = descriptor.to_tool_artifact_reference()
    restored = DesktopCapabilityArtifactDescriptor.from_tool_artifact_reference(
        reference
    )

    assert isinstance(reference, ToolArtifactReference)
    assert reference.to_dict() == descriptor.to_dict()
    assert restored == descriptor


def test_bridge_error_model_and_response_invariants() -> None:
    timeout_error = DesktopCapabilityBridgeError(
        code="timeout",
        message=" Host bridge timed out. ",
        details={"timeoutMs": 5000},
    )
    permission_error = DesktopCapabilityBridgeError(
        code="permission_denied",
        message="Forbidden.",
    )
    failure_response = DesktopCapabilityBridgeResponse.failure(
        request_id="request-2",
        error=timeout_error,
    )

    assert timeout_error.to_dict() == {
        "code": "timeout",
        "message": "Host bridge timed out.",
        "retryable": True,
        "details": {"timeoutMs": 5000},
    }
    assert permission_error.retryable is False
    assert failure_response.to_dict() == {
        "requestId": "request-2",
        "ok": False,
        "errorCode": "timeout",
        "errorMessage": "Host bridge timed out.",
        "errorRetryable": True,
        "details": {"timeoutMs": 5000},
    }

    with pytest.raises(
        ValueError,
        match="Successful bridge responses cannot include an error payload",
    ):
        DesktopCapabilityBridgeResponse(
            request_id="request-3",
            ok=True,
            error=timeout_error,
        )

    with pytest.raises(
        ValueError,
        match="Failed bridge responses must include an error payload",
    ):
        DesktopCapabilityBridgeResponse(request_id="request-4", ok=False)

    with pytest.raises(
        ValueError,
        match="Failed bridge responses cannot include a result payload",
    ):
        DesktopCapabilityBridgeResponse(
            request_id="request-5",
            ok=False,
            result={},
            error=timeout_error,
        )
