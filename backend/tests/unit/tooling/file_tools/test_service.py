from __future__ import annotations

from pathlib import Path
import hashlib
import os
import time

from app.tooling.file_tools import FileToolPathPolicy, GlobRequest, GrepRequest, ReadRequest, WriteRequest
from app.tooling.file_tools.glob_search import FileToolGlobSearcher
from app.tooling.file_tools.grep_search import FileToolGrepSearcher
from app.tooling.file_tools.service import (
    FileToolGlobService,
    FileToolGrepService,
    FileToolReadService,
    FileToolWriteService,
)
from app.tooling.file_tools.text_reader import FileToolTextReader
from app.tooling.file_tools.writer import FileToolTextWriter


def test_file_tool_read_service_returns_success_envelope(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("a\nb\nc\n", encoding="utf-8")
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )

    result = service.read(ReadRequest(path="notes.txt", offset=2, limit=1))

    assert result.to_dict()["ok"] is True
    assert result.to_dict()["tool"] == "Read"
    assert result.to_dict()["data"]["content"] == {"text": "b"}
    assert result.to_dict()["data"]["nextOffset"] == 3


def test_file_tool_read_service_maps_file_errors_into_failure_envelope(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )

    result = service.read(ReadRequest(path="missing.txt"))

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["tool"] == "Read"
    assert result.to_dict()["error"]["code"] == "file_not_found"


def test_file_tool_write_service_creates_new_file(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    service = FileToolWriteService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_writer=FileToolTextWriter(),
    )

    result = service.write(WriteRequest(path="nested/output.txt", content="hello write"))

    created = workspace_root / "nested" / "output.txt"
    assert created.read_text(encoding="utf-8") == "hello write"
    assert result.to_dict()["ok"] is True
    assert result.to_dict()["tool"] == "Write"
    assert result.to_dict()["data"]["created"] is True
    assert result.to_dict()["data"]["overwritten"] is False
    assert result.to_dict()["data"]["metadata"]["fileSize"] == len("hello write".encode("utf-8"))


def test_file_tool_write_service_overwrites_existing_file(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("before", encoding="utf-8")
    service = FileToolWriteService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_writer=FileToolTextWriter(),
    )

    result = service.write(WriteRequest(path="notes.txt", content="after"))

    assert target.read_text(encoding="utf-8") == "after"
    assert result.to_dict()["data"]["created"] is False
    assert result.to_dict()["data"]["overwritten"] is True
    assert result.to_dict()["data"]["metadata"]["writeMode"] == "overwrite"


def test_file_tool_write_service_rejects_existing_file_when_overwrite_disabled(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("before", encoding="utf-8")
    service = FileToolWriteService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_writer=FileToolTextWriter(),
    )

    result = service.write(WriteRequest(path="notes.txt", content="after", overwrite=False))

    assert target.read_text(encoding="utf-8") == "before"
    assert result.to_dict()["ok"] is False
    assert result.to_dict()["error"]["code"] == "already_exists"


def test_file_tool_write_service_checks_expected_hash(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("before", encoding="utf-8")
    current_hash = f"sha256:{hashlib.sha256(b'before').hexdigest()}"
    service = FileToolWriteService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_writer=FileToolTextWriter(),
    )

    ok_result = service.write(WriteRequest(path="notes.txt", content="after", expected_hash=current_hash))
    fail_result = service.write(
        WriteRequest(path="notes.txt", content="again", expected_hash="sha256:deadbeef")
    )

    assert ok_result.to_dict()["ok"] is True
    assert ok_result.to_dict()["data"]["metadata"]["sha256"].startswith("sha256:")
    assert fail_result.to_dict()["ok"] is False
    assert fail_result.to_dict()["error"]["code"] == "hash_mismatch"


def test_file_tool_write_service_rejects_directory_target(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    target_dir = workspace_root / "notes"
    target_dir.mkdir(parents=True)
    service = FileToolWriteService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_writer=FileToolTextWriter(),
    )

    result = service.write(WriteRequest(path="notes", content="after"))

    assert result.to_dict()["ok"] is False
    assert result.to_dict()["error"]["code"] == "not_a_file"


def test_file_tool_glob_service_returns_sorted_matches_and_truncation(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    docs_dir = workspace_root / "docs"
    docs_dir.mkdir(parents=True)
    older = docs_dir / "older.md"
    newer = docs_dir / "newer.md"
    older.write_text("old", encoding="utf-8")
    newer.write_text("new", encoding="utf-8")
    now = time.time()
    older_mtime = now - 60
    newer_mtime = now - 10
    older.touch()
    newer.touch()
    older_ts = (older_mtime, older_mtime)
    newer_ts = (newer_mtime, newer_mtime)
    os.utime(older, older_ts)
    os.utime(newer, newer_ts)

    service = FileToolGlobService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        glob_searcher=FileToolGlobSearcher(),
    )

    result = service.glob(GlobRequest(base_path="docs", pattern="*.md", max_results=1))

    assert result.to_dict()["ok"] is True
    assert result.to_dict()["tool"] == "Glob"
    assert result.to_dict()["data"]["truncated"] is True
    assert [match["path"] for match in result.to_dict()["data"]["matches"]] == ["docs/newer.md"]


def test_file_tool_glob_service_excludes_hidden_entries_by_default_and_blocks_escape(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    hidden = workspace_root / ".secret.txt"
    hidden.write_text("secret", encoding="utf-8")

    service = FileToolGlobService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        glob_searcher=FileToolGlobSearcher(),
    )

    hidden_result = service.glob(GlobRequest(base_path=".", pattern="*.txt"))
    included_result = service.glob(GlobRequest(base_path=".", pattern="*.txt", include_hidden=True))
    escape_result = service.glob(GlobRequest(base_path="..", pattern="*.txt"))

    assert hidden_result.to_dict()["data"]["matches"] == []
    assert [match["path"] for match in included_result.to_dict()["data"]["matches"]] == [".secret.txt"]
    assert escape_result.to_dict()["ok"] is False
    assert escape_result.to_dict()["error"]["code"] == "path_out_of_bounds"


def test_file_tool_grep_service_returns_structured_matches_and_invalid_regex_failure(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "notes.txt"
    target.write_text("alpha\nTODO item\nomega\n", encoding="utf-8")

    service = FileToolGrepService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        grep_searcher=FileToolGrepSearcher(),
    )

    result = service.grep(
        GrepRequest(base_path=".", pattern="TODO", file_glob="*.txt", context_lines=1, max_results=5)
    )
    invalid_result = service.grep(
        GrepRequest(base_path=".", pattern="(", file_glob="*.txt", is_regex=True)
    )

    assert result.to_dict()["ok"] is True
    assert result.to_dict()["tool"] == "Grep"
    assert result.to_dict()["data"]["matches"][0]["matchText"] == "TODO"
    assert result.to_dict()["data"]["matches"][0]["before"] == ["alpha"]
    assert result.to_dict()["data"]["matches"][0]["after"] == ["omega"]
    assert invalid_result.to_dict()["ok"] is False
    assert invalid_result.to_dict()["error"]["code"] == "invalid_regex"


def test_file_tools_allow_absolute_paths_outside_workspace(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    target = outside_root / "notes.txt"
    target.write_text("alpha\nTODO item\nomega\n", encoding="utf-8")

    read_service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )
    glob_service = FileToolGlobService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        glob_searcher=FileToolGlobSearcher(),
    )
    grep_service = FileToolGrepService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        grep_searcher=FileToolGrepSearcher(),
    )

    read_result = read_service.read(ReadRequest(path=str(target)))
    glob_result = glob_service.glob(GlobRequest(base_path=str(outside_root), pattern="*.txt"))
    grep_result = grep_service.grep(
        GrepRequest(base_path=str(outside_root), pattern="TODO", file_glob="*.txt", context_lines=1)
    )

    assert read_result.to_dict()["ok"] is True
    assert read_result.to_dict()["data"]["resolvedPath"] == target.resolve(strict=False).as_posix()
    assert read_result.to_dict()["data"]["effectiveRoot"] == outside_root.resolve(strict=False).as_posix()
    assert read_result.to_dict()["data"]["rootSource"] == "absolute_override"
    assert glob_result.to_dict()["ok"] is True
    assert [match["path"] for match in glob_result.to_dict()["data"]["matches"]] == [target.resolve(strict=False).as_posix()]
    assert grep_result.to_dict()["ok"] is True
    assert [match["path"] for match in grep_result.to_dict()["data"]["matches"]] == [target.resolve(strict=False).as_posix()]
