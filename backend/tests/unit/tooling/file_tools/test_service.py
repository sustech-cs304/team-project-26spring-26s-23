from __future__ import annotations

from pathlib import Path
import time

from app.tooling.file_tools import FileToolPathPolicy, GlobRequest, ReadRequest
from app.tooling.file_tools.service import FileToolGlobService, FileToolReadService
from app.tooling.file_tools.text_reader import FileToolTextReader
from app.tooling.file_tools.glob_search import FileToolGlobSearcher


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
    import os
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
