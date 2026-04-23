from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.copilot_runtime.mcp_snapshot_provider import (
    MCP_CAPABILITY_BRIDGE_STATE_FILE_NAME,
    MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY,
    MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID,
    MCP_CAPABILITY_SNAPSHOT_FILE_NAME,
    MCP_SNAPSHOT_VERSION,
    collect_mcp_snapshot_forbidden_paths,
    create_mcp_snapshot_provider,
    validate_mcp_capability_snapshot,
    validate_mcp_tool_call_request,
    validate_mcp_tool_call_result,
)

_FIXTURE_ROOT = (
    Path(__file__).resolve().parents[4]
    / "frontend-copilot"
    / "electron"
    / "mcp-registry"
    / "test-fixtures"
)


def _load_fixture(name: str) -> dict[str, object]:
    return json.loads((_FIXTURE_ROOT / name).read_text(encoding="utf-8"))


def test_validate_mcp_capability_snapshot_accepts_shared_fixture_and_keeps_redaction_guard() -> None:
    payload = _load_fixture("snapshot.sample.json")

    snapshot = validate_mcp_capability_snapshot(payload)

    assert snapshot.version == MCP_SNAPSHOT_VERSION
    assert [server.server_id for server in snapshot.servers] == [
        "mcp-stdio-stub",
        "mcp-http-sse-stub",
    ]
    assert [tool.tool_id for tool in snapshot.tools] == [
        "mcp.mcp-stdio-stub.search-campus.00004d8d",
        "mcp.mcp-http-sse-stub.fetch-calendar.00005a3e",
    ]
    assert collect_mcp_snapshot_forbidden_paths(payload) == []


def test_collect_mcp_snapshot_forbidden_paths_ignores_public_input_schema_keys() -> None:
    payload = _load_fixture("snapshot.sample.json")
    payload["tools"][0]["inputSchema"] = {
        "type": "object",
        "properties": {
            "token": {"type": "string"},
            "headers": {"type": "object"},
            "args": {"type": "array"},
            "command": {"type": "string"},
        },
    }

    assert collect_mcp_snapshot_forbidden_paths(payload) == []
    assert validate_mcp_capability_snapshot(payload).tools[0].input_schema["properties"] == {
        "token": {"type": "string"},
        "headers": {"type": "object"},
        "args": {"type": "array"},
        "command": {"type": "string"},
    }


def test_collect_mcp_snapshot_forbidden_paths_rejects_host_sensitive_fields_outside_input_schema() -> None:
    payload = _load_fixture("snapshot.sample.json")
    payload["servers"][0]["headers"] = {"authorization": "Bearer desktop-secret"}

    assert collect_mcp_snapshot_forbidden_paths(payload) == ["servers[0].headers"]


def test_validate_mcp_capability_snapshot_rejects_version_mismatch() -> None:
    payload = _load_fixture("snapshot.sample.json")
    payload["version"] = MCP_SNAPSHOT_VERSION + 1

    with pytest.raises(ValidationError):
        validate_mcp_capability_snapshot(payload)


def test_validate_mcp_tool_call_request_accepts_shared_fixture() -> None:
    payload = _load_fixture("tool-call.request.sample.json")

    request = validate_mcp_tool_call_request(payload)

    assert request.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    assert request.server_id == "mcp-stdio-stub"
    assert request.snapshot_revision == 8
    assert request.arguments == {"keyword": "library"}


def test_validate_mcp_tool_call_result_keeps_directory_drift_error_shape() -> None:
    payload = _load_fixture("tool-call.directory-drift.sample.json")

    result = validate_mcp_tool_call_result(payload)

    assert result.ok is False
    assert result.tool_id == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    assert result.error.code == "directory_drift"
    assert result.error.retryable is False
    assert result.snapshot_revision == 8



def test_create_mcp_snapshot_provider_returns_missing_when_state_dir_is_unavailable() -> None:
    provider = create_mcp_snapshot_provider(state_dir=None)

    result = provider.load_snapshot_result()

    assert result.source == "missing"
    assert result.snapshot is None



def test_create_mcp_snapshot_provider_prefers_snapshot_file_then_bridge_then_cache(
    tmp_path: Path,
) -> None:
    provider = create_mcp_snapshot_provider(state_dir=tmp_path)
    snapshot_payload = _load_fixture("snapshot.sample.json")
    snapshot_file = tmp_path / MCP_CAPABILITY_SNAPSHOT_FILE_NAME
    bridge_state_file = tmp_path / MCP_CAPABILITY_BRIDGE_STATE_FILE_NAME

    snapshot_file.write_text(json.dumps(snapshot_payload), encoding="utf-8")

    from_snapshot_file = provider.load_snapshot_result()

    assert from_snapshot_file.source == "snapshot-file"
    assert from_snapshot_file.snapshot is not None
    assert from_snapshot_file.snapshot.snapshot_revision == 8

    snapshot_file.unlink()
    bridge_state_file.write_text(
        json.dumps(
            {
                "version": 1,
                "values": {
                    "tool": {
                        MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID: {
                            MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY: snapshot_payload,
                        }
                    },
                    "run": {},
                },
            }
        ),
        encoding="utf-8",
    )

    from_bridge_state = provider.load_snapshot_result()

    assert from_bridge_state.source == "capability-bridge-state"
    assert from_bridge_state.snapshot is not None
    assert from_bridge_state.snapshot.snapshot_revision == 8

    bridge_state_file.write_text("{ this is not valid json }\n", encoding="utf-8")

    from_cache = provider.load_snapshot_result()

    assert from_cache.source == "cache"
    assert from_cache.snapshot is not None
    assert from_cache.snapshot.snapshot_revision == 8



def test_create_mcp_snapshot_provider_rejects_leaked_bridge_snapshot_payload(
    tmp_path: Path,
) -> None:
    provider = create_mcp_snapshot_provider(state_dir=tmp_path)
    leaked_payload = _load_fixture("snapshot.sample.json")
    leaked_payload["token"] = "desktop-local-token"

    (tmp_path / MCP_CAPABILITY_BRIDGE_STATE_FILE_NAME).write_text(
        json.dumps(
            {
                "version": 1,
                "values": {
                    "tool": {
                        MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID: {
                            MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY: leaked_payload,
                        }
                    },
                    "run": {},
                },
            }
        ),
        encoding="utf-8",
    )

    result = provider.load_snapshot_result()

    assert result.source == "missing"
    assert result.snapshot is None
