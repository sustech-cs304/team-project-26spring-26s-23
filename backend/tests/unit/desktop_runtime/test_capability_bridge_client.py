from __future__ import annotations

import asyncio
import base64
import json

import httpx
import pytest

from app.desktop_runtime.capability_bridge_client import (
    HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME,
    DesktopCapabilityBridgeClient,
)
from app.tooling import HostCapabilityOperationError, ToolInvocationContext


def _build_invocation_context(*, tool_id: str = "blackboard.snapshot.sync") -> ToolInvocationContext:
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
        captured_headers.append(request.headers.get(HOST_CAPABILITY_BRIDGE_TOKEN_HEADER_NAME))
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
            suffix = "workspace-root" if relative_path is None else f"workspace-root/{relative_path}"
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
            suffix = "database-root" if relative_path is None else f"database-root/{relative_path}"
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
                    "result": {"path": f"workspace-root/{payload['payload']['relativePath']}"},
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
                        "contentType": payload["payload"].get("contentType", "text/plain"),
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
                        "contentType": payload["payload"].get("contentType", "application/octet-stream"),
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
    ]
    assert all(item["toolId"] == context.tool_id for item in captured_payloads)
    assert all(item["runId"] == context.run_id for item in captured_payloads)
    assert all(item["toolCallId"] == context.invocation_id for item in captured_payloads)
    save_bytes_payload = captured_payloads[6]["payload"]
    assert isinstance(save_bytes_payload, dict)
    assert base64.b64decode(save_bytes_payload["contentBase64"]).decode("utf-8") == "payload-bytes"


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


def test_desktop_capability_bridge_client_reports_missing_bootstrap_as_unavailable() -> None:
    client = DesktopCapabilityBridgeClient(bridge_url=None, bridge_token=None)

    with pytest.raises(HostCapabilityOperationError) as exc_info:
        asyncio.run(client.get_secret(context=_build_invocation_context(), name="bb.password"))

    assert exc_info.value.capability == "secret"
    assert exc_info.value.code == "temporarily_unavailable"
    assert exc_info.value.retryable is True
    assert exc_info.value.details == {"operation": "get_secret"}
