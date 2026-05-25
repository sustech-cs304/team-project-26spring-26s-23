"""Thin composition layer for assembling Copilot runtime dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.tooling.runtime_adapter.copilot_runtime import ToolHostCapabilitiesFactory

from .agent import PydanticAIAgentExecutor
from .agent_registry import AgentRegistry, build_default_agent_registry
from .bridge import RuntimeBridge
from .contracts import RuntimeScaffold, build_runtime_scaffold
from .message_runs import RuntimeMessageRunOrchestrator
from .mcp_catalog_provider import McpCatalogProvider, create_mcp_catalog_provider
from .mcp_snapshot_provider import create_mcp_snapshot_provider
from .mcp_tool_executor import McpExecutableToolLoader
from .skill_snapshot_provider import create_skill_snapshot_provider
from .model_routes import (
    HostModelRouteUnavailableError,
    RuntimeModelRoute,
    RuntimeModelRouteResolver,
)
from .persistence import SQLiteSessionStore
from .runtime_session_store import RuntimeSessionStore
from .session_store import InMemorySessionStore
from .tool_approval_coordinator import RuntimeToolApprovalCoordinator
from .tool_registry import ToolRegistry, build_default_tool_registry

if TYPE_CHECKING:
    from app.desktop_runtime.config import DesktopRuntimeConfig


@dataclass(frozen=True, slots=True)
class RuntimeDependencies:
    """Assembled dependency package for the current Copilot runtime host."""

    session_store: RuntimeSessionStore
    agent_registry: AgentRegistry
    tool_registry: ToolRegistry
    agent_executor: PydanticAIAgentExecutor
    message_run_orchestrator: RuntimeMessageRunOrchestrator
    runtime_bridge: RuntimeBridge
    scaffold: RuntimeScaffold
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None


class _UnavailableRuntimeModelRouteResolver(RuntimeModelRouteResolver):
    async def resolve(self, model_route: RuntimeModelRoute):
        raise HostModelRouteUnavailableError(
            detail="Host model route bridge bootstrap is not configured."
        )


def build_default_runtime_dependencies(
    *,
    runtime_config: DesktopRuntimeConfig | None = None,
    session_store: RuntimeSessionStore | None = None,
    agent_executor: PydanticAIAgentExecutor | None = None,
    model_route_resolver: RuntimeModelRouteResolver | None = None,
    host_capabilities_factory: ToolHostCapabilitiesFactory | None = None,
    host_capability_bridge_client: DesktopCapabilityBridgeClient | None = None,
    mcp_catalog_provider: McpCatalogProvider | None = None,
) -> RuntimeDependencies:
    """Create the default runtime object graph without adding protocol logic."""

    resolved_session_store = session_store or (
        SQLiteSessionStore(runtime_config=runtime_config)
        if runtime_config is not None
        else InMemorySessionStore()
    )
    resolved_model_route_resolver = (
        model_route_resolver or _UnavailableRuntimeModelRouteResolver()
    )
    runtime_workspace_root = (
        runtime_config.runtime_root_dir if runtime_config is not None else None
    )
    snapshot_provider = create_mcp_snapshot_provider(
        state_dir=runtime_config.state_dir if runtime_config is not None else None,
    )
    skill_snapshot_provider = create_skill_snapshot_provider(
        state_dir=runtime_config.state_dir if runtime_config is not None else None,
        config_dir=runtime_config.config_dir if runtime_config is not None else None,
        runtime_root_dir=runtime_config.runtime_root_dir
        if runtime_config is not None
        else None,
    )
    dynamic_tool_loader = (
        None
        if host_capability_bridge_client is None
        else McpExecutableToolLoader(
            snapshot_provider=snapshot_provider,
            bridge_client=host_capability_bridge_client,
        ).load_tools
    )
    resolved_mcp_catalog_provider = (
        None
        if dynamic_tool_loader is None
        else mcp_catalog_provider or create_mcp_catalog_provider(snapshot_provider)
    )
    tool_registry = build_default_tool_registry(
        host_capabilities_factory=host_capabilities_factory,
        workspace_root=runtime_workspace_root,
        dynamic_tool_loader=dynamic_tool_loader,
    )
    executor_workspace_root = tool_registry.workspace_root or runtime_workspace_root
    shared_approval_coordinator: RuntimeToolApprovalCoordinator | None = None
    if agent_executor is None:
        shared_approval_coordinator = RuntimeToolApprovalCoordinator()
        resolved_agent_executor = PydanticAIAgentExecutor(
            tool_registry=tool_registry,
            workspace_root=executor_workspace_root,
            default_root=executor_workspace_root,
            user_data_dir=runtime_config.user_data_dir
            if runtime_config is not None
            else None,
            approval_coordinator=shared_approval_coordinator,
        )
    else:
        resolved_agent_executor = agent_executor
        existing_approval_coordinator = getattr(
            resolved_agent_executor, "_approval_coordinator", None
        )
        if isinstance(existing_approval_coordinator, RuntimeToolApprovalCoordinator):
            shared_approval_coordinator = existing_approval_coordinator
    if shared_approval_coordinator is None:
        shared_approval_coordinator = RuntimeToolApprovalCoordinator()
    agent_registry = build_default_agent_registry(
        executor_factory=lambda: resolved_agent_executor,
        toolset_name=tool_registry.get_default().name,
    )
    scaffold = build_runtime_scaffold(
        session_store_type=resolved_session_store.storage_type,
        model_configured=resolved_agent_executor.model_configured,
        model_environment_keys=resolved_agent_executor.model_environment_keys,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
        mcp_catalog_provider=resolved_mcp_catalog_provider,
    )
    message_run_orchestrator = RuntimeMessageRunOrchestrator(
        session_store=resolved_session_store,
        agent_registry=agent_registry,
        scaffold=scaffold,
        model_route_resolver=resolved_model_route_resolver,
        provider_adapter_registry=resolved_agent_executor.provider_adapter_registry,
        skill_snapshot_provider=skill_snapshot_provider,
    )
    runtime_bridge = RuntimeBridge(
        session_store=resolved_session_store,
        agent_registry=agent_registry,
        scaffold=scaffold,
        message_run_orchestrator=message_run_orchestrator,
        model_route_resolver=resolved_model_route_resolver,
        provider_adapter_registry=resolved_agent_executor.provider_adapter_registry,
        approval_coordinator=shared_approval_coordinator,
    )
    return RuntimeDependencies(
        session_store=resolved_session_store,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
        agent_executor=resolved_agent_executor,
        message_run_orchestrator=message_run_orchestrator,
        runtime_bridge=runtime_bridge,
        scaffold=scaffold,
        host_capabilities_factory=host_capabilities_factory,
    )


__all__ = ["RuntimeDependencies", "build_default_runtime_dependencies"]
