"""Structured notebook editor for staged NotebookEdit support."""

from __future__ import annotations

from dataclasses import dataclass
import json
import uuid
from pathlib import Path
from typing import Any

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import (
    NotebookEditOperation,
    NotebookEditRequest,
    NotebookEditResult,
    PathMetadata,
)
from .writer import _atomic_write_text, _build_sha256


@dataclass(frozen=True, slots=True)
class NotebookEditPayload:
    """Resolved notebook edit payload before service/runtime envelope mapping."""

    result: NotebookEditResult


class FileToolNotebookEditor:
    """Apply transactional cell edits to notebook files."""

    def edit_notebook(self, *, request: NotebookEditRequest, resolution: PathResolution) -> NotebookEditPayload:
        target_path = resolution.resolved_path
        notebook = _load_notebook(target_path=target_path, request_path=request.path)
        existing_raw = target_path.read_bytes()
        current_hash = _build_sha256(existing_raw)
        if request.expected_hash is not None and current_hash != request.expected_hash:
            raise FileToolError(
                code="hash_mismatch",
                message="Target notebook content hash does not match expected_hash.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "expectedHash": request.expected_hash,
                    "actualHash": current_hash,
                },
            )

        cells = notebook["cells"]
        for operation_index, operation in enumerate(request.operations):
            _apply_operation(cells=cells, operation=operation, operation_index=operation_index)

        updated_raw = json.dumps(notebook, ensure_ascii=False, indent=1).encode("utf-8") + b"\n"
        _atomic_write_text(target_path=target_path, raw=updated_raw)
        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            effective_root=resolution.effective_root.as_posix(),
            root_source=resolution.root_source,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        return NotebookEditPayload(
            result=NotebookEditResult(
                path=path_metadata,
                applied_operations=len(request.operations),
                cell_count=len(cells),
                metadata={
                    "fileSize": len(updated_raw),
                    "sha256": _build_sha256(updated_raw),
                },
            )
        )


def _load_notebook(*, target_path: Path, request_path: str) -> dict[str, Any]:
    if not target_path.exists():
        raise FileToolError(
            code="file_not_found",
            message="Target file does not exist.",
            details={"path": request_path, "resolvedPath": target_path.as_posix()},
        )
    if not target_path.is_file():
        raise FileToolError(
            code="not_a_file",
            message="Target path is not a regular file.",
            details={"path": request_path, "resolvedPath": target_path.as_posix()},
        )
    try:
        notebook = json.loads(target_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FileToolError(
            code="invalid_request",
            message="Notebook file is not valid UTF-8 JSON.",
            details={"path": request_path, "resolvedPath": target_path.as_posix()},
        ) from exc
    if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
        raise FileToolError(
            code="invalid_request",
            message="Notebook file must be a JSON object with a cells array.",
            details={"path": request_path, "resolvedPath": target_path.as_posix()},
        )
    return notebook


def _apply_operation(*, cells: list[dict[str, Any]], operation: NotebookEditOperation, operation_index: int) -> None:
    if operation.kind == "replace":
        cell_index = _find_cell_index(cells=cells, cell_id=operation.cell_id, operation_index=operation_index)
        cells[cell_index]["source"] = _split_source(operation.source)
        return
    if operation.kind == "delete":
        cell_index = _find_cell_index(cells=cells, cell_id=operation.cell_id, operation_index=operation_index)
        del cells[cell_index]
        return
    if operation.kind == "insert":
        if operation.after_cell_id is None:
            raise FileToolError(
                code="invalid_request",
                message="Notebook insert operations require afterCellId.",
                details={"operationIndex": operation_index},
            )
        anchor_index = _find_cell_index(cells=cells, cell_id=operation.after_cell_id, operation_index=operation_index)
        cells.insert(anchor_index + 1, _build_inserted_cell(operation=operation))
        return
    raise FileToolError(
        code="invalid_request",
        message="Unsupported notebook operation.",
        details={"operationIndex": operation_index, "kind": operation.kind},
    )


def _find_cell_index(*, cells: list[dict[str, Any]], cell_id: str | None, operation_index: int) -> int:
    if cell_id is None:
        raise FileToolError(
            code="invalid_request",
            message="Notebook operation requires cellId.",
            details={"operationIndex": operation_index},
        )
    for index, cell in enumerate(cells):
        if cell.get("id") == cell_id:
            return index
    raise FileToolError(
        code="not_found",
        message="Notebook cell was not found.",
        details={"operationIndex": operation_index, "cellId": cell_id},
    )


def _build_inserted_cell(*, operation: NotebookEditOperation) -> dict[str, Any]:
    cell_type = operation.cell_type
    if cell_type not in {"code", "markdown", "raw"}:
        raise FileToolError(
            code="invalid_request",
            message="Notebook insert operations require a supported cellType.",
            details={"cellType": cell_type},
        )
    cell: dict[str, Any] = {
        "id": f"cell-{uuid.uuid4().hex[:12]}",
        "cell_type": cell_type,
        "metadata": {},
        "source": _split_source(operation.source or ""),
    }
    if cell_type == "code":
        cell["execution_count"] = None
        cell["outputs"] = []
    return cell


def _split_source(source: str) -> list[str]:
    if source == "":
        return []
    lines = source.splitlines(keepends=True)
    if not lines:
        return [source]
    return lines


__all__ = ["FileToolNotebookEditor", "NotebookEditPayload"]
