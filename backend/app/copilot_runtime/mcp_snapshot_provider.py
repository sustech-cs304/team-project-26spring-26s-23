"""MCP capability snapshot contracts and snapshot-loading helpers."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, TypeAlias, cast

from pydantic import Field

from app.copilot_runtime.pydantic_contracts import RuntimeContractModel

MCP_SNAPSHOT_VERSION = 1
MCP_CAPABILITY_SNAPSHOT_FILE_NAME = "mcp-capability-snapshot.json"
MCP_CAPABILITY_BRIDGE_STATE_FILE_NAME = "capability-bridge-state.json"
MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID = "__runtime.mcp.catalog__"
MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY = "snapshot"
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


class McpSnapshotCatalogRefreshSummary(RuntimeContractModel):
    refreshed_at: str = Field(alias="refreshedAt")
    tool_count: int = Field(alias="toolCount")


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
    last_successful_catalog_refresh: McpSnapshotCatalogRefreshSummary | None = Field(
        default=None,
        alias="lastSuccessfulCatalogRefresh",
    )


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
    version: Literal[1] = MCP_SNAPSHOT_VERSION
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
McpSnapshotSource: TypeAlias = Literal[
    "snapshot-file", "capability-bridge-state", "cache", "missing"
]


@dataclass(frozen=True, slots=True)
class McpSnapshotProviderLoadResult:
    snapshot: McpCapabilitySnapshot | None
    source: McpSnapshotSource


class McpSnapshotProvider:
    def __init__(
        self,
        *,
        snapshot_file: Path | None,
        capability_bridge_state_file: Path | None = None,
    ) -> None:
        self._snapshot_file = snapshot_file
        self._capability_bridge_state_file = capability_bridge_state_file
        self._cached_snapshot: McpCapabilitySnapshot | None = None

    def load_snapshot(self) -> McpCapabilitySnapshot | None:
        return self.load_snapshot_result().snapshot

    def load_snapshot_result(self) -> McpSnapshotProviderLoadResult:
        snapshot = self._load_from_snapshot_file()
        if snapshot is not None:
            self._cached_snapshot = snapshot
            return McpSnapshotProviderLoadResult(
                snapshot=snapshot,
                source=cast(McpSnapshotSource, "snapshot-file"),
            )

        snapshot = self._load_from_capability_bridge_state()
        if snapshot is not None:
            self._cached_snapshot = snapshot
            return McpSnapshotProviderLoadResult(
                snapshot=snapshot,
                source=cast(McpSnapshotSource, "capability-bridge-state"),
            )

        if self._cached_snapshot is not None:
            return McpSnapshotProviderLoadResult(
                snapshot=self._cached_snapshot,
                source=cast(McpSnapshotSource, "cache"),
            )

        return McpSnapshotProviderLoadResult(
            snapshot=None,
            source=cast(McpSnapshotSource, "missing"),
        )

    def _load_from_snapshot_file(self) -> McpCapabilitySnapshot | None:
        if self._snapshot_file is None:
            return None
        payload = _read_json_file(self._snapshot_file)
        if payload is None:
            return None
        return _validate_snapshot_payload(payload)

    def _load_from_capability_bridge_state(self) -> McpCapabilitySnapshot | None:
        if self._capability_bridge_state_file is None:
            return None
        payload = _read_json_file(self._capability_bridge_state_file)
        if payload is None:
            return None
        extracted = _extract_snapshot_from_capability_bridge_state(payload)
        if extracted is None:
            return None
        return _validate_snapshot_payload(extracted)


def create_mcp_snapshot_provider(
    *,
    state_dir: Path | None,
) -> McpSnapshotProvider:
    if state_dir is None:
        return McpSnapshotProvider(
            snapshot_file=None, capability_bridge_state_file=None
        )
    return McpSnapshotProvider(
        snapshot_file=state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME,
        capability_bridge_state_file=state_dir / MCP_CAPABILITY_BRIDGE_STATE_FILE_NAME,
    )


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
            violations.extend(
                collect_mcp_snapshot_forbidden_paths(item, _path=next_path)
            )
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


def _read_json_file(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def _extract_snapshot_from_capability_bridge_state(payload: Any) -> Any | None:
    if not isinstance(payload, Mapping):
        return None
    values = payload.get("values")
    if not isinstance(values, Mapping):
        return None
    tool_values = values.get("tool")
    if not isinstance(tool_values, Mapping):
        return None
    tool_bucket = tool_values.get(MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID)
    if not isinstance(tool_bucket, Mapping):
        return None
    return tool_bucket.get(MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY)


def _validate_snapshot_payload(payload: Any) -> McpCapabilitySnapshot | None:
    if payload is None:
        return None
    if collect_mcp_snapshot_forbidden_paths(payload):
        return None
    try:
        return validate_mcp_capability_snapshot(payload)
    except Exception:
        return None


__all__ = [
    "MCP_CAPABILITY_BRIDGE_STATE_FILE_NAME",
    "MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY",
    "MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID",
    "MCP_CAPABILITY_SNAPSHOT_FILE_NAME",
    "MCP_SNAPSHOT_FORBIDDEN_FIELD_KEYS",
    "MCP_SNAPSHOT_VERSION",
    "McpCapabilitySnapshot",
    "McpErrorSummary",
    "McpSnapshotProvider",
    "McpSnapshotProviderLoadResult",
    "McpSnapshotSource",
    "McpSnapshotGroupSummary",
    "McpSnapshotCatalogRefreshSummary",
    "McpSnapshotServerSummary",
    "McpSnapshotToolSummary",
    "McpToolCallFailureModel",
    "McpToolCallRequestModel",
    "McpToolCallResultModel",
    "McpToolCallSuccessModel",
    "collect_mcp_snapshot_forbidden_paths",
    "create_mcp_snapshot_provider",
    "validate_mcp_capability_snapshot",
    "validate_mcp_tool_call_request",
    "validate_mcp_tool_call_result",
]
