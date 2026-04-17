from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path

from app.tooling.file_tools.runtime_bindings import (
    FILE_TOOL_GLOB_FUNCTION_NAME,
    FILE_TOOL_GLOB_ID,
    FILE_TOOL_GREP_FUNCTION_NAME,
    FILE_TOOL_GREP_ID,
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    FILE_TOOL_SWITCH_ROOT_FUNCTION_NAME,
    FILE_TOOL_SWITCH_ROOT_ID,
    FILE_TOOL_WRITE_FUNCTION_NAME,
    FILE_TOOL_WRITE_ID,
    build_file_tool_glob_runtime_binding,
    build_file_tool_grep_runtime_binding,
    build_file_tool_read_runtime_binding,
    build_file_tool_switch_root_runtime_binding,
    build_file_tool_write_runtime_binding,
)
from app.tooling.runtime_adapter.copilot_runtime import RuntimeToolExecutionContext, runtime_tool_execution_scope


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
            "pages": {
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {"type": "integer", "minimum": 1},
            },
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


def test_file_tool_write_runtime_binding_exposes_schema_and_executes(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()

    binding = build_file_tool_write_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": "sample.txt", "content": "hello"}))

    assert binding.tool_id == FILE_TOOL_WRITE_ID
    assert binding.kind == "builtin"
    assert binding.function_name == FILE_TOOL_WRITE_FUNCTION_NAME
    assert binding.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "content": {"type": "string"},
            "encoding": {"type": "string", "enum": ["utf-8"], "default": "utf-8"},
            "overwrite": {"type": "boolean", "default": True},
            "expectedHash": {"type": "string", "minLength": 1},
            "atomic": {"type": "boolean", "default": True},
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
        "required": ["path", "content"],
    }
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["created"] is True
    assert result["output"]["data"]["metadata"]["fileSize"] == 5


def test_file_tool_write_runtime_binding_maps_conflicts(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.txt"
    target.write_text("before", encoding="utf-8")

    binding = build_file_tool_write_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": "sample.txt", "content": "after", "overwrite": False}))

    assert result["status"] == "error"
    assert result["error"]["code"] == "conflict"
    assert result["output"]["error"]["code"] == "already_exists"


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


def test_file_tool_grep_runtime_binding_exposes_schema_and_executes(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.txt"
    target.write_text("alpha\nTODO item\nomega\n", encoding="utf-8")

    binding = build_file_tool_grep_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(
        binding.execute({
            "basePath": ".",
            "pattern": "TODO",
            "fileGlob": "*.txt",
            "contextLines": 1,
            "maxResults": 5,
        })
    )

    assert binding.tool_id == FILE_TOOL_GREP_ID
    assert binding.kind == "builtin"
    assert binding.function_name == FILE_TOOL_GREP_FUNCTION_NAME
    assert binding.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "pattern": {"type": "string", "minLength": 1},
            "basePath": {"type": "string", "minLength": 1, "default": "."},
            "fileGlob": {"type": "string", "minLength": 1, "default": "**/*"},
            "isRegex": {"type": "boolean", "default": False},
            "caseSensitive": {"type": "boolean", "default": False},
            "contextLines": {"type": "integer", "minimum": 0, "default": 0},
            "includeHidden": {"type": "boolean", "default": False},
            "maxResults": {"type": "integer", "minimum": 1, "default": 100},
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
    assert result["output"]["data"]["matches"][0]["matchText"] == "TODO"
    assert result["output"]["data"]["matches"][0]["before"] == ["alpha"]
    assert result["output"]["data"]["matches"][0]["after"] == ["omega"]


def test_file_tool_grep_runtime_binding_maps_invalid_regex_to_invalid_input(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "sample.txt").write_text("TODO\n", encoding="utf-8")

    binding = build_file_tool_grep_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(
        binding.execute({
            "basePath": ".",
            "pattern": "(",
            "fileGlob": "*.txt",
            "isRegex": True,
        })
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_input"
    assert result["output"]["error"]["code"] == "invalid_regex"



def test_file_tool_read_runtime_binding_uses_runtime_default_root(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    runtime_root = tmp_path / "runtime-root"
    workspace_root.mkdir()
    runtime_root.mkdir()
    (runtime_root / "sample.txt").write_text("runtime\nvalue\n", encoding="utf-8")

    binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)
    with runtime_tool_execution_scope(
        RuntimeToolExecutionContext(
            tool_call_id="call-1",
            metadata={"fileSystemState": {"defaultRoot": str(runtime_root)}},
        )
    ):
        result = asyncio.run(binding.execute({"path": "sample.txt", "offset": 2, "limit": 1}))

    assert result["status"] == "success"
    assert result["output"]["data"]["content"] == {"text": "value"}
    assert result["output"]["data"]["effectiveRoot"] == runtime_root.resolve(strict=False).as_posix()



def test_file_tool_read_runtime_binding_falls_back_to_workspace_root_without_runtime_default_root(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "sample.txt").write_text("workspace\nvalue\n", encoding="utf-8")

    binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": "sample.txt", "offset": 2, "limit": 1}))

    assert result["status"] == "success"
    assert result["output"]["data"]["content"] == {"text": "value"}
    assert result["output"]["data"]["effectiveRoot"] == workspace_root.resolve(strict=False).as_posix()



def test_file_tool_switch_root_runtime_binding_succeeds_for_directory(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    target_root = tmp_path / "target-root"
    workspace_root.mkdir()
    target_root.mkdir()

    binding = build_file_tool_switch_root_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": str(target_root)}))

    assert binding.tool_id == FILE_TOOL_SWITCH_ROOT_ID
    assert binding.function_name == FILE_TOOL_SWITCH_ROOT_FUNCTION_NAME
    assert result["status"] == "success"
    assert result["output"]["data"]["currentRoot"] == target_root.resolve(strict=False).as_posix()
    assert result["output"]["data"]["previousRoot"] == workspace_root.resolve(strict=False).as_posix()



def test_file_tool_switch_root_runtime_binding_rejects_file_target(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    target_file = tmp_path / "target.txt"
    workspace_root.mkdir()
    target_file.write_text("hello", encoding="utf-8")

    binding = build_file_tool_switch_root_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(binding.execute({"path": str(target_file)}))

    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_input"
    assert result["output"]["error"]["code"] == "not_a_directory"
