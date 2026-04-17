"""Minimal staged text writer for file tool Write support."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path
import tempfile

from .errors import FileToolError
from .path_policy import PathResolution
from .protocol import PathMetadata, WriteRequest, WriteResult


@dataclass(frozen=True, slots=True)
class TextWritePayload:
    """Resolved text write payload before service/runtime envelope mapping."""

    result: WriteResult


class FileToolTextWriter:
    """Write UTF-8 text files with guarded overwrite and atomic replace semantics."""

    def write_text(self, *, request: WriteRequest, resolution: PathResolution) -> TextWritePayload:
        target_path = resolution.resolved_path
        if target_path.exists() and target_path.is_dir():
            raise FileToolError(
                code="not_a_file",
                message="Target path is a directory.",
                details={"path": request.path, "resolvedPath": target_path.as_posix()},
            )

        existed = target_path.exists()
        existing_raw: bytes | None = None
        if existed:
            if not request.overwrite:
                raise FileToolError(
                    code="already_exists",
                    message="Target file already exists and overwrite is disabled.",
                    details={"path": request.path, "resolvedPath": target_path.as_posix()},
                )
            existing_raw = target_path.read_bytes()
            if request.expected_hash is not None:
                current_hash = _build_sha256(existing_raw)
                if current_hash != request.expected_hash:
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
        elif request.expected_hash is not None:
            raise FileToolError(
                code="hash_mismatch",
                message="Target file does not exist for the provided expected_hash.",
                details={
                    "path": request.path,
                    "resolvedPath": target_path.as_posix(),
                    "expectedHash": request.expected_hash,
                    "actualHash": None,
                },
            )

        target_path.parent.mkdir(parents=True, exist_ok=True)
        raw = request.content.encode("utf-8")
        if request.atomic:
            _atomic_write_text(target_path=target_path, raw=raw)
        else:
            target_path.write_bytes(raw)

        final_hash = _build_sha256(raw)
        path_metadata = PathMetadata(
            path=request.path,
            resolved_path=target_path.as_posix(),
            path_kind=resolution.path_kind,
            root_policy=resolution.root_policy,
            symlink_policy=resolution.symlink_policy,
        )
        return TextWritePayload(
            result=WriteResult(
                path=path_metadata,
                encoding="utf-8",
                created=not existed,
                overwritten=existed,
                metadata={
                    "fileSize": len(raw),
                    "sha256": final_hash,
                    "writeMode": "create" if not existed else "overwrite",
                },
            )
        )


def _atomic_write_text(*, target_path: Path, raw: bytes) -> None:
    temp_fd, temp_name = tempfile.mkstemp(prefix=f".{target_path.name}.", suffix=".tmp", dir=target_path.parent)
    temp_path = Path(temp_name)
    try:
        with open(temp_fd, "wb", closefd=True) as handle:
            handle.write(raw)
            handle.flush()
        temp_path.replace(target_path)
    except OSError as exc:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        raise FileToolError(
            code="permission_denied",
            message="Atomic file write failed.",
            details={"path": target_path.as_posix(), "resolvedPath": target_path.as_posix()},
        ) from exc


def _build_sha256(raw: bytes) -> str:
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


__all__ = ["FileToolTextWriter", "TextWritePayload"]
