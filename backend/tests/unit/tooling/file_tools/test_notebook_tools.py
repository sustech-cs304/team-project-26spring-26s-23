from __future__ import annotations

import asyncio
import json
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
from app.tooling.file_tools.service import FileToolNotebookEditService, FileToolReadService
from app.tooling.file_tools.text_reader import FileToolTextReader


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
                    "execution_count": None,
                    "source": ["print('old')\n"],
                    "outputs": [],
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
    assert "".join(updated["cells"][0]["source"]) == "inserted\n"
    assert "".join(updated["cells"][1]["source"]) == "print('new')\n"


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


def test_default_tool_registry_exposes_notebook_edit_tool(tmp_path: Path) -> None:
    registry = build_default_tool_registry(workspace_root=tmp_path)
    tool_ids = registry.list_tool_ids()
    catalog_by_id = {entry["toolId"]: entry for entry in registry.build_tool_catalog()}

    assert FILE_TOOL_NOTEBOOK_EDIT_ID in tool_ids
    assert catalog_by_id[FILE_TOOL_NOTEBOOK_EDIT_ID]["displayName"] == "Notebook 编辑"
    assert catalog_by_id[FILE_TOOL_NOTEBOOK_EDIT_ID]["group"]["id"] == "builtin-core"


def _write_notebook(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
