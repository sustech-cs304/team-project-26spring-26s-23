from __future__ import annotations

from pathlib import Path

import pytest

from app.tooling.file_tools import FileToolPathPolicy, ReadRequest
from app.tooling.file_tools.errors import FileToolError
from app.tooling.file_tools.text_reader import FileToolTextReader


@pytest.fixture
def workspace_root(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    root.mkdir()
    return root


def test_text_reader_reads_paginated_text_and_returns_next_offset(workspace_root: Path) -> None:
    target = workspace_root / "docs.txt"
    target.write_text("line 1\nline 2\nline 3\nline 4\n", encoding="utf-8")
    policy = FileToolPathPolicy(workspace_root=workspace_root)
    resolution = policy.resolve_path("docs.txt")

    payload = FileToolTextReader().read_text(
        request=ReadRequest(path="docs.txt", offset=2, limit=2),
        resolution=resolution,
    )

    assert payload.result.to_dict()["content"] == {"text": "line 2\nline 3"}
    assert payload.result.to_dict()["truncated"] is True
    assert payload.result.to_dict()["nextOffset"] == 4
    assert payload.result.to_dict()["metadata"]["lineStart"] == 2
    assert payload.result.to_dict()["metadata"]["lineCount"] == 2
    assert payload.result.to_dict()["metadata"]["resolvedPath"] == target.as_posix()
    assert payload.result.to_dict()["metadata"]["fileSize"] == target.stat().st_size
    assert payload.result.to_dict()["metadata"]["sha256"].startswith("sha256:")


def test_text_reader_returns_empty_result_when_offset_exceeds_eof(workspace_root: Path) -> None:
    target = workspace_root / "docs.txt"
    target.write_text("line 1\nline 2\n", encoding="utf-8")
    policy = FileToolPathPolicy(workspace_root=workspace_root)
    resolution = policy.resolve_path("docs.txt")

    payload = FileToolTextReader().read_text(
        request=ReadRequest(path="docs.txt", offset=10, limit=5),
        resolution=resolution,
    )

    assert payload.result.to_dict()["content"] == {"text": ""}
    assert payload.result.to_dict()["truncated"] is False
    assert "nextOffset" not in payload.result.to_dict()
    assert payload.result.to_dict()["metadata"]["lineStart"] == 10
    assert payload.result.to_dict()["metadata"]["lineCount"] == 0


def test_text_reader_rejects_obvious_binary_content(workspace_root: Path) -> None:
    target = workspace_root / "blob.bin"
    target.write_bytes(b"\x00\x01\x02\x03hello")
    policy = FileToolPathPolicy(workspace_root=workspace_root)
    resolution = policy.resolve_path("blob.bin")

    with pytest.raises(FileToolError, match="Binary file reading is not supported") as exc_info:
        FileToolTextReader().read_text(
            request=ReadRequest(path="blob.bin"),
            resolution=resolution,
        )

    assert exc_info.value.code == "binary_unsupported"
    assert exc_info.value.details["resolvedPath"] == target.as_posix()
