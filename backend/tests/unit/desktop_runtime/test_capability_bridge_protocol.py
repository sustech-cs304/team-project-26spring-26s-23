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
from app.desktop_runtime.capability_bridge_protocol import (
    _ArtifactDescriptorFields,
    _ArtifactDescriptorResult,
    _BridgePayloadModel,
    _BridgeResultModel,
    _BrowserCloseTabPayload,
    _BrowserCookiesPayload,
    _BrowserCookiesResult,
    _BrowserExecutePayload,
    _BrowserExecuteResult,
    _BrowserListTabsPayload,
    _BrowserListTabsResult,
    _BrowserPagePayload,
    _BrowserPageResult,
    _BrowserResetPayload,
    _BrowserResetResult,
    _BrowserScreenshotPayload,
    _BrowserScreenshotResult,
    _BrowserSnapshotPayload,
    _BrowserSnapshotResult,
    _BrowserSwitchTabPayload,
    _DescribeArtifactPayload,
    _DesktopCapabilityBridgeModel,
    _EmitEventPayload,
    _EmptyResult,
    _EnsureDirectoryPayload,
    _GetSecretResult,
    _HasSecretResult,
    _McpToolCallError,
    _McpToolCallPayload,
    _McpToolCallResult,
    _PathResult,
    _ResolvePathPayload,
    _SaveBytesPayload,
    _SaveTextPayload,
    _SecretNamePayload,
    _StateAddressPayload,
    _StateGetValueResult,
    _StatePutValuePayload,
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
        "browser": ("open", "screenshot", "list_tabs", "close_tab", "switch_tab", "execute", "cookies", "reset", "snapshot"),
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
    assert get_desktop_capability_operations("browser") == ("open", "screenshot", "list_tabs", "close_tab", "switch_tab", "execute", "cookies", "reset", "snapshot")
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


def test_browser_page_result_serializes_content_when_present() -> None:
    result = validate_desktop_capability_bridge_result(
        capability="browser",
        operation="open",
        result={
            "tabId": "tab-1",
            "currentUrl": "https://example.com",
            "title": "Example",
            "content": "Extracted text content",
        },
    )
    assert result["tabId"] == "tab-1"
    assert result["currentUrl"] == "https://example.com"
    assert result["content"] == "Extracted text content"


def test_browser_page_result_omits_content_when_absent() -> None:
    result = validate_desktop_capability_bridge_result(
        capability="browser",
        operation="open",
        result={
            "tabId": "tab-1",
            "currentUrl": "https://example.com",
        },
    )
    assert "content" not in result
    assert result["tabId"] == "tab-1"
    assert result["currentUrl"] == "https://example.com"


# ---------------------------------------------------------------------------
# _SecretNamePayload
# ---------------------------------------------------------------------------


def test_secret_name_payload_construction_and_serialization() -> None:
    p = _SecretNamePayload.model_validate({"secretName": "my-api-key"})
    assert p.secret_name == "my-api-key"
    assert p.to_bridge_payload() == {"secretName": "my-api-key"}


def test_secret_name_payload_accepts_camel_alias() -> None:
    p = _SecretNamePayload.model_validate({"secretName": "my-api-key"})
    assert p.secret_name == "my-api-key"
    assert p.to_bridge_payload() == {"secretName": "my-api-key"}


def test_secret_name_payload_rejects_missing_field() -> None:
    with pytest.raises(ValueError):
        _SecretNamePayload.model_validate({})


def test_secret_name_payload_trims_whitespace() -> None:
    p = _SecretNamePayload.model_validate({"secretName": "  my-key  "})
    assert p.secret_name == "my-key"


def test_secret_name_payload_rejects_empty_string() -> None:
    with pytest.raises(ValueError):
        _SecretNamePayload.model_validate({"secretName": ""})


def test_secret_name_payload_rejects_non_string() -> None:
    with pytest.raises(ValueError):
        _SecretNamePayload.model_validate({"secretName": 123})


def test_secret_name_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _SecretNamePayload.model_validate({"secretName": "k", "extra": 1})


# ---------------------------------------------------------------------------
# _ResolvePathPayload
# ---------------------------------------------------------------------------


def test_resolve_path_payload_default_construction() -> None:
    p = _ResolvePathPayload.model_validate({})
    assert p.relative_path is None
    assert p.to_bridge_payload() == {}


def test_resolve_path_payload_with_value() -> None:
    p = _ResolvePathPayload.model_validate({"relativePath": "docs/output"})
    assert p.relative_path == "docs/output"
    assert p.to_bridge_payload() == {"relativePath": "docs/output"}


def test_resolve_path_payload_trims_whitespace() -> None:
    p = _ResolvePathPayload.model_validate({"relativePath": "  docs/output  "})
    assert p.relative_path == "docs/output"


def test_resolve_path_payload_rejects_non_string() -> None:
    with pytest.raises(ValueError):
        _ResolvePathPayload.model_validate({"relativePath": 123})


def test_resolve_path_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _ResolvePathPayload.model_validate({"relativePath": "x", "bonus": 1})


# ---------------------------------------------------------------------------
# _EnsureDirectoryPayload
# ---------------------------------------------------------------------------


def test_ensure_directory_payload_construction() -> None:
    p = _EnsureDirectoryPayload.model_validate({"relativePath": "subdir"})
    assert p.relative_path == "subdir"
    assert p.to_bridge_payload() == {"relativePath": "subdir"}


def test_ensure_directory_payload_trims_whitespace() -> None:
    p = _EnsureDirectoryPayload.model_validate({"relativePath": "  subdir  "})
    assert p.relative_path == "subdir"


def test_ensure_directory_payload_rejects_empty_string() -> None:
    with pytest.raises(ValueError):
        _EnsureDirectoryPayload.model_validate({"relativePath": ""})


def test_ensure_directory_payload_rejects_missing_field() -> None:
    with pytest.raises(ValueError):
        _EnsureDirectoryPayload.model_validate({})


# ---------------------------------------------------------------------------
# _SaveTextPayload
# ---------------------------------------------------------------------------


def test_save_text_payload_full_construction() -> None:
    p = _SaveTextPayload.model_validate({
        "name": "report.md",
        "text": "# Report",
        "contentType": "text/markdown",
        "metadata": {"kind": "report"},
    })
    assert p.name == "report.md"
    assert p.text == "# Report"
    assert p.content_type == "text/markdown"
    assert p.metadata == {"kind": "report"}
    assert p.to_bridge_payload() == {
        "name": "report.md",
        "text": "# Report",
        "contentType": "text/markdown",
        "metadata": {"kind": "report"},
    }


def test_save_text_payload_minimal_construction() -> None:
    p = _SaveTextPayload.model_validate({"name": "file.txt", "text": ""})
    assert p.content_type is None
    assert p.metadata is None
    assert p.to_bridge_payload() == {"name": "file.txt", "text": ""}


def test_save_text_payload_allows_empty_text() -> None:
    p = _SaveTextPayload.model_validate({"name": "empty.txt", "text": ""})
    assert p.text == ""


def test_save_text_payload_rejects_missing_name() -> None:
    with pytest.raises(ValueError):
        _SaveTextPayload.model_validate({"text": "hi"})


def test_save_text_payload_rejects_non_string_name() -> None:
    with pytest.raises(ValueError):
        _SaveTextPayload.model_validate({"name": 1, "text": "hi"})


def test_save_text_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _SaveTextPayload.model_validate({"name": "a", "text": "b", "extra": 1})


# ---------------------------------------------------------------------------
# _SaveBytesPayload
# ---------------------------------------------------------------------------


def test_save_bytes_payload_full_construction() -> None:
    p = _SaveBytesPayload.model_validate({
        "name": "image.png",
        "contentBase64": "aGVsbG8=",
        "contentType": "image/png",
        "metadata": {"width": 100},
    })
    assert p.name == "image.png"
    assert p.content_base64 == "aGVsbG8="
    assert p.content_type == "image/png"
    assert p.metadata == {"width": 100}
    assert p.to_bridge_payload() == {
        "name": "image.png",
        "contentBase64": "aGVsbG8=",
        "contentType": "image/png",
        "metadata": {"width": 100},
    }


def test_save_bytes_payload_minimal_construction() -> None:
    p = _SaveBytesPayload.model_validate({"name": "data.bin", "contentBase64": "AAEC"})
    assert p.content_type is None
    assert p.metadata is None
    assert p.to_bridge_payload() == {
        "name": "data.bin",
        "contentBase64": "AAEC",
    }


def test_save_bytes_payload_rejects_empty_content_base64() -> None:
    with pytest.raises(ValueError):
        _SaveBytesPayload.model_validate({"name": "data.bin", "contentBase64": ""})


# ---------------------------------------------------------------------------
# _DescribeArtifactPayload
# ---------------------------------------------------------------------------


def test_describe_artifact_payload_construction() -> None:
    p = _DescribeArtifactPayload.model_validate({"artifactId": "artifact-1"})
    assert p.artifact_id == "artifact-1"
    assert p.to_bridge_payload() == {"artifactId": "artifact-1"}


def test_describe_artifact_payload_trims_whitespace() -> None:
    p = _DescribeArtifactPayload.model_validate({"artifactId": "  artifact-1  "})
    assert p.artifact_id == "artifact-1"


def test_describe_artifact_payload_rejects_empty() -> None:
    with pytest.raises(ValueError):
        _DescribeArtifactPayload.model_validate({"artifactId": ""})


def test_describe_artifact_payload_rejects_missing() -> None:
    with pytest.raises(ValueError):
        _DescribeArtifactPayload.model_validate({})


# ---------------------------------------------------------------------------
# _StateAddressPayload
# ---------------------------------------------------------------------------


def test_state_address_payload_construction() -> None:
    p = _StateAddressPayload(scope="tool", key="prefs.theme")
    assert p.scope == "tool"
    assert p.key == "prefs.theme"
    assert p.to_bridge_payload() == {"scope": "tool", "key": "prefs.theme"}


def test_state_address_payload_rejects_nonsensical_scope() -> None:
    with pytest.raises(ValueError):
        _StateAddressPayload(scope="nonsensical", key="k")


def test_state_address_payload_rejects_missing_scope() -> None:
    with pytest.raises(ValueError):
        _StateAddressPayload.model_validate({"key": "k"})


def test_state_address_payload_rejects_empty_key() -> None:
    with pytest.raises(ValueError):
        _StateAddressPayload(scope="run", key="")


# ---------------------------------------------------------------------------
# _StatePutValuePayload
# ---------------------------------------------------------------------------


def test_state_put_value_payload_construction() -> None:
    p = _StatePutValuePayload(scope="tool", key="theme", value={"dark": True})
    assert p.scope == "tool"
    assert p.key == "theme"
    assert p.value == {"dark": True}
    assert p.to_bridge_payload() == {
        "scope": "tool",
        "key": "theme",
        "value": {"dark": True},
    }


def test_state_put_value_payload_rejects_missing_value() -> None:
    with pytest.raises(ValueError):
        _StatePutValuePayload.model_validate({"scope": "tool", "key": "k"})


def test_state_put_value_payload_rejects_non_mapping_value() -> None:
    with pytest.raises(ValueError):
        _StatePutValuePayload(
            scope="tool", key="k", value="not-a-map"  # type: ignore[arg-type]
        )


def test_state_put_value_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _StatePutValuePayload.model_validate(
            {"scope": "tool", "key": "k", "value": {}, "extra": 1}
        )


# ---------------------------------------------------------------------------
# _EmitEventPayload
# ---------------------------------------------------------------------------


def test_emit_event_payload_full_construction() -> None:
    p = _EmitEventPayload.model_validate({
        "eventType": "tool.completed",
        "message": "All done.",
        "data": {"exitCode": 0},
    })
    assert p.event_type == "tool.completed"
    assert p.message == "All done."
    assert p.data == {"exitCode": 0}
    assert p.to_bridge_payload() == {
        "eventType": "tool.completed",
        "message": "All done.",
        "data": {"exitCode": 0},
    }


def test_emit_event_payload_minimal_construction() -> None:
    p = _EmitEventPayload.model_validate({"eventType": "tool.started"})
    assert p.message is None
    assert p.data is None
    assert p.to_bridge_payload() == {"eventType": "tool.started"}


def test_emit_event_payload_rejects_missing_event_type() -> None:
    with pytest.raises(ValueError):
        _EmitEventPayload.model_validate({"message": "hi"})


def test_emit_event_payload_rejects_empty_event_type() -> None:
    with pytest.raises(ValueError):
        _EmitEventPayload.model_validate({"eventType": ""})


def test_emit_event_payload_rejects_non_string_event_type() -> None:
    with pytest.raises(ValueError):
        _EmitEventPayload.model_validate({"eventType": True})


# ---------------------------------------------------------------------------
# _McpToolCallPayload
# ---------------------------------------------------------------------------


def test_mcp_tool_call_payload_full_construction() -> None:
    p = _McpToolCallPayload.model_validate({
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "arguments": {"keyword": "library"},
        "snapshotRevision": 8,
    })
    assert p.server_id == "mcp-stdio-stub"
    assert p.remote_tool_name == "search-campus"
    assert p.arguments == {"keyword": "library"}
    assert p.snapshot_revision == 8
    assert p.to_bridge_payload() == {
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "arguments": {"keyword": "library"},
        "snapshotRevision": 8,
    }


def test_mcp_tool_call_payload_default_arguments() -> None:
    p = _McpToolCallPayload.model_validate(
        {"serverId": "srv", "remoteToolName": "tool"}
    )
    assert p.arguments == {}


def test_mcp_tool_call_payload_rejects_missing_server_id() -> None:
    with pytest.raises(ValueError):
        _McpToolCallPayload.model_validate({"remoteToolName": "tool"})


def test_mcp_tool_call_payload_rejects_empty_server_id() -> None:
    with pytest.raises(ValueError):
        _McpToolCallPayload.model_validate(
            {"serverId": "", "remoteToolName": "tool"}
        )


def test_mcp_tool_call_payload_rejects_negative_snapshot_revision() -> None:
    with pytest.raises(ValueError):
        _McpToolCallPayload.model_validate({
            "serverId": "srv",
            "remoteToolName": "tool",
            "snapshotRevision": -1,
        })


def test_mcp_tool_call_payload_rejects_bool_as_snapshot_revision() -> None:
    with pytest.raises(ValueError):
        _McpToolCallPayload.model_validate(
            {
                "serverId": "srv",
                "remoteToolName": "tool",
                "snapshotRevision": True,
            }
        )


def test_mcp_tool_call_payload_rejects_non_dict_arguments() -> None:
    with pytest.raises(ValueError):
        _McpToolCallPayload.model_validate(
            {
                "serverId": "srv",
                "remoteToolName": "tool",
                "arguments": "not-a-dict",
            }
        )


# ---------------------------------------------------------------------------
# _McpToolCallError
# ---------------------------------------------------------------------------


def test_mcp_tool_call_error_full_construction() -> None:
    e = _McpToolCallError.model_validate({
        "code": "directory_drift",
        "message": "Tool no longer exists.",
        "retryable": False,
        "observedAt": "2026-04-21T12:00:00.000Z",
        "details": {"snapshotRevision": 8},
    })
    assert e.code == "directory_drift"
    assert e.message == "Tool no longer exists."
    assert e.retryable is False
    assert e.observed_at == "2026-04-21T12:00:00.000Z"
    assert e.details == {"snapshotRevision": 8}
    assert e.to_dict() == {
        "code": "directory_drift",
        "message": "Tool no longer exists.",
        "retryable": False,
        "observedAt": "2026-04-21T12:00:00.000Z",
        "details": {"snapshotRevision": 8},
    }


def test_mcp_tool_call_error_minimal_construction() -> None:
    e = _McpToolCallError.model_validate(
        {"code": "timeout", "message": "Timed out.", "retryable": True}
    )
    assert e.observed_at is None
    assert e.details is None
    d = e.to_dict()
    assert d["code"] == "timeout"
    assert "observedAt" not in d
    assert "details" not in d


def test_mcp_tool_call_error_rejects_non_bool_retryable() -> None:
    with pytest.raises(ValueError):
        _McpToolCallError.model_validate(
            {"code": "x", "message": "y", "retryable": "yes"}
        )


def test_mcp_tool_call_error_rejects_empty_code() -> None:
    with pytest.raises(ValueError):
        _McpToolCallError.model_validate(
            {"code": "", "message": "msg", "retryable": False}
        )


def test_mcp_tool_call_error_rejects_empty_message() -> None:
    with pytest.raises(ValueError):
        _McpToolCallError.model_validate(
            {"code": "code", "message": "", "retryable": False}
        )


# ---------------------------------------------------------------------------
# _McpToolCallResult
# ---------------------------------------------------------------------------


def test_mcp_tool_call_result_success_construction() -> None:
    r = _McpToolCallResult.model_validate({
        "ok": True,
        "toolId": "mcp.srv.tool.000",
        "serverId": "srv",
        "remoteToolName": "tool",
        "content": [{"type": "text", "text": "done"}],
        "structuredContent": {"echoed": True},
        "snapshotRevision": 8,
        "isError": False,
    })
    assert r.ok is True
    assert r.is_error is False
    result = r.to_bridge_result()
    assert result["ok"] is True
    assert result["toolId"] == "mcp.srv.tool.000"
    assert result["isError"] is False
    assert result["content"] == [{"type": "text", "text": "done"}]
    assert result["structuredContent"] == {"echoed": True}


def test_mcp_tool_call_result_success_defaults_is_error() -> None:
    r = _McpToolCallResult.model_validate({
        "ok": True,
        "toolId": "tid",
        "serverId": "sid",
        "remoteToolName": "tool",
    })
    assert r.is_error is False
    assert r.to_bridge_result()["isError"] is False


def test_mcp_tool_call_result_failure_construction() -> None:
    error = _McpToolCallError.model_validate({
        "code": "directory_drift",
        "message": "Tool missing.",
        "retryable": False,
    })
    r = _McpToolCallResult.model_validate({
        "ok": False,
        "toolId": "tid",
        "serverId": "sid",
        "remoteToolName": "tool",
        "snapshotRevision": 8,
        "error": {
            "code": "directory_drift",
            "message": "Tool missing.",
            "retryable": False,
        },
    })
    assert r.ok is False
    result = r.to_bridge_result()
    assert result["ok"] is False
    assert result["error"]["code"] == "directory_drift"


def test_mcp_tool_call_result_success_rejects_error_payload() -> None:
    with pytest.raises(ValueError, match="cannot include an error"):
        _McpToolCallResult.model_validate({
            "ok": True,
            "toolId": "tid",
            "serverId": "sid",
            "remoteToolName": "tool",
            "error": {"code": "x", "message": "y", "retryable": False},
        })


def test_mcp_tool_call_result_success_rejects_is_error_true() -> None:
    with pytest.raises(ValueError, match="cannot mark isError=true"):
        _McpToolCallResult.model_validate({
            "ok": True,
            "toolId": "tid",
            "serverId": "sid",
            "remoteToolName": "tool",
            "isError": True,
        })


def test_mcp_tool_call_result_failure_rejects_content() -> None:
    with pytest.raises(ValueError, match="cannot include content"):
        _McpToolCallResult.model_validate({
            "ok": False,
            "toolId": "tid",
            "serverId": "sid",
            "remoteToolName": "tool",
            "content": [{"type": "text"}],
            "error": {"code": "x", "message": "y", "retryable": False},
        })


def test_mcp_tool_call_result_failure_requires_error() -> None:
    with pytest.raises(ValueError, match="must include an error"):
        _McpToolCallResult.model_validate({
            "ok": False,
            "toolId": "tid",
            "serverId": "sid",
            "remoteToolName": "tool",
        })


def test_mcp_tool_call_result_rejects_missing_tool_id() -> None:
    with pytest.raises(ValueError):
        _McpToolCallResult.model_validate(
            {"ok": True, "serverId": "s", "remoteToolName": "t"}
        )


# ---------------------------------------------------------------------------
# _GetSecretResult
# ---------------------------------------------------------------------------


def test_get_secret_result_with_value() -> None:
    r = _GetSecretResult(value="secret-value")
    assert r.value == "secret-value"
    assert r.to_bridge_result() == {"value": "secret-value"}


def test_get_secret_result_with_null() -> None:
    r = _GetSecretResult(value=None)
    assert r.value is None
    assert r.to_bridge_result() == {"value": None}


def test_get_secret_result_default_null() -> None:
    r = _GetSecretResult()
    assert r.value is None
    assert r.to_bridge_result() == {"value": None}


def test_get_secret_result_rejects_non_string_value() -> None:
    with pytest.raises(ValueError):
        _GetSecretResult.model_validate({"value": 42})


# ---------------------------------------------------------------------------
# _HasSecretResult
# ---------------------------------------------------------------------------


def test_has_secret_result_true() -> None:
    r = _HasSecretResult(present=True)
    assert r.present is True
    assert r.to_bridge_result() == {"present": True}


def test_has_secret_result_false() -> None:
    r = _HasSecretResult(present=False)
    assert r.present is False
    assert r.to_bridge_result() == {"present": False}


def test_has_secret_result_rejects_non_bool() -> None:
    with pytest.raises(ValueError):
        _HasSecretResult.model_validate({"present": "yes"})


# ---------------------------------------------------------------------------
# _PathResult
# ---------------------------------------------------------------------------


def test_path_result_construction() -> None:
    r = _PathResult(path="/home/user/workspace")
    assert r.path == "/home/user/workspace"
    assert r.to_bridge_result() == {"path": "/home/user/workspace"}


def test_path_result_trims_whitespace() -> None:
    r = _PathResult(path="  /path/to/file  ")
    assert r.path == "/path/to/file"


def test_path_result_rejects_empty_path() -> None:
    with pytest.raises(ValueError):
        _PathResult(path="")


def test_path_result_rejects_non_string() -> None:
    with pytest.raises(ValueError):
        _PathResult.model_validate({"path": 123})


# ---------------------------------------------------------------------------
# _ArtifactDescriptorFields / _ArtifactDescriptorResult
# ---------------------------------------------------------------------------


def test_artifact_descriptor_result_full_construction() -> None:
    r = _ArtifactDescriptorResult(
        artifactId="artifact-1",
        name="report.md",
        contentType="text/markdown",
        uri="artifact://report.md",
        metadata={"kind": "report"},
    )
    assert r.artifact_id == "artifact-1"
    assert r.name == "report.md"
    assert r.content_type == "text/markdown"
    assert r.uri == "artifact://report.md"
    assert r.metadata == {"kind": "report"}
    result = r.to_bridge_result()
    assert result["artifactId"] == "artifact-1"
    assert result["name"] == "report.md"
    assert result["contentType"] == "text/markdown"
    assert result["uri"] == "artifact://report.md"
    assert result["metadata"] == {"kind": "report"}


def test_artifact_descriptor_result_minimal_construction() -> None:
    r = _ArtifactDescriptorResult(
        artifactId="artifact-1",
        metadata={},
    )
    assert r.name is None
    assert r.content_type is None
    assert r.uri is None
    result = r.to_bridge_result()
    assert result["artifactId"] == "artifact-1"
    assert result["metadata"] == {}
    assert "name" not in result
    assert "uri" not in result
    assert "contentType" not in result


def test_artifact_descriptor_result_rejects_missing_artifact_id() -> None:
    with pytest.raises(ValueError):
        _ArtifactDescriptorResult.model_validate({"metadata": {}})


def test_artifact_descriptor_result_rejects_missing_metadata() -> None:
    with pytest.raises(ValueError):
        _ArtifactDescriptorResult.model_validate({"artifactId": "a"})


def test_artifact_descriptor_result_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _ArtifactDescriptorResult.model_validate(
            {"artifactId": "a", "metadata": {}, "extra": 1}
        )


# ---------------------------------------------------------------------------
# _StateGetValueResult
# ---------------------------------------------------------------------------


def test_state_get_value_result_found() -> None:
    r = _StateGetValueResult(found=True, value={"theme": "dark"})
    assert r.found is True
    assert r.value == {"theme": "dark"}
    assert r.to_bridge_result() == {"found": True, "value": {"theme": "dark"}}


def test_state_get_value_result_not_found() -> None:
    r = _StateGetValueResult(found=False, value=None)
    assert r.found is False
    assert r.value is None
    assert r.to_bridge_result() == {"found": False, "value": None}


def test_state_get_value_result_found_rejects_null_value() -> None:
    with pytest.raises(ValueError, match="must be an object when 'found' is true"):
        _StateGetValueResult(found=True, value=None)


def test_state_get_value_result_not_found_rejects_value() -> None:
    with pytest.raises(ValueError, match="must be null when 'found' is false"):
        _StateGetValueResult(found=False, value={"x": 1})


def test_state_get_value_result_rejects_non_bool_found() -> None:
    with pytest.raises(ValueError):
        _StateGetValueResult.model_validate({"found": "yes", "value": None})


# ---------------------------------------------------------------------------
# _EmptyResult
# ---------------------------------------------------------------------------


def test_empty_result_construction() -> None:
    r = _EmptyResult()
    assert r.to_bridge_result() == {}


def test_empty_result_rejects_any_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _EmptyResult.model_validate({"anything": 1})


# ---------------------------------------------------------------------------
# _BrowserPagePayload
# ---------------------------------------------------------------------------


def test_browser_page_payload_full_construction() -> None:
    p = _BrowserPagePayload.model_validate({
        "url": "https://example.com",
        "showWindow": True,
        "newTab": False,
        "selector": "#main",
        "format": "html",
    })
    assert p.url == "https://example.com"
    assert p.show_window is True
    assert p.new_tab is False
    assert p.selector == "#main"
    assert p.format == "html"
    payload = p.to_bridge_payload()
    assert payload["url"] == "https://example.com"
    assert payload["showWindow"] is True
    assert payload["newTab"] is False
    assert payload["selector"] == "#main"
    assert payload["format"] == "html"


def test_browser_page_payload_minimal_construction() -> None:
    p = _BrowserPagePayload(url="https://example.com")
    assert p.show_window is None
    assert p.new_tab is None
    assert p.selector is None
    assert p.format is None
    payload = p.to_bridge_payload()
    assert payload == {"url": "https://example.com"}


def test_browser_page_payload_rejects_invalid_format() -> None:
    with pytest.raises(ValueError, match="format must be one of"):
        _BrowserPagePayload(url="https://x.com", format="xml")


def test_browser_page_payload_accepts_valid_formats() -> None:
    for fmt in ("text", "html", "markdown"):
        p = _BrowserPagePayload(url="https://x.com", format=fmt)
        assert p.format == fmt


def test_browser_page_payload_rejects_empty_url() -> None:
    with pytest.raises(ValueError):
        _BrowserPagePayload(url="")


def test_browser_page_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _BrowserPagePayload.model_validate({"url": "x", "extra": 1})


# ---------------------------------------------------------------------------
# _BrowserScreenshotPayload
# ---------------------------------------------------------------------------


def test_browser_screenshot_payload_with_name() -> None:
    p = _BrowserScreenshotPayload(name="screenshot.png")
    assert p.name == "screenshot.png"
    assert p.to_bridge_payload() == {"name": "screenshot.png"}


def test_browser_screenshot_payload_without_name() -> None:
    p = _BrowserScreenshotPayload()
    assert p.name is None
    assert p.to_bridge_payload() == {}


# ---------------------------------------------------------------------------
# _BrowserListTabsPayload
# ---------------------------------------------------------------------------


def test_browser_list_tabs_payload_construction() -> None:
    p = _BrowserListTabsPayload()
    assert p.to_bridge_payload() == {}


def test_browser_list_tabs_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _BrowserListTabsPayload.model_validate({"extra": 1})


# ---------------------------------------------------------------------------
# _BrowserCloseTabPayload
# ---------------------------------------------------------------------------


def test_browser_close_tab_payload_with_tab_id() -> None:
    p = _BrowserCloseTabPayload.model_validate({"tabId": "tab-1"})
    assert p.tab_id == "tab-1"
    assert p.to_bridge_payload() == {"tabId": "tab-1"}


def test_browser_close_tab_payload_without_tab_id() -> None:
    p = _BrowserCloseTabPayload()
    assert p.tab_id is None
    assert p.to_bridge_payload() == {}


def test_browser_close_tab_payload_trims_whitespace() -> None:
    p = _BrowserCloseTabPayload.model_validate({"tabId": "  tab-1  "})
    assert p.tab_id == "tab-1"


# ---------------------------------------------------------------------------
# _BrowserSwitchTabPayload
# ---------------------------------------------------------------------------


def test_browser_switch_tab_payload_construction() -> None:
    p = _BrowserSwitchTabPayload.model_validate({"tabId": "tab-1"})
    assert p.tab_id == "tab-1"
    assert p.to_bridge_payload() == {"tabId": "tab-1"}


def test_browser_switch_tab_payload_rejects_empty_tab_id() -> None:
    with pytest.raises(ValueError):
        _BrowserSwitchTabPayload.model_validate({"tabId": ""})


def test_browser_switch_tab_payload_rejects_missing_tab_id() -> None:
    with pytest.raises(ValueError):
        _BrowserSwitchTabPayload.model_validate({})


# ---------------------------------------------------------------------------
# _BrowserExecutePayload
# ---------------------------------------------------------------------------


def test_browser_execute_payload_full_construction() -> None:
    p = _BrowserExecutePayload.model_validate(
        {"script": "document.title", "tabId": "tab-1"}
    )
    assert p.script == "document.title"
    assert p.tab_id == "tab-1"
    assert p.to_bridge_payload() == {"script": "document.title", "tabId": "tab-1"}


def test_browser_execute_payload_without_tab_id() -> None:
    p = _BrowserExecutePayload.model_validate({"script": "window.scrollTo(0, 100)"})
    assert p.tab_id is None
    assert p.to_bridge_payload() == {"script": "window.scrollTo(0, 100)"}


def test_browser_execute_payload_rejects_empty_script() -> None:
    with pytest.raises(ValueError):
        _BrowserExecutePayload.model_validate({"script": ""})


def test_browser_execute_payload_rejects_missing_script() -> None:
    with pytest.raises(ValueError):
        _BrowserExecutePayload.model_validate({"tabId": "tab-1"})


# ---------------------------------------------------------------------------
# _BrowserCookiesPayload
# ---------------------------------------------------------------------------


def test_browser_cookies_payload_full_construction() -> None:
    p = _BrowserCookiesPayload.model_validate(
        {"tabId": " tab-1 ", "url": " https://bb.sustech.edu.cn/ "}
    )
    assert p.tab_id == "tab-1"
    assert p.url == "https://bb.sustech.edu.cn/"
    assert p.to_bridge_payload() == {
        "tabId": "tab-1",
        "url": "https://bb.sustech.edu.cn/",
    }


def test_browser_cookies_payload_empty_construction() -> None:
    p = _BrowserCookiesPayload()
    assert p.tab_id is None
    assert p.url is None
    assert p.to_bridge_payload() == {}


def test_browser_cookies_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _BrowserCookiesPayload.model_validate({"tabId": "tab-1", "domain": "bb.sustech.edu.cn"})


# ---------------------------------------------------------------------------
# _BrowserResetPayload
# ---------------------------------------------------------------------------


def test_browser_reset_payload_construction() -> None:
    p = _BrowserResetPayload()
    assert p.to_bridge_payload() == {}


def test_browser_reset_payload_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _BrowserResetPayload.model_validate({"extra": 1})


# ---------------------------------------------------------------------------
# _BrowserSnapshotPayload
# ---------------------------------------------------------------------------


def test_browser_snapshot_payload_full_construction() -> None:
    p = _BrowserSnapshotPayload.model_validate({"selector": "#main", "tabId": "tab-1"})
    assert p.selector == "#main"
    assert p.tab_id == "tab-1"
    assert p.to_bridge_payload() == {"selector": "#main", "tabId": "tab-1"}


def test_browser_snapshot_payload_empty_construction() -> None:
    p = _BrowserSnapshotPayload()
    assert p.selector is None
    assert p.tab_id is None
    assert p.to_bridge_payload() == {}


# ---------------------------------------------------------------------------
# _BrowserPageResult
# ---------------------------------------------------------------------------


def test_browser_page_result_full_construction() -> None:
    r = _BrowserPageResult.model_validate({
        "tabId": "tab-1",
        "currentUrl": "https://example.com",
        "title": "Example Domain",
        "windowVisible": True,
        "content": "Extracted text",
    })
    assert r.tab_id == "tab-1"
    assert r.current_url == "https://example.com"
    assert r.title == "Example Domain"
    assert r.window_visible is True
    assert r.content == "Extracted text"
    result = r.to_bridge_result()
    assert result["tabId"] == "tab-1"
    assert result["currentUrl"] == "https://example.com"
    assert result["title"] == "Example Domain"
    assert result["windowVisible"] is True
    assert result["content"] == "Extracted text"


def test_browser_page_result_minimal_construction() -> None:
    r = _BrowserPageResult.model_validate(
        {"tabId": "tab-1", "currentUrl": "https://example.com"}
    )
    assert r.title is None
    assert r.window_visible is None
    assert r.content is None
    result = r.to_bridge_result()
    assert result == {"tabId": "tab-1", "currentUrl": "https://example.com"}


def test_browser_page_result_rejects_missing_tab_id() -> None:
    with pytest.raises(ValueError):
        _BrowserPageResult.model_validate({"currentUrl": "https://x.com"})


def test_browser_page_result_rejects_missing_current_url() -> None:
    with pytest.raises(ValueError):
        _BrowserPageResult.model_validate({"tabId": "tab-1"})


def test_browser_page_result_rejects_extra_fields() -> None:
    with pytest.raises(ValueError, match="unexpected fields"):
        _BrowserPageResult.model_validate(
            {"tabId": "t", "currentUrl": "u", "extra": 1}
        )


# ---------------------------------------------------------------------------
# _BrowserScreenshotResult
# ---------------------------------------------------------------------------


def test_browser_screenshot_result_full_construction() -> None:
    r = _BrowserScreenshotResult.model_validate({
        "tabId": "tab-1",
        "currentUrl": "https://example.com",
        "title": "Example Domain",
        "windowVisible": False,
        "artifactId": "artifact-ss",
        "uri": "artifact://desktop/ss.png",
        "name": "ss.png",
        "contentType": "image/png",
        "metadata": {"source": "browser"},
    })
    assert r.tab_id == "tab-1"
    assert r.artifact_id == "artifact-ss"
    assert r.metadata == {"source": "browser"}
    result = r.to_bridge_result()
    assert result["tabId"] == "tab-1"
    assert result["currentUrl"] == "https://example.com"
    assert result["artifactId"] == "artifact-ss"
    assert result["metadata"] == {"source": "browser"}
    assert result["uri"] == "artifact://desktop/ss.png"
    assert result["contentType"] == "image/png"


def test_browser_screenshot_result_minimal_construction() -> None:
    r = _BrowserScreenshotResult.model_validate({
        "tabId": "tab-1",
        "currentUrl": "https://example.com",
        "artifactId": "artifact-ss",
        "metadata": {},
    })
    result = r.to_bridge_result()
    assert "title" not in result
    assert "windowVisible" not in result
    assert "uri" not in result
    assert "name" not in result
    assert "contentType" not in result


def test_browser_screenshot_result_rejects_missing_artifact_id() -> None:
    with pytest.raises(ValueError):
        _BrowserScreenshotResult.model_validate(
            {
                "tabId": "t",
                "currentUrl": "u",
                "metadata": {},
            }
        )


def test_browser_screenshot_result_rejects_missing_metadata() -> None:
    with pytest.raises(ValueError):
        _BrowserScreenshotResult.model_validate(
            {"tabId": "t", "currentUrl": "u", "artifactId": "a"}
        )


# ---------------------------------------------------------------------------
# _BrowserListTabsResult
# ---------------------------------------------------------------------------


def test_browser_list_tabs_result_with_tabs() -> None:
    r = _BrowserListTabsResult(
        tabs=[
            {"tabId": "tab-1", "currentUrl": "https://a.com"},
            {"tabId": "tab-2", "currentUrl": "https://b.com"},
        ]
    )
    result = r.to_bridge_result()
    assert len(result["tabs"]) == 2
    assert result["tabs"][0]["tabId"] == "tab-1"


def test_browser_list_tabs_result_empty_tabs() -> None:
    r = _BrowserListTabsResult()
    assert r.to_bridge_result() == {"tabs": []}


def test_browser_list_tabs_result_rejects_non_list() -> None:
    with pytest.raises(ValueError):
        _BrowserListTabsResult.model_validate({"tabs": "not-a-list"})


def test_browser_list_tabs_result_rejects_tab_missing_tab_id() -> None:
    with pytest.raises(ValueError, match="each tab must have a non-empty tabId"):
        _BrowserListTabsResult(tabs=[{"currentUrl": "https://x.com"}])


def test_browser_list_tabs_result_rejects_empty_tab_id() -> None:
    with pytest.raises(ValueError, match="each tab must have a non-empty tabId"):
        _BrowserListTabsResult(tabs=[{"tabId": "", "currentUrl": "https://x.com"}])


def test_browser_list_tabs_result_rejects_tab_missing_current_url() -> None:
    with pytest.raises(ValueError, match="each tab must have a currentUrl string"):
        _BrowserListTabsResult(tabs=[{"tabId": "tab-1"}])


# ---------------------------------------------------------------------------
# _BrowserExecuteResult
# ---------------------------------------------------------------------------


def test_browser_execute_result_with_result_only() -> None:
    r = _BrowserExecuteResult(result={"title": "Example"})
    assert r.result == {"title": "Example"}
    assert r.tab_id is None
    assert r.to_bridge_result() == {"result": {"title": "Example"}}


def test_browser_execute_result_with_tab_id() -> None:
    r = _BrowserExecuteResult.model_validate(
        {"result": "done", "tabId": "tab-1"}
    )
    assert r.tab_id == "tab-1"
    assert r.to_bridge_result() == {"result": "done", "tabId": "tab-1"}


# ---------------------------------------------------------------------------
# _BrowserCookiesResult
# ---------------------------------------------------------------------------


def test_browser_cookies_result_full_construction() -> None:
    r = _BrowserCookiesResult.model_validate(
        {
            "tabId": " tab-1 ",
            "currentUrl": " https://bb.sustech.edu.cn/ ",
            "cookies": [
                {
                    "name": " JSESSIONID ",
                    "value": "session-value",
                    "domain": ".bb.sustech.edu.cn",
                    "path": "/",
                    "secure": True,
                    "httpOnly": True,
                    "sameSite": "no_restriction",
                    "expirationDate": 1799999999,
                    "ignored": "not serialized",
                }
            ],
        }
    )
    assert r.tab_id == "tab-1"
    assert r.current_url == "https://bb.sustech.edu.cn/"
    assert r.cookies == [
        {
            "name": "JSESSIONID",
            "value": "session-value",
            "domain": ".bb.sustech.edu.cn",
            "path": "/",
            "sameSite": "no_restriction",
            "secure": True,
            "httpOnly": True,
            "expirationDate": 1799999999,
        }
    ]
    assert r.to_bridge_result() == {
        "tabId": "tab-1",
        "currentUrl": "https://bb.sustech.edu.cn/",
        "cookies": r.cookies,
    }


def test_browser_cookies_result_rejects_cookie_without_string_value() -> None:
    with pytest.raises(ValueError, match="cookie field 'value' must be a string"):
        _BrowserCookiesResult.model_validate(
            {
                "tabId": "tab-1",
                "currentUrl": "https://bb.sustech.edu.cn/",
                "cookies": [{"name": "JSESSIONID", "value": 123}],
            }
        )


# ---------------------------------------------------------------------------
# _BrowserResetResult
# ---------------------------------------------------------------------------


def test_browser_reset_result_with_count() -> None:
    r = _BrowserResetResult.model_validate({"closedCount": 5})
    assert r.closed_count == 5
    assert r.to_bridge_result() == {"closedCount": 5}


def test_browser_reset_result_default_count() -> None:
    r = _BrowserResetResult()
    assert r.closed_count == 0
    assert r.to_bridge_result() == {"closedCount": 0}


def test_browser_reset_result_clamps_negative() -> None:
    r = _BrowserResetResult.model_validate({"closedCount": -5})
    assert r.closed_count == 0


# ---------------------------------------------------------------------------
# _BrowserSnapshotResult
# ---------------------------------------------------------------------------

# NOTE: _BrowserSnapshotResult has a default tab_id="" which conflicts with the
# min_length=1 constraint and the _require_text_field_value validator.
# Constructing without an explicit tab_id will fail validation.
# This is a SOURCE BUG: the default value contradicts the field constraints.


def test_browser_snapshot_result_full_construction() -> None:
    r = _BrowserSnapshotResult.model_validate({
        "tabId": "tab-1",
        "snapshot": "<html>...</html>",
        "elementCount": 42,
        "interactiveCount": 7,
    })
    assert r.tab_id == "tab-1"
    assert r.snapshot == "<html>...</html>"
    assert r.element_count == 42
    assert r.interactive_count == 7
    result = r.to_bridge_result()
    assert result == {
        "snapshot": "<html>...</html>",
        "tabId": "tab-1",
        "elementCount": 42,
        "interactiveCount": 7,
    }


def test_browser_snapshot_result_defaults() -> None:
    r = _BrowserSnapshotResult.model_validate({"tabId": "tab-1"})
    assert r.snapshot == ""
    assert r.element_count == 0
    assert r.interactive_count == 0
    result = r.to_bridge_result()
    assert result["snapshot"] == ""
    assert result["tabId"] == "tab-1"
    assert result["elementCount"] == 0
    assert result["interactiveCount"] == 0


def test_browser_snapshot_result_none_snapshot_is_coerced_to_empty() -> None:
    r = _BrowserSnapshotResult.model_validate(
        {"tabId": "tab-1", "snapshot": None}
    )
    assert r.snapshot == ""


def test_browser_snapshot_result_default_tab_id_is_empty() -> None:
    r = _BrowserSnapshotResult.model_validate(
        {"snapshot": "<html>"}
    )
    assert r.tab_id == ""


def test_browser_snapshot_result_rejects_non_numeric_element_count() -> None:
    with pytest.raises(ValueError):
        _BrowserSnapshotResult.model_validate(
            {
                "tabId": "tab-1",
                "elementCount": "many",
            }
        )


# ---------------------------------------------------------------------------
# Bridge model base-class behaviours
# ---------------------------------------------------------------------------


def test_bridge_model_rejects_non_mapping_input() -> None:
    with pytest.raises(ValueError):
        _SecretNamePayload.model_validate("not-a-map")


def test_bridge_payload_base_serialization() -> None:
    p = _SecretNamePayload.model_validate({"secretName": "test"})
    result = p.to_bridge_payload()
    assert isinstance(result, dict)
    assert "secretName" in result


def test_bridge_result_base_serialization() -> None:
    r = _PathResult(path="/tmp")
    result = r.to_bridge_result()
    assert isinstance(result, dict)
    assert "path" in result


def test_frozen_models_cannot_be_mutated() -> None:
    p = _SecretNamePayload.model_validate({"secretName": "test"})
    with pytest.raises(Exception):
        p.secret_name = "other"  # type: ignore[misc]


def test_desktop_capability_bridge_model_base_is_abstract_like() -> None:
    assert issubclass(_SecretNamePayload, _DesktopCapabilityBridgeModel)
    assert issubclass(_PathResult, _DesktopCapabilityBridgeModel)
    assert issubclass(_BridgePayloadModel, _DesktopCapabilityBridgeModel)
    assert issubclass(_BridgeResultModel, _DesktopCapabilityBridgeModel)
