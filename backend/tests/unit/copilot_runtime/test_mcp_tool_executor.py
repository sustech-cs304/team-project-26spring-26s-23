from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from pathlib import Path
from typing import Any, TypeVar, cast

from app.copilot_runtime.mcp_snapshot_provider import (
    MCP_CAPABILITY_SNAPSHOT_FILE_NAME,
    McpCapabilitySnapshot,
    McpSnapshotProvider,
    create_mcp_snapshot_provider,
)
from app.copilot_runtime.mcp_tool_executor import (
    McpExecutableToolLoader,
    build_mcp_executable_tools,
    build_mcp_tool_execution_target,
    build_mcp_tool_function_name,
    execute_mcp_tool,
    normalize_mcp_parameters_schema,
    resolve_latest_execution_target,
)
from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.tooling import ToolInvocationContext
from app.tooling.host_capabilities import HostCapabilityOperationError

_T = TypeVar("_T")

_FIXTURE_ROOT = (
    Path(__file__).resolve().parents[4]
    / "frontend-copilot"
    / "electron"
    / "mcp-registry"
    / "test-fixtures"
)


async def _await_value(awaitable: Awaitable[_T]) -> _T:
    return await awaitable


def _run_awaitable(awaitable: Awaitable[_T]) -> _T:
    return asyncio.run(_await_value(awaitable))


class _RecordingBridgeClient:
    def __init__(self, result: dict[str, Any] | Exception) -> None:
        self._result = result
        self.calls: list[dict[str, Any]] = []

    async def call_mcp_tool(
        self,
        *,
        context: ToolInvocationContext,
        server_id: str,
        remote_tool_name: str,
        arguments: dict[str, Any] | None = None,
        snapshot_revision: int | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "toolId": context.tool_id,
                "serverId": server_id,
                "remoteToolName": remote_tool_name,
                "arguments": dict(arguments or {}),
                "snapshotRevision": snapshot_revision,
                "runId": context.run_id,
                "toolCallId": context.invocation_id,
            }
        )
        if isinstance(self._result, Exception):
            raise self._result
        return dict(self._result)


class _SnapshotProvider:
    def __init__(self, snapshot: McpCapabilitySnapshot | None) -> None:
        self._snapshot = snapshot

    def load_snapshot(self) -> McpCapabilitySnapshot | None:
        return self._snapshot


def test_build_mcp_tool_execution_target_uses_snapshot_group_metadata() -> None:
    snapshot = _load_snapshot_fixture()
    tool = next(
        entry
        for entry in snapshot.tools
        if entry.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )

    target = build_mcp_tool_execution_target(snapshot=snapshot, tool=tool)

    assert target.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    assert target.server_id == "mcp-stdio-stub"
    assert target.remote_tool_name == "search-campus"
    assert target.display_name == "Search Campus"
    assert target.description == "Search the campus knowledge base."
    assert target.input_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "keyword": {"type": "string"},
        },
        "required": ["keyword"],
    }
    assert target.availability == "available"
    assert target.snapshot_revision == 8
    assert target.group_id == "mcp-search"
    assert target.group_label == "Search"


def test_build_mcp_executable_tools_exposes_snapshot_tools_with_stable_function_names() -> None:
    snapshot = _load_snapshot_fixture()
    bridge_client = cast(
        DesktopCapabilityBridgeClient,
        _RecordingBridgeClient(
            {
                "ok": True,
                "toolId": "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
                "serverId": "mcp-http-sse-stub",
                "remoteToolName": "fetch-calendar",
                "content": [],
                "structuredContent": None,
                "snapshotRevision": 8,
                "isError": False,
            }
        ),
    )

    tools = build_mcp_executable_tools(
        snapshot=snapshot,
        bridge_client=bridge_client,
        snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(snapshot)),
    )
    tool_by_id = {tool.tool_id: tool for tool in tools}

    assert tuple(tool_by_id) == (
        "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
        "mcp.mcp-stdio-stub.search-campus.00004d8d",
    )
    search_tool = tool_by_id["mcp.mcp-stdio-stub.search-campus.00004d8d"]
    assert search_tool.descriptor.kind == "mcp"
    assert search_tool.descriptor.display_name == "Search Campus"
    assert search_tool.descriptor.presentation is not None
    assert search_tool.descriptor.presentation.group is not None
    assert search_tool.descriptor.presentation.group.group_id == "mcp-search"
    assert search_tool.function_name == "mcp_mcp_stdio_stub_search_campus_00004d8d"
    assert search_tool.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "keyword": {"type": "string"},
        },
        "required": ["keyword"],
    }


def test_mcp_executable_tool_loader_reads_snapshot_file_and_executes_bridge_call(
    tmp_path: Path,
) -> None:
    snapshot_payload = json.loads(
        (_FIXTURE_ROOT / "snapshot.sample.json").read_text(encoding="utf-8")
    )
    (tmp_path / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )
    provider = create_mcp_snapshot_provider(state_dir=tmp_path)
    bridge = _RecordingBridgeClient(
        {
            "ok": True,
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "content": [{"type": "text", "text": "search completed"}],
            "structuredContent": {"count": 1},
            "snapshotRevision": 8,
            "isError": False,
        }
    )
    loader = McpExecutableToolLoader(
        snapshot_provider=provider,
        bridge_client=cast(DesktopCapabilityBridgeClient, bridge),
    )

    tools = loader.load_tools()
    tool = next(
        entry
        for entry in tools
        if entry.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    result = _run_awaitable(tool.execute({"keyword": "library"}))

    assert result == {
        "status": "success",
        "output": {
            "ok": True,
            "content": [{"type": "text", "text": "search completed"}],
            "structuredContent": {"count": 1},
        },
        "artifacts": [],
        "metadata": {
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "sourceKind": "mcp",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "snapshotRevision": 8,
        },
    }
    assert bridge.calls == [
        {
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "arguments": {"keyword": "library"},
            "snapshotRevision": 8,
            "runId": None,
            "toolCallId": "mcp.mcp-stdio-stub.search-campus.00004d8d:direct",
        }
    ]


def test_execute_mcp_tool_maps_directory_drift_to_normalized_not_found_error() -> None:
    snapshot = _load_snapshot_fixture()
    tool = next(
        entry
        for entry in snapshot.tools
        if entry.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    target = build_mcp_tool_execution_target(snapshot=snapshot, tool=tool)
    bridge = _RecordingBridgeClient(
        {
            "ok": False,
            "toolId": target.tool_id,
            "serverId": target.server_id,
            "remoteToolName": target.remote_tool_name,
            "snapshotRevision": 8,
            "error": {
                "code": "directory_drift",
                "message": "The requested MCP tool no longer exists in the current snapshot.",
                "retryable": False,
                "observedAt": "2026-04-21T12:00:00.000Z",
                "details": {"snapshotRevision": 8},
            },
        }
    )

    result = asyncio.run(
        execute_mcp_tool(
            target=target,
            bridge_client=cast(DesktopCapabilityBridgeClient, bridge),
            snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(snapshot)),
            arguments={"keyword": "library"},
        )
    )

    assert result == {
        "status": "error",
        "artifacts": [],
        "metadata": {
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "sourceKind": "mcp",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "snapshotRevision": 8,
        },
        "error": {
            "code": "not_found",
            "message": "The requested MCP tool no longer exists in the current snapshot.",
            "retryable": False,
            "details": {
                "snapshotRevision": 8,
                "mcpErrorCode": "directory_drift",
                "observedAt": "2026-04-21T12:00:00.000Z",
            },
        },
    }


def test_execute_mcp_tool_maps_bridge_unavailable_to_retryable_failure() -> None:
    snapshot = _load_snapshot_fixture()
    tool = next(
        entry
        for entry in snapshot.tools
        if entry.tool_id == "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e"
    )
    target = build_mcp_tool_execution_target(snapshot=snapshot, tool=tool)
    bridge = _RecordingBridgeClient(
        HostCapabilityOperationError(
            capability="mcp",
            code="temporarily_unavailable",
            message="The MCP bridge is temporarily unavailable.",
            retryable=True,
            details={"operation": "call_tool"},
        )
    )

    result = asyncio.run(
        execute_mcp_tool(
            target=target,
            bridge_client=cast(DesktopCapabilityBridgeClient, bridge),
            snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(snapshot)),
            arguments={},
        )
    )

    assert result == {
        "status": "error",
        "artifacts": [],
        "metadata": {
            "toolId": "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
            "sourceKind": "mcp",
            "serverId": "mcp-http-sse-stub",
            "remoteToolName": "fetch-calendar",
            "snapshotRevision": 8,
        },
        "error": {
            "code": "temporarily_unavailable",
            "message": "The MCP bridge is temporarily unavailable.",
            "retryable": True,
            "details": {"capability": "mcp", "operation": "call_tool"},
        },
    }


def test_execute_mcp_tool_preserves_layered_target_resolution_details() -> None:
    snapshot = _load_snapshot_fixture()
    tool = next(
        entry
        for entry in snapshot.tools
        if entry.tool_id == "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e"
    )
    target = build_mcp_tool_execution_target(snapshot=snapshot, tool=tool)
    bridge = _RecordingBridgeClient(
        {
            "ok": False,
            "toolId": target.tool_id,
            "serverId": target.server_id,
            "remoteToolName": target.remote_tool_name,
            "snapshotRevision": 9,
            "error": {
                "code": "server_not_ready",
                "message": "The MCP server is not ready to execute tools.",
                "retryable": True,
                "observedAt": "2026-04-21T12:00:00.000Z",
                "details": {
                    "requestedServerId": target.server_id,
                    "requestedRemoteToolName": target.remote_tool_name,
                    "connectionState": "connecting",
                    "connectorToolCount": 0,
                    "requestedSnapshotRevision": 8,
                    "snapshotRevision": 9,
                },
            },
        }
    )

    result = asyncio.run(
        execute_mcp_tool(
            target=target,
            bridge_client=cast(DesktopCapabilityBridgeClient, bridge),
            snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(snapshot)),
            arguments={"course": "CS304"},
        )
    )

    assert result == {
        "status": "error",
        "artifacts": [],
        "metadata": {
            "toolId": "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
            "sourceKind": "mcp",
            "serverId": "mcp-http-sse-stub",
            "remoteToolName": "fetch-calendar",
            "snapshotRevision": 9,
        },
        "error": {
            "code": "temporarily_unavailable",
            "message": "The MCP server is not ready to execute tools.",
            "retryable": True,
            "details": {
                "requestedServerId": "mcp-http-sse-stub",
                "requestedRemoteToolName": "fetch-calendar",
                "connectionState": "connecting",
                "connectorToolCount": 0,
                "requestedSnapshotRevision": 8,
                "snapshotRevision": 9,
                "mcpErrorCode": "server_not_ready",
                "observedAt": "2026-04-21T12:00:00.000Z",
            },
        },
    }


def test_execute_mcp_tool_uses_bridge_reported_snapshot_revision_for_first_call_not_ready_failures() -> None:
    snapshot = _load_snapshot_fixture()
    tool = next(
        entry
        for entry in snapshot.tools
        if entry.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    target = build_mcp_tool_execution_target(snapshot=snapshot, tool=tool)
    bridge = _RecordingBridgeClient(
        {
            "ok": False,
            "toolId": "mcp.missing.tool.11111111",
            "serverId": target.server_id,
            "remoteToolName": target.remote_tool_name,
            "snapshotRevision": 12,
            "error": {
                "code": "server_not_ready",
                "message": "The MCP server is not ready to execute tools.",
                "retryable": True,
                "observedAt": "2026-04-21T12:00:00.000Z",
                "details": {
                    "requestedServerId": target.server_id,
                    "requestedRemoteToolName": target.remote_tool_name,
                    "connectionState": "connected",
                    "connectorToolCount": 0,
                    "requestedSnapshotRevision": 8,
                    "snapshotRevision": 12,
                },
            },
        }
    )

    result = asyncio.run(
        execute_mcp_tool(
            target=target,
            bridge_client=cast(DesktopCapabilityBridgeClient, bridge),
            snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(snapshot)),
            arguments={"keyword": "library"},
        )
    )

    assert result == {
        "status": "error",
        "artifacts": [],
        "metadata": {
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "sourceKind": "mcp",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "snapshotRevision": 12,
        },
        "error": {
            "code": "temporarily_unavailable",
            "message": "The MCP server is not ready to execute tools.",
            "retryable": True,
            "details": {
                "requestedServerId": "mcp-stdio-stub",
                "requestedRemoteToolName": "search-campus",
                "connectionState": "connected",
                "connectorToolCount": 0,
                "requestedSnapshotRevision": 8,
                "snapshotRevision": 12,
                "mcpErrorCode": "server_not_ready",
                "observedAt": "2026-04-21T12:00:00.000Z",
            },
        },
    }


def test_mcp_tool_helpers_normalize_function_names_and_object_schema() -> None:
    assert (
        build_mcp_tool_function_name("mcp.mcp-stdio-stub.search-campus.00004d8d")
        == "mcp_mcp_stdio_stub_search_campus_00004d8d"
    )
    assert normalize_mcp_parameters_schema(None) == {
        "type": "object",
        "properties": {},
    }


def test_resolve_latest_execution_target_prefers_the_latest_snapshot_revision() -> None:
    snapshot = _load_snapshot_fixture()
    tool = next(
        entry
        for entry in snapshot.tools
        if entry.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    target = build_mcp_tool_execution_target(snapshot=snapshot, tool=tool)

    refreshed_snapshot = snapshot.model_copy(
        update={
            "snapshot_revision": 12,
            "tools": [
                entry.model_copy(update={"description": "Latest description"})
                if entry.tool_id == tool.tool_id
                else entry
                for entry in snapshot.tools
            ],
        }
    )

    resolved = resolve_latest_execution_target(
        target=target,
        snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(refreshed_snapshot)),
    )

    assert resolved.snapshot_revision == 12
    assert resolved.description == "Latest description"
    assert normalize_mcp_parameters_schema({"properties": {"keyword": {"type": "string"}}}) == {
        "type": "object",
        "properties": {"keyword": {"type": "string"}},
    }


def _load_snapshot_fixture() -> McpCapabilitySnapshot:
    return McpCapabilitySnapshot.model_validate(
        json.loads((_FIXTURE_ROOT / "snapshot.sample.json").read_text(encoding="utf-8"))
    )
