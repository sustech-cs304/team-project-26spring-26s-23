from __future__ import annotations

import asyncio
from pathlib import Path

from app.tooling.file_tools.runtime_bindings import (
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    build_file_tool_read_runtime_binding,
)


def test_file_tool_read_runtime_binding_exposes_schema_and_executes(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.txt"
    target.write_text("alpha\nbeta\ngamma\n", encoding="utf-8")

    binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": "sample.txt", "offset": 2, "limit": 1}))

    assert binding.tool_id == FILE_TOOL_READ_ID
    assert binding.kind == "builtin"
    assert binding.function_name == FILE_TOOL_READ_FUNCTION_NAME
    assert binding.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "offset": {"type": "integer", "minimum": 1, "default": 1},
            "limit": {"type": "integer", "minimum": 1, "default": 2000},
            "includeMetadata": {"type": "boolean", "default": True},
            "parserHint": {"type": "string"},
            "audit": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "actor": {"type": "string"},
                    "intent": {"type": "string"},
                    "sessionId": {"type": "string"},
                    "traceId": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "required": ["path"],
    }
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["content"] == {"text": "beta"}


def test_file_tool_read_runtime_binding_returns_structured_failure_for_binary(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.bin"
    target.write_bytes(b"\x00\x01")

    binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": "sample.bin"}))

    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_input"
    assert result["output"]["error"]["code"] == "binary_unsupported"
