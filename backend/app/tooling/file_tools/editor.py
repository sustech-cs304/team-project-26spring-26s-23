"""Exact text replacement editor for staged file tool Edit support."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import EditRequest, EditResult, PathMetadata
from .writer import _atomic_write_text, _build_sha256


@dataclass(frozen=True, slots=True)
class TextEditPayload:
    """Resolved text edit payload before service/runtime envelope mapping."""

    result: EditResult


class FileToolTextEditor:
    """Edit UTF-8 text files via exact string replacement with optimistic guards."""

    def edit_text(self, *, request: EditRequest, resolution: PathResolution) -> TextEditPayload:
        target_path = resolution.resolved_path
        if not target_path.exists():
            raise FileToolError(
                code="file_not_found",
                message="Target file does not exist.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )
        if target_path.is_dir():
            raise FileToolError(
                code="not_a_file",
                message="Target path is a directory.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )

        existing_raw = target_path.read_bytes()
        if _looks_binary(existing_raw):
            raise FileToolError(
                code="binary_unsupported",
                message="Target file is binary and cannot be edited as text.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )

        current_hash = _build_sha256(existing_raw)
        if request.expected_hash is not None and current_hash != request.expected_hash:
            raise FileToolError(
                code="hash_mismatch",
                message="Target file content hash does not match expected_hash.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "expectedHash": request.expected_hash,
                    "actualHash": current_hash,
                },
            )

        try:
            existing_text = existing_raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise FileToolError(
                code="encoding_error",
                message="Target file is not valid UTF-8 text.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            ) from exc

        match_count = existing_text.count(request.old_string)
        if match_count == 0:
            raise FileToolError(
                code="not_found",
                message="old_string was not found in the target file.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "oldString": request.old_string,
                    "actualOccurrences": 0,
                },
            )

        if request.expected_occurrences is not None and match_count != request.expected_occurrences:
            raise FileToolError(
                code="occurrence_mismatch",
                message="Target file occurrence count does not match expected_occurrences.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "expectedOccurrences": request.expected_occurrences,
                    "actualOccurrences": match_count,
                },
            )

        if not request.replace_all and match_count != 1:
            raise FileToolError(
                code="not_unique",
                message="old_string must match exactly once unless replace_all is enabled.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "oldString": request.old_string,
                    "actualOccurrences": match_count,
                },
            )

        if request.replace_all:
            updated_text = existing_text.replace(request.old_string, request.new_string)
            replacements = match_count
        else:
            updated_text = existing_text.replace(request.old_string, request.new_string, 1)
            replacements = 1

        updated_raw = updated_text.encode("utf-8")
        _atomic_write_text(target_path=target_path, raw=updated_raw)
        final_hash = _build_sha256(updated_raw)
        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            effective_root=resolution.effective_root.as_posix(),
            root_source=resolution.root_source,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        return TextEditPayload(
            result=EditResult(
                path=path_metadata,
                encoding="utf-8",
                replaced_count=replacements,
                modified=updated_raw != existing_raw,
                metadata={
                    "fileSize": len(updated_raw),
                    "sha256": final_hash,
                },
            )
        )


_BINARY_BYTE_MARKERS = frozenset({0})


def _looks_binary(raw: bytes) -> bool:
    if not raw:
        return False
    if any(byte in _BINARY_BYTE_MARKERS for byte in raw):
        return True
    return False


__all__ = ["FileToolTextEditor", "TextEditPayload"]
