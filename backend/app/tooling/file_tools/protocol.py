"""Protocol data structures for staged file tool implementation."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Literal, cast

from .errors import FileToolError

ToolName = Literal[
    "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit", "SwitchRoot"
]
PathKind = Literal["relative", "absolute"]
RootPolicy = Literal["workspace_root"]
RootSource = Literal["workspace_root", "absolute_override"]
SymlinkPolicy = Literal["deny_escape"]
ReadKind = Literal["text", "image", "pdf", "notebook", "binary"]

_TOOL_NAMES: tuple[ToolName, ...] = (
    "Read",
    "Write",
    "Edit",
    "Glob",
    "Grep",
    "NotebookEdit",
    "SwitchRoot",
)
_PATH_KINDS: tuple[PathKind, ...] = ("relative", "absolute")
_ROOT_POLICIES: tuple[RootPolicy, ...] = ("workspace_root",)
_ROOT_SOURCES: tuple[RootSource, ...] = ("workspace_root", "absolute_override")
_SYMLINK_POLICIES: tuple[SymlinkPolicy, ...] = ("deny_escape",)
_READ_KINDS: tuple[ReadKind, ...] = ("text", "image", "pdf", "notebook", "binary")


def _require_non_empty_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if normalized == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return normalized


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


def _normalize_string_sequence(value: Sequence[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    for item in value:
        text = item.strip()
        if text:
            normalized.append(text)
    return tuple(normalized)


def _normalize_positive_int(value: int, *, field_name: str) -> int:
    if value < 1:
        raise ValueError(f"{field_name} must be greater than or equal to 1.")
    return value


def _normalize_literal(value: str, *, field_name: str, allowed: tuple[str, ...]) -> str:
    normalized = value.strip()
    if normalized not in allowed:
        raise ValueError(
            f"Unknown {field_name} '{value}'. Expected one of {', '.join(allowed)}."
        )
    return normalized


@dataclass(frozen=True, slots=True)
class AuditMetadata:
    """Optional audit context attached to file tool requests."""

    actor: str | None = None
    intent: str | None = None
    session_id: str | None = None
    trace_id: str | None = None
    reason: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "actor", _normalize_optional_text(self.actor))
        object.__setattr__(self, "intent", _normalize_optional_text(self.intent))
        object.__setattr__(
            self, "session_id", _normalize_optional_text(self.session_id)
        )
        object.__setattr__(self, "trace_id", _normalize_optional_text(self.trace_id))
        object.__setattr__(self, "reason", _normalize_optional_text(self.reason))
        object.__setattr__(self, "extra", _normalize_mapping(self.extra))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = dict(self.extra)
        if self.actor is not None:
            payload["actor"] = self.actor
        if self.intent is not None:
            payload["intent"] = self.intent
        if self.session_id is not None:
            payload["sessionId"] = self.session_id
        if self.trace_id is not None:
            payload["traceId"] = self.trace_id
        if self.reason is not None:
            payload["reason"] = self.reason
        return payload


@dataclass(frozen=True, slots=True)
class PathMetadata:
    """Resolved path metadata shared by all file tool results."""

    path: str
    resolved_path: str
    path_kind: PathKind
    effective_root: str
    root_source: RootSource
    root_policy: RootPolicy = "workspace_root"
    symlink_policy: SymlinkPolicy = "deny_escape"

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "path", _require_non_empty_text(self.path, field_name="path")
        )
        object.__setattr__(
            self,
            "resolved_path",
            _require_non_empty_text(self.resolved_path, field_name="resolved_path"),
        )
        object.__setattr__(
            self,
            "path_kind",
            cast(
                PathKind,
                _normalize_literal(
                    self.path_kind,
                    field_name="path_kind",
                    allowed=_PATH_KINDS,
                ),
            ),
        )
        object.__setattr__(
            self,
            "effective_root",
            _require_non_empty_text(self.effective_root, field_name="effective_root"),
        )
        object.__setattr__(
            self,
            "root_source",
            cast(
                RootSource,
                _normalize_literal(
                    self.root_source,
                    field_name="root_source",
                    allowed=_ROOT_SOURCES,
                ),
            ),
        )
        object.__setattr__(
            self,
            "root_policy",
            cast(
                RootPolicy,
                _normalize_literal(
                    self.root_policy,
                    field_name="root_policy",
                    allowed=_ROOT_POLICIES,
                ),
            ),
        )
        object.__setattr__(
            self,
            "symlink_policy",
            cast(
                SymlinkPolicy,
                _normalize_literal(
                    self.symlink_policy,
                    field_name="symlink_policy",
                    allowed=_SYMLINK_POLICIES,
                ),
            ),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "path": self.path,
            "resolvedPath": self.resolved_path,
            "pathKind": self.path_kind,
            "effectiveRoot": self.effective_root,
            "rootSource": self.root_source,
            "rootPolicy": self.root_policy,
            "symlinkPolicy": self.symlink_policy,
        }


@dataclass(frozen=True, slots=True)
class FileToolCallMetadata:
    """Shared metadata envelope for file tool success and error results."""

    duration_ms: int | None = None
    audit: AuditMetadata | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.duration_ms is not None and self.duration_ms < 0:
            raise ValueError("duration_ms must be greater than or equal to 0.")
        object.__setattr__(self, "extra", _normalize_mapping(self.extra))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = dict(self.extra)
        if self.duration_ms is not None:
            payload["durationMs"] = self.duration_ms
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class ReadRequest:
    """Request contract for future staged Read implementation."""

    path: str
    offset: int = 1
    limit: int = 2000
    include_metadata: bool = True
    parser_hint: str | None = None
    pages: tuple[int, int] | None = None
    vision_enabled: bool = False
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "path", _require_non_empty_text(self.path, field_name="path")
        )
        object.__setattr__(
            self, "offset", _normalize_positive_int(self.offset, field_name="offset")
        )
        object.__setattr__(
            self, "limit", _normalize_positive_int(self.limit, field_name="limit")
        )
        object.__setattr__(
            self, "parser_hint", _normalize_optional_text(self.parser_hint)
        )
        if self.pages is not None:
            if len(self.pages) != 2:
                raise ValueError(
                    "pages must contain exactly two integers when provided."
                )
            object.__setattr__(
                self,
                "pages",
                (
                    _normalize_positive_int(self.pages[0], field_name="pages[0]"),
                    _normalize_positive_int(self.pages[1], field_name="pages[1]"),
                ),
            )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "path": self.path,
            "offset": self.offset,
            "limit": self.limit,
            "includeMetadata": self.include_metadata,
        }
        if self.parser_hint is not None:
            payload["parserHint"] = self.parser_hint
        if self.pages is not None:
            payload["pages"] = [self.pages[0], self.pages[1]]
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class ReadResult:
    """Future Read payload shape without binding to concrete readers yet."""

    kind: ReadKind
    path: PathMetadata
    encoding: str | None = None
    truncated: bool = False
    next_offset: int | None = None
    content: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "kind",
            cast(
                ReadKind,
                _normalize_literal(self.kind, field_name="kind", allowed=_READ_KINDS),
            ),
        )
        object.__setattr__(self, "encoding", _normalize_optional_text(self.encoding))
        if self.next_offset is not None:
            object.__setattr__(
                self,
                "next_offset",
                _normalize_positive_int(self.next_offset, field_name="next_offset"),
            )
        object.__setattr__(self, "content", _normalize_mapping(self.content))
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": self.kind,
            **self.path.to_dict(),
            "truncated": self.truncated,
            "content": _normalize_mapping(self.content),
            "metadata": _normalize_mapping(self.metadata),
        }
        if self.encoding is not None:
            payload["encoding"] = self.encoding
        if self.next_offset is not None:
            payload["nextOffset"] = self.next_offset
        return payload


@dataclass(frozen=True, slots=True)
class WriteRequest:
    """Request contract for staged Write implementation."""

    path: str
    content: str
    encoding: str = "utf-8"
    overwrite: bool = True
    expected_hash: str | None = None
    atomic: bool = True
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "path", _require_non_empty_text(self.path, field_name="path")
        )
        object.__setattr__(
            self,
            "encoding",
            _require_non_empty_text(self.encoding, field_name="encoding").lower(),
        )
        if self.encoding != "utf-8":
            raise ValueError("encoding must be utf-8 for the staged text writer.")
        object.__setattr__(
            self, "expected_hash", _normalize_optional_text(self.expected_hash)
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "path": self.path,
            "content": self.content,
            "encoding": self.encoding,
            "overwrite": self.overwrite,
            "atomic": self.atomic,
        }
        if self.expected_hash is not None:
            payload["expectedHash"] = self.expected_hash
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class WriteResult:
    """Stable payload for staged Write results."""

    path: PathMetadata
    encoding: str
    created: bool
    overwritten: bool
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "encoding",
            _require_non_empty_text(self.encoding, field_name="encoding").lower(),
        )
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))
        if self.created and self.overwritten:
            raise ValueError("Write results cannot be both created and overwritten.")

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.path.to_dict(),
            "encoding": self.encoding,
            "created": self.created,
            "overwritten": self.overwritten,
            "metadata": _normalize_mapping(self.metadata),
        }


@dataclass(frozen=True, slots=True)
class EditRequest:
    """Request contract for staged Edit implementation."""

    path: str
    old_string: str
    new_string: str
    replace_all: bool = False
    expected_occurrences: int | None = None
    expected_hash: str | None = None
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "path", _require_non_empty_text(self.path, field_name="path")
        )
        object.__setattr__(
            self,
            "old_string",
            _require_non_empty_text(self.old_string, field_name="old_string"),
        )
        object.__setattr__(
            self, "expected_hash", _normalize_optional_text(self.expected_hash)
        )
        if self.expected_occurrences is not None:
            object.__setattr__(
                self,
                "expected_occurrences",
                _normalize_positive_int(
                    self.expected_occurrences, field_name="expected_occurrences"
                ),
            )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "path": self.path,
            "oldString": self.old_string,
            "newString": self.new_string,
            "replaceAll": self.replace_all,
        }
        if self.expected_occurrences is not None:
            payload["expectedOccurrences"] = self.expected_occurrences
        if self.expected_hash is not None:
            payload["expectedHash"] = self.expected_hash
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class EditResult:
    """Stable payload for staged Edit results."""

    path: PathMetadata
    encoding: str
    replaced_count: int
    modified: bool
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "encoding",
            _require_non_empty_text(self.encoding, field_name="encoding").lower(),
        )
        object.__setattr__(
            self,
            "replaced_count",
            _normalize_positive_int(self.replaced_count, field_name="replaced_count"),
        )
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.path.to_dict(),
            "encoding": self.encoding,
            "replacedCount": self.replaced_count,
            "modified": self.modified,
            "metadata": _normalize_mapping(self.metadata),
        }


NotebookEditOperationKind = Literal["replace", "insert", "delete"]
_NOTEBOOK_EDIT_OPERATION_KINDS: tuple[NotebookEditOperationKind, ...] = (
    "replace",
    "insert",
    "delete",
)


@dataclass(frozen=True, slots=True)
class NotebookOutputSummary:
    output_type: str
    text: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "output_type",
            _require_non_empty_text(self.output_type, field_name="output_type"),
        )
        object.__setattr__(self, "text", _normalize_optional_text(self.text))
        object.__setattr__(self, "data", _normalize_mapping(self.data))

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "outputType": self.output_type,
            "data": _normalize_mapping(self.data),
        }
        if self.text is not None:
            payload["text"] = self.text
        return payload


@dataclass(frozen=True, slots=True)
class NotebookCell:
    cell_id: str
    cell_type: str
    source: str
    outputs: tuple[NotebookOutputSummary, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "cell_id", _require_non_empty_text(self.cell_id, field_name="cell_id")
        )
        object.__setattr__(
            self,
            "cell_type",
            _require_non_empty_text(self.cell_type, field_name="cell_type"),
        )
        object.__setattr__(self, "source", self.source)
        object.__setattr__(self, "outputs", tuple(self.outputs))

    def to_dict(self) -> dict[str, Any]:
        return {
            "cellId": self.cell_id,
            "cellType": self.cell_type,
            "source": self.source,
            "outputs": [output.to_dict() for output in self.outputs],
        }


@dataclass(frozen=True, slots=True)
class NotebookReadResult:
    path: PathMetadata
    notebook_format: int | None = None
    notebook_format_minor: int | None = None
    cell_count: int = 0
    cells: tuple[NotebookCell, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.notebook_format is not None and self.notebook_format < 0:
            raise ValueError("notebook_format must be greater than or equal to 0.")
        if self.notebook_format_minor is not None and self.notebook_format_minor < 0:
            raise ValueError(
                "notebook_format_minor must be greater than or equal to 0."
            )
        if self.cell_count < 0:
            raise ValueError("cell_count must be greater than or equal to 0.")
        object.__setattr__(self, "cells", tuple(self.cells))
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    def to_content_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "notebookFormat": self.notebook_format,
            "notebookFormatMinor": self.notebook_format_minor,
            "cellCount": self.cell_count,
            "cells": [cell.to_dict() for cell in self.cells],
        }
        return payload


@dataclass(frozen=True, slots=True)
class NotebookEditOperation:
    kind: NotebookEditOperationKind
    cell_id: str | None = None
    source: str | None = None
    after_cell_id: str | None = None
    cell_type: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "kind",
            cast(
                NotebookEditOperationKind,
                _normalize_literal(
                    self.kind, field_name="kind", allowed=_NOTEBOOK_EDIT_OPERATION_KINDS
                ),
            ),
        )
        object.__setattr__(self, "cell_id", _normalize_optional_text(self.cell_id))
        object.__setattr__(self, "source", self.source)
        object.__setattr__(
            self, "after_cell_id", _normalize_optional_text(self.after_cell_id)
        )
        object.__setattr__(self, "cell_type", _normalize_optional_text(self.cell_type))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"kind": self.kind}
        if self.cell_id is not None:
            payload["cellId"] = self.cell_id
        if self.source is not None:
            payload["source"] = self.source
        if self.after_cell_id is not None:
            payload["afterCellId"] = self.after_cell_id
        if self.cell_type is not None:
            payload["cellType"] = self.cell_type
        return payload


@dataclass(frozen=True, slots=True)
class NotebookEditRequest:
    path: str
    operations: tuple[NotebookEditOperation, ...]
    expected_hash: str | None = None
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "path", _require_non_empty_text(self.path, field_name="path")
        )
        object.__setattr__(self, "operations", tuple(self.operations))
        object.__setattr__(
            self, "expected_hash", _normalize_optional_text(self.expected_hash)
        )
        if not self.operations:
            raise ValueError("operations must contain at least one notebook operation.")

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "path": self.path,
            "operations": [operation.to_dict() for operation in self.operations],
        }
        if self.expected_hash is not None:
            payload["expectedHash"] = self.expected_hash
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class NotebookEditResult:
    path: PathMetadata
    applied_operations: int
    cell_count: int
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "applied_operations",
            _normalize_positive_int(
                self.applied_operations, field_name="applied_operations"
            ),
        )
        if self.cell_count < 0:
            raise ValueError("cell_count must be greater than or equal to 0.")
        object.__setattr__(self, "metadata", _normalize_mapping(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.path.to_dict(),
            "appliedOperations": self.applied_operations,
            "cellCount": self.cell_count,
            "metadata": _normalize_mapping(self.metadata),
        }


@dataclass(frozen=True, slots=True)
class SwitchRootRequest:
    path: str
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "path", _require_non_empty_text(self.path, field_name="path")
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"path": self.path}
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class SwitchRootResult:
    path: PathMetadata
    previous_root: str
    current_root: str

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "previous_root",
            _require_non_empty_text(self.previous_root, field_name="previous_root"),
        )
        object.__setattr__(
            self,
            "current_root",
            _require_non_empty_text(self.current_root, field_name="current_root"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.path.to_dict(),
            "previousRoot": self.previous_root,
            "currentRoot": self.current_root,
        }


@dataclass(frozen=True, slots=True)
class GlobRequest:
    """Request contract for staged Glob implementation."""

    base_path: str = "."
    pattern: str = ""
    include_hidden: bool = False
    max_results: int | None = None
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "base_path",
            _require_non_empty_text(self.base_path, field_name="base_path"),
        )
        object.__setattr__(
            self, "pattern", _require_non_empty_text(self.pattern, field_name="pattern")
        )
        if self.max_results is not None:
            object.__setattr__(
                self,
                "max_results",
                _normalize_positive_int(self.max_results, field_name="max_results"),
            )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "basePath": self.base_path,
            "pattern": self.pattern,
            "includeHidden": self.include_hidden,
        }
        if self.max_results is not None:
            payload["maxResults"] = self.max_results
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class GlobMatch:
    """Resolved file discovery record returned by staged Glob."""

    path: PathMetadata
    is_directory: bool
    is_hidden: bool
    size_bytes: int | None = None
    modified_time_ms: int | None = None

    def __post_init__(self) -> None:
        if self.size_bytes is not None and self.size_bytes < 0:
            raise ValueError("size_bytes must be greater than or equal to 0.")
        if self.modified_time_ms is not None and self.modified_time_ms < 0:
            raise ValueError("modified_time_ms must be greater than or equal to 0.")

    def to_dict(self) -> dict[str, Any]:
        payload = {
            **self.path.to_dict(),
            "isDirectory": self.is_directory,
            "isHidden": self.is_hidden,
        }
        if self.size_bytes is not None:
            payload["sizeBytes"] = self.size_bytes
        if self.modified_time_ms is not None:
            payload["modifiedTimeMs"] = self.modified_time_ms
        return payload


@dataclass(frozen=True, slots=True)
class GrepRequest:
    """Request contract for staged Grep implementation."""

    base_path: str = "."
    pattern: str = ""
    file_glob: str = "**/*"
    is_regex: bool = False
    case_sensitive: bool = False
    context_lines: int = 0
    include_hidden: bool = False
    max_results: int | None = None
    audit: AuditMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "base_path",
            _require_non_empty_text(self.base_path, field_name="base_path"),
        )
        object.__setattr__(
            self, "pattern", _require_non_empty_text(self.pattern, field_name="pattern")
        )
        object.__setattr__(
            self,
            "file_glob",
            _require_non_empty_text(self.file_glob, field_name="file_glob"),
        )
        if self.context_lines < 0:
            raise ValueError("context_lines must be greater than or equal to 0.")
        if self.max_results is not None:
            object.__setattr__(
                self,
                "max_results",
                _normalize_positive_int(self.max_results, field_name="max_results"),
            )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "basePath": self.base_path,
            "pattern": self.pattern,
            "fileGlob": self.file_glob,
            "isRegex": self.is_regex,
            "caseSensitive": self.case_sensitive,
            "contextLines": self.context_lines,
            "includeHidden": self.include_hidden,
        }
        if self.max_results is not None:
            payload["maxResults"] = self.max_results
        if self.audit is not None:
            payload["audit"] = self.audit.to_dict()
        return payload


@dataclass(frozen=True, slots=True)
class GrepMatch:
    """Resolved content hit returned by staged Grep."""

    path: PathMetadata
    line_number: int
    column_number: int
    line_text: str
    match_text: str
    before: tuple[str, ...] = ()
    after: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "line_number",
            _normalize_positive_int(self.line_number, field_name="line_number"),
        )
        object.__setattr__(
            self,
            "column_number",
            _normalize_positive_int(self.column_number, field_name="column_number"),
        )
        object.__setattr__(
            self,
            "line_text",
            _require_non_empty_text(self.line_text, field_name="line_text"),
        )
        object.__setattr__(
            self,
            "match_text",
            _require_non_empty_text(self.match_text, field_name="match_text"),
        )
        object.__setattr__(self, "before", _normalize_string_sequence(self.before))
        object.__setattr__(self, "after", _normalize_string_sequence(self.after))

    def to_dict(self) -> dict[str, Any]:
        return {
            **self.path.to_dict(),
            "lineNumber": self.line_number,
            "columnNumber": self.column_number,
            "lineText": self.line_text,
            "matchText": self.match_text,
            "before": list(self.before),
            "after": list(self.after),
        }


@dataclass(frozen=True, slots=True)
class ToolResultEnvelope:
    """Uniform file tool success or error envelope."""

    ok: bool
    tool: ToolName
    request_id: str | None = None
    data: dict[str, Any] | None = None
    error: FileToolError | None = None
    metadata: FileToolCallMetadata | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "tool",
            cast(
                ToolName,
                _normalize_literal(self.tool, field_name="tool", allowed=_TOOL_NAMES),
            ),
        )
        object.__setattr__(
            self, "request_id", _normalize_optional_text(self.request_id)
        )
        if self.ok and self.error is not None:
            raise ValueError(
                "Successful file tool envelopes cannot include an error payload."
            )
        if not self.ok and self.error is None:
            raise ValueError(
                "Failed file tool envelopes must include an error payload."
            )
        if self.data is not None:
            object.__setattr__(self, "data", _normalize_mapping(self.data))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": self.ok,
            "tool": self.tool,
        }
        if self.request_id is not None:
            payload["requestId"] = self.request_id
        if self.data is not None:
            payload["data"] = _normalize_mapping(self.data)
        if self.error is not None:
            payload["error"] = self.error.to_dict()
        if self.metadata is not None:
            payload["metadata"] = self.metadata.to_dict()
        return payload


__all__ = [
    "AuditMetadata",
    "EditRequest",
    "EditResult",
    "FileToolCallMetadata",
    "GlobMatch",
    "GlobRequest",
    "GrepMatch",
    "GrepRequest",
    "NotebookCell",
    "NotebookEditOperation",
    "NotebookEditOperationKind",
    "NotebookEditRequest",
    "NotebookEditResult",
    "NotebookOutputSummary",
    "NotebookReadResult",
    "PathKind",
    "PathMetadata",
    "ReadRequest",
    "ReadResult",
    "RootPolicy",
    "RootSource",
    "SwitchRootRequest",
    "SwitchRootResult",
    "SymlinkPolicy",
    "ToolName",
    "ToolResultEnvelope",
    "WriteRequest",
    "WriteResult",
]
