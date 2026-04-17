from __future__ import annotations

import asyncio
from pathlib import Path
import os
import time

from app.tooling.file_tools.runtime_bindings import (
    FILE_TOOL_GLOB_FUNCTION_NAME,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    build_file_tool_glob_runtime_binding,
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



def test_file_tool_glob_runtime_binding_exposes_schema_and_executes(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    docs_dir = workspace_root / "docs"
    docs_dir.mkdir(parents=True)
    newer = docs_dir / "newer.md"
    older = docs_dir / "older.md"
    newer.write_text("new", encoding="utf-8")
    older.write_text("old", encoding="utf-8")
    now = time.time()
    os.utime(older, (now - 60, now - 60))
    os.utime(newer, (now - 10, now - 10))

    binding = build_file_tool_glob_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"basePath": "docs", "pattern": "*.md", "maxResults": 1}))

    assert binding.tool_id == FILE_TOOL_GLOB_ID
    assert binding.kind == "builtin"
    assert binding.function_name == FILE_TOOL_GLOB_FUNCTION_NAME
    assert binding.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "pattern": {"type": "string", "minLength": 1},
            "basePath": {"type": "string", "minLength": 1, "default": "."},
            "includeHidden": {"type": "boolean", "default": False},
            "maxResults": {"type": "integer", "minimum": 1, "default": 500},
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
        "required": ["pattern"],
    }
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["truncated"] is True
    assert [match["path"] for match in result["output"]["data"]["matches"]] == ["docs/newer.md"]
