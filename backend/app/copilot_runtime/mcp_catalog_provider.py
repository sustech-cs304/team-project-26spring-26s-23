"""Map MCP capability snapshots into global tool catalog entries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .mcp_snapshot_provider import McpCapabilitySnapshot, McpSnapshotProvider


@dataclass(frozen=True, slots=True)
class McpCatalogProvider:
    snapshot_provider: McpSnapshotProvider

    def load_catalog_entries(self, *, language: str | None = None) -> tuple[dict[str, Any], ...]:
        _ = language
        snapshot = self.snapshot_provider.load_snapshot()
        if snapshot is None:
            return ()
        return build_mcp_catalog_entries(snapshot)


def create_mcp_catalog_provider(snapshot_provider: McpSnapshotProvider) -> McpCatalogProvider:
    return McpCatalogProvider(snapshot_provider=snapshot_provider)


def build_mcp_catalog_entries(
    snapshot: McpCapabilitySnapshot,
) -> tuple[dict[str, Any], ...]:
    server_by_id = {server.server_id: server for server in snapshot.servers}
    group_by_id = {group.group_id: group for group in snapshot.groups}
    group_order_by_id = {
        group.group_id: index for index, group in enumerate(snapshot.groups, start=100)
    }

    entries: list[dict[str, Any]] = []
    for tool in sorted(snapshot.tools, key=lambda item: (item.server_id, item.remote_tool_name)):
        group_id, group_label, group_order = _resolve_group_metadata(
            tool=tool,
            server_by_id=server_by_id,
            group_by_id=group_by_id,
            group_order_by_id=group_order_by_id,
        )
        entry: dict[str, Any] = {
            "toolId": tool.tool_id,
            "kind": "mcp",
            "availability": tool.availability,
            "displayName": tool.display_name,
            "displayNameZh": tool.display_name,
            "displayNameEn": tool.display_name,
            "group": {
                "id": group_id,
                "label": group_label,
                "labelZh": group_label,
                "labelEn": group_label,
                "order": group_order,
                "sourceKind": "mcp",
            },
        }
        if tool.description is not None:
            entry["description"] = tool.description
            entry["descriptionZh"] = tool.description
            entry["descriptionEn"] = tool.description
        entries.append(entry)

    return tuple(entries)


def _resolve_group_metadata(
    *,
    tool: Any,
    server_by_id: dict[str, Any],
    group_by_id: dict[str, Any],
    group_order_by_id: dict[str, int],
) -> tuple[str, str, int]:
    if tool.group_id is not None:
        group = group_by_id.get(tool.group_id)
        if group is not None:
            return (
                group.group_id,
                group.display_name,
                group_order_by_id.get(group.group_id, 1000),
            )
        if tool.group_label is not None:
            return (tool.group_id, tool.group_label, 1000)

    server = server_by_id.get(tool.server_id)
    server_label = server.display_name if server is not None else tool.server_id
    fallback_group_id = f"mcp.server.{tool.server_id}"
    return fallback_group_id, server_label, 1000


__all__ = [
    "McpCatalogProvider",
    "build_mcp_catalog_entries",
    "create_mcp_catalog_provider",
]
