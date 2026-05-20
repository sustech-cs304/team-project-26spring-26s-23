from __future__ import annotations

import asyncio
import base64
import json

import httpx
import pytest

import app.desktop_runtime.capability_bridge_client as capability_bridge_client_module
from app.desktop_runtime.capability_bridge_protocol import (
    DesktopCapabilityBridgeResponse as ProtocolDesktopCapabilityBridgeResponse,
)
from app.desktop_runtime.capability_bridge_client import (
    HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME,
    DesktopCapabilityBridgeClient,
)
from app.tooling import (
    HostArtifact,
    HostBrowserPage,
    HostBrowserScreenshot,
    HostCapabilityOperationError,
    ToolInvocationContext,
)


def _build_invocation_context(
    *, tool_id: str = "blackboard.snapshot.sync"
) -> ToolInvocationContext:
    return ToolInvocationContext(
        invocation_id=f"{tool_id}:call-1",
        tool_id=tool_id,
        run_id="run-1",
        actor="agent",
    )


def test_desktop_capability_bridge_client_routes_all_capability_categories() -> None:
    captured_headers: list[str | None] = []
    captured_payloads: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.append(
            request.headers.get(HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME)
        )
        payload = json.loads(request.content.decode("utf-8"))
        captured_payloads.append(payload)
        request_id = payload["requestId"]
        capability = payload["capability"]
        operation = payload["operation"]

        if (capability, operation) == ("secret", "get_secret"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {"value": "resolved-secret"},
                },
                request=request,
            )
        if (capability, operation) == ("secret", "has_secret"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {"present": True},
                },
                request=request,
            )
        if (capability, operation) == ("workspace", "resolve_path"):
            relative_path = payload["payload"].get("relativePath")
            suffix = (
                "workspace-root"
                if relative_path is None
                else f"workspace-root/{relative_path}"
            )
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {"path": suffix},
                },
                request=request,
            )
        if (capability, operation) == ("database", "resolve_path"):
            relative_path = payload["payload"].get("relativePath")
            suffix = (
                "database-root"
                if relative_path is None
                else f"database-root/{relative_path}"
            )
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {"path": suffix},
                },
                request=request,
            )
        if (capability, operation) == ("workspace", "ensure_directory"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "path": f"workspace-root/{payload['payload']['relativePath']}"
                    },
                },
                request=request,
            )
        if (capability, operation) == ("artifact", "save_text"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "artifactId": "artifact-text",
                        "uri": "artifact://desktop/artifact-text",
                        "name": payload["payload"]["name"],
                        "contentType": payload["payload"].get(
                            "contentType", "text/plain"
                        ),
                        "metadata": payload["payload"].get("metadata", {}),
                    },
                },
                request=request,
            )
        if (capability, operation) == ("artifact", "save_bytes"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "artifactId": "artifact-bytes",
                        "uri": "artifact://desktop/artifact-bytes",
                        "name": payload["payload"]["name"],
                        "contentType": payload["payload"].get(
                            "contentType", "application/octet-stream"
                        ),
                        "metadata": payload["payload"].get("metadata", {}),
                    },
                },
                request=request,
            )
        if (capability, operation) == ("artifact", "describe_artifact"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "artifactId": payload["payload"]["artifactId"],
                        "uri": "artifact://desktop/described",
                        "name": "described.json",
                        "contentType": "application/json",
                        "metadata": {"described": True},
                    },
                },
                request=request,
            )
        if (capability, operation) == ("state", "get_value"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {"found": True, "value": {"count": 1}},
                },
                request=request,
            )
        if (capability, operation) in {
            ("state", "put_value"),
            ("state", "delete_value"),
            ("event", "emit_event"),
        }:
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {},
                },
                request=request,
            )
        if (capability, operation) == ("mcp", "call_tool"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "ok": True,
                        "toolId": payload["toolId"],
                        "serverId": payload["payload"]["serverId"],
                        "remoteToolName": payload["payload"]["remoteToolName"],
                        "content": [{"type": "text", "text": "search completed"}],
                        "structuredContent": {
                            "echoedArguments": payload["payload"]["arguments"]
                        },
                        "snapshotRevision": payload["payload"].get("snapshotRevision"),
                        "isError": False,
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "open"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "tabId": "main-window",
                        "currentUrl": payload["payload"]["url"],
                        "title": "Example Domain",
                        "windowVisible": payload["payload"].get("showWindow", False),
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "screenshot"):
            screenshot_name = payload["payload"].get("name") or "browser-screenshot.png"
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "tabId": "main-window",
                        "currentUrl": "https://example.com/",
                        "title": "Example Domain",
                        "windowVisible": True,
                        "artifactId": "artifact-browser-screenshot",
                        "uri": "artifact://desktop/browser-screenshot.png",
                        "name": screenshot_name,
                        "contentType": "image/png",
                        "metadata": {"source": "browser.screenshot"},
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "list_tabs"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "tabs": [
                            {"tabId": "tab-1", "currentUrl": "https://example.com", "title": "Example", "windowVisible": True},
                            {"tabId": "tab-2", "currentUrl": "https://other.com", "title": "Other", "windowVisible": False},
                        ],
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "close_tab"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "tabId": payload["payload"].get("tabId", "tab-1"),
                        "currentUrl": "https://example.com",
                        "title": "Example Domain",
                        "windowVisible": False,
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "switch_tab"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "tabId": payload["payload"]["tabId"],
                        "currentUrl": "https://example.com",
                        "title": "Example Domain",
                        "windowVisible": True,
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "execute"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "result": "executed: " + payload["payload"]["script"],
                        "tabId": payload["payload"].get("tabId", "tab-1"),
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "reset"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "closedCount": 2,
                    },
                },
                request=request,
            )
        if (capability, operation) == ("browser", "snapshot"):
            return httpx.Response(
                200,
                json={
                    "requestId": request_id,
                    "ok": True,
                    "result": {
                        "snapshot": "- [heading] Page\n- [link] Click me [ref=@1]",
                        "tabId": payload["payload"].get("tabId", "tab-1"),
                        "elementCount": 5,
                        "interactiveCount": 2,
                    },
                },
                request=request,
            )

        raise AssertionError(f"Unhandled bridge request {(capability, operation)!r}")

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )
    context = _build_invocation_context()

    secret_value = asyncio.run(client.get_secret(context=context, name="bb.password"))
    secret_present = asyncio.run(client.has_secret(context=context, name="bb.password"))
    workspace_path = client.resolve_workspace_path(
        context=context,
        relative_path="backend/data/calendar.db",
    )
    database_path = client.resolve_database_path(
        context=context,
        relative_path="blackboard/snapshot.db",
    )
    ensured_path = client.ensure_workspace_directory(
        context=context,
        relative_path="artifacts/reports",
    )
    text_artifact = asyncio.run(
        client.save_text(
            context=context,
            name="snapshot.json",
            text="{}",
            content_type="application/json",
            metadata={"toolId": context.tool_id},
        )
    )
    bytes_artifact = asyncio.run(
        client.save_bytes(
            context=context,
            name="snapshot.bin",
            content=b"payload-bytes",
            content_type="application/octet-stream",
            metadata={"kind": "binary"},
        )
    )
    described_artifact = asyncio.run(
        client.describe_artifact(context=context, artifact_id="artifact-bytes")
    )
    state_value = asyncio.run(
        client.get_state_value(context=context, scope="tool", key="snapshot:latest")
    )
    asyncio.run(
        client.put_state_value(
            context=context,
            scope="tool",
            key="snapshot:latest",
            value={"count": 2},
        )
    )
    asyncio.run(
        client.delete_state_value(
            context=context,
            scope="tool",
            key="snapshot:latest",
        )
    )
    client.emit_event(
        context=context,
        event_type="blackboard.snapshot.sync.completed",
        message="completed",
        data={"artifactCount": 2},
    )
    mcp_result = asyncio.run(
        client.call_mcp_tool(
            context=_build_invocation_context(
                tool_id="mcp.mcp-stdio-stub.search-campus.00004d8d"
            ),
            server_id="mcp-stdio-stub",
            remote_tool_name="search-campus",
            arguments={"keyword": "library"},
            snapshot_revision=8,
        )
    )
    browser_page = asyncio.run(
        client.open_browser_page(
            context=context,
            url="https://example.com/",
            show_window=True,
        )
    )
    browser_screenshot = asyncio.run(
        client.capture_browser_screenshot(context=context, name="browser-capture")
    )
    browser_tabs = asyncio.run(
        client.list_browser_tabs(context=context)
    )
    closed_tab = asyncio.run(
        client.close_browser_tab(context=context, tab_id="tab-2")
    )
    switched_tab = asyncio.run(
        client.switch_browser_tab(context=context, tab_id="tab-3")
    )
    execute_result = asyncio.run(
        client.execute_browser_script(context=context, script="document.title")
    )
    reset_result = asyncio.run(
        client.reset_browser(context=context)
    )
    snapshot_result = asyncio.run(
        client.capture_browser_snapshot(context=context, tab_id="tab-1", selector=".main")
    )
    asyncio.run(client.aclose())

    assert secret_value == "resolved-secret"
    assert secret_present is True
    assert workspace_path.as_posix() == "workspace-root/backend/data/calendar.db"
    assert database_path.as_posix() == "database-root/blackboard/snapshot.db"
    assert ensured_path.as_posix() == "workspace-root/artifacts/reports"
    assert text_artifact.artifact_id == "artifact-text"
    assert text_artifact.metadata == {"toolId": context.tool_id}
    assert bytes_artifact.artifact_id == "artifact-bytes"
    assert bytes_artifact.content_type == "application/octet-stream"
    assert described_artifact.metadata == {"described": True}
    assert state_value == {"count": 1}
    assert mcp_result == {
        "ok": True,
        "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "content": [{"type": "text", "text": "search completed"}],
        "structuredContent": {"echoedArguments": {"keyword": "library"}},
        "snapshotRevision": 8,
        "isError": False,
    }
    assert browser_page == HostBrowserPage(
        tab_id="main-window",
        current_url="https://example.com/",
        title="Example Domain",
        window_visible=True,
    )
    assert browser_screenshot == HostBrowserScreenshot(
        page=HostBrowserPage(
            tab_id="main-window",
            current_url="https://example.com/",
            title="Example Domain",
            window_visible=True,
        ),
        artifact=HostArtifact(
            artifact_id="artifact-browser-screenshot",
            uri="artifact://desktop/browser-screenshot.png",
            name="browser-capture",
            content_type="image/png",
            metadata={"source": "browser.screenshot"},
        ),
    )
    assert len(browser_tabs) == 2
    assert browser_tabs[0].tab_id == "tab-1"
    assert browser_tabs[1].tab_id == "tab-2"
    assert str(closed_tab.tab_id) == "tab-2"
    assert closed_tab.window_visible is False
    assert switched_tab.tab_id == "tab-3"
    assert execute_result == {"result": "executed: document.title", "tabId": "tab-1"}
    assert reset_result == {"closedCount": 2}
    assert "Click me" in str(snapshot_result.get("snapshot", ""))
    assert snapshot_result.get("elementCount") == 5
    assert snapshot_result.get("interactiveCount") == 2

    assert captured_headers == ["bridge-token-123"] * len(captured_headers)
    assert [(item["capability"], item["operation"]) for item in captured_payloads] == [
        ("secret", "get_secret"),
        ("secret", "has_secret"),
        ("workspace", "resolve_path"),
        ("database", "resolve_path"),
        ("workspace", "ensure_directory"),
        ("artifact", "save_text"),
        ("artifact", "save_bytes"),
        ("artifact", "describe_artifact"),
        ("state", "get_value"),
        ("state", "put_value"),
        ("state", "delete_value"),
        ("event", "emit_event"),
        ("mcp", "call_tool"),
        ("browser", "open"),
        ("browser", "screenshot"),
        ("browser", "list_tabs"),
        ("browser", "close_tab"),
        ("browser", "switch_tab"),
        ("browser", "execute"),
        ("browser", "reset"),
        ("browser", "snapshot"),
    ]
    assert all(
        item["toolId"] == context.tool_id
        for item in captured_payloads
        if item["operation"] != "call_tool"
    )
    assert captured_payloads[-9]["toolId"] == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    assert captured_payloads[-8]["toolId"] == context.tool_id
    assert captured_payloads[-8]["payload"] == {"url": "https://example.com/", "showWindow": True}
    assert captured_payloads[-7]["toolId"] == context.tool_id
    assert captured_payloads[-7]["payload"] == {"name": "browser-capture"}
    assert captured_payloads[-6]["toolId"] == context.tool_id
    assert captured_payloads[-6]["payload"] == {}
    assert captured_payloads[-5]["toolId"] == context.tool_id
    assert captured_payloads[-5]["payload"] == {"tabId": "tab-2"}
    assert captured_payloads[-4]["toolId"] == context.tool_id
    assert captured_payloads[-4]["payload"] == {"tabId": "tab-3"}
    assert captured_payloads[-3]["toolId"] == context.tool_id
    assert captured_payloads[-3]["payload"] == {"script": "document.title"}
    assert captured_payloads[-2]["toolId"] == context.tool_id
    assert captured_payloads[-2]["payload"] == {}
    assert captured_payloads[-1]["toolId"] == context.tool_id
    assert captured_payloads[-1]["payload"] == {"tabId": "tab-1", "selector": ".main"}
    assert all(item["runId"] == context.run_id for item in captured_payloads)
    assert all(
        item["toolCallId"] == context.invocation_id
        for item in captured_payloads
        if item["operation"] != "call_tool"
    )
    assert captured_payloads[-9]["toolCallId"] == "mcp.mcp-stdio-stub.search-campus.00004d8d:call-1"
    save_bytes_payload = captured_payloads[6]["payload"]
    assert isinstance(save_bytes_payload, dict)
    assert (
        base64.b64decode(save_bytes_payload["contentBase64"]).decode("utf-8")
        == "payload-bytes"
    )


    mcp_payload = captured_payloads[-9]["payload"]
    assert mcp_payload == {
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "arguments": {"keyword": "library"},
        "snapshotRevision": 8,
    }



def test_desktop_capability_bridge_client_maps_host_error_payloads() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "requestId": payload["requestId"],
                "ok": False,
                "errorCode": "unsupported_operation",
                "errorMessage": "Artifact persistence is not implemented by the host yet.",
                "errorRetryable": False,
                "details": {"reason": "todo"},
            },
            request=request,
        )

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(HostCapabilityOperationError) as exc_info:
        asyncio.run(
            client.save_text(
                context=_build_invocation_context(),
                name="report.json",
                text="{}",
            )
        )

    assert exc_info.value.capability == "artifact"
    assert exc_info.value.code == "unsupported_operation"
    assert exc_info.value.retryable is False
    assert exc_info.value.details == {"reason": "todo", "operation": "save_text"}


def test_desktop_capability_bridge_client_preserves_mcp_first_call_readiness_failures() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "requestId": payload["requestId"],
                "ok": True,
                "result": {
                    "ok": False,
                    "toolId": payload["toolId"],
                    "serverId": payload["payload"]["serverId"],
                    "remoteToolName": payload["payload"]["remoteToolName"],
                    "snapshotRevision": 12,
                    "error": {
                        "code": "server_not_ready",
                        "message": "The MCP server is not ready to execute tools.",
                        "retryable": True,
                        "observedAt": "2026-04-21T12:00:00.000Z",
                        "details": {
                            "requestedServerId": payload["payload"]["serverId"],
                            "requestedRemoteToolName": payload["payload"]["remoteToolName"],
                            "connectionState": "connected",
                            "connectorToolCount": 0,
                            "requestedSnapshotRevision": payload["payload"].get("snapshotRevision"),
                            "snapshotRevision": 12,
                        },
                    },
                },
            },
            request=request,
        )

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    result = asyncio.run(
        client.call_mcp_tool(
            context=_build_invocation_context(
                tool_id="mcp.missing.tool.11111111"
            ),
            server_id="mcp-stdio-stub",
            remote_tool_name="search-campus",
            arguments={"keyword": "library"},
            snapshot_revision=11,
        )
    )

    assert result == {
        "ok": False,
        "toolId": "mcp.missing.tool.11111111",
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "snapshotRevision": 12,
        "error": {
            "code": "server_not_ready",
            "message": "The MCP server is not ready to execute tools.",
            "retryable": True,
            "observedAt": "2026-04-21T12:00:00.000Z",
            "details": {
                "requestedServerId": "mcp-stdio-stub",
                "requestedRemoteToolName": "search-campus",
                "connectionState": "connected",
                "connectorToolCount": 0,
                "requestedSnapshotRevision": 11,
                "snapshotRevision": 12,
            },
        },
    }


def test_desktop_capability_bridge_client_wraps_invalid_error_envelope_validation_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _RaisingBridgeResponse:
        @classmethod
        def model_validate(cls, value: object) -> object:
            if isinstance(value, dict) and value.get("ok") is False:
                ProtocolDesktopCapabilityBridgeResponse.model_validate(
                    {
                        "requestId": "request-1",
                        "ok": False,
                        "errorCode": "timeout",
                    }
                )
            return ProtocolDesktopCapabilityBridgeResponse.model_validate(value)

    monkeypatch.setattr(
        capability_bridge_client_module,
        "DesktopCapabilityBridgeResponse",
        _RaisingBridgeResponse,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "requestId": payload["requestId"],
                "ok": False,
                "errorCode": "timeout",
                "errorMessage": "Host bridge timed out.",
                "errorRetryable": True,
                "details": {"timeoutMs": 5000},
            },
            request=request,
        )

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )


def test_desktop_capability_bridge_client_maps_mcp_timeout_to_structured_timeout() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out while waiting for the MCP bridge")

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(HostCapabilityOperationError) as exc_info:
        asyncio.run(
            client.call_mcp_tool(
                context=_build_invocation_context(
                    tool_id="mcp.mcp-stdio-stub.search-campus.00004d8d"
                ),
                server_id="mcp-stdio-stub",
                remote_tool_name="search-campus",
                arguments={"keyword": "library"},
                snapshot_revision=8,
            )
        )

    error = exc_info.value
    assert error.capability == "mcp"
    assert error.code == "timeout"
    assert error.retryable is True
    assert error.message == (
        "Desktop capability bridge timed out while waiting for the host response."
    )
    assert error.details == {
        "operation": "call_tool",
        "transportErrorType": "ReadTimeout",
    }

    with pytest.raises(HostCapabilityOperationError) as exc_info:
        asyncio.run(
            client.save_text(
                context=_build_invocation_context(),
                name="report.json",
                text="{}",
            )
        )

    assert exc_info.value.capability == "artifact"
    assert exc_info.value.code == "temporarily_unavailable"
    assert exc_info.value.retryable is True
    assert exc_info.value.details == {
        "operation": "save_text",
    }


def test_desktop_capability_bridge_client_omits_request_timeout_when_not_overridden() -> (
    None
):
    captured_post_calls: list[dict[str, object]] = []

    class _RecordingAsyncClient:
        async def post(self, url: str, **kwargs: object) -> httpx.Response:
            captured_post_calls.append({"url": url, **kwargs})
            payload = kwargs["json"]
            assert isinstance(payload, dict)
            return httpx.Response(
                200,
                json={
                    "requestId": payload["requestId"],
                    "ok": True,
                    "result": {"value": "resolved-secret"},
                },
                request=httpx.Request("POST", url),
            )

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
    )
    client._async_client = _RecordingAsyncClient()  # type: ignore[assignment]

    secret_value = asyncio.run(
        client.get_secret(context=_build_invocation_context(), name="bb.password")
    )

    assert secret_value == "resolved-secret"
    assert len(captured_post_calls) == 1
    post_call = captured_post_calls[0]
    assert post_call["url"] == "http://127.0.0.1:45678/host/private/capability-bridge"
    assert "timeout" not in post_call


def test_desktop_capability_bridge_client_preserves_explicit_mcp_timeout_override() -> (
    None
):
    captured_post_calls: list[dict[str, object]] = []

    class _RecordingAsyncClient:
        async def post(self, url: str, **kwargs: object) -> httpx.Response:
            captured_post_calls.append({"url": url, **kwargs})
            payload = kwargs["json"]
            assert isinstance(payload, dict)
            return httpx.Response(
                200,
                json={
                    "requestId": payload["requestId"],
                    "ok": True,
                    "result": {
                        "ok": True,
                        "toolId": payload["toolId"],
                        "serverId": payload["payload"]["serverId"],
                        "remoteToolName": payload["payload"]["remoteToolName"],
                        "content": [],
                        "structuredContent": {},
                        "snapshotRevision": payload["payload"].get("snapshotRevision"),
                        "isError": False,
                    },
                },
                request=httpx.Request("POST", url),
            )

    client = DesktopCapabilityBridgeClient(
        bridge_url="http://127.0.0.1:45678/host/private/capability-bridge",
        bridge_token="bridge-token-123",
    )
    client._async_client = _RecordingAsyncClient()  # type: ignore[assignment]

    result = asyncio.run(
        client.call_mcp_tool(
            context=_build_invocation_context(
                tool_id="mcp.mcp-stdio-stub.search-campus.00004d8d"
            ),
            server_id="mcp-stdio-stub",
            remote_tool_name="search-campus",
            arguments={"keyword": "library"},
            snapshot_revision=8,
        )
    )

    assert result["ok"] is True
    assert len(captured_post_calls) == 1
    post_call = captured_post_calls[0]
    assert post_call["timeout"] == max(client._timeout, 20.0)


def test_desktop_capability_bridge_client_reports_missing_bootstrap_as_unavailable() -> (
    None
):
    client = DesktopCapabilityBridgeClient(bridge_url=None, bridge_token=None)

    with pytest.raises(HostCapabilityOperationError) as exc_info:
        asyncio.run(
            client.get_secret(context=_build_invocation_context(), name="bb.password")
        )

    assert exc_info.value.capability == "secret"
    assert exc_info.value.code == "temporarily_unavailable"
    assert exc_info.value.retryable is True
    assert exc_info.value.details == {"operation": "get_secret"}
