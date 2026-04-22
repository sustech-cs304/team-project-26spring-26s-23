from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from app.copilot_runtime.mcp_catalog_provider import (
    McpCatalogProvider,
    build_mcp_catalog_entries,
    create_mcp_catalog_provider,
)
from app.copilot_runtime.mcp_snapshot_provider import McpCapabilitySnapshot, McpSnapshotProvider

_FIXTURE_ROOT = (
    Path(__file__).resolve().parents[4]
    / "frontend-copilot"
    / "electron"
    / "mcp-registry"
    / "test-fixtures"
)


@dataclass(slots=True)
class _SnapshotProvider:
    snapshot: McpCapabilitySnapshot | None

    def load_snapshot(self) -> McpCapabilitySnapshot | None:
        return self.snapshot


def _load_snapshot_fixture() -> McpCapabilitySnapshot:
    payload = json.loads((_FIXTURE_ROOT / "snapshot.sample.json").read_text(encoding="utf-8"))
    return McpCapabilitySnapshot.model_validate(payload)


def test_build_mcp_catalog_entries_maps_snapshot_tools_to_runtime_directory_entries() -> None:
    snapshot = _load_snapshot_fixture()

    entries = build_mcp_catalog_entries(snapshot)

    assert [entry["toolId"] for entry in entries] == [
        "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
        "mcp.mcp-stdio-stub.search-campus.00004d8d",
    ]
    calendar_entry = entries[0]
    assert calendar_entry == {
        "toolId": "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
        "kind": "mcp",
        "availability": "available",
        "displayName": "Fetch Calendar",
        "displayNameZh": "Fetch Calendar",
        "displayNameEn": "Fetch Calendar",
        "serverId": "mcp-http-sse-stub",
        "remoteToolName": "fetch-calendar",
        "mcpServerName": "Productivity",
        "description": "Fetch the current course calendar.",
        "descriptionZh": "Fetch the current course calendar.",
        "descriptionEn": "Fetch the current course calendar.",
        "group": {
            "id": "mcp-productivity",
            "label": "Productivity",
            "labelZh": "Productivity",
            "labelEn": "Productivity",
            "order": 101,
            "sourceKind": "mcp-server",
        },
    }


def test_build_mcp_catalog_entries_falls_back_to_server_group_metadata() -> None:
    snapshot = McpCapabilitySnapshot.model_validate(
        {
            **_load_snapshot_fixture().model_dump(by_alias=True),
            "tools": [
                {
                    **tool,
                    "groupId": "mcp-missing-group",
                    "groupLabel": None,
                }
                for tool in _load_snapshot_fixture().model_dump(by_alias=True)["tools"]
            ],
            "groups": [],
        }
    )

    entries = build_mcp_catalog_entries(snapshot)

    search_entry = next(
        entry for entry in entries if entry["toolId"] == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    assert search_entry["group"] == {
        "id": "mcp.server.mcp-stdio-stub",
        "label": "Stdio Stub Server",
        "labelZh": "Stdio Stub Server",
        "labelEn": "Stdio Stub Server",
        "order": 1000,
        "sourceKind": "mcp-server",
    }


def test_build_mcp_catalog_entries_builds_readable_tool_name_when_snapshot_name_is_missing() -> None:
    fixture_snapshot = _load_snapshot_fixture().model_dump(by_alias=True)
    search_tool = next(
        tool
        for tool in fixture_snapshot["tools"]
        if tool["toolId"] == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    snapshot = McpCapabilitySnapshot.model_validate(
        {
            **fixture_snapshot,
            "tools": [
                {
                    **search_tool,
                    "displayName": "",
                }
            ],
        }
    )

    entries = build_mcp_catalog_entries(snapshot)

    entry = next(
        item for item in entries if item["toolId"] == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )

    assert entry["displayName"] == "Stdio Stub Server / Search Campus"
    assert entry["displayNameZh"] == "Stdio Stub Server / Search Campus"
    assert entry["displayNameEn"] == "Stdio Stub Server / Search Campus"
    assert entry["serverId"] == "mcp-stdio-stub"
    assert entry["remoteToolName"] == "search-campus"


def test_mcp_catalog_provider_returns_empty_catalog_when_snapshot_is_missing() -> None:
    provider = create_mcp_catalog_provider(
        cast(McpSnapshotProvider, _SnapshotProvider(snapshot=None))
    )

    assert provider.load_catalog_entries(language="zh-CN") == ()


def test_mcp_catalog_provider_loads_snapshot_entries_without_parallel_catalog_path() -> None:
    snapshot = _load_snapshot_fixture()
    provider = McpCatalogProvider(
        snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider(snapshot=snapshot))
    )

    entries = provider.load_catalog_entries(language="en-US")

    assert len(entries) == 2
    assert {entry["kind"] for entry in entries} == {"mcp"}
