"""Glob discovery for file tools with workspace defaults and absolute overrides."""

from __future__ import annotations

from dataclasses import dataclass
from fnmatch import translate
import re
from pathlib import Path

from .errors import FileToolError
from .path_policy import PathResolution, is_hidden_path
from .protocol import GlobMatch, GlobRequest, PathMetadata

_DEFAULT_MAX_RESULTS = 500


@dataclass(frozen=True, slots=True)
class GlobSearchPayload:
    """Resolved glob result payload before service/runtime envelope mapping."""

    base_path: str
    resolved_base_path: str
    pattern: str
    matches: tuple[GlobMatch, ...]
    truncated: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "basePath": self.base_path,
            "resolvedBasePath": self.resolved_base_path,
            "pattern": self.pattern,
            "matches": [match.to_dict() for match in self.matches],
            "truncated": self.truncated,
        }


class FileToolGlobSearcher:
    """Discover paths using glob-like patterns without reading file contents."""

    def search(
        self, *, request: GlobRequest, resolution: PathResolution
    ) -> GlobSearchPayload:
        base_path = resolution.resolved_path
        if not base_path.exists():
            raise FileToolError(
                code="file_not_found",
                message="Base path does not exist.",
                details={
                    "path": request.base_path,
                    "resolvedPath": base_path.as_posix(),
                },
            )
        if not base_path.is_dir():
            raise FileToolError(
                code="not_a_directory",
                message="Base path must resolve to a directory.",
                details={
                    "path": request.base_path,
                    "resolvedPath": base_path.as_posix(),
                },
            )

        matcher = _compile_pattern(request.pattern)
        max_results = request.max_results or _DEFAULT_MAX_RESULTS
        discovered: list[tuple[float, str, GlobMatch]] = []
        truncated = False

        for candidate in _iter_workspace_entries(base_path):
            relative_candidate = candidate.relative_to(base_path)
            if not request.include_hidden and is_hidden_path(
                candidate, workspace_root=resolution.effective_root
            ):
                continue
            if not _matches_candidate(matcher, relative_candidate):
                continue

            stat = candidate.stat()
            match_path = _build_match_path(candidate=candidate, resolution=resolution)
            match = GlobMatch(
                path=PathMetadata(
                    path=match_path,
                    resolved_path=candidate.as_posix(),
                    path_kind=resolution.path_kind,
                    effective_root=resolution.effective_root.as_posix(),
                    root_source=resolution.root_source,
                    root_policy=resolution.root_policy,
                    symlink_policy=resolution.symlink_policy,
                ),
                is_directory=candidate.is_dir(),
                is_hidden=is_hidden_path(
                    candidate, workspace_root=resolution.effective_root
                ),
                size_bytes=None if candidate.is_dir() else stat.st_size,
                modified_time_ms=int(stat.st_mtime * 1000),
            )
            discovered.append((stat.st_mtime, match.path.path, match))

        discovered.sort(key=lambda item: (-item[0], item[1]))
        if len(discovered) > max_results:
            truncated = True
            discovered = discovered[:max_results]

        return GlobSearchPayload(
            base_path=request.base_path,
            resolved_base_path=base_path.as_posix(),
            pattern=request.pattern,
            matches=tuple(item[2] for item in discovered),
            truncated=truncated,
        )


def _compile_pattern(pattern: str) -> re.Pattern[str]:
    normalized = pattern.strip()
    if normalized == "":
        raise FileToolError(
            code="invalid_pattern", message="pattern must be a non-empty string."
        )
    try:
        translated = translate(normalized)
        if isinstance(translated, tuple):
            translated = translated[0]
        return re.compile(translated)
    except re.error as exc:
        raise FileToolError(
            code="invalid_pattern",
            message="Glob pattern is invalid.",
            details={"pattern": pattern},
        ) from exc


def _matches_candidate(matcher: re.Pattern[str], relative_candidate: Path) -> bool:
    candidate_text = _to_posix_path(relative_candidate)
    if candidate_text == ".":
        return False
    if matcher.fullmatch(candidate_text):
        return True
    if relative_candidate.is_dir():
        return matcher.fullmatch(f"{candidate_text}/") is not None
    return False


def _iter_workspace_entries(base_path: Path):
    for candidate in base_path.rglob("*"):
        yield candidate
    yield base_path


def _build_match_path(*, candidate: Path, resolution: PathResolution) -> str:
    if resolution.root_source == "absolute_override":
        return candidate.as_posix()
    return _to_posix_path(candidate.relative_to(resolution.workspace_root))


def _to_posix_path(path: Path) -> str:
    value = path.as_posix()
    return "." if value == "" else value


__all__ = ["FileToolGlobSearcher", "GlobSearchPayload"]
