"""General path resolution with workspace-root defaults and absolute overrides."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .errors import FileToolError
from .protocol import PathKind, RootPolicy, RootSource, SymlinkPolicy


@dataclass(frozen=True, slots=True)
class PathResolution:
    """Normalized file tool path with explicit effective-root metadata."""

    original_path: str
    requested_path: Path
    resolved_path: Path
    workspace_root: Path
    effective_root: Path
    path_kind: PathKind
    root_source: RootSource
    root_policy: RootPolicy = "workspace_root"
    symlink_policy: SymlinkPolicy = "deny_escape"


@dataclass(frozen=True, slots=True)
class FileToolPathPolicy:
    """Resolve user-supplied paths with workspace-root defaults and absolute overrides."""

    workspace_root: Path
    root_policy: RootPolicy = "workspace_root"
    symlink_policy: SymlinkPolicy = "deny_escape"

    def __post_init__(self) -> None:
        object.__setattr__(self, "workspace_root", self.workspace_root.resolve(strict=False))

    def resolve_path(self, path: str) -> PathResolution:
        normalized = path.strip()
        if normalized == "":
            raise FileToolError(code="invalid_request", message="path must be a non-empty string.")

        requested = Path(normalized)
        path_kind: PathKind = "absolute" if requested.is_absolute() else "relative"
        if requested.is_absolute():
            effective_root = requested.parent if requested.name else requested
            root_source: RootSource = "absolute_override"
            candidate = requested
        else:
            effective_root = self.workspace_root
            root_source = "workspace_root"
            candidate = effective_root / requested

        resolved = candidate.resolve(strict=False)
        if path_kind == "relative":
            ensure_within_workspace(resolved_path=resolved, workspace_root=self.workspace_root)
        return PathResolution(
            original_path=normalized,
            requested_path=requested,
            resolved_path=resolved,
            workspace_root=self.workspace_root,
            effective_root=effective_root.resolve(strict=False),
            path_kind=path_kind,
            root_source=root_source,
            root_policy=self.root_policy,
            symlink_policy=self.symlink_policy,
        )


def ensure_within_workspace(*, resolved_path: Path, workspace_root: Path) -> None:
    resolved_workspace = workspace_root.resolve(strict=False)
    resolved_candidate = resolved_path.resolve(strict=False)
    try:
        resolved_candidate.relative_to(resolved_workspace)
    except ValueError as exc:
        raise FileToolError(
            code="path_out_of_bounds",
            message="Resolved path escapes the workspace root.",
            details={
                "resolvedPath": resolved_candidate.as_posix(),
                "workspaceRoot": resolved_workspace.as_posix(),
            },
        ) from exc


def is_hidden_path(path: Path, *, workspace_root: Path | None = None) -> bool:
    target = path.resolve(strict=False)
    if workspace_root is not None:
        root = workspace_root.resolve(strict=False)
        try:
            parts = target.relative_to(root).parts
        except ValueError:
            parts = target.parts
    else:
        parts = target.parts
    return any(part.startswith(".") for part in parts if part not in {".", ".."})


__all__ = [
    "FileToolPathPolicy",
    "PathResolution",
    "RootPolicy",
    "RootSource",
    "SymlinkPolicy",
    "ensure_within_workspace",
    "is_hidden_path",
]
