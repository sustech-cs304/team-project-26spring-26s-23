"""File tool protocol scaffolding and workspace-only path policy helpers."""

from .errors import FILE_TOOL_ERROR_CODES, FileToolError, FileToolErrorCode
from .path_policy import (
    FileToolPathPolicy,
    PathResolution,
    RootPolicy,
    SymlinkPolicy,
    ensure_within_workspace,
    is_hidden_path,
)
from .protocol import (
    AuditMetadata,
    FileToolCallMetadata,
    GlobMatch,
    GlobRequest,
    GrepMatch,
    GrepRequest,
    PathKind,
    PathMetadata,
    ReadRequest,
    ReadResult,
    ToolName,
    ToolResultEnvelope,
)
from .runtime_bindings import (
    FILE_TOOL_READ_FUNCTION_NAME,
    FILE_TOOL_READ_ID,
    RuntimeFileToolReadContract,
    build_file_tool_read_runtime_binding,
)
from .service import FileToolReadService
from .text_reader import FileToolTextReader, TextReadPayload

__all__ = [
    "AuditMetadata",
    "FILE_TOOL_ERROR_CODES",
    "FILE_TOOL_READ_FUNCTION_NAME",
    "FILE_TOOL_READ_ID",
    "FileToolCallMetadata",
    "FileToolError",
    "FileToolErrorCode",
    "FileToolPathPolicy",
    "FileToolReadService",
    "FileToolTextReader",
    "GlobMatch",
    "GlobRequest",
    "GrepMatch",
    "GrepRequest",
    "PathKind",
    "PathMetadata",
    "PathResolution",
    "ReadRequest",
    "ReadResult",
    "RootPolicy",
    "RuntimeFileToolReadContract",
    "SymlinkPolicy",
    "TextReadPayload",
    "ToolName",
    "ToolResultEnvelope",
    "build_file_tool_read_runtime_binding",
    "ensure_within_workspace",
    "is_hidden_path",
]
