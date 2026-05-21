from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from app.tooling.file_tools import (
    FileToolError,
    FileToolGlobSearcher,
    FileToolPathPolicy,
    GlobRequest,
    GlobSearchPayload,
)
from app.tooling.file_tools.errors import FileToolError
from app.tooling.file_tools.glob_search import _compile_pattern, _to_posix_path


class TestGlobSearchPayload:
    def test_construction_defaults(self) -> None:
        payload = GlobSearchPayload(
            base_path=".",
            resolved_base_path="/abs/path",
            pattern="*.py",
            matches=(),
            truncated=False,
        )
        assert payload.base_path == "."
        assert payload.resolved_base_path == "/abs/path"
        assert payload.pattern == "*.py"
        assert payload.matches == ()
        assert payload.truncated is False

    def test_construction_with_truncated(self) -> None:
        payload = GlobSearchPayload(
            base_path="src",
            resolved_base_path="/workspace/src",
            pattern="**/*.py",
            matches=(),
            truncated=True,
        )
        assert payload.truncated is True

    def test_to_dict_no_matches(self) -> None:
        payload = GlobSearchPayload(
            base_path=".",
            resolved_base_path="/tmp/work",
            pattern="*.py",
            matches=(),
            truncated=False,
        )
        result = payload.to_dict()
        assert result == {
            "basePath": ".",
            "resolvedBasePath": "/tmp/work",
            "pattern": "*.py",
            "matches": [],
            "truncated": False,
        }

    def test_to_dict_with_truncated(self) -> None:
        payload = GlobSearchPayload(
            base_path=".",
            resolved_base_path="/tmp/work",
            pattern="*.py",
            matches=(),
            truncated=True,
        )
        assert payload.to_dict()["truncated"] is True


class TestFileToolGlobSearcher:
    def test_search_simple_pattern(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "a.py").write_text("", encoding="utf-8")
        (workspace_root / "b.py").write_text("", encoding="utf-8")
        (workspace_root / "c.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        match_paths = [m.path.path for m in payload.matches]
        assert sorted(match_paths) == ["a.py", "b.py"]

    def test_search_no_matches(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "a.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        assert payload.matches == ()

    def test_search_recursive_multi_level_pattern(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub = workspace_root / "sub"
        sub.mkdir()
        deep = sub / "deep"
        deep.mkdir()
        (workspace_root / "root.py").write_text("", encoding="utf-8")
        (sub / "nested.py").write_text("", encoding="utf-8")
        (deep / "deep.py").write_text("", encoding="utf-8")
        (workspace_root / "other.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        # Using */*/*.py to match across multiple directory levels
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*/*/*.py"),
            resolution=resolution,
        )

        match_paths = [m.path.path for m in payload.matches]
        assert sorted(match_paths) == ["sub/deep/deep.py"]

    def test_search_dotfile_with_include_hidden(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / ".hidden").write_text("", encoding="utf-8")
        (workspace_root / ".env").write_text("", encoding="utf-8")
        (workspace_root / "visible.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern=".*", include_hidden=True),
            resolution=resolution,
        )

        match_paths = [m.path.path for m in payload.matches]
        assert sorted(match_paths) == [".env", ".hidden"]

    def test_search_dotfile_excluded_without_include_hidden(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / ".hidden").write_text("", encoding="utf-8")
        (workspace_root / ".env").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern=".*"),
            resolution=resolution,
        )

        assert payload.matches == ()

    def test_search_hidden_excluded_by_default(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / ".secret").write_text("", encoding="utf-8")
        (workspace_root / "visible.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*"),
            resolution=resolution,
        )

        match_paths = [m.path.path for m in payload.matches]
        assert ".secret" not in match_paths
        assert "visible.txt" in match_paths

    def test_search_results_sorted(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        a = workspace_root / "a.py"
        b = workspace_root / "b.py"
        c = workspace_root / "c.py"
        a.write_text("", encoding="utf-8")
        b.write_text("", encoding="utf-8")
        c.write_text("", encoding="utf-8")
        # Force equal mtimes so sort is determined by path ascending.
        ref_mtime = a.stat().st_mtime
        os.utime(b, (ref_mtime, ref_mtime))
        os.utime(c, (ref_mtime, ref_mtime))

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        paths = [m.path.path for m in payload.matches]
        # The sort key is (-mtime, path): newest first, alphabetical for ties.
        # Verify that the result is correctly ordered according to this key.
        for i in range(len(paths) - 1):
            a_match = payload.matches[i]
            b_match = payload.matches[i + 1]
            assert (
                a_match.modified_time_ms >= b_match.modified_time_ms
            ), f"expected newer first, got {paths}"
            if a_match.modified_time_ms == b_match.modified_time_ms:
                assert a_match.path.path <= b_match.path.path, (
                    f"tie broken by path ascending, got {paths}"
                )

    def test_search_sorted_by_mtime_descending(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        older = workspace_root / "older.py"
        newer = workspace_root / "newer.py"
        older.write_text("", encoding="utf-8")
        # Force a small delay so files get distinct mtime values on all OS
        time.sleep(0.1)
        newer.write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        paths = [m.path.path for m in payload.matches]
        assert paths[0] == "newer.py"
        assert paths[1] == "older.py"

    def test_search_max_results_truncation(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        for i in range(10):
            (workspace_root / f"file_{i:02d}.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.txt", max_results=3),
            resolution=resolution,
        )

        assert payload.truncated is True
        assert len(payload.matches) == 3

    def test_search_max_results_no_truncation(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        for i in range(3):
            (workspace_root / f"file_{i:02d}.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.txt", max_results=10),
            resolution=resolution,
        )

        assert payload.truncated is False
        assert len(payload.matches) == 3

    def test_search_respects_base_path(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub = workspace_root / "subdir"
        sub.mkdir()
        (workspace_root / "root.py").write_text("", encoding="utf-8")
        (sub / "nested.py").write_text("", encoding="utf-8")

        resolution_root = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload_root = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution_root,
        )
        root_paths = [m.path.path for m in payload_root.matches]
        # fnmatch.translate on Python 3.12 maps * to .* (includes /),
        # so *.py acts recursively. Both root and nested files appear.
        assert "root.py" in root_paths
        assert "subdir/nested.py" in root_paths

        resolution_sub = FileToolPathPolicy(workspace_root=workspace_root).resolve_path("subdir")
        payload_sub = FileToolGlobSearcher().search(
            request=GlobRequest(base_path="subdir", pattern="*.py"),
            resolution=resolution_sub,
        )
        sub_paths = [m.path.path for m in payload_sub.matches]
        assert sub_paths == ["subdir/nested.py"]

    def test_search_resolved_base_path_in_payload(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "a.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        assert payload.base_path == "."
        assert payload.resolved_base_path == workspace_root.resolve(strict=False).as_posix()
        assert payload.pattern == "*.py"

    def test_search_bracket_pattern_accepted(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "[test].py").write_text("", encoding="utf-8")
        (workspace_root / "other.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="[[]test[]].py"),
            resolution=resolution,
        )
        assert len(payload.matches) == 1
        assert payload.matches[0].path.path == "[test].py"

    def test_search_non_existent_base_path(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path("nonexistent")

        with pytest.raises(FileToolError) as exc_info:
            FileToolGlobSearcher().search(
                request=GlobRequest(base_path="nonexistent", pattern="*.py"),
                resolution=resolution,
            )
        assert exc_info.value.code == "file_not_found"

    def test_search_base_path_not_directory(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        file_path = workspace_root / "file.txt"
        file_path.write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path("file.txt")

        with pytest.raises(FileToolError) as exc_info:
            FileToolGlobSearcher().search(
                request=GlobRequest(base_path="file.txt", pattern="*.py"),
                resolution=resolution,
            )
        assert exc_info.value.code == "not_a_directory"

    def test_search_metadata_in_match(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        content = "print('hello')"
        py_file = workspace_root / "main.py"
        py_file.write_text(content, encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        assert len(payload.matches) == 1
        match = payload.matches[0]
        assert match.path.path == "main.py"
        assert match.is_directory is False
        assert match.is_hidden is False
        assert match.size_bytes == len(content.encode("utf-8"))
        assert match.modified_time_ms is not None and match.modified_time_ms > 0

    def test_search_match_is_directory_flag(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub_dir = workspace_root / "mypackage"
        sub_dir.mkdir()

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")

        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="mypackage"),
            resolution=resolution,
        )

        assert len(payload.matches) == 1
        assert payload.matches[0].is_directory is True
        assert payload.matches[0].size_bytes is None

    def test_search_glob_match_to_dict(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "main.py").write_text("x", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        match_dict = payload.matches[0].to_dict()
        assert match_dict["path"] == "main.py"
        assert match_dict["isDirectory"] is False
        assert match_dict["isHidden"] is False
        assert "sizeBytes" in match_dict
        assert "modifiedTimeMs" in match_dict

    def test_search_payload_to_dict_includes_matches(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "a.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py"),
            resolution=resolution,
        )

        result = payload.to_dict()
        assert isinstance(result["matches"], list)
        assert len(result["matches"]) == 1
        assert result["matches"][0]["path"] == "a.py"

    def test_search_with_absolute_override_root_source(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        outside_dir = tmp_path / "outside"
        outside_dir.mkdir()
        (outside_dir / "data.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(
            str(outside_dir)
        )
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=str(outside_dir), pattern="*.py"),
            resolution=resolution,
        )

        assert len(payload.matches) == 1
        assert payload.matches[0].path.path == outside_dir.as_posix() + "/data.py"

    def test_search_subdir_simple_match(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub = workspace_root / "src"
        sub.mkdir()
        (sub / "main.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path("src")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path="src", pattern="*.py"),
            resolution=resolution,
        )

        assert [m.path.path for m in payload.matches] == ["src/main.py"]

    def test_search_star_pattern_matches_recursively(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub = workspace_root / "sub"
        sub.mkdir()
        (workspace_root / "root.py").write_text("", encoding="utf-8")
        (sub / "nested.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*"),
            resolution=resolution,
        )

        match_paths = [m.path.path for m in payload.matches]
        # fnmatch.translate on Python 3.12 maps * to .* (which includes /),
        # so patterns behave recursively.
        assert "root.py" in match_paths
        assert "sub" in match_paths
        assert "sub/nested.py" in match_paths


    def test_search_recursive_double_star_pattern(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub = workspace_root / "sub"
        sub.mkdir()
        deep = sub / "deep"
        deep.mkdir()
        (workspace_root / "root.py").write_text("", encoding="utf-8")
        (sub / "nested.py").write_text("", encoding="utf-8")
        (deep / "deep.py").write_text("", encoding="utf-8")
        (workspace_root / "other.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="**/*.py"),
            resolution=resolution,
        )

        match_paths = [m.path.path for m in payload.matches]
        # Python 3.12 fnmatch.translate for **/*.py uses an atomic group
        # that requires at least one directory level, so root-level *.py
        # is not matched. Only nested *.py files are returned.
        assert sorted(match_paths) == [
            "sub/deep/deep.py",
            "sub/nested.py",
        ]

    def test_search_double_star_pattern_requires_subdirectory(
        self, tmp_path: Path
    ) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        sub = workspace_root / "src"
        sub.mkdir()
        (workspace_root / "top.py").write_text("", encoding="utf-8")
        (sub / "inner.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="**/*.py"),
            resolution=resolution,
        )

        paths = [m.path.path for m in payload.matches]
        # **/*.py requires at least one directory level on Python 3.12,
        # so root-level files are excluded.
        assert "top.py" not in paths
        assert "src/inner.py" in paths

    def test_search_comma_separated_pattern(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        (workspace_root / "a.py").write_text("", encoding="utf-8")
        (workspace_root / "b.py").write_text("", encoding="utf-8")
        (workspace_root / "c.txt").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="*.py,*.txt"),
            resolution=resolution,
        )

        assert len(payload.matches) == 0

    def test_search_comma_in_filename(self, tmp_path: Path) -> None:
        workspace_root = tmp_path / "workspace"
        workspace_root.mkdir()
        comma_file = workspace_root / "my,file.py"
        comma_file.write_text("", encoding="utf-8")
        (workspace_root / "normal.py").write_text("", encoding="utf-8")

        resolution = FileToolPathPolicy(workspace_root=workspace_root).resolve_path(".")
        payload = FileToolGlobSearcher().search(
            request=GlobRequest(base_path=".", pattern="my,file.py"),
            resolution=resolution,
        )

        assert len(payload.matches) == 1
        assert payload.matches[0].path.path == "my,file.py"


class TestCompilePattern:
    def test_compile_valid_pattern(self) -> None:
        pat = _compile_pattern("*.py")
        assert pat.match("hello.py")
        assert not pat.match("hello.txt")

    def test_compile_empty_raises(self) -> None:
        with pytest.raises(FileToolError) as exc_info:
            _compile_pattern("")
        assert exc_info.value.code == "invalid_pattern"

    def test_compile_whitespace_raises(self) -> None:
        with pytest.raises(FileToolError) as exc_info:
            _compile_pattern("   ")
        assert exc_info.value.code == "invalid_pattern"

    def test_compile_bracket_pattern_compiles(self) -> None:
        pat = _compile_pattern("[")
        assert pat.match("[")
        assert not pat.match("x")


class TestToPosixPath:
    def test_empty_path_returns_dot(self) -> None:
        assert _to_posix_path(Path()) == "."

    def test_dot_returns_dot(self) -> None:
        assert _to_posix_path(Path(".")) == "."

    def test_relative_path(self) -> None:
        assert _to_posix_path(Path("foo/bar.py")) == "foo/bar.py"

    def test_absolute_path(self) -> None:
        p = Path("/abs/path/file.py")
        assert _to_posix_path(p) == "/abs/path/file.py"
