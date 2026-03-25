"""Thin composition layer for assembling Copilot runtime dependencies."""

from __future__ import annotations

from dataclasses import dataclass

from .agent import PydanticAIAgentExecutor
from .agent_registry import AgentRegistry, build_default_agent_registry
from .bridge import RuntimeBridge
from .contracts import RuntimeScaffold, build_runtime_scaffold
from .session_store import InMemorySessionStore
from .tool_registry import ToolRegistry, build_default_tool_registry


@dataclass(frozen=True, slots=True)
class RuntimeDependencies:
    """Assembled dependency package for the current Copilot runtime host."""

    session_store: InMemorySessionStore
    agent_registry: AgentRegistry
    tool_registry: ToolRegistry
    agent_executor: PydanticAIAgentExecutor
    runtime_bridge: RuntimeBridge
    scaffold: RuntimeScaffold


def build_default_runtime_dependencies(
    *,
    session_store: InMemorySessionStore | None = None,
    agent_executor: PydanticAIAgentExecutor | None = None,
) -> RuntimeDependencies:
    """Create the default runtime object graph without adding protocol logic."""

    resolved_session_store = session_store or InMemorySessionStore()
    resolved_agent_executor = agent_executor or PydanticAIAgentExecutor()
    tool_registry = build_default_tool_registry()
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
    )
    runtime_bridge = RuntimeBridge(
        session_store=resolved_session_store,
        agent_registry=agent_registry,
    )
    return RuntimeDependencies(
        session_store=resolved_session_store,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
        agent_executor=resolved_agent_executor,
        runtime_bridge=runtime_bridge,
        scaffold=scaffold,
    )


__all__ = ["RuntimeDependencies", "build_default_runtime_dependencies"]
