"""Public surface for the minimal Copilot runtime run bridge."""

from .agent import (
    AgentExecutionError,
    DEFAULT_AGENT_NAME,
    DEFAULT_AGENT_SYSTEM_PROMPT,
    MODEL_ENVIRONMENT_KEYS,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
)
from .agent_registry import AgentDescriptor, AgentRegistry, build_default_agent_registry
from .bridge import (
    BoundAgentMismatchError,
    InvalidSessionHistoryError,
    RuntimeBridge,
    RuntimeBridgeResult,
)
from .composition import RuntimeDependencies, build_default_runtime_dependencies
from .contracts import (
    AGENT_CONNECT_METHOD,
    AGENT_RUN_METHOD,
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    INFO_METHOD,
    SESSION_CREATE_METHOD,
    RuntimeCapabilitiesGetRequest,
    RuntimeCapabilitiesResponse,
    RuntimeRunRequest,
    RuntimeScaffold,
    RuntimeToolDirectoryEntry,
    build_runtime_scaffold,
)
from .router import build_router
from .tool_registry import (
    ToolDescriptor,
    ToolRegistry,
    ToolsetDescriptor,
    build_default_tool_registry,
)

__all__ = [
    "AGENT_CONNECT_METHOD",
    "AGENT_RUN_METHOD",
    "AGENTS_LIST_METHOD",
    "CAPABILITIES_GET_METHOD",
    "AgentDescriptor",
    "AgentExecutionError",
    "AgentRegistry",
    "BoundAgentMismatchError",
    "DEFAULT_AGENT_NAME",
    "DEFAULT_AGENT_SYSTEM_PROMPT",
    "INFO_METHOD",
    "InvalidSessionHistoryError",
    "MODEL_ENVIRONMENT_KEYS",
    "ModelNotConfiguredError",
    "PydanticAIAgentExecutor",
    "RuntimeBridge",
    "RuntimeBridgeResult",
    "RuntimeCapabilitiesGetRequest",
    "RuntimeCapabilitiesResponse",
    "RuntimeDependencies",
    "RuntimeRunRequest",
    "RuntimeScaffold",
    "RuntimeToolDirectoryEntry",
    "SESSION_CREATE_METHOD",
    "ToolDescriptor",
    "ToolRegistry",
    "ToolsetDescriptor",
    "build_default_agent_registry",
    "build_default_runtime_dependencies",
    "build_default_tool_registry",
    "build_router",
    "build_runtime_scaffold",
]
