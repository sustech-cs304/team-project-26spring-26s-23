"""Structured notebook reader for staged file tool Read support."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import (
    NotebookCell,
    NotebookOutputSummary,
    NotebookReadResult,
    PathMetadata,
    ReadRequest,
    ReadResult,
)
from .text_reader import _build_sha256


@dataclass(frozen=True, slots=True)
class NotebookReadPayload:
    """Resolved notebook read payload before service/runtime envelope mapping."""

    result: ReadResult
    file_size: int


class FileToolNotebookReader:
    """Read `.ipynb` files into a structured cell-oriented representation."""

    def read_notebook(
        self, *, request: ReadRequest, resolution: PathResolution
    ) -> NotebookReadPayload:
        target_path = resolution.resolved_path
        if not target_path.exists():
            raise FileToolError(
                code="file_not_found",
                message="Target file does not exist.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )
        if not target_path.is_file():
            raise FileToolError(
                code="not_a_file",
                message="Target path is not a regular file.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )

        raw = target_path.read_bytes()
        file_size = len(raw)
        try:
            notebook = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise FileToolError(
                code="invalid_request",
                message="Notebook file is not valid UTF-8 JSON.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            ) from exc

        if not isinstance(notebook, dict) or not isinstance(
            notebook.get("cells"), list
        ):
            raise FileToolError(
                code="invalid_request",
                message="Notebook file must be a JSON object with a cells array.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )

        cells = notebook["cells"]
        _normalize_missing_cell_ids(cells)

        cells_payload: list[dict[str, Any]] = []
        for index, cell in enumerate(cells):
            cells_payload.append(_build_cell_payload(cell=cell, index=index))

        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            effective_root=resolution.effective_root.as_posix(),
            root_source=resolution.root_source,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        notebook_metadata = _normalize_mapping(notebook.get("metadata", {}))
        notebook_result = NotebookReadResult(
            path=path_metadata,
            notebook_format=_normalize_optional_int(notebook.get("nbformat")),
            notebook_format_minor=_normalize_optional_int(
                notebook.get("nbformat_minor")
            ),
            cell_count=len(cells_payload),
            cells=tuple(NotebookCell(**cell_payload) for cell_payload in cells_payload),
            metadata={
                "fileSize": file_size,
                "sha256": _build_sha256(raw),
                "mimeType": "application/x-ipynb+json",
                "kernelSpec": notebook_metadata.get("kernelspec"),
                "languageInfo": notebook_metadata.get("language_info"),
            }
            if request.include_metadata
            else {},
        )
        return NotebookReadPayload(
            result=ReadResult(
                kind="notebook",
                path=path_metadata,
                encoding="utf-8",
                truncated=False,
                next_offset=None,
                content=notebook_result.to_content_dict(),
                metadata=notebook_result.metadata,
            ),
            file_size=file_size,
        )


def _build_cell_payload(*, cell: Any, index: int) -> dict[str, Any]:
    if not isinstance(cell, dict):
        raise FileToolError(
            code="invalid_request",
            message="Notebook cell entries must be objects.",
            details={"cellIndex": index},
        )

    raw_source = cell.get("source", [])
    source = _normalize_source(raw_source)
    raw_outputs = cell.get("outputs", [])
    if raw_outputs is None:
        raw_outputs = []
    if not isinstance(raw_outputs, list):
        raise FileToolError(
            code="invalid_request",
            message="Notebook outputs must be an array when present.",
        )
    outputs = tuple(
        _summarize_output(output=output, index=output_index)
        for output_index, output in enumerate(raw_outputs)
    )
    return {
        "cell_id": _resolve_cell_id(cell=cell, index=index),
        "cell_type": _normalize_cell_type(cell.get("cell_type")),
        "source": source,
        "outputs": outputs,
    }


def _normalize_missing_cell_ids(cells: list[Any]) -> None:
    next_generated_index = 1
    for cell in cells:
        if not isinstance(cell, dict):
            raise FileToolError(
                code="invalid_request", message="Notebook cell entries must be objects."
            )
        raw_cell_id = cell.get("id")
        if isinstance(raw_cell_id, str) and raw_cell_id.strip() != "":
            continue
        while True:
            candidate = f"cell-{next_generated_index}"
            next_generated_index += 1
            if candidate not in {
                existing.get("id") for existing in cells if isinstance(existing, dict)
            }:
                cell["id"] = candidate
                break


def _resolve_cell_id(*, cell: dict[str, Any], index: int) -> str:
    raw_cell_id = cell.get("id")
    if isinstance(raw_cell_id, str) and raw_cell_id.strip() != "":
        return raw_cell_id
    return f"cell-{index + 1}"


def _normalize_cell_type(value: Any) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise FileToolError(
            code="invalid_request",
            message="Notebook cell_type must be a non-empty string.",
        )
    return value.strip()


def _normalize_source(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        chunks: list[str] = []
        for item in value:
            if not isinstance(item, str):
                raise FileToolError(
                    code="invalid_request",
                    message="Notebook source items must be strings.",
                )
            chunks.append(item)
        return "".join(chunks)
    raise FileToolError(
        code="invalid_request",
        message="Notebook source must be a string or string array.",
    )


def _summarize_output(*, output: Any, index: int) -> NotebookOutputSummary:
    if not isinstance(output, dict):
        raise FileToolError(
            code="invalid_request",
            message="Notebook outputs must be objects.",
            details={"outputIndex": index},
        )
    output_type = (
        output.get("output_type")
        if isinstance(output.get("output_type"), str)
        else "unknown"
    )
    text_parts: list[str] = []
    if "text" in output:
        text_parts.append(_normalize_source(output.get("text")))
    data = output.get("data")
    structured: dict[str, Any] = {}
    if isinstance(data, dict):
        if isinstance(data.get("text/plain"), (str, list)):
            text_parts.append(_normalize_source(data.get("text/plain")))
        for key in ("application/json", "application/vnd.jupyter.widget-view+json"):
            if key in data:
                structured[key] = data[key]
        if "text/html" in data:
            structured["text/html"] = _summarize_text(
                _normalize_source(data["text/html"])
            )
    if isinstance(output.get("ename"), str):
        structured["ename"] = output["ename"]
    if isinstance(output.get("evalue"), str):
        structured["evalue"] = output["evalue"]
    if isinstance(output.get("traceback"), list):
        structured["traceback"] = [
            item for item in output["traceback"] if isinstance(item, str)
        ]
    return NotebookOutputSummary(
        output_type=output_type,
        text=_summarize_text("\n".join(part for part in text_parts if part)),
        data=structured,
    )


def _summarize_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip("\n")
    return normalized or None


def _normalize_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _normalize_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise FileToolError(
            code="invalid_request",
            message="Notebook format fields must be integers when present.",
        )
    return value


__all__ = ["FileToolNotebookReader", "NotebookReadPayload"]
