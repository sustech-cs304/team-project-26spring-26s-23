"""Copilot runtime bindings for staged file tool Read, Write, Edit, Glob, and Grep support."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.tooling.contract import ToolContract, ToolInvocationContext
from app.tooling.contract.errors import NormalizedToolError
from app.tooling.contract.metadata import ToolMetadata
from app.tooling.contract.results import ToolResultEnvelope as ContractToolResultEnvelope
from app.tooling.contract.schema import ToolSchema
from app.tooling.host_capabilities import ToolHostCapabilities
from app.tooling.runtime_adapter.copilot_runtime import RuntimeExecutableToolBinding, build_contract_runtime_binding

from .editor import FileToolTextEditor
from .glob_search import FileToolGlobSearcher
from .grep_search import FileToolGrepSearcher
from .path_policy import FileToolPathPolicy
from .protocol import AuditMetadata, EditRequest, GlobRequest, GrepRequest, ReadRequest, WriteRequest
from .service import FileToolEditService, FileToolGlobService, FileToolGrepService, FileToolReadService, FileToolWriteService
from .text_reader import FileToolTextReader
from .writer import FileToolTextWriter

FILE_TOOL_READ_ID = "tool.fs.read"
FILE_TOOL_READ_FUNCTION_NAME = "tool_fs_read"
FILE_TOOL_WRITE_ID = "tool.fs.write"
FILE_TOOL_WRITE_FUNCTION_NAME = "tool_fs_write"
FILE_TOOL_EDIT_ID = "tool.fs.edit"
FILE_TOOL_EDIT_FUNCTION_NAME = "tool_fs_edit"
FILE_TOOL_GLOB_ID = "tool.fs.glob"
FILE_TOOL_GLOB_FUNCTION_NAME = "tool_fs_glob"
FILE_TOOL_GREP_ID = "tool.fs.grep"
FILE_TOOL_GREP_FUNCTION_NAME = "tool_fs_grep"
_FILE_TOOL_READ_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "offset": {"type": "integer", "minimum": 1, "default": 1},
            "limit": {"type": "integer", "minimum": 1, "default": 2000},
            "includeMetadata": {"type": "boolean", "default": True},
            "parserHint": {"type": "string"},
            "audit": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "actor": {"type": "string"},
                    "intent": {"type": "string"},
                    "sessionId": {"type": "string"},
                    "traceId": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "required": ["path"],
    }
)
_FILE_TOOL_WRITE_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "content": {"type": "string"},
            "encoding": {"type": "string", "enum": ["utf-8"], "default": "utf-8"},
            "overwrite": {"type": "boolean", "default": True},
            "expectedHash": {"type": "string", "minLength": 1},
            "atomic": {"type": "boolean", "default": True},
            "audit": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "actor": {"type": "string"},
                    "intent": {"type": "string"},
                    "sessionId": {"type": "string"},
                    "traceId": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "required": ["path", "content"],
    }
)
_FILE_TOOL_EDIT_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "path": {"type": "string", "minLength": 1},
            "oldString": {"type": "string", "minLength": 1},
            "newString": {"type": "string"},
            "replaceAll": {"type": "boolean", "default": False},
            "expectedOccurrences": {"type": "integer", "minimum": 1},
            "expectedHash": {"type": "string", "minLength": 1},
            "audit": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "actor": {"type": "string"},
                    "intent": {"type": "string"},
                    "sessionId": {"type": "string"},
                    "traceId": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "required": ["path", "oldString", "newString"],
    }
)
_FILE_TOOL_GLOB_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "pattern": {"type": "string", "minLength": 1},
            "basePath": {"type": "string", "minLength": 1, "default": "."},
            "includeHidden": {"type": "boolean", "default": False},
            "maxResults": {"type": "integer", "minimum": 1, "default": 500},
            "audit": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "actor": {"type": "string"},
                    "intent": {"type": "string"},
                    "sessionId": {"type": "string"},
                    "traceId": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "required": ["pattern"],
    }
)
_FILE_TOOL_GREP_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "pattern": {"type": "string", "minLength": 1},
            "basePath": {"type": "string", "minLength": 1, "default": "."},
            "fileGlob": {"type": "string", "minLength": 1, "default": "**/*"},
            "isRegex": {"type": "boolean", "default": False},
            "caseSensitive": {"type": "boolean", "default": False},
            "contextLines": {"type": "integer", "minimum": 0, "default": 0},
            "includeHidden": {"type": "boolean", "default": False},
            "maxResults": {"type": "integer", "minimum": 1, "default": 100},
            "audit": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "actor": {"type": "string"},
                    "intent": {"type": "string"},
                    "sessionId": {"type": "string"},
                    "traceId": {"type": "string"},
                    "reason": {"type": "string"},
                },
            },
        },
        "required": ["pattern"],
    }
)


@dataclass(frozen=True, slots=True)
class RuntimeFileToolReadContract(ToolContract):
    """Runtime-agnostic contract wrapper for the staged file text Read tool."""

    service: FileToolReadService
    metadata: ToolMetadata = ToolMetadata(
        tool_id=FILE_TOOL_READ_ID,
        display_name="File Read",
        description="Read UTF-8 text files from the workspace with line-based pagination.",
        kind="operation",
        input_schema=_FILE_TOOL_READ_INPUT_SCHEMA,
        idempotent=True,
        annotations={"stage": "phase1-read"},
    )

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ContractToolResultEnvelope:
        _ = (context, host)
        try:
            request = _build_read_request(arguments)
        except ValueError as exc:
            return ContractToolResultEnvelope.failure(
                error=NormalizedToolError(code="invalid_input", message=str(exc)),
                metadata={"toolId": self.metadata.tool_id},
            )

        result = self.service.read(request)
        if result.ok:
            return ContractToolResultEnvelope.success(
                output=result.to_dict(),
                metadata={"toolId": self.metadata.tool_id},
            )
        return ContractToolResultEnvelope.failure(
            error=_map_file_tool_error(result.error),
            output=result.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class RuntimeFileToolWriteContract(ToolContract):
    """Runtime-agnostic contract wrapper for the staged file text Write tool."""

    service: FileToolWriteService
    metadata: ToolMetadata = ToolMetadata(
        tool_id=FILE_TOOL_WRITE_ID,
        display_name="File Write",
        description="Create or overwrite UTF-8 text files in the workspace with guarded overwrite semantics.",
        kind="operation",
        input_schema=_FILE_TOOL_WRITE_INPUT_SCHEMA,
        idempotent=False,
        annotations={"stage": "phase2-write"},
    )

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ContractToolResultEnvelope:
        _ = (context, host)
        try:
            request = _build_write_request(arguments)
        except ValueError as exc:
            return ContractToolResultEnvelope.failure(
                error=NormalizedToolError(code="invalid_input", message=str(exc)),
                metadata={"toolId": self.metadata.tool_id},
            )

        result = self.service.write(request)
        if result.ok:
            return ContractToolResultEnvelope.success(
                output=result.to_dict(),
                metadata={"toolId": self.metadata.tool_id},
            )
        return ContractToolResultEnvelope.failure(
            error=_map_file_tool_error(result.error),
            output=result.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class RuntimeFileToolEditContract(ToolContract):
    """Runtime-agnostic contract wrapper for the staged file text Edit tool."""

    service: FileToolEditService
    metadata: ToolMetadata = ToolMetadata(
        tool_id=FILE_TOOL_EDIT_ID,
        display_name="File Edit",
        description="Edit UTF-8 text files in the workspace using exact replacement semantics.",
        kind="operation",
        input_schema=_FILE_TOOL_EDIT_INPUT_SCHEMA,
        idempotent=False,
        annotations={"stage": "phase2-edit"},
    )

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ContractToolResultEnvelope:
        _ = (context, host)
        try:
            request = _build_edit_request(arguments)
        except ValueError as exc:
            return ContractToolResultEnvelope.failure(
                error=NormalizedToolError(code="invalid_input", message=str(exc)),
                metadata={"toolId": self.metadata.tool_id},
            )

        result = self.service.edit(request)
        if result.ok:
            return ContractToolResultEnvelope.success(
                output=result.to_dict(),
                metadata={"toolId": self.metadata.tool_id},
            )
        return ContractToolResultEnvelope.failure(
            error=_map_file_tool_error(result.error),
            output=result.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class RuntimeFileToolGlobContract(ToolContract):
    """Runtime-agnostic contract wrapper for the staged file discovery Glob tool."""

    service: FileToolGlobService
    metadata: ToolMetadata = ToolMetadata(
        tool_id=FILE_TOOL_GLOB_ID,
        display_name="File Glob",
        description="Discover workspace files and directories by glob pattern without reading contents.",
        kind="operation",
        input_schema=_FILE_TOOL_GLOB_INPUT_SCHEMA,
        idempotent=True,
        annotations={"stage": "phase1-glob"},
    )

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ContractToolResultEnvelope:
        _ = (context, host)
        try:
            request = _build_glob_request(arguments)
        except ValueError as exc:
            return ContractToolResultEnvelope.failure(
                error=NormalizedToolError(code="invalid_input", message=str(exc)),
                metadata={"toolId": self.metadata.tool_id},
            )

        result = self.service.glob(request)
        if result.ok:
            return ContractToolResultEnvelope.success(
                output=result.to_dict(),
                metadata={"toolId": self.metadata.tool_id},
            )
        return ContractToolResultEnvelope.failure(
            error=_map_file_tool_error(result.error),
            output=result.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class RuntimeFileToolGrepContract(ToolContract):
    """Runtime-agnostic contract wrapper for the staged file grep tool."""

    service: FileToolGrepService
    metadata: ToolMetadata = ToolMetadata(
        tool_id=FILE_TOOL_GREP_ID,
        display_name="File Grep",
        description="Search workspace text files by literal or regex pattern with bounded line context.",
        kind="operation",
        input_schema=_FILE_TOOL_GREP_INPUT_SCHEMA,
        idempotent=True,
        annotations={"stage": "phase1-grep"},
    )

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ContractToolResultEnvelope:
        _ = (context, host)
        try:
            request = _build_grep_request(arguments)
        except ValueError as exc:
            return ContractToolResultEnvelope.failure(
                error=NormalizedToolError(code="invalid_input", message=str(exc)),
                metadata={"toolId": self.metadata.tool_id},
            )

        result = self.service.grep(request)
        if result.ok:
            return ContractToolResultEnvelope.success(
                output=result.to_dict(),
                metadata={"toolId": self.metadata.tool_id},
            )
        return ContractToolResultEnvelope.failure(
            error=_map_file_tool_error(result.error),
            output=result.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


def build_file_tool_read_runtime_binding(*, workspace_root: Path) -> RuntimeExecutableToolBinding:
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )
    contract = RuntimeFileToolReadContract(service=service)
    return build_contract_runtime_binding(contract, kind="builtin", function_name=FILE_TOOL_READ_FUNCTION_NAME)


def build_file_tool_write_runtime_binding(*, workspace_root: Path) -> RuntimeExecutableToolBinding:
    service = FileToolWriteService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_writer=FileToolTextWriter(),
    )
    contract = RuntimeFileToolWriteContract(service=service)
    return build_contract_runtime_binding(contract, kind="builtin", function_name=FILE_TOOL_WRITE_FUNCTION_NAME)


def build_file_tool_edit_runtime_binding(*, workspace_root: Path) -> RuntimeExecutableToolBinding:
    service = FileToolEditService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_editor=FileToolTextEditor(),
    )
    contract = RuntimeFileToolEditContract(service=service)
    return build_contract_runtime_binding(contract, kind="builtin", function_name=FILE_TOOL_EDIT_FUNCTION_NAME)


def build_file_tool_glob_runtime_binding(*, workspace_root: Path) -> RuntimeExecutableToolBinding:
    service = FileToolGlobService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        glob_searcher=FileToolGlobSearcher(),
    )
    contract = RuntimeFileToolGlobContract(service=service)
    return build_contract_runtime_binding(contract, kind="builtin", function_name=FILE_TOOL_GLOB_FUNCTION_NAME)


def build_file_tool_grep_runtime_binding(*, workspace_root: Path) -> RuntimeExecutableToolBinding:
    service = FileToolGrepService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        grep_searcher=FileToolGrepSearcher(),
    )
    contract = RuntimeFileToolGrepContract(service=service)
    return build_contract_runtime_binding(contract, kind="builtin", function_name=FILE_TOOL_GREP_FUNCTION_NAME)


def _build_read_request(arguments: Mapping[str, Any] | None) -> ReadRequest:
    payload = dict(arguments or {})
    audit_payload = payload.get("audit")
    audit = _build_audit_metadata(audit_payload)
    return ReadRequest(
        path=_require_string(payload.get("path"), field_name="path"),
        offset=_coerce_int(payload.get("offset", 1), field_name="offset"),
        limit=_coerce_int(payload.get("limit", 2000), field_name="limit"),
        include_metadata=_coerce_bool(payload.get("includeMetadata", True), field_name="includeMetadata"),
        parser_hint=_optional_string(payload.get("parserHint"), field_name="parserHint"),
        audit=audit,
    )


def _build_write_request(arguments: Mapping[str, Any] | None) -> WriteRequest:
    payload = dict(arguments or {})
    audit_payload = payload.get("audit")
    audit = _build_audit_metadata(audit_payload)
    return WriteRequest(
        path=_require_string(payload.get("path"), field_name="path"),
        content=_require_plain_string(payload.get("content"), field_name="content"),
        encoding=_require_string(payload.get("encoding", "utf-8"), field_name="encoding"),
        overwrite=_coerce_bool(payload.get("overwrite", True), field_name="overwrite"),
        expected_hash=_optional_string(payload.get("expectedHash"), field_name="expectedHash"),
        atomic=_coerce_bool(payload.get("atomic", True), field_name="atomic"),
        audit=audit,
    )


def _build_edit_request(arguments: Mapping[str, Any] | None) -> EditRequest:
    payload = dict(arguments or {})
    audit_payload = payload.get("audit")
    audit = _build_audit_metadata(audit_payload)
    return EditRequest(
        path=_require_string(payload.get("path"), field_name="path"),
        old_string=_require_string(payload.get("oldString"), field_name="oldString"),
        new_string=_require_plain_string(payload.get("newString"), field_name="newString"),
        replace_all=_coerce_bool(payload.get("replaceAll", False), field_name="replaceAll"),
        expected_occurrences=_coerce_optional_int(payload.get("expectedOccurrences"), field_name="expectedOccurrences"),
        expected_hash=_optional_string(payload.get("expectedHash"), field_name="expectedHash"),
        audit=audit,
    )


def _build_glob_request(arguments: Mapping[str, Any] | None) -> GlobRequest:
    payload = dict(arguments or {})
    audit_payload = payload.get("audit")
    audit = _build_audit_metadata(audit_payload)
    return GlobRequest(
        base_path=_require_string(payload.get("basePath", "."), field_name="basePath"),
        pattern=_require_string(payload.get("pattern"), field_name="pattern"),
        include_hidden=_coerce_bool(payload.get("includeHidden", False), field_name="includeHidden"),
        max_results=_coerce_optional_int(payload.get("maxResults"), field_name="maxResults"),
        audit=audit,
    )


def _build_grep_request(arguments: Mapping[str, Any] | None) -> GrepRequest:
    payload = dict(arguments or {})
    audit_payload = payload.get("audit")
    audit = _build_audit_metadata(audit_payload)
    return GrepRequest(
        base_path=_require_string(payload.get("basePath", "."), field_name="basePath"),
        pattern=_require_string(payload.get("pattern"), field_name="pattern"),
        file_glob=_require_string(payload.get("fileGlob", "**/*"), field_name="fileGlob"),
        is_regex=_coerce_bool(payload.get("isRegex", False), field_name="isRegex"),
        case_sensitive=_coerce_bool(payload.get("caseSensitive", False), field_name="caseSensitive"),
        context_lines=_coerce_non_negative_int(payload.get("contextLines", 0), field_name="contextLines"),
        include_hidden=_coerce_bool(payload.get("includeHidden", False), field_name="includeHidden"),
        max_results=_coerce_optional_int(payload.get("maxResults"), field_name="maxResults"),
        audit=audit,
    )


def _build_audit_metadata(value: Any) -> AuditMetadata | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ValueError("audit must be an object when provided.")
    payload = dict(value)
    extras = {
        key: item
        for key, item in payload.items()
        if key not in {"actor", "intent", "sessionId", "traceId", "reason"}
    }
    return AuditMetadata(
        actor=_optional_string(payload.get("actor"), field_name="audit.actor"),
        intent=_optional_string(payload.get("intent"), field_name="audit.intent"),
        session_id=_optional_string(payload.get("sessionId"), field_name="audit.sessionId"),
        trace_id=_optional_string(payload.get("traceId"), field_name="audit.traceId"),
        reason=_optional_string(payload.get("reason"), field_name="audit.reason"),
        extra=extras,
    )


def _require_string(value: Any, *, field_name: str) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value


def _require_plain_string(value: Any, *, field_name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string.")
    return value


def _optional_string(value: Any, *, field_name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a string when provided.")
    normalized = value.strip()
    return normalized or None


def _coerce_int(value: Any, *, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field_name} must be an integer.")
    return value


def _coerce_non_negative_int(value: Any, *, field_name: str) -> int:
    coerced = _coerce_int(value, field_name=field_name)
    if coerced < 0:
        raise ValueError(f"{field_name} must be greater than or equal to 0.")
    return coerced


def _coerce_optional_int(value: Any, *, field_name: str) -> int | None:
    if value is None:
        return None
    return _coerce_int(value, field_name=field_name)


def _coerce_bool(value: Any, *, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean.")
    return value


def _map_file_tool_error(error: Any) -> NormalizedToolError:
    if error is None:
        return NormalizedToolError(code="execution_failed", message="File tool execution failed.")
    code_map = {
        "invalid_request": "invalid_input",
        "path_out_of_bounds": "permission_denied",
        "file_not_found": "not_found",
        "not_found": "not_found",
        "not_unique": "conflict",
        "occurrence_mismatch": "conflict",
        "not_a_file": "invalid_input",
        "not_a_directory": "invalid_input",
        "binary_unsupported": "invalid_input",
        "invalid_pattern": "invalid_input",
        "invalid_regex": "invalid_input",
        "too_large": "invalid_input",
        "encoding_error": "invalid_input",
        "permission_denied": "permission_denied",
        "already_exists": "conflict",
        "hash_mismatch": "conflict",
    }
    normalized_code = code_map.get(error.code, "execution_failed")
    return NormalizedToolError(
        code=normalized_code,
        message=error.message,
        details=error.details,
        retryable=error.retryable,
    )


__all__ = [
    "FILE_TOOL_EDIT_FUNCTION_NAME",
    "FILE_TOOL_EDIT_ID",
    "FILE_TOOL_GLOB_FUNCTION_NAME",
    "FILE_TOOL_GLOB_ID",
    "FILE_TOOL_GREP_FUNCTION_NAME",
    "FILE_TOOL_GREP_ID",
    "FILE_TOOL_READ_FUNCTION_NAME",
    "FILE_TOOL_READ_ID",
    "FILE_TOOL_WRITE_FUNCTION_NAME",
    "FILE_TOOL_WRITE_ID",
    "RuntimeFileToolEditContract",
    "RuntimeFileToolGlobContract",
    "RuntimeFileToolGrepContract",
    "RuntimeFileToolReadContract",
    "RuntimeFileToolWriteContract",
    "build_file_tool_edit_runtime_binding",
    "build_file_tool_glob_runtime_binding",
    "build_file_tool_grep_runtime_binding",
    "build_file_tool_read_runtime_binding",
    "build_file_tool_write_runtime_binding",
]
