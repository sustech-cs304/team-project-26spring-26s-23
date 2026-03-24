"""Public surface for the minimal Copilot runtime run bridge."""

from .agent import (
    AgentExecutionError,
    DEFAULT_AGENT_NAME,
    DEFAULT_AGENT_SYSTEM_PROMPT,
    MODEL_ENVIRONMENT_KEYS,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
)
from .bridge import InvalidSessionHistoryError, RuntimeBridge, RuntimeBridgeResult
from .contracts import (
    AGENT_CONNECT_METHOD,
    AGENT_RUN_METHOD,
    INFO_METHOD,
    RuntimeRunRequest,
    RuntimeScaffold,
    build_runtime_scaffold,
)
from .router import build_router

__all__ = [
    "AGENT_CONNECT_METHOD",
    "AGENT_RUN_METHOD",
    "AgentExecutionError",
    "DEFAULT_AGENT_NAME",
    "DEFAULT_AGENT_SYSTEM_PROMPT",
    "INFO_METHOD",
    "InvalidSessionHistoryError",
    "MODEL_ENVIRONMENT_KEYS",
    "ModelNotConfiguredError",
    "PydanticAIAgentExecutor",
    "RuntimeBridge",
    "RuntimeBridgeResult",
    "RuntimeRunRequest",
    "RuntimeScaffold",
    "build_router",
    "build_runtime_scaffold",
]
