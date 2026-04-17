from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.tooling.file_tools import FileToolError, FileToolPathPolicy, ensure_within_workspace, is_hidden_path


@pytest.fixture
def workspace_root(tmp_path: Path) -> Path:
    root = tmp_path / "workspace"
    root.mkdir()
    return root


def test_resolve_path_accepts_relative_path_under_workspace(workspace_root: Path) -> None:
    policy = FileToolPathPolicy(workspace_root=workspace_root)

    resolution = policy.resolve_path("src/main.py")

    assert resolution.path_kind == "relative"
    assert resolution.resolved_path == (workspace_root / "src/main.py").resolve(strict=False)
    assert resolution.root_policy == "workspace_only"
    assert resolution.symlink_policy == "deny_escape"


def test_resolve_path_accepts_absolute_path_inside_workspace(workspace_root: Path) -> None:
    policy = FileToolPathPolicy(workspace_root=workspace_root)
    absolute_path = workspace_root / "docs/readme.md"

    resolution = policy.resolve_path(str(absolute_path))

    assert resolution.path_kind == "absolute"
    assert resolution.resolved_path == absolute_path.resolve(strict=False)


def test_resolve_path_blocks_parent_directory_escape(workspace_root: Path) -> None:
    policy = FileToolPathPolicy(workspace_root=workspace_root)

    with pytest.raises(FileToolError) as exc_info:
        policy.resolve_path("../outside.txt")

    assert exc_info.value.code == "path_out_of_bounds"
    assert exc_info.value.details["workspaceRoot"] == workspace_root.resolve(strict=False).as_posix()


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="symlink unsupported on this platform")
def test_resolve_path_blocks_symlink_escape(workspace_root: Path) -> None:
    outside = workspace_root.parent / "outside"
    outside.mkdir()
    secret = outside / "secret.txt"
    secret.write_text("secret", encoding="utf-8")
    link_path = workspace_root / "linked-secret.txt"
    link_path.symlink_to(secret)
    policy = FileToolPathPolicy(workspace_root=workspace_root)

    with pytest.raises(FileToolError) as exc_info:
        policy.resolve_path("linked-secret.txt")

    assert exc_info.value.code == "path_out_of_bounds"
    assert exc_info.value.details["resolvedPath"] == secret.resolve(strict=False).as_posix()


def test_resolve_path_rejects_blank_path(workspace_root: Path) -> None:
    policy = FileToolPathPolicy(workspace_root=workspace_root)

    with pytest.raises(FileToolError) as exc_info:
        policy.resolve_path("   ")

    assert exc_info.value.code == "invalid_request"


def test_hidden_path_helper_detects_dot_segments(workspace_root: Path) -> None:
    hidden = workspace_root / ".config" / "settings.json"
    visible = workspace_root / "src" / "main.py"

    assert is_hidden_path(hidden, workspace_root=workspace_root) is True
    assert is_hidden_path(visible, workspace_root=workspace_root) is False


def test_ensure_within_workspace_accepts_nested_path(workspace_root: Path) -> None:
    nested = workspace_root / "nested" / "file.txt"

    ensure_within_workspace(resolved_path=nested, workspace_root=workspace_root)


def test_ensure_within_workspace_rejects_external_path(workspace_root: Path) -> None:
    outside = workspace_root.parent / "other" / "file.txt"

    with pytest.raises(FileToolError) as exc_info:
        ensure_within_workspace(resolved_path=outside, workspace_root=workspace_root)

    assert exc_info.value.code == "path_out_of_bounds"
