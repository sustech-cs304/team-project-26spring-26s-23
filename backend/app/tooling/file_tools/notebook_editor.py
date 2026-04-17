"""Structured notebook editor for staged NotebookEdit support."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import tempfile
from typing import Any
import uuid

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import (
    NotebookEditOperation,
    NotebookEditRequest,
    NotebookEditResult,
    PathMetadata,
)
from .writer import _build_sha256


@dataclass(frozen=True, slots=True)
class NotebookEditPayload:
    """Resolved notebook edit payload before service/runtime envelope mapping."""

    result: NotebookEditResult


class FileToolNotebookEditor:
    """Apply transactional cell edits to notebook files."""

    def edit_notebook(self, *, request: NotebookEditRequest, resolution: PathResolution) -> NotebookEditPayload:
        target_path = resolution.resolved_path
        notebook, existing_raw = _load_notebook(target_path=target_path, request_path=request.path)
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
        _normalize_missing_cell_ids(cells)
        for operation_index, operation in enumerate(request.operations):
            _apply_operation(cells=cells, operation=operation, operation_index=operation_index)

        updated_raw = json.dumps(notebook, ensure_ascii=False, indent=1).encode("utf-8") + b"\n"
        _write_notebook_if_hash_matches(
            target_path=target_path,
            raw=updated_raw,
            request_path=request.path,
            expected_hash=request.expected_hash,
        )
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


def _load_notebook(*, target_path: Path, request_path: str) -> tuple[dict[str, Any], bytes]:
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
    raw = target_path.read_bytes()
    try:
        notebook = json.loads(raw.decode("utf-8"))
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
    return notebook, raw


def _normalize_missing_cell_ids(cells: list[dict[str, Any]]) -> None:
    for cell in cells:
        if not isinstance(cell, dict):
            raise FileToolError(code="invalid_request", message="Notebook cell entries must be objects.")
        if not _has_real_cell_id(cell):
            cell["id"] = _new_cell_id()


def _apply_operation(*, cells: list[dict[str, Any]], operation: NotebookEditOperation, operation_index: int) -> None:
    if operation.kind == "replace":
        cell_index = _find_cell_index(cells=cells, cell_id=operation.cell_id, operation_index=operation_index)
        target_cell = cells[cell_index]
        target_cell["source"] = _split_source(operation.source or "")
        if target_cell.get("cell_type") == "code":
            target_cell["execution_count"] = None
            target_cell["outputs"] = []
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
        if _resolve_cell_id(cell=cell, index=index) == cell_id:
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
        "id": _new_cell_id(),
        "cell_type": cell_type,
        "metadata": {},
        "source": _split_source(operation.source or ""),
    }
    if cell_type == "code":
        cell["execution_count"] = None
        cell["outputs"] = []
    return cell


def _write_notebook_if_hash_matches(
    *,
    target_path: Path,
    raw: bytes,
    request_path: str,
    expected_hash: str | None,
) -> None:
    temp_fd, temp_name = tempfile.mkstemp(prefix=f".{target_path.name}.", suffix=".tmp", dir=target_path.parent)
    temp_path = Path(temp_name)
    try:
        with open(temp_fd, "wb", closefd=True) as handle:
            handle.write(raw)
            handle.flush()
        if expected_hash is not None:
            latest_raw = target_path.read_bytes()
            latest_hash = _build_sha256(latest_raw)
            if latest_hash != expected_hash:
                raise FileToolError(
                    code="hash_mismatch",
                    message="Target notebook content hash does not match expected_hash.",
                    details={
                        "path": request_path,
                        "resolvedPath": target_path.as_posix(),
                        "expectedHash": expected_hash,
                        "actualHash": latest_hash,
                    },
                )
        temp_path.replace(target_path)
    except OSError as exc:
        raise FileToolError(
            code="permission_denied",
            message="Atomic notebook write failed.",
            details={"path": request_path, "resolvedPath": target_path.as_posix()},
        ) from exc
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def _resolve_cell_id(*, cell: dict[str, Any], index: int) -> str:
    raw_cell_id = cell.get("id")
    if isinstance(raw_cell_id, str) and raw_cell_id.strip() != "":
        return raw_cell_id
    return f"cell-{index + 1}"


def _has_real_cell_id(cell: dict[str, Any]) -> bool:
    raw_cell_id = cell.get("id")
    return isinstance(raw_cell_id, str) and raw_cell_id.strip() != ""


def _new_cell_id() -> str:
    return f"cell-{uuid.uuid4().hex[:12]}"


def _split_source(source: str) -> list[str]:
    if source == "":
        return []
    lines = source.splitlines(keepends=True)
    if not lines:
        return [source]
    return lines


__all__ = ["FileToolNotebookEditor", "NotebookEditPayload"]
