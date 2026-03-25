"""PydanticAI-backed default executor implementation for the Copilot runtime."""

from __future__ import annotations

import os
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Protocol

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage

DEFAULT_AGENT_NAME = "default"
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available."
)
MODEL_ENVIRONMENT_KEYS = ("COPILOT_RUNTIME_MODEL", "COPILOT_MODEL")


class RuntimeAgentExecutor(Protocol):
    """Minimal executor interface consumed by the runtime bridge."""

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
    ) -> str: ...


AgentExecutorFactory = Callable[[], RuntimeAgentExecutor]


class ModelNotConfiguredError(RuntimeError):
    """Raised when no runtime model is configured for the default executor."""


class AgentExecutionError(RuntimeError):
    """Raised when a runtime agent executor cannot complete a text run."""


class PydanticAIAgentExecutor:
    """Minimal default agent executor backed by PydanticAI."""

    def __init__(
        self,
        *,
        model: Any | None = None,
        env: Mapping[str, str] | None = None,
        agent_name: str = DEFAULT_AGENT_NAME,
    ) -> None:
        self.agent_name = agent_name
        self._model_override = model
        self._env = dict(os.environ if env is None else env)
        self._agent = Agent(
            name=agent_name,
            output_type=str,
            system_prompt=DEFAULT_AGENT_SYSTEM_PROMPT,
            defer_model_check=True,
        )

    @property
    def model_configured(self) -> bool:
        return self._resolved_explicit_model() is not None or self._configured_model_name() is not None

    @property
    def model_environment_keys(self) -> tuple[str, ...]:
        return MODEL_ENVIRONMENT_KEYS

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
    ) -> str:
        if agent_name != self.agent_name:
            raise AgentExecutionError(f"Unsupported agent '{agent_name}'.")

        model = self.resolve_model()
        try:
            result = await self._agent.run(
                user_prompt,
                message_history=message_history,
                model=model,
            )
        except ModelNotConfiguredError:
            raise
        except Exception as exc:
            raise AgentExecutionError(f"PydanticAI agent execution failed: {exc}") from exc

        output = result.output
        if not isinstance(output, str):
            raise AgentExecutionError("PydanticAI agent returned a non-text output.")
        if output.strip() == "":
            raise AgentExecutionError("PydanticAI agent returned an empty text response.")

        return output

    def resolve_model(self) -> Any:
        explicit_model = self._resolved_explicit_model()
        if explicit_model is not None:
            return explicit_model

        model_name = self._configured_model_name()
        if model_name is None:
            raise ModelNotConfiguredError(
                "No runtime model is configured. Pass --model or set COPILOT_RUNTIME_MODEL or COPILOT_MODEL."
            )
        return model_name

    def _resolved_explicit_model(self) -> Any | None:
        if self._model_override is None:
            return None
        if isinstance(self._model_override, str):
            value = self._model_override.strip()
            return value or None
        return self._model_override

    def _configured_model_name(self) -> str | None:
        for key in MODEL_ENVIRONMENT_KEYS:
            raw_value = self._env.get(key)
            if raw_value is None:
                continue
            value = raw_value.strip()
            if value:
                return value
        return None
