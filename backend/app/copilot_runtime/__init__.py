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
from .bridge import RuntimeBridge, SessionNotFoundError
from .composition import RuntimeDependencies, build_default_runtime_dependencies
from .contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    MESSAGE_SEND_METHOD,
    SESSION_CREATE_METHOD,
    RuntimeCapabilitiesGetRequest,
    RuntimeCapabilitiesResponse,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
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
    "AGENTS_LIST_METHOD",
    "CAPABILITIES_GET_METHOD",
    "MESSAGE_SEND_METHOD",
    "AgentDescriptor",
    "AgentExecutionError",
    "AgentRegistry",
    "DEFAULT_AGENT_NAME",
    "DEFAULT_AGENT_SYSTEM_PROMPT",
    "MODEL_ENVIRONMENT_KEYS",
    "ModelNotConfiguredError",
    "PydanticAIAgentExecutor",
    "RuntimeBridge",
    "RuntimeCapabilitiesGetRequest",
    "RuntimeCapabilitiesResponse",
    "RuntimeDependencies",
    "RuntimeMessageExecutionPolicy",
    "RuntimeMessagePayload",
    "RuntimeMessageSendRequest",
    "RuntimeScaffold",
    "RuntimeToolDirectoryEntry",
    "SESSION_CREATE_METHOD",
    "SessionNotFoundError",
    "ToolDescriptor",
    "ToolRegistry",
    "ToolsetDescriptor",
    "build_default_agent_registry",
    "build_default_runtime_dependencies",
    "build_default_tool_registry",
    "build_router",
    "build_runtime_scaffold",
]
