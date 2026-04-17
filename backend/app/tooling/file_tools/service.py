"""Service orchestration for staged file tool Read, Glob, and Grep support."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from .errors import FileToolError
from .glob_search import FileToolGlobSearcher
from .grep_search import FileToolGrepSearcher
from .path_policy import FileToolPathPolicy
from .protocol import FileToolCallMetadata, GlobRequest, GrepRequest, ReadRequest, ToolResultEnvelope
from .text_reader import FileToolTextReader


@dataclass(frozen=True, slots=True)
class FileToolReadService:
    """Compose path policy and text reader into the staged Read service."""

    path_policy: FileToolPathPolicy
    text_reader: FileToolTextReader

    def read(self, request: ReadRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.path)
            payload = self.text_reader.read_text(request=request, resolution=resolution)
            return ToolResultEnvelope(
                ok=True,
                tool="Read",
                data=payload.result.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="Read",
                error=exc,
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )


@dataclass(frozen=True, slots=True)
class FileToolGlobService:
    """Compose path policy and glob search into the staged Glob service."""

    path_policy: FileToolPathPolicy
    glob_searcher: FileToolGlobSearcher

    def glob(self, request: GlobRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.base_path)
            payload = self.glob_searcher.search(request=request, resolution=resolution)
            return ToolResultEnvelope(
                ok=True,
                tool="Glob",
                data=payload.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="Glob",
                error=exc,
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )


@dataclass(frozen=True, slots=True)
class FileToolGrepService:
    """Compose path policy and text grep into the staged Grep service."""

    path_policy: FileToolPathPolicy
    grep_searcher: FileToolGrepSearcher

    def grep(self, request: GrepRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.base_path)
            payload = self.grep_searcher.search(request=request, resolution=resolution)
            return ToolResultEnvelope(
                ok=True,
                tool="Grep",
                data=payload.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="Grep",
                error=exc,
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )


__all__ = ["FileToolGlobService", "FileToolGrepService", "FileToolReadService"]
