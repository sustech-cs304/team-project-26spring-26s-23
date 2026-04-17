from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

from app.copilot_runtime import build_default_tool_registry
from app.tooling.file_tools import FileToolPathPolicy, NotebookEditOperation, NotebookEditRequest, ReadRequest
from app.tooling.file_tools.notebook_editor import FileToolNotebookEditor
from app.tooling.file_tools.notebook_reader import FileToolNotebookReader
from app.tooling.file_tools.runtime_bindings import (
    FILE_TOOL_NOTEBOOK_EDIT_FUNCTION_NAME,
    FILE_TOOL_NOTEBOOK_EDIT_ID,
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    build_file_tool_notebook_edit_runtime_binding,
    build_file_tool_read_runtime_binding,
)
from app.tooling.runtime_adapter.copilot_runtime import RuntimeToolExecutionContext, runtime_tool_execution_scope
from app.tooling.file_tools.service import FileToolNotebookEditService, FileToolReadService
from app.tooling.file_tools.text_reader import FileToolTextReader
from app.tooling.file_tools.writer import _build_sha256

FIXTURE_DIR = Path(__file__).parent / "fixtures"



def _runtime_context(default_root: Path) -> RuntimeToolExecutionContext:
    return RuntimeToolExecutionContext(
        tool_call_id="call-1",
        metadata={"fileSystemState": {"defaultRoot": str(default_root)}},
    )


def test_notebook_read_service_parses_structured_cells(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {"kernelspec": {"name": "python3"}},
            "cells": [
                {
                    "id": "cell-a",
                    "cell_type": "markdown",
                    "metadata": {},
                    "source": ["# Title\n", "Body\n"],
                },
                {
                    "id": "cell-b",
                    "cell_type": "code",
                    "metadata": {},
                    "execution_count": 1,
                    "source": ["print('hi')\n"],
                    "outputs": [
                        {"output_type": "stream", "name": "stdout", "text": ["hi\n"]},
                        {
                            "output_type": "execute_result",
                            "data": {"text/plain": ["{'ok': True}"], "application/json": {"ok": True}},
                            "metadata": {},
                            "execution_count": 1,
                        },
                    ],
                },
            ],
        },
    )
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
        notebook_reader=FileToolNotebookReader(),
    )

    result = service.read(ReadRequest(path="sample.ipynb"))

    assert result.to_dict()["ok"] is True
    assert result.to_dict()["data"]["kind"] == "notebook"
    assert result.to_dict()["data"]["content"]["cellCount"] == 2
    assert result.to_dict()["data"]["content"]["cells"][0] == {
        "cellId": "cell-a",
        "cellType": "markdown",
        "source": "# Title\nBody\n",
        "outputs": [],
    }
    assert result.to_dict()["data"]["content"]["cells"][1]["outputs"][0]["text"] == "hi"
    assert result.to_dict()["data"]["metadata"]["mimeType"] == "application/x-ipynb+json"


def test_notebook_read_service_returns_stable_failure_for_invalid_notebook(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "broken.ipynb"
    target.write_text("{not json}", encoding="utf-8")
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
        notebook_reader=FileToolNotebookReader(),
    )

    result = service.read(ReadRequest(path="broken.ipynb"))

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["error"]["code"] == "invalid_request"
    assert result.to_dict()["error"]["message"] == "Notebook file is not valid UTF-8 JSON."


def test_notebook_read_identifiers_round_trip_on_fixture_notebook(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = _copy_fixture_notebook(workspace_root, "realistic_missing_ids.ipynb")
    read_service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
        notebook_reader=FileToolNotebookReader(),
    )
    edit_service = FileToolNotebookEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        notebook_editor=FileToolNotebookEditor(),
    )

    read_result = read_service.read(ReadRequest(path=target.name)).to_dict()
    cells = read_result["data"]["content"]["cells"]
    markdown_cell_id = cells[0]["cellId"]
    code_cell_id = cells[1]["cellId"]
    anchor_cell_id = cells[2]["cellId"]

    edit_result = edit_service.edit_notebook(
        NotebookEditRequest(
            path=target.name,
            expected_hash=read_result["data"]["metadata"]["sha256"],
            operations=(
                NotebookEditOperation(kind="replace", cell_id=code_cell_id, source="print('fresh output')\n"),
                NotebookEditOperation(kind="delete", cell_id=markdown_cell_id),
                NotebookEditOperation(
                    kind="insert",
                    after_cell_id=anchor_cell_id,
                    cell_type="markdown",
                    source="Inserted after anchor.\n",
                ),
            ),
        )
    ).to_dict()

    updated = json.loads(target.read_text(encoding="utf-8"))
    assert read_result["ok"] is True
    assert edit_result["ok"] is True
    assert edit_result["data"]["appliedOperations"] == 3
    assert len(updated["cells"]) == 3
    assert all(isinstance(cell.get("id"), str) and cell["id"].strip() for cell in updated["cells"])
    assert updated["cells"][0]["cell_type"] == "code"
    assert updated["cells"][0]["source"] == ["print('fresh output')\n"]
    assert updated["cells"][0]["outputs"] == []
    assert updated["cells"][0]["execution_count"] is None
    assert updated["cells"][1]["id"] == "cell-existing-markdown"
    assert updated["cells"][2]["cell_type"] == "markdown"
    assert updated["cells"][2]["source"] == ["Inserted after anchor.\n"]


def test_notebook_edit_service_replace_insert_delete(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [
                {"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["before\n"]},
                {
                    "id": "cell-b",
                    "cell_type": "code",
                    "metadata": {},
                    "execution_count": 3,
                    "source": ["print('old')\n"],
                    "outputs": [{"output_type": "stream", "name": "stdout", "text": ["old\n"]}],
                },
            ],
        },
    )
    service = FileToolNotebookEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        notebook_editor=FileToolNotebookEditor(),
    )

    result = service.edit_notebook(
        NotebookEditRequest(
            path="sample.ipynb",
            operations=(
                NotebookEditOperation(kind="replace", cell_id="cell-b", source="print('new')\n"),
                NotebookEditOperation(kind="insert", after_cell_id="cell-a", cell_type="markdown", source="inserted\n"),
                NotebookEditOperation(kind="delete", cell_id="cell-a"),
            ),
        )
    )

    updated = json.loads(target.read_text(encoding="utf-8"))
    assert result.to_dict()["ok"] is True
    assert result.to_dict()["data"]["appliedOperations"] == 3
    assert [cell["cell_type"] for cell in updated["cells"]] == ["markdown", "code"]
    assert "id" in updated["cells"][0]
    assert "id" in updated["cells"][1]
    assert "".join(updated["cells"][0]["source"]) == "inserted\n"
    assert "".join(updated["cells"][1]["source"]) == "print('new')\n"
    assert updated["cells"][1]["outputs"] == []
    assert updated["cells"][1]["execution_count"] is None


def test_notebook_edit_service_rejects_stale_expected_hash(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = _copy_fixture_notebook(workspace_root, "realistic_missing_ids.ipynb")
    service = FileToolNotebookEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        notebook_editor=FileToolNotebookEditor(),
    )

    original_raw = target.read_bytes()
    stale_hash = _build_sha256(original_raw)
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [{"id": "cell-new", "cell_type": "markdown", "metadata": {}, "source": ["changed\n"]}],
        },
    )

    result = service.edit_notebook(
        NotebookEditRequest(
            path=target.name,
            expected_hash=stale_hash,
            operations=(NotebookEditOperation(kind="replace", cell_id="cell-new", source="updated\n"),),
        )
    ).to_dict()

    assert result["ok"] is False
    assert result["error"]["code"] == "hash_mismatch"
    assert target.read_bytes() != original_raw


def test_notebook_edit_service_detects_commit_time_hash_conflict(tmp_path: Path, monkeypatch) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [{"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["before\n"]}],
        },
    )
    service = FileToolNotebookEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        notebook_editor=FileToolNotebookEditor(),
    )
    expected_hash = _build_sha256(target.read_bytes())
    original_read_bytes = Path.read_bytes
    original_replace = Path.replace
    conflict_injected = False

    def read_bytes_with_race(self: Path) -> bytes:
        nonlocal conflict_injected
        raw = original_read_bytes(self)
        if self == target and not conflict_injected:
            conflict_injected = True
            _write_notebook(
                target,
                {
                    "nbformat": 4,
                    "nbformat_minor": 5,
                    "metadata": {},
                    "cells": [{"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["raced\n"]}],
                },
            )
        return raw

    def replace_passthrough(self: Path, target_path: Path) -> Path:
        return original_replace(self, target_path)

    monkeypatch.setattr(Path, "read_bytes", read_bytes_with_race)
    monkeypatch.setattr(Path, "replace", replace_passthrough)

    result = service.edit_notebook(
        NotebookEditRequest(
            path="sample.ipynb",
            expected_hash=expected_hash,
            operations=(NotebookEditOperation(kind="replace", cell_id="cell-a", source="updated\n"),),
        )
    ).to_dict()

    assert result["ok"] is False
    assert result["error"]["code"] == "hash_mismatch"
    updated = json.loads(target.read_text(encoding="utf-8"))
    assert updated["cells"][0]["source"] == ["raced\n"]


def test_notebook_edit_service_is_transactional_on_invalid_operation(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [
                {"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["before\n"]},
                {"id": "cell-b", "cell_type": "markdown", "metadata": {}, "source": ["keep\n"]},
            ],
        },
    )
    original = target.read_text(encoding="utf-8")
    service = FileToolNotebookEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        notebook_editor=FileToolNotebookEditor(),
    )

    result = service.edit_notebook(
        NotebookEditRequest(
            path="sample.ipynb",
            operations=(
                NotebookEditOperation(kind="replace", cell_id="cell-a", source="changed\n"),
                NotebookEditOperation(kind="delete", cell_id="missing-cell"),
            ),
        )
    )

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["error"]["code"] == "not_found"
    assert target.read_text(encoding="utf-8") == original


def test_runtime_bindings_expose_notebook_read_and_edit_schemas(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [{"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["hello\n"]}],
        },
    )

    read_binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)
    edit_binding = build_file_tool_notebook_edit_runtime_binding(workspace_root=workspace_root)
    read_result = asyncio.run(read_binding.execute({"path": "sample.ipynb"}))
    edit_result = asyncio.run(
        edit_binding.execute(
            {
                "path": "sample.ipynb",
                "operations": [{"kind": "replace", "cellId": "cell-a", "source": "updated\n"}],
            }
        )
    )

    assert read_binding.tool_id == FILE_TOOL_READ_ID
    assert read_binding.function_name == FILE_TOOL_READ_FUNCTION_NAME
    assert read_result["status"] == "success"
    assert read_result["output"]["data"]["kind"] == "notebook"
    assert edit_binding.tool_id == FILE_TOOL_NOTEBOOK_EDIT_ID
    assert edit_binding.function_name == FILE_TOOL_NOTEBOOK_EDIT_FUNCTION_NAME
    assert edit_binding.parameters_json_schema["properties"]["operations"]["items"]["properties"]["kind"]["enum"] == [
        "replace",
        "insert",
        "delete",
    ]
    assert edit_result["status"] == "success"
    assert edit_result["output"]["data"]["appliedOperations"] == 1


def test_notebook_tools_allow_absolute_paths_outside_workspace(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    target = outside_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [{"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["hello\n"]}],
        },
    )
    read_service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
        notebook_reader=FileToolNotebookReader(),
    )
    edit_service = FileToolNotebookEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        notebook_editor=FileToolNotebookEditor(),
    )

    read_result = read_service.read(ReadRequest(path=str(target))).to_dict()
    edit_result = edit_service.edit_notebook(
        NotebookEditRequest(
            path=str(target),
            operations=(NotebookEditOperation(kind="replace", cell_id="cell-a", source="updated\n"),),
        )
    ).to_dict()

    assert read_result["ok"] is True
    assert read_result["data"]["resolvedPath"] == target.resolve(strict=False).as_posix()
    assert read_result["data"]["effectiveRoot"] == outside_root.resolve(strict=False).as_posix()
    assert read_result["data"]["rootSource"] == "absolute_override"
    assert edit_result["ok"] is True
    assert edit_result["data"]["resolvedPath"] == target.resolve(strict=False).as_posix()
    assert json.loads(target.read_text(encoding="utf-8"))["cells"][0]["source"] == ["updated\n"]


def test_notebook_runtime_bindings_allow_absolute_paths_and_runtime_default_root(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    runtime_root = tmp_path / "runtime-root"
    runtime_root.mkdir()
    target = runtime_root / "sample.ipynb"
    _write_notebook(
        target,
        {
            "nbformat": 4,
            "nbformat_minor": 5,
            "metadata": {},
            "cells": [{"id": "cell-a", "cell_type": "markdown", "metadata": {}, "source": ["hello\n"]}],
        },
    )

    read_binding = build_file_tool_read_runtime_binding(workspace_root=workspace_root)
    edit_binding = build_file_tool_notebook_edit_runtime_binding(workspace_root=workspace_root)
    absolute_result = asyncio.run(read_binding.execute({"path": str(target)}))
    with runtime_tool_execution_scope(_runtime_context(runtime_root)):
        relative_read_result = asyncio.run(read_binding.execute({"path": "sample.ipynb"}))
        relative_edit_result = asyncio.run(
            edit_binding.execute(
                {
                    "path": "sample.ipynb",
                    "operations": [{"kind": "replace", "cellId": "cell-a", "source": "updated\n"}],
                }
            )
        )

    assert absolute_result["status"] == "success"
    assert absolute_result["output"]["data"]["resolvedPath"] == target.resolve(strict=False).as_posix()
    assert absolute_result["output"]["data"]["rootSource"] == "absolute_override"
    assert relative_read_result["status"] == "success"
    assert relative_read_result["output"]["data"]["effectiveRoot"] == runtime_root.resolve(strict=False).as_posix()
    assert relative_edit_result["status"] == "success"
    assert relative_edit_result["output"]["data"]["resolvedPath"] == target.resolve(strict=False).as_posix()
    assert json.loads(target.read_text(encoding="utf-8"))["cells"][0]["source"] == ["updated\n"]



def test_default_tool_registry_exposes_notebook_edit_tool(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    tool_ids = registry.list_tool_ids()
    catalog_by_id = {entry["toolId"]: entry for entry in registry.build_tool_catalog()}

    assert FILE_TOOL_NOTEBOOK_EDIT_ID in tool_ids
    assert catalog_by_id[FILE_TOOL_NOTEBOOK_EDIT_ID]["displayName"] == "Notebook 编辑"
    assert catalog_by_id[FILE_TOOL_NOTEBOOK_EDIT_ID]["group"]["id"] == "builtin-core"


def _copy_fixture_notebook(workspace_root: Path, fixture_name: str) -> Path:
    target = workspace_root / fixture_name
    shutil.copyfile(FIXTURE_DIR / fixture_name, target)
    return target


def _write_notebook(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
