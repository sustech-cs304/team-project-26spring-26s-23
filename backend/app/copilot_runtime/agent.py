"""PydanticAI-backed single-agent executor for the Copilot runtime."""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import Any

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage

DEFAULT_AGENT_NAME = "default"
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available."
)
MODEL_ENVIRONMENT_KEYS = ("COPILOT_RUNTIME_MODEL", "COPILOT_MODEL")


class ModelNotConfiguredError(RuntimeError):
    """Raised when no runtime model is configured for the single agent."""


class AgentExecutionError(RuntimeError):
    """Raised when the single agent cannot complete a text run."""


class PydanticAIAgentExecutor:
    """Minimal single-agent executor backed by PydanticAI."""

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
        return self._model_override is not None or self._configured_model_name() is not None

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
        if self._model_override is not None:
            return self._model_override

        model_name = self._configured_model_name()
        if model_name is None:
            raise ModelNotConfiguredError(
                "No runtime model is configured. Set COPILOT_RUNTIME_MODEL or COPILOT_MODEL."
            )
        return model_name

    def _configured_model_name(self) -> str | None:
        for key in MODEL_ENVIRONMENT_KEYS:
            raw_value = self._env.get(key)
            if raw_value is None:
                continue
            value = raw_value.strip()
            if value:
                return value
        return None
