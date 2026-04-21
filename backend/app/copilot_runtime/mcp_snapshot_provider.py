"""P0 MCP snapshot and bridge contract models shared with Electron main.

This module deliberately freezes payload shape and validation rules only.
Snapshot loading, caching, and bridge transport behavior remain deferred to
later implementation phases.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeAlias

from pydantic import Field

from app.copilot_runtime.pydantic_contracts import RuntimeContractModel

MCP_SNAPSHOT_VERSION = 1
MCP_SNAPSHOT_FORBIDDEN_FIELD_KEYS = frozenset(
    {
        "apikey",
        "args",
        "authorization",
        "command",
        "env",
        "headers",
        "localtoken",
        "password",
        "passwords",
        "secret",
        "secrets",
        "token",
        "tokens",
    }
)


class McpErrorSummary(RuntimeContractModel):
    code: str
    message: str
    retryable: bool
    observed_at: str | None = Field(default=None, alias="observedAt")
    details: dict[str, Any] | None = None


class McpSnapshotServerSummary(RuntimeContractModel):
    server_id: str = Field(alias="serverId")
    display_name: str = Field(alias="displayName")
    transport_kind: Literal["stdio", "http-sse"] = Field(alias="transportKind")
    connection_state: Literal[
        "disabled", "idle", "connecting", "connected", "degraded", "error"
    ] = Field(alias="connectionState")
    tool_count: int = Field(alias="toolCount")
    last_handshake_at: str | None = Field(default=None, alias="lastHandshakeAt")
    last_catalog_sync_at: str | None = Field(default=None, alias="lastCatalogSyncAt")
    last_error: McpErrorSummary | None = Field(default=None, alias="lastError")


class McpSnapshotToolSummary(RuntimeContractModel):
    tool_id: str = Field(alias="toolId")
    server_id: str = Field(alias="serverId")
    remote_tool_name: str = Field(alias="remoteToolName")
    display_name: str = Field(alias="displayName")
    description: str | None = None
    input_schema: dict[str, Any] = Field(default_factory=dict, alias="inputSchema")
    source_kind: Literal["mcp"] = Field(default="mcp", alias="sourceKind")
    availability: Literal["available", "degraded", "unavailable"]
    group_id: str | None = Field(default=None, alias="groupId")
    group_label: str | None = Field(default=None, alias="groupLabel")


class McpSnapshotGroupSummary(RuntimeContractModel):
    group_id: str = Field(alias="groupId")
    display_name: str = Field(alias="displayName")
    source_kind: Literal["mcp"] = Field(default="mcp", alias="sourceKind")
    tool_ids: list[str] = Field(default_factory=list, alias="toolIds")


class McpCapabilitySnapshot(RuntimeContractModel):
    version: Literal[MCP_SNAPSHOT_VERSION] = MCP_SNAPSHOT_VERSION
    registry_revision: int = Field(alias="registryRevision")
    snapshot_revision: int = Field(alias="snapshotRevision")
    generated_at: str = Field(alias="generatedAt")
    servers: list[McpSnapshotServerSummary] = Field(default_factory=list)
    tools: list[McpSnapshotToolSummary] = Field(default_factory=list)
    groups: list[McpSnapshotGroupSummary] = Field(default_factory=list)


class McpToolCallRequestModel(RuntimeContractModel):
    tool_id: str = Field(alias="toolId")
    server_id: str = Field(alias="serverId")
    remote_tool_name: str = Field(alias="remoteToolName")
    arguments: dict[str, Any] = Field(default_factory=dict)
    run_id: str = Field(alias="runId")
    tool_call_id: str = Field(alias="toolCallId")
    snapshot_revision: int | None = Field(default=None, alias="snapshotRevision")


class McpToolCallSuccessModel(RuntimeContractModel):
    ok: Literal[True] = True
    tool_id: str = Field(alias="toolId")
    server_id: str = Field(alias="serverId")
    remote_tool_name: str = Field(alias="remoteToolName")
    content: list[Any] = Field(default_factory=list)
    structured_content: Any = Field(default=None, alias="structuredContent")
    snapshot_revision: int | None = Field(default=None, alias="snapshotRevision")
    is_error: bool = Field(default=False, alias="isError")


class McpToolCallFailureModel(RuntimeContractModel):
    ok: Literal[False] = False
    tool_id: str = Field(alias="toolId")
    server_id: str = Field(alias="serverId")
    remote_tool_name: str = Field(alias="remoteToolName")
    snapshot_revision: int | None = Field(default=None, alias="snapshotRevision")
    error: McpErrorSummary


McpToolCallResultModel: TypeAlias = McpToolCallSuccessModel | McpToolCallFailureModel


def validate_mcp_capability_snapshot(payload: Any) -> McpCapabilitySnapshot:
    return McpCapabilitySnapshot.model_validate(payload)


def validate_mcp_tool_call_request(payload: Any) -> McpToolCallRequestModel:
    return McpToolCallRequestModel.model_validate(payload)


def validate_mcp_tool_call_result(payload: Any) -> McpToolCallResultModel:
    if isinstance(payload, Mapping) and payload.get("ok") is True:
        return McpToolCallSuccessModel.model_validate(payload)
    return McpToolCallFailureModel.model_validate(payload)


def collect_mcp_snapshot_forbidden_paths(payload: Any, *, _path: str = "") -> list[str]:
    if isinstance(payload, RuntimeContractModel):
        payload = payload.model_dump(by_alias=True, exclude_none=False)

    if isinstance(payload, list):
        violations: list[str] = []
        for index, item in enumerate(payload):
            next_path = f"{_path}[{index}]" if _path else f"[{index}]"
            violations.extend(collect_mcp_snapshot_forbidden_paths(item, _path=next_path))
        return violations

    if not isinstance(payload, Mapping):
        return []

    violations: list[str] = []
    for key, value in payload.items():
        next_path = f"{_path}.{key}" if _path else str(key)
        if _normalize_forbidden_key(key) in MCP_SNAPSHOT_FORBIDDEN_FIELD_KEYS:
            violations.append(next_path)
            continue
        violations.extend(collect_mcp_snapshot_forbidden_paths(value, _path=next_path))
    return violations


def _normalize_forbidden_key(value: Any) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


__all__ = [
    "MCP_SNAPSHOT_FORBIDDEN_FIELD_KEYS",
    "MCP_SNAPSHOT_VERSION",
    "McpCapabilitySnapshot",
    "McpErrorSummary",
    "McpSnapshotGroupSummary",
    "McpSnapshotServerSummary",
    "McpSnapshotToolSummary",
    "McpToolCallFailureModel",
    "McpToolCallRequestModel",
    "McpToolCallResultModel",
    "McpToolCallSuccessModel",
    "collect_mcp_snapshot_forbidden_paths",
    "validate_mcp_capability_snapshot",
    "validate_mcp_tool_call_request",
    "validate_mcp_tool_call_result",
]
