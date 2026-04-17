"""Minimal MCP-readiness boundary over the unified tool contract."""

from .readiness import (
    DEFAULT_MCP_DIRECT_HOST_CAPABILITIES,
    MCP_HOST_CAPABILITY_BRIDGE_NOTES,
    MCP_SUPPORTED_INPUT_SCHEMA_FORMATS,
    MCPToolCapabilityReadiness,
    MCPToolDescriptor,
    MCPToolReadinessReport,
    assess_default_contract_mcp_readiness,
    assess_mcp_tool_readiness,
    build_mcp_tool_descriptor,
)

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
