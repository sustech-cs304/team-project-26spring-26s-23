"""Executable MCP tool bindings for the Copilot runtime."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast

from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.tooling.contract import NormalizedToolError, ToolInvocationContext
from app.tooling.contract.errors import NormalizedToolErrorCode
from app.tooling.contract.results import ToolResultEnvelope
from app.tooling.host_capabilities import HostCapabilityOperationError
from app.tooling.runtime_adapter.copilot_runtime import (
    RuntimeExecutableToolError,
    get_current_runtime_tool_execution_context,
)

from .mcp_snapshot_provider import (
    McpCapabilitySnapshot,
    McpSnapshotProvider,
    McpSnapshotToolSummary,
)
from .tool_registry import (
    ExecutableTool,
    ToolDescriptor,
    ToolPresentation,
    ToolPresentationGroup,
)

MCP_RUNTIME_TOOL_KIND = "mcp"
_MCP_FUNCTION_NAME_PREFIX = "mcp"


@dataclass(frozen=True, slots=True)
class McpToolExecutionTarget:
    tool_id: str
    server_id: str
    remote_tool_name: str
    display_name: str
    description: str | None
    input_schema: dict[str, Any]
    availability: str
    snapshot_revision: int
    group_id: str
    group_label: str


@dataclass(frozen=True, slots=True)
class McpExecutableToolLoader:
    snapshot_provider: McpSnapshotProvider
    bridge_client: DesktopCapabilityBridgeClient

    def load_tools(self, language: str | None = None) -> tuple[ExecutableTool, ...]:
        _ = language
        snapshot = self.snapshot_provider.load_snapshot()
        if snapshot is None:
            return ()
        return build_mcp_executable_tools(
            snapshot=snapshot, bridge_client=self.bridge_client
        )


def build_mcp_executable_tools(
    *,
    snapshot: McpCapabilitySnapshot,
    bridge_client: DesktopCapabilityBridgeClient,
) -> tuple[ExecutableTool, ...]:
    return tuple(
        build_mcp_executable_tool(
            target=build_mcp_tool_execution_target(snapshot=snapshot, tool=tool),
            bridge_client=bridge_client,
        )
        for tool in sorted(
            snapshot.tools, key=lambda item: (item.server_id, item.remote_tool_name)
        )
        if tool.availability in {"available", "degraded"}
    )


def build_mcp_tool_execution_target(
    *,
    snapshot: McpCapabilitySnapshot,
    tool: McpSnapshotToolSummary,
) -> McpToolExecutionTarget:
    group_by_id = {group.group_id: group for group in snapshot.groups}
    server_by_id = {server.server_id: server for server in snapshot.servers}
    group_id = tool.group_id or f"mcp.server.{tool.server_id}"
    group = group_by_id.get(group_id)
    server = server_by_id.get(tool.server_id)
    group_label = (
        group.display_name
        if group is not None
        else tool.group_label
        or (server.display_name if server is not None else tool.server_id)
    )
    return McpToolExecutionTarget(
        tool_id=tool.tool_id,
        server_id=tool.server_id,
        remote_tool_name=tool.remote_tool_name,
        display_name=tool.display_name,
        description=tool.description,
        input_schema=dict(tool.input_schema),
        availability=tool.availability,
        snapshot_revision=snapshot.snapshot_revision,
        group_id=group_id,
        group_label=group_label,
    )


def build_mcp_executable_tool(
    *,
    target: McpToolExecutionTarget,
    bridge_client: DesktopCapabilityBridgeClient,
) -> ExecutableTool:
    async def execute(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
        return await execute_mcp_tool(
            target=target,
            bridge_client=bridge_client,
            arguments=arguments,
        )

    return ExecutableTool(
        descriptor=ToolDescriptor(
            tool_id=target.tool_id,
            kind=MCP_RUNTIME_TOOL_KIND,
            display_name=target.display_name,
            description=target.description,
            availability=target.availability,
            presentation=ToolPresentation(
                display_name_zh=target.display_name,
                display_name_en=target.display_name,
                description_zh=target.description,
                description_en=target.description,
                group=ToolPresentationGroup(
                    group_id=target.group_id,
                    label_zh=target.group_label,
                    label_en=target.group_label,
                    order=1000,
                    source_kind=MCP_RUNTIME_TOOL_KIND,
                ),
            ),
        ),
        execute=execute,
        function_name=build_mcp_tool_function_name(target.tool_id),
        parameters_json_schema=normalize_mcp_parameters_schema(target.input_schema),
    )


async def execute_mcp_tool(
    *,
    target: McpToolExecutionTarget,
    bridge_client: DesktopCapabilityBridgeClient,
    arguments: Mapping[str, Any] | None,
) -> dict[str, Any]:
    runtime_context = get_current_runtime_tool_execution_context()
    invocation_context = ToolInvocationContext(
        invocation_id=(
            runtime_context.tool_call_id
            if runtime_context is not None and runtime_context.tool_call_id is not None
            else f"{target.tool_id}:direct"
        ),
        tool_id=target.tool_id,
        actor="agent" if runtime_context is None else runtime_context.actor,
        run_id=None if runtime_context is None else runtime_context.run_id,
        requested_at=None if runtime_context is None else runtime_context.requested_at,
        trace={} if runtime_context is None else dict(runtime_context.trace),
        metadata={"runtimeContext": dict(runtime_context.metadata)}
        if runtime_context is not None
        else {},
    )
    normalized_arguments = dict(arguments or {})
    try:
        result = await bridge_client.call_mcp_tool(
            context=invocation_context,
            server_id=target.server_id,
            remote_tool_name=target.remote_tool_name,
            arguments=normalized_arguments,
            snapshot_revision=target.snapshot_revision,
        )
    except HostCapabilityOperationError as exc:
        return ToolResultEnvelope.failure(
            error=map_mcp_bridge_error(exc),
            metadata=build_mcp_result_metadata(target=target),
        ).to_dict()

    if result.get("ok") is True:
        return ToolResultEnvelope.success(
            output={
                "ok": True,
                "content": list(result.get("content") or []),
                "structuredContent": result.get("structuredContent"),
            },
            metadata={
                **build_mcp_result_metadata(target=target),
                "snapshotRevision": result.get("snapshotRevision"),
            },
        ).to_dict()

    if result.get("ok") is False:
        raw_error = result.get("error")
        error_payload: Mapping[str, Any] = (
            raw_error if isinstance(raw_error, Mapping) else {}
        )
        return ToolResultEnvelope.failure(
            error=map_mcp_tool_call_error(error_payload),
            metadata={
                **build_mcp_result_metadata(target=target),
                "snapshotRevision": result.get("snapshotRevision"),
            },
        ).to_dict()

    raise RuntimeExecutableToolError(
        code="execution_failed",
        message="MCP tool bridge returned an invalid result envelope.",
        details={
            "toolId": target.tool_id,
            "serverId": target.server_id,
            "remoteToolName": target.remote_tool_name,
        },
    )


def build_mcp_result_metadata(*, target: McpToolExecutionTarget) -> dict[str, Any]:
    return {
        "toolId": target.tool_id,
        "sourceKind": MCP_RUNTIME_TOOL_KIND,
        "serverId": target.server_id,
        "remoteToolName": target.remote_tool_name,
        "snapshotRevision": target.snapshot_revision,
    }


def map_mcp_bridge_error(error: HostCapabilityOperationError) -> NormalizedToolError:
    code = map_mcp_error_code(error.code)
    details = {"capability": error.capability, **dict(error.details)}
    if error.code != code:
        details["bridgeErrorCode"] = error.code
    return NormalizedToolError(
        code=code,
        message=error.message,
        retryable=error.retryable,
        details=details,
    )


def map_mcp_tool_call_error(error_payload: Mapping[str, Any]) -> NormalizedToolError:
    raw_code = str(error_payload.get("code") or "execution_failed")
    message = str(error_payload.get("message") or "MCP tool execution failed.")
    retryable = error_payload.get("retryable")
    details = error_payload.get("details")
    normalized_details = dict(details) if isinstance(details, Mapping) else {}
    normalized_details["mcpErrorCode"] = raw_code
    observed_at = error_payload.get("observedAt")
    if isinstance(observed_at, str) and observed_at.strip() != "":
        normalized_details["observedAt"] = observed_at.strip()
    return NormalizedToolError(
        code=map_mcp_error_code(raw_code),
        message=message,
        retryable=retryable if isinstance(retryable, bool) else None,
        details=normalized_details,
    )


def map_mcp_error_code(raw_code: str) -> NormalizedToolErrorCode:
    normalized = raw_code.strip()
    if normalized in {
        "invalid_input",
        "host_capability_missing",
        "authentication_required",
        "permission_denied",
        "not_found",
        "conflict",
        "rate_limited",
        "temporarily_unavailable",
        "timeout",
        "cancelled",
        "execution_failed",
    }:
        return cast(NormalizedToolErrorCode, normalized)
    if normalized in {"tool_not_found", "directory_drift"}:
        return "not_found"
    if normalized in {"server_not_ready", "tool_unavailable", "connector_unavailable"}:
        return "temporarily_unavailable"
    if normalized in {"unsupported_capability", "unsupported_operation"}:
        return "host_capability_missing"
    return "execution_failed"


def normalize_mcp_parameters_schema(schema: Mapping[str, Any] | None) -> dict[str, Any]:
    payload = dict(schema or {})
    if payload.get("type") != "object":
        payload["type"] = "object"
    payload.setdefault("properties", {})
    return payload


def build_mcp_tool_function_name(tool_id: str) -> str:
    normalized = re.sub(r"[^0-9a-zA-Z]+", "_", tool_id).strip("_").lower()
    if normalized == "":
        return _MCP_FUNCTION_NAME_PREFIX
    if not normalized.startswith(f"{_MCP_FUNCTION_NAME_PREFIX}_"):
        normalized = f"{_MCP_FUNCTION_NAME_PREFIX}_{normalized}"
    if normalized[0].isdigit():
        normalized = f"{_MCP_FUNCTION_NAME_PREFIX}_{normalized}"
    return normalized


__all__ = [
    "MCP_RUNTIME_TOOL_KIND",
    "McpExecutableToolLoader",
    "McpToolExecutionTarget",
    "build_mcp_executable_tool",
    "build_mcp_executable_tools",
    "build_mcp_tool_execution_target",
    "build_mcp_tool_function_name",
    "execute_mcp_tool",
    "map_mcp_bridge_error",
    "map_mcp_error_code",
    "map_mcp_tool_call_error",
    "normalize_mcp_parameters_schema",
]
