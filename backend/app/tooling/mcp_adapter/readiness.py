"""MCP-readiness helpers for projecting unified tool contracts into a future adapter boundary."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from app.tooling.contract import (
    HOST_CAPABILITY_NAMES,
    HostCapabilityName,
    ToolContract,
    ToolMetadata,
)

MCP_SUPPORTED_INPUT_SCHEMA_FORMATS: tuple[str, ...] = ("json-schema",)
DEFAULT_MCP_DIRECT_HOST_CAPABILITIES: tuple[HostCapabilityName, ...] = ()

_MCP_DEFAULT_INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {},
}
_MCP_CAPABILITY_BRIDGE_NOTES: dict[HostCapabilityName, str] = {
    "workspace_resolver": (
        "Not directly satisfiable over a bare MCP tool boundary; "
        "requires an explicit workspace or roots bridge."
    ),
    "artifact_store": (
        "Not directly satisfiable over a bare MCP tool boundary; "
        "requires a host-specific artifact persistence bridge."
    ),
    "state_store": (
        "Not directly satisfiable over a bare MCP tool boundary; "
        "requires a host-managed state bridge."
    ),
    "secret_provider": (
        "Not directly satisfiable over a bare MCP tool boundary; "
        "requires explicit server-side secret wiring or a host auth bridge."
    ),
    "event_sink": (
        "Not directly satisfiable over a bare MCP tool boundary; "
        "requires mapping into MCP logging or progress notifications, "
        "or a host-specific event bridge."
    ),
}


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



def _normalize_metadata(value: Mapping[str, Any]) -> dict[str, Any]:
    return deepcopy(dict(value))



def _normalize_tags(tags: Sequence[str]) -> tuple[str, ...]:
    normalized_tags: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        normalized_tag = tag.strip()
        if normalized_tag == "" or normalized_tag in seen:
            continue
        seen.add(normalized_tag)
        normalized_tags.append(normalized_tag)
    return tuple(normalized_tags)



def _normalize_direct_capabilities(
    capabilities: Sequence[HostCapabilityName],
) -> tuple[HostCapabilityName, ...]:
    normalized_capabilities: list[HostCapabilityName] = []
    seen: set[str] = set()
    for capability in capabilities:
        if capability not in HOST_CAPABILITY_NAMES:
            raise ValueError(
                "Unknown host capability "
                f"'{capability}'. Expected one of {', '.join(HOST_CAPABILITY_NAMES)}."
            )
        if capability in seen:
            continue
        seen.add(capability)
        normalized_capabilities.append(capability)
    return tuple(normalized_capabilities)



def _build_mcp_tool_name(tool_id: str) -> str:
    normalized = re.sub(r"[^0-9a-zA-Z_-]+", "_", tool_id.strip()).strip("_").lower()
    if normalized == "":
        return "tool"
    if normalized[0].isdigit():
        return f"tool_{normalized}"
    return normalized



def _resolve_metadata(tool_or_metadata: ToolContract | ToolMetadata) -> ToolMetadata:
    if isinstance(tool_or_metadata, ToolMetadata):
        return tool_or_metadata
    return tool_or_metadata.metadata



def _derive_mcp_annotations(metadata: ToolMetadata) -> dict[str, Any]:
    annotations: dict[str, Any] = {}
    if metadata.display_name is not None:
        annotations["title"] = metadata.display_name
    if metadata.idempotent is not None:
        annotations["idempotentHint"] = metadata.idempotent
    if metadata.kind == "query":
        annotations["readOnlyHint"] = True
    elif metadata.idempotent is False:
        annotations["destructiveHint"] = True
    return annotations



@dataclass(frozen=True, slots=True)
class MCPToolDescriptor:
    """Minimal MCP-facing descriptor derived from a runtime-agnostic tool contract."""

    tool_id: str
    name: str
    description: str | None = None
    input_schema: dict[str, Any] = field(default_factory=dict)
    annotations: dict[str, Any] = field(default_factory=dict)
    tags: tuple[str, ...] = ()
    contract_annotations: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "tool_id",
            _require_non_empty_text(self.tool_id, field_name="tool_id"),
        )
        object.__setattr__(
            self,
            "name",
            _require_non_empty_text(self.name, field_name="name"),
        )
        object.__setattr__(self, "description", _normalize_optional_text(self.description))
        object.__setattr__(self, "input_schema", _normalize_metadata(self.input_schema))
        object.__setattr__(self, "annotations", _normalize_metadata(self.annotations))
        object.__setattr__(self, "tags", _normalize_tags(self.tags))
        object.__setattr__(
            self,
            "contract_annotations",
            _normalize_metadata(self.contract_annotations),
        )

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "toolId": self.tool_id,
            "name": self.name,
            "inputSchema": _normalize_metadata(self.input_schema),
        }
        if self.description is not None:
            payload["description"] = self.description
        if self.annotations:
            payload["annotations"] = _normalize_metadata(self.annotations)
        if self.tags:
            payload["tags"] = list(self.tags)
        if self.contract_annotations:
            payload["contractAnnotations"] = _normalize_metadata(self.contract_annotations)
        return payload



@dataclass(frozen=True, slots=True)
class MCPToolCapabilityReadiness:
    """Assessment of one host capability requirement under a future MCP adapter."""

    capability: HostCapabilityName
    required: bool
    directly_supported: bool
    purpose: str | None = None
    note: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.capability not in HOST_CAPABILITY_NAMES:
            raise ValueError(
                "Unknown host capability "
                f"'{self.capability}'. Expected one of {', '.join(HOST_CAPABILITY_NAMES)}."
            )
        object.__setattr__(self, "purpose", _normalize_optional_text(self.purpose))
        object.__setattr__(self, "note", _normalize_optional_text(self.note))
        object.__setattr__(self, "metadata", _normalize_metadata(self.metadata))

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "capability": self.capability,
            "required": self.required,
            "directlySupported": self.directly_supported,
        }
        if self.purpose is not None:
            payload["purpose"] = self.purpose
        if self.note is not None:
            payload["note"] = self.note
        if self.metadata:
            payload["metadata"] = _normalize_metadata(self.metadata)
        return payload



@dataclass(frozen=True, slots=True)
class MCPToolReadinessReport:
    """Structured readiness report for exposing a contract-ready tool via a future MCP adapter."""

    tool_id: str
    descriptor: MCPToolDescriptor
    ready_for_exposure: bool
    supported_input_schema: bool
    requires_capability_bridge: bool
    capability_readiness: tuple[MCPToolCapabilityReadiness, ...] = ()
    blocking_reasons: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "tool_id",
            _require_non_empty_text(self.tool_id, field_name="tool_id"),
        )
        object.__setattr__(self, "blocking_reasons", tuple(self.blocking_reasons))
        object.__setattr__(self, "warnings", tuple(self.warnings))
        object.__setattr__(self, "capability_readiness", tuple(self.capability_readiness))

    def to_dict(self) -> dict[str, Any]:
        return {
            "toolId": self.tool_id,
            "descriptor": self.descriptor.to_dict(),
            "readyForExposure": self.ready_for_exposure,
            "supportedInputSchema": self.supported_input_schema,
            "requiresCapabilityBridge": self.requires_capability_bridge,
            "capabilityReadiness": [
                readiness.to_dict() for readiness in self.capability_readiness
            ],
            "blockingReasons": list(self.blocking_reasons),
            "warnings": list(self.warnings),
        }



def build_mcp_tool_descriptor(
    tool_or_metadata: ToolContract | ToolMetadata,
) -> MCPToolDescriptor:
    """Project a tool contract into the minimal descriptor shape needed by a future MCP adapter."""

    metadata = _resolve_metadata(tool_or_metadata)
    input_schema = _normalize_metadata(metadata.input_schema.schema)
    if not input_schema:
        input_schema = _normalize_metadata(_MCP_DEFAULT_INPUT_SCHEMA)
    return MCPToolDescriptor(
        tool_id=metadata.tool_id,
        name=_build_mcp_tool_name(metadata.tool_id),
        description=metadata.description,
        input_schema=input_schema,
        annotations=_derive_mcp_annotations(metadata),
        tags=metadata.tags,
        contract_annotations=metadata.annotations,
    )



def assess_mcp_tool_readiness(
    tool_or_metadata: ToolContract | ToolMetadata,
    *,
    direct_host_capabilities: Sequence[HostCapabilityName] = DEFAULT_MCP_DIRECT_HOST_CAPABILITIES,
) -> MCPToolReadinessReport:
    """Assess whether a contract-ready tool can be exposed through a minimal future MCP adapter."""

    metadata = _resolve_metadata(tool_or_metadata)
    normalized_direct_capabilities = _normalize_direct_capabilities(direct_host_capabilities)
    supported_input_schema = metadata.input_schema.format in MCP_SUPPORTED_INPUT_SCHEMA_FORMATS
    descriptor = build_mcp_tool_descriptor(metadata)

    capability_readiness: list[MCPToolCapabilityReadiness] = []
    blocking_reasons: list[str] = []
    warnings: list[str] = []
    requires_capability_bridge = False

    if not supported_input_schema:
        blocking_reasons.append(
            "MCP readiness currently requires json-schema input descriptors; "
            f"tool uses '{metadata.input_schema.format}'."
        )

    for requirement in metadata.capability_requirements:
        directly_supported = requirement.capability in normalized_direct_capabilities
        note = None
        if not directly_supported:
            requires_capability_bridge = True
            note = _MCP_CAPABILITY_BRIDGE_NOTES[requirement.capability]
            message = (
                f"Host capability '{requirement.capability}' is not directly satisfiable "
                "in bare MCP mode."
            )
            if requirement.required:
                blocking_reasons.append(message)
            else:
                warnings.append(message)
        capability_readiness.append(
            MCPToolCapabilityReadiness(
                capability=requirement.capability,
                required=requirement.required,
                directly_supported=directly_supported,
                purpose=requirement.purpose,
                note=note,
                metadata=requirement.metadata,
            )
        )

    ready_for_exposure = supported_input_schema and not any(
        readiness.required and not readiness.directly_supported
        for readiness in capability_readiness
    )
    return MCPToolReadinessReport(
        tool_id=metadata.tool_id,
        descriptor=descriptor,
        ready_for_exposure=ready_for_exposure,
        supported_input_schema=supported_input_schema,
        requires_capability_bridge=requires_capability_bridge,
        capability_readiness=tuple(capability_readiness),
        blocking_reasons=tuple(blocking_reasons),
        warnings=tuple(warnings),
    )



def assess_default_contract_mcp_readiness() -> tuple[MCPToolReadinessReport, ...]:
    """Assess MCP readiness for the currently approved Blackboard and TIS facade tools."""

    from app.blackboard import get_blackboard_tool_contracts
    from app.teaching_information_system import get_tis_tool_contracts

    contracts = (
        *get_blackboard_tool_contracts(),
        *get_tis_tool_contracts(),
    )
    return tuple(assess_mcp_tool_readiness(contract) for contract in contracts)


MCP_HOST_CAPABILITY_BRIDGE_NOTES = deepcopy(_MCP_CAPABILITY_BRIDGE_NOTES)

__all__ = [
    "DEFAULT_MCP_DIRECT_HOST_CAPABILITIES",
    "MCP_HOST_CAPABILITY_BRIDGE_NOTES",
    "MCP_SUPPORTED_INPUT_SCHEMA_FORMATS",
    "MCPToolCapabilityReadiness",
    "MCPToolDescriptor",
    "MCPToolReadinessReport",
    "assess_default_contract_mcp_readiness",
    "assess_mcp_tool_readiness",
    "build_mcp_tool_descriptor",
]
