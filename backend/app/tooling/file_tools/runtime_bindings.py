"""Copilot runtime bindings for staged file tool Read support."""

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

from .path_policy import FileToolPathPolicy
from .protocol import AuditMetadata, ReadRequest
from .service import FileToolReadService
from .text_reader import FileToolTextReader

FILE_TOOL_READ_ID = "tool.fs.read"
FILE_TOOL_READ_FUNCTION_NAME = "tool_fs_read"
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


def build_file_tool_read_runtime_binding(*, workspace_root: Path) -> RuntimeExecutableToolBinding:
    service = FileToolReadService(
        path_policy=FileToolPathPolicy(workspace_root=workspace_root),
        text_reader=FileToolTextReader(),
    )
    contract = RuntimeFileToolReadContract(service=service)
    return build_contract_runtime_binding(contract, kind="builtin", function_name=FILE_TOOL_READ_FUNCTION_NAME)


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
        "not_a_file": "invalid_input",
        "not_a_directory": "invalid_input",
        "binary_unsupported": "invalid_input",
        "invalid_pattern": "invalid_input",
        "too_large": "invalid_input",
        "encoding_error": "invalid_input",
        "permission_denied": "permission_denied",
    }
    normalized_code = code_map.get(error.code, "execution_failed")
    return NormalizedToolError(
        code=normalized_code,
        message=error.message,
        details=error.details,
        retryable=error.retryable,
    )


__all__ = [
    "FILE_TOOL_READ_FUNCTION_NAME",
    "FILE_TOOL_READ_ID",
    "RuntimeFileToolReadContract",
    "build_file_tool_read_runtime_binding",
]
