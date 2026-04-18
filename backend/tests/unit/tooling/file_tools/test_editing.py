from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable
from pathlib import Path
from typing import TypeVar

from app.copilot_runtime import build_default_tool_registry
from app.tooling.file_tools import FileToolPathPolicy
from app.tooling.file_tools.editor import FileToolTextEditor
from app.tooling.file_tools.protocol import EditRequest
from app.tooling.file_tools.runtime_bindings import (
    FILE_TOOL_EDIT_FUNCTION_NAME,
    FILE_TOOL_EDIT_ID,
    build_file_tool_edit_runtime_binding,
)
from app.tooling.file_tools.service import FileToolEditService


_T = TypeVar("_T")


async def _as_coroutine(awaitable: Awaitable[_T]) -> _T:
    return await awaitable


def test_file_tool_edit_service_replaces_unique_match(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("alpha\nTODO item\nomega\n", encoding="utf-8")
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    result = service.edit(EditRequest(path="notes.txt", old_string="TODO item", new_string="DONE item"))

    assert target.read_text(encoding="utf-8") == "alpha\nDONE item\nomega\n"
    assert result.to_dict()["ok"] is True
    assert result.to_dict()["tool"] == "Edit"
    assert result.to_dict()["data"]["replacedCount"] == 1
    assert result.to_dict()["data"]["modified"] is True
    assert result.to_dict()["data"]["metadata"]["fileSize"] == len(target.read_bytes())
    assert result.to_dict()["data"]["metadata"]["sha256"].startswith("sha256:")


def test_file_tool_edit_service_returns_not_found_when_old_string_missing(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("alpha\nomega\n", encoding="utf-8")
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    result = service.edit(EditRequest(path="notes.txt", old_string="TODO", new_string="DONE"))

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["error"]["code"] == "not_found"


def test_file_tool_edit_service_returns_not_unique_without_replace_all(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("TODO\nalpha\nTODO\n", encoding="utf-8")
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    result = service.edit(EditRequest(path="notes.txt", old_string="TODO", new_string="DONE"))

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["error"]["code"] == "not_unique"


def test_file_tool_edit_service_replace_all_replaces_multiple_matches(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("TODO\nalpha\nTODO\n", encoding="utf-8")
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    result = service.edit(EditRequest(path="notes.txt", old_string="TODO", new_string="DONE", replace_all=True))

    assert target.read_text(encoding="utf-8") == "DONE\nalpha\nDONE\n"
    assert result.to_dict()["ok"] is True
    assert result.to_dict()["data"]["replacedCount"] == 2


def test_file_tool_edit_service_checks_expected_occurrences(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("TODO\nalpha\nTODO\n", encoding="utf-8")
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    ok_result = service.edit(
        EditRequest(
            path="notes.txt",
            old_string="TODO",
            new_string="DONE",
            replace_all=True,
            expected_occurrences=2,
        )
    )
    target.write_text("TODO\nalpha\nTODO\n", encoding="utf-8")
    fail_result = service.edit(
        EditRequest(
            path="notes.txt",
            old_string="TODO",
            new_string="DONE",
            replace_all=True,
            expected_occurrences=1,
        )
    )

    assert ok_result.to_dict()["ok"] is True
    assert fail_result.to_dict()["ok"] is False
    assert fail_result.to_dict()["error"]["code"] == "occurrence_mismatch"


def test_file_tool_edit_service_checks_expected_hash(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("TODO\n", encoding="utf-8", newline="")
    current_hash = f"sha256:{hashlib.sha256(b'TODO\n').hexdigest()}"
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    ok_result = service.edit(
        EditRequest(path="notes.txt", old_string="TODO\n", new_string="DONE\n", expected_hash=current_hash)
    )
    target.write_text("TODO\n", encoding="utf-8", newline="")
    fail_result = service.edit(
        EditRequest(path="notes.txt", old_string="TODO\n", new_string="DONE\n", expected_hash="sha256:deadbeef")
    )

    assert ok_result.to_dict()["ok"] is True
    assert fail_result.to_dict()["ok"] is False
    assert fail_result.to_dict()["error"]["code"] == "hash_mismatch"


def test_file_tool_edit_service_rejects_directory_and_binary_targets(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "folder").mkdir()
    binary_target = workspace_root / "sample.bin"
    binary_target.write_bytes(b"\x00\x01TODO")
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )

    directory_result = service.edit(EditRequest(path="folder", old_string="TODO", new_string="DONE"))
    binary_result = service.edit(EditRequest(path="sample.bin", old_string="TODO", new_string="DONE"))

    assert directory_result.to_dict()["ok"] is False
    assert directory_result.to_dict()["error"]["code"] == "not_a_file"
    assert binary_result.to_dict()["ok"] is False
    assert binary_result.to_dict()["error"]["code"] == "binary_unsupported"


def test_file_tool_edit_runtime_binding_exposes_schema_and_executes(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.txt"
    target.write_text("TODO\n", encoding="utf-8")

    binding = build_file_tool_edit_runtime_binding(workspace_root=workspace_root)
    result = asyncio.run(
        _as_coroutine(binding.execute({"path": "sample.txt", "oldString": "TODO", "newString": "DONE"}))
    )

    assert binding.tool_id == FILE_TOOL_EDIT_ID
    assert binding.kind == "builtin"
    assert binding.function_name == FILE_TOOL_EDIT_FUNCTION_NAME
    assert binding.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "oldString": {"type": "string", "minLength": 1},
            "newString": {"type": "string"},
            "replaceAll": {"type": "boolean", "default": False},
            "expectedOccurrences": {"type": "integer", "minimum": 1},
            "expectedHash": {"type": "string", "minLength": 1},
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
        "required": ["path", "oldString", "newString"],
    }
    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert result["output"]["data"]["replacedCount"] == 1


def test_default_tool_registry_exposes_tool_fs_edit(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    tool_ids = registry.list_tool_ids()
    catalog_by_id = {entry["toolId"]: entry for entry in registry.build_tool_catalog()}

    assert FILE_TOOL_EDIT_ID in tool_ids
    assert catalog_by_id[FILE_TOOL_EDIT_ID]["displayName"] == "文件编辑"
    assert catalog_by_id[FILE_TOOL_EDIT_ID]["description"] == "按精确字符串替换语义编辑工作区内 UTF-8 文本文件。"
