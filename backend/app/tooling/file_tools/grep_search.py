"""Text grep with bounded context for workspace defaults and absolute overrides."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from fnmatch import translate
import re
from pathlib import Path

from .errors import FileToolError
from .path_policy import PathResolution, is_hidden_path
from .protocol import GrepMatch, GrepRequest, PathMetadata
from .text_reader import _looks_binary

_DEFAULT_MAX_RESULTS = 100


@dataclass(frozen=True, slots=True)
class GrepSearchPayload:
    """Resolved grep result payload before service/runtime envelope mapping."""

    base_path: str
    resolved_base_path: str
    pattern: str
    file_glob: str
    is_regex: bool
    case_sensitive: bool
    context_lines: int
    matches: tuple[GrepMatch, ...]
    truncated: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "basePath": self.base_path,
            "resolvedBasePath": self.resolved_base_path,
            "pattern": self.pattern,
            "fileGlob": self.file_glob,
            "isRegex": self.is_regex,
            "caseSensitive": self.case_sensitive,
            "contextLines": self.context_lines,
            "matches": [match.to_dict() for match in self.matches],
            "truncated": self.truncated,
        }


class FileToolGrepSearcher:
    """Search text files and return structured line matches with context."""

    def search(
        self, *, request: GrepRequest, resolution: PathResolution
    ) -> GrepSearchPayload:
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

        candidates = list(
            _iter_matching_files(
                base_path=base_path, request=request, resolution=resolution
            )
        )
        content_matcher = _compile_search_pattern(
            pattern=request.pattern,
            is_regex=request.is_regex,
            case_sensitive=request.case_sensitive,
        )
        max_results = request.max_results or _DEFAULT_MAX_RESULTS
        matches: list[GrepMatch] = []
        truncated = False

        for candidate in candidates:
            file_matches, file_truncated = _search_file(
                candidate=candidate,
                request=request,
                resolution=resolution,
                matcher=content_matcher,
                remaining=max_results - len(matches),
            )
            matches.extend(file_matches)
            if len(matches) >= max_results:
                truncated = file_truncated or _has_any_match(
                    candidates=_remaining_candidates(candidates, after=candidate),
                    matcher=content_matcher,
                )
                break

        return GrepSearchPayload(
            base_path=request.base_path,
            resolved_base_path=base_path.as_posix(),
            pattern=request.pattern,
            file_glob=request.file_glob,
            is_regex=request.is_regex,
            case_sensitive=request.case_sensitive,
            context_lines=request.context_lines,
            matches=tuple(matches),
            truncated=truncated,
        )


def _search_file(
    *,
    candidate: Path,
    request: GrepRequest,
    resolution: PathResolution,
    matcher: re.Pattern[str],
    remaining: int,
) -> tuple[list[GrepMatch], bool]:
    if remaining <= 0:
        return [], False

    lines = _read_searchable_lines(candidate)
    if lines is None:
        return [], False
    before_buffer: deque[str] = deque(maxlen=request.context_lines)
    results: list[GrepMatch] = []
    truncated = False

    for index, line in enumerate(lines):
        search_match = matcher.search(line)
        if search_match is None:
            before_buffer.append(line)
            continue

        line_number = index + 1
        after = tuple(lines[index + 1 : index + 1 + request.context_lines])
        match_path = _build_match_path(candidate=candidate, resolution=resolution)
        results.append(
            GrepMatch(
                path=PathMetadata(
                    path=match_path,
                    resolved_path=candidate.as_posix(),
                    path_kind=resolution.path_kind,
                    effective_root=resolution.effective_root.as_posix(),
                    root_source=resolution.root_source,
                    root_policy=resolution.root_policy,
                    symlink_policy=resolution.symlink_policy,
                ),
                line_number=line_number,
                column_number=search_match.start() + 1,
                line_text=line,
                match_text=search_match.group(0),
                before=tuple(before_buffer),
                after=after,
            )
        )
        if len(results) >= remaining:
            truncated = _line_has_following_match(
                lines=lines, start_index=index + 1, matcher=matcher
            )
            break
        before_buffer.append(line)

    return results, truncated


def _iter_matching_files(
    *,
    base_path: Path,
    request: GrepRequest,
    resolution: PathResolution,
):
    file_matcher = _compile_file_glob(request.file_glob)
    for candidate in sorted(
        (path for path in base_path.rglob("*") if path.is_file()),
        key=lambda path: _to_posix_path(path.relative_to(base_path)),
    ):
        if not request.include_hidden and is_hidden_path(
            candidate, workspace_root=resolution.effective_root
        ):
            continue
        if not _matches_file_glob(file_matcher, candidate.relative_to(base_path)):
            continue
        if _is_binary_file(candidate):
            continue
        yield candidate


def _compile_file_glob(pattern: str) -> re.Pattern[str]:
    normalized = pattern.strip()
    if normalized == "":
        raise FileToolError(
            code="invalid_pattern", message="fileGlob must be a non-empty string."
        )
    try:
        return re.compile(translate(normalized))
    except re.error as exc:
        raise FileToolError(
            code="invalid_pattern",
            message="fileGlob is invalid.",
            details={"fileGlob": pattern},
        ) from exc


def _compile_search_pattern(
    *, pattern: str, is_regex: bool, case_sensitive: bool
) -> re.Pattern[str]:
    flags = 0 if case_sensitive else re.IGNORECASE
    source = pattern if is_regex else re.escape(pattern)
    try:
        return re.compile(source, flags)
    except re.error as exc:
        raise FileToolError(
            code="invalid_regex",
            message="Search pattern is not a valid regular expression.",
            details={"pattern": pattern},
        ) from exc


def _matches_file_glob(matcher: re.Pattern[str], relative_candidate: Path) -> bool:
    candidate_text = _to_posix_path(relative_candidate)
    return matcher.fullmatch(candidate_text) is not None


def _build_match_path(*, candidate: Path, resolution: PathResolution) -> str:
    if resolution.root_source == "absolute_override":
        return candidate.as_posix()
    return _to_posix_path(candidate.relative_to(resolution.workspace_root))


def _to_posix_path(path: Path) -> str:
    value = path.as_posix()
    return "." if value == "" else value


def _is_binary_file(path: Path) -> bool:
    sample = path.read_bytes()[:4096]
    return _looks_binary(sample)


def _read_searchable_lines(path: Path) -> list[str] | None:
    try:
        return path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeDecodeError):
        return None


def _line_has_following_match(
    *, lines: list[str], start_index: int, matcher: re.Pattern[str]
) -> bool:
    for line in lines[start_index:]:
        if matcher.search(line) is not None:
            return True
    return False


def _remaining_candidates(candidates: list[Path], *, after: Path) -> list[Path]:
    seen_current = False
    remaining: list[Path] = []
    for candidate in candidates:
        if not seen_current:
            if candidate == after:
                seen_current = True
            continue
        remaining.append(candidate)
    return remaining


def _has_any_match(*, candidates: list[Path], matcher: re.Pattern[str]) -> bool:
    for candidate in candidates:
        lines = _read_searchable_lines(candidate)
        if lines is None:
            continue
        for line in lines:
            if matcher.search(line) is not None:
                return True
    return False


__all__ = ["FileToolGrepSearcher", "GrepSearchPayload"]
