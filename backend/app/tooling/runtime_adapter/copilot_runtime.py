"""Adapt runtime-agnostic tool contracts into Copilot runtime executable tools."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from app.tooling.contract import ToolContract, ToolInvocationContext
from app.tooling.contract.errors import (
    NormalizedToolError,
    build_tool_exception_details,
    redact_tool_error_value,
)
from app.tooling.contract.results import ToolResultEnvelope
from app.tooling.host_capabilities import ToolHostCapabilities

CONTRACT_RUNTIME_TOOL_KIND = "contract"
_DEFAULT_TOOL_AVAILABILITY = "available"
_CURRENT_RUNTIME_TOOL_EXECUTION_CONTEXT: ContextVar[
    RuntimeToolExecutionContext | None
] = ContextVar(
    "copilot_runtime_tool_execution_context",
    default=None,
)

RuntimeExecutableToolExecutor = Callable[
    [Mapping[str, Any] | None], Awaitable[dict[str, Any]]
]
ToolHostCapabilitiesFactory = Callable[
    [ToolContract, ToolInvocationContext, "RuntimeToolExecutionContext | None"],
    ToolHostCapabilities,
]


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_trace(value: Mapping[str, str]) -> dict[str, str]:
    return {str(key): str(item) for key, item in value.items()}


def _normalize_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))


@dataclass(frozen=True, slots=True)
class RuntimeToolExecutionContext:
    """Runtime invocation metadata forwarded into contract-tool adapter execution."""

    tool_call_id: str | None = None
    run_id: str | None = None
    actor: str = "agent"
    requested_at: datetime | None = None
    trace: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "tool_call_id", _normalize_optional_text(self.tool_call_id)
        )
        object.__setattr__(self, "run_id", _normalize_optional_text(self.run_id))
        normalized_actor = self.actor.strip()
        if normalized_actor == "":
            raise ValueError("actor must be a non-empty string.")
        object.__setattr__(self, "actor", normalized_actor)
        if self.requested_at is not None and (
            self.requested_at.tzinfo is None or self.requested_at.utcoffset() is None
        ):
            raise ValueError("requested_at must be timezone-aware when provided.")
        object.__setattr__(self, "trace", _normalize_trace(self.trace))
        object.__setattr__(self, "metadata", _normalize_metadata(self.metadata))


@contextmanager
def runtime_tool_execution_scope(context: RuntimeToolExecutionContext):
    """Temporarily bind runtime invocation metadata for adapter-backed tool execution."""

    token = _CURRENT_RUNTIME_TOOL_EXECUTION_CONTEXT.set(context)
    try:
        yield context
    finally:
        _CURRENT_RUNTIME_TOOL_EXECUTION_CONTEXT.reset(token)


def get_current_runtime_tool_execution_context() -> RuntimeToolExecutionContext | None:
    """Return the currently bound runtime tool execution context, if any."""

    return _CURRENT_RUNTIME_TOOL_EXECUTION_CONTEXT.get()


def get_runtime_context_metadata_value(
    key_path: str | tuple[str, ...],
    *,
    runtime_context: RuntimeToolExecutionContext | None = None,
) -> Any:
    """Resolve a nested metadata value from the active runtime context."""

    context = runtime_context or get_current_runtime_tool_execution_context()
    if context is None:
        return None
    metadata: Any = context.metadata
    keys = (key_path,) if isinstance(key_path, str) else key_path
    for key in keys:
        if not isinstance(metadata, Mapping):
            return None
        metadata = metadata.get(key)
    return metadata


class RuntimeExecutableToolError(RuntimeError):
    """Stable runtime-tool failure raised by contract adapters before agent wrapping."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        normalized_message = message.strip() or "Tool execution failed."
        self.code = code.strip() or "execution_failed"
        self.message = normalized_message
        self.details = dict(details or {})
        super().__init__(normalized_message)


@dataclass(frozen=True, slots=True)
class RuntimeExecutableToolBinding:
    """Executable runtime binding derived from a runtime-agnostic tool contract."""

    tool_id: str
    kind: str
    display_name: str | None
    description: str | None
    availability: str
    function_name: str | None
    parameters_json_schema: dict[str, Any] | None
    execute: RuntimeExecutableToolExecutor

    def __post_init__(self) -> None:
        normalized_tool_id = self.tool_id.strip()
        if normalized_tool_id == "":
            raise ValueError("tool_id must be a non-empty string.")
        normalized_kind = self.kind.strip()
        if normalized_kind == "":
            raise ValueError("kind must be a non-empty string.")
        normalized_availability = self.availability.strip()
        if normalized_availability == "":
            raise ValueError("availability must be a non-empty string.")
        object.__setattr__(self, "tool_id", normalized_tool_id)
        object.__setattr__(self, "kind", normalized_kind)
        object.__setattr__(
            self, "display_name", _normalize_optional_text(self.display_name)
        )
        object.__setattr__(
            self, "description", _normalize_optional_text(self.description)
        )
        object.__setattr__(self, "availability", normalized_availability)
        object.__setattr__(
            self, "function_name", _normalize_optional_text(self.function_name)
        )
        if self.parameters_json_schema is not None:
            object.__setattr__(
                self,
                "parameters_json_schema",
                deepcopy(dict(self.parameters_json_schema)),
            )


def build_contract_runtime_binding(
    contract_tool: ToolContract,
    *,
    kind: str = CONTRACT_RUNTIME_TOOL_KIND,
    availability: str = _DEFAULT_TOOL_AVAILABILITY,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
    function_name: str | None = None,
) -> RuntimeExecutableToolBinding:
    """Adapt a unified tool contract into a Copilot runtime executable binding."""

    metadata = contract_tool.metadata
    resolved_function_name = _normalize_function_name(
        function_name
    ) or _build_function_name(metadata.tool_id)
    parameters_json_schema = _extract_parameters_json_schema(contract_tool)

    async def execute(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
        runtime_context = get_current_runtime_tool_execution_context()
        invocation_context = _build_invocation_context(
            tool_id=metadata.tool_id,
            runtime_context=runtime_context,
        )
        host = _build_host_capabilities(
            contract_tool=contract_tool,
            invocation_context=invocation_context,
            runtime_context=runtime_context,
            host_capabilities_factory=host_capabilities_factory,
        )
        try:
            result = await contract_tool.invoke(
                arguments=arguments,
                context=invocation_context,
                host=host,
            )
        except Exception as exc:
            return ToolResultEnvelope.failure(
                error=NormalizedToolError(
                    code="execution_failed",
                    message=f"Tool '{metadata.tool_id}' execution failed.",
                    details=build_tool_exception_details(
                        error=exc,
                        diagnostic_context={
                            "toolId": metadata.tool_id,
                            "invocationId": invocation_context.invocation_id,
                        },
                        sanitizer=redact_tool_error_value,
                    ),
                ),
                metadata={"toolId": metadata.tool_id},
            ).to_dict()
        if result.status == "error" and result.error is None:
            return ToolResultEnvelope.failure(
                error=NormalizedToolError(
                    code="execution_failed",
                    message="Tool returned an error result without a normalized error payload.",
                    details={"integrity": "missing_error_payload"},
                ),
                metadata={"toolId": metadata.tool_id},
            ).to_dict()
        return result.to_dict()

    return RuntimeExecutableToolBinding(
        tool_id=metadata.tool_id,
        kind=kind,
        display_name=metadata.display_name,
        description=metadata.description,
        availability=availability,
        function_name=resolved_function_name,
        parameters_json_schema=parameters_json_schema,
        execute=execute,
    )


def build_default_contract_runtime_bindings(
    *,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
) -> tuple[RuntimeExecutableToolBinding, ...]:
    """Build runtime bindings for the currently approved Blackboard and TIS facade tools."""

    from app.integrations.sustech.blackboard import get_blackboard_tool_contracts
    from app.integrations.sustech.teaching_information_system import (
        get_tis_tool_contracts,
    )

    contracts = (
        *get_blackboard_tool_contracts(),
        *get_tis_tool_contracts(),
    )
    return tuple(
        build_contract_runtime_binding(
            contract_tool,
            host_capabilities_factory=host_capabilities_factory,
        )
        for contract_tool in contracts
    )


def _build_host_capabilities(
    *,
    contract_tool: ToolContract,
    invocation_context: ToolInvocationContext,
    runtime_context: RuntimeToolExecutionContext | None,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None,
) -> ToolHostCapabilities:
    if host_capabilities_factory is None:
        return ToolHostCapabilities()
    return host_capabilities_factory(contract_tool, invocation_context, runtime_context)


def _build_invocation_context(
    *,
    tool_id: str,
    runtime_context: RuntimeToolExecutionContext | None,
) -> ToolInvocationContext:
    invocation_id = (
        runtime_context.tool_call_id
        if runtime_context is not None and runtime_context.tool_call_id is not None
        else f"{tool_id}:direct"
    )
    metadata = (
        {} if runtime_context is None else deepcopy(dict(runtime_context.metadata))
    )
    return ToolInvocationContext(
        invocation_id=invocation_id,
        tool_id=tool_id,
        actor="agent" if runtime_context is None else runtime_context.actor,
        run_id=None if runtime_context is None else runtime_context.run_id,
        requested_at=(
            datetime.now(UTC)
            if runtime_context is None or runtime_context.requested_at is None
            else runtime_context.requested_at
        ),
        trace={} if runtime_context is None else runtime_context.trace,
        metadata={"runtimeContext": metadata} if metadata else {},
    )


def _extract_parameters_json_schema(contract_tool: ToolContract) -> dict[str, Any]:
    schema = contract_tool.metadata.input_schema
    if schema.format != "json-schema":
        raise ValueError(
            "Copilot runtime adapter only supports tools with json-schema input descriptors."
        )
    payload = deepcopy(dict(schema.schema))
    if payload:
        return payload
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    }


def _normalize_function_name(value: str | None) -> str | None:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        return None
    return _build_function_name(normalized)


def _build_function_name(tool_id: str) -> str:
    normalized = re.sub(r"[^0-9a-zA-Z]+", "_", tool_id).strip("_").lower()
    if normalized == "":
        return "tool"
    if normalized[0].isdigit():
        return f"tool_{normalized}"
    return normalized


__all__ = [
    "CONTRACT_RUNTIME_TOOL_KIND",
    "RuntimeExecutableToolBinding",
    "RuntimeExecutableToolError",
    "RuntimeToolExecutionContext",
    "ToolHostCapabilitiesFactory",
    "build_contract_runtime_binding",
    "build_default_contract_runtime_bindings",
    "get_current_runtime_tool_execution_context",
    "get_runtime_context_metadata_value",
    "runtime_tool_execution_scope",
]
