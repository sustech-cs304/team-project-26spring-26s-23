"""Service orchestration for staged file tool Read support."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from .errors import FileToolError
from .path_policy import FileToolPathPolicy
from .protocol import FileToolCallMetadata, ReadRequest, ToolResultEnvelope
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


__all__ = ["FileToolReadService"]
