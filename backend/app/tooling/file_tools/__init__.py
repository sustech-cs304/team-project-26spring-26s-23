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

__all__ = [
    "AuditMetadata",
    "FILE_TOOL_ERROR_CODES",
    "FileToolCallMetadata",
    "FileToolError",
    "FileToolErrorCode",
    "FileToolPathPolicy",
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
    "SymlinkPolicy",
    "ToolName",
    "ToolResultEnvelope",
    "ensure_within_workspace",
    "is_hidden_path",
]
