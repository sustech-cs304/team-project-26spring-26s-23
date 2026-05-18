"""Service orchestration for staged file tools, including notebook-aware read and edit."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
from .errors import FileToolError
from .editor import FileToolTextEditor
from .glob_search import FileToolGlobSearcher
from .grep_search import FileToolGrepSearcher
from .image_reader import FileToolImageReader, is_supported_image_path
from .notebook_editor import FileToolNotebookEditor
from .notebook_reader import FileToolNotebookReader
from .path_policy import FileToolPathPolicy, PathResolution
from .pdf_reader import FileToolPdfReader
from .protocol import (
    EditRequest,
    FileToolCallMetadata,
    GlobRequest,
    PathMetadata,
    GrepRequest,
    NotebookEditRequest,
    ReadRequest,
    SwitchRootRequest,
    SwitchRootResult,
    ToolResultEnvelope,
    WriteRequest,
)
from .text_reader import FileToolTextReader
from .writer import FileToolTextWriter


@dataclass(frozen=True, slots=True)
class FileToolReadService:
    """Compose path policy and text reader into the staged Read service."""

    path_policy: FileToolPathPolicy
    text_reader: FileToolTextReader
    notebook_reader: FileToolNotebookReader | None = None
    image_reader: FileToolImageReader | None = None
    pdf_reader: FileToolPdfReader | None = None

    def read(self, request: ReadRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.path)
            suffix = resolution.resolved_path.suffix.lower()
            if suffix == ".ipynb":
                reader = self.notebook_reader or FileToolNotebookReader()
                payload = reader.read_notebook(request=request, resolution=resolution)
            elif suffix == ".pdf":
                reader = self.pdf_reader or FileToolPdfReader()
                payload = reader.read_pdf(request=request, resolution=resolution)
            elif is_supported_image_path(resolution.resolved_path):
                reader = self.image_reader or FileToolImageReader()
                payload = reader.read_image(request=request, resolution=resolution)
            else:
                payload = self.text_reader.read_text(
                    request=request, resolution=resolution
                )
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
class FileToolWriteService:
    """Compose path policy and text writer into the staged Write service."""

    path_policy: FileToolPathPolicy
    text_writer: FileToolTextWriter

    def write(self, request: WriteRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.path)
            payload = self.text_writer.write_text(
                request=request, resolution=resolution
            )
            return ToolResultEnvelope(
                ok=True,
                tool="Write",
                data=payload.result.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="Write",
                error=exc,
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )


@dataclass(frozen=True, slots=True)
class FileToolEditService:
    """Compose path policy and text editor into the staged Edit service."""

    path_policy: FileToolPathPolicy
    text_editor: FileToolTextEditor

    def edit(self, request: EditRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.path)
            payload = self.text_editor.edit_text(request=request, resolution=resolution)
            return ToolResultEnvelope(
                ok=True,
                tool="Edit",
                data=payload.result.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="Edit",
                error=exc,
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )


@dataclass(frozen=True, slots=True)
class FileToolNotebookEditService:
    """Compose path policy and notebook editor into the staged NotebookEdit service."""

    path_policy: FileToolPathPolicy
    notebook_editor: FileToolNotebookEditor

    def edit_notebook(self, request: NotebookEditRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.path)
            payload = self.notebook_editor.edit_notebook(
                request=request, resolution=resolution
            )
            return ToolResultEnvelope(
                ok=True,
                tool="NotebookEdit",
                data=payload.result.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="NotebookEdit",
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


@dataclass(frozen=True, slots=True)
class FileToolSwitchRootService:
    """Validate and describe a requested file-tool default root switch."""

    path_policy: FileToolPathPolicy

    def switch_root(self, request: SwitchRootRequest) -> ToolResultEnvelope:
        started = perf_counter()
        try:
            resolution = self.path_policy.resolve_path(request.path)
            if not resolution.resolved_path.exists():
                raise FileToolError(
                    code="not_found",
                    message="Target root does not exist.",
                    details={"path": resolution.resolved_path.as_posix()},
                )
            if not resolution.resolved_path.is_dir():
                raise FileToolError(
                    code="not_a_directory",
                    message="Target root must be an existing directory.",
                    details={"path": resolution.resolved_path.as_posix()},
                )
            payload = SwitchRootResult(
                path=_build_path_metadata(resolution),
                previous_root=resolution.workspace_root.as_posix(),
                current_root=resolution.resolved_path.as_posix(),
            )
            return ToolResultEnvelope(
                ok=True,
                tool="SwitchRoot",
                data=payload.to_dict(),
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )
        except FileToolError as exc:
            return ToolResultEnvelope(
                ok=False,
                tool="SwitchRoot",
                error=exc,
                metadata=FileToolCallMetadata(
                    duration_ms=max(0, int((perf_counter() - started) * 1000)),
                    audit=request.audit,
                ),
            )


def _build_path_metadata(resolution: PathResolution) -> PathMetadata:
    return PathMetadata(
        path=resolution.original_path,
        resolved_path=resolution.resolved_path.as_posix(),
        path_kind=resolution.path_kind,
        effective_root=resolution.effective_root.as_posix(),
        root_source=resolution.root_source,
        root_policy=resolution.root_policy,
        symlink_policy=resolution.symlink_policy,
    )


__all__ = [
    "FileToolEditService",
    "FileToolGlobService",
    "FileToolGrepService",
    "FileToolNotebookEditService",
    "FileToolReadService",
    "FileToolSwitchRootService",
    "FileToolWriteService",
]
