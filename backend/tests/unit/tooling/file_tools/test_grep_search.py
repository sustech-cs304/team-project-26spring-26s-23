from __future__ import annotations

from pathlib import Path

import pytest

from app.tooling.file_tools import FileToolPathPolicy, GrepRequest
from app.tooling.file_tools.errors import FileToolError
from app.tooling.file_tools.grep_search import FileToolGrepSearcher


def test_grep_search_supports_literal_case_and_context(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    docs_dir = workspace_root / "docs"
    docs_dir.mkdir(parents=True)
    target = docs_dir / "notes.txt"
    target.write_text("alpha\nBeta target\ngamma\n", encoding="utf-8")

    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path("docs")
    payload = FileToolGrepSearcher().search(
        request=GrepRequest(
            base_path="docs",
            pattern="target",
            file_glob="*.txt",
            context_lines=1,
            case_sensitive=False,
        ),
        resolution=resolution,
    )

    assert payload.to_dict()["truncated"] is False
    assert payload.to_dict()["matches"] == [
        {
            "path": "docs/notes.txt",
            "resolvedPath": target.as_posix(),
            "pathKind": "relative",
            "effectiveRoot": workspace_root.resolve(strict=False).as_posix(),
            "rootSource": "workspace_root",
            "rootPolicy": "workspace_root",
            "symlinkPolicy": "deny_escape",
            "lineNumber": 2,
            "columnNumber": 6,
            "lineText": "Beta target",
            "matchText": "target",
            "before": ["alpha"],
            "after": ["gamma"],
        }
    ]


def test_grep_search_supports_regex_and_max_results(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    src_dir = workspace_root / "src"
    src_dir.mkdir(parents=True)
    (src_dir / "a.py").write_text("TODO one\npass\nTODO two\n", encoding="utf-8")
    (src_dir / "b.py").write_text("TODO three\n", encoding="utf-8")

    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path("src")
    payload = FileToolGrepSearcher().search(
        request=GrepRequest(
            base_path="src",
            pattern=r"TODO\s+\w+",
            file_glob="*.py",
            is_regex=True,
            max_results=2,
        ),
        resolution=resolution,
    )

    result = payload.to_dict()
    assert result["truncated"] is True
    assert [match["path"] for match in result["matches"]] == ["src/a.py", "src/a.py"]
    assert [match["matchText"] for match in result["matches"]] == ["TODO one", "TODO two"]


def test_grep_search_respects_case_sensitivity(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    target = workspace_root / "sample.txt"
    target.write_text("todo\nTODO\n", encoding="utf-8")

    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
    insensitive = FileToolGrepSearcher().search(
        request=GrepRequest(base_path=".", pattern="TODO", file_glob="*.txt", case_sensitive=False),
        resolution=resolution,
    )
    sensitive = FileToolGrepSearcher().search(
        request=GrepRequest(base_path=".", pattern="TODO", file_glob="*.txt", case_sensitive=True),
        resolution=resolution,
    )

    assert len(insensitive.matches) == 2
    assert len(sensitive.matches) == 1
    assert sensitive.matches[0].line_number == 2


def test_grep_search_skips_binary_files_and_reports_invalid_regex(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "sample.bin").write_bytes(b"\x00\x01TODO")
    (workspace_root / "sample.txt").write_text("TODO\n", encoding="utf-8")
    resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")

    payload = FileToolGrepSearcher().search(
        request=GrepRequest(base_path=".", pattern="TODO", file_glob="*", max_results=5),
        resolution=resolution,
    )
    assert [match.path.path for match in payload.matches] == ["sample.txt"]

    with pytest.raises(FileToolError) as exc_info:
        FileToolGrepSearcher().search(
            request=GrepRequest(base_path=".", pattern="(", file_glob="*.txt", is_regex=True),
            resolution=resolution,
        )

    assert exc_info.value.code == "invalid_regex"
