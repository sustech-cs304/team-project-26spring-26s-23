from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.copilot_runtime.mcp_snapshot_provider import (
    MCP_SNAPSHOT_VERSION,
    collect_mcp_snapshot_forbidden_paths,
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
