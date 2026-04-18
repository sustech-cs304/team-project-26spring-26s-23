"""Minimal staged text reader for file tool Read support."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import PathMetadata, ReadRequest, ReadResult

_BINARY_SAMPLE_SIZE = 4096
_NULL_BYTE = b"\x00"
_UTF8_BOM = b"\xef\xbb\xbf"


@dataclass(frozen=True, slots=True)
class TextReadPayload:
    """Resolved text read payload before service/runtime envelope mapping."""

    result: ReadResult
    file_size: int


class FileToolTextReader:
    """Read text files with line-based pagination and minimal binary detection."""

    def read_text(self, *, request: ReadRequest, resolution: PathResolution) -> TextReadPayload:
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

        file_size = target_path.stat().st_size
        raw = target_path.read_bytes()
        if _looks_binary(raw):
            raise FileToolError(
                code="binary_unsupported",
                message="Binary file reading is not supported by the staged text reader.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "fileSize": file_size,
                },
            )

        try:
            text = raw.decode("utf-8-sig")
            encoding = "utf-8"
        except UnicodeDecodeError as exc:
            raise FileToolError(
                code="encoding_error",
                message="File content cannot be decoded as UTF-8 text.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "fileSize": file_size,
                },
            ) from exc

        lines = text.splitlines()
        start_index = request.offset - 1
        selected_lines = lines[start_index : start_index + request.limit] if start_index < len(lines) else []
        line_count = len(selected_lines)
        truncated = start_index + line_count < len(lines)
        next_offset = request.offset + line_count if truncated else None
        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            effective_root=resolution.effective_root.as_posix(),
            root_source=resolution.root_source,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        metadata = {
            "lineStart": request.offset,
            "lineCount": line_count,
            "resolvedPath": target_path.as_posix(),
            "fileSize": file_size,
            "sha256": _build_sha256(raw),
        }
        return TextReadPayload(
            result=ReadResult(
                kind="text",
                path=path_metadata,
                encoding=encoding,
                truncated=truncated,
                next_offset=next_offset,
                content={"text": "\n".join(selected_lines)},
                metadata=metadata if request.include_metadata else {},
            ),
            file_size=file_size,
        )


def _looks_binary(raw: bytes) -> bool:
    if not raw:
        return False
    sample = raw[:_BINARY_SAMPLE_SIZE]
    if _NULL_BYTE in sample:
        return True
    trimmed = sample[len(_UTF8_BOM) :] if sample.startswith(_UTF8_BOM) else sample
    if not trimmed:
        return False
    suspicious_bytes = 0
    for byte in trimmed:
        if byte in {9, 10, 13}:
            continue
        if 32 <= byte <= 126:
            continue
        if byte >= 128:
            continue
        suspicious_bytes += 1
    return suspicious_bytes / len(trimmed) > 0.3


def _build_sha256(raw: bytes) -> str:
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


__all__ = ["FileToolTextReader", "TextReadPayload"]
