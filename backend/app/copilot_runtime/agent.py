"""PydanticAI-backed default executor implementation for the Copilot runtime."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from typing import Any, Protocol, cast

from pydantic_ai import Agent
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.result import StreamedRunResult

from .model_routes import ResolvedRuntimeModelRoute

DEFAULT_AGENT_NAME = "default"
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available."
)
MODEL_ENVIRONMENT_KEYS = ("COPILOT_RUNTIME_MODEL", "COPILOT_MODEL")
_SUPPORTED_STREAM_ENDPOINT_TYPES = frozenset({"openai-compatible"})


class RuntimeAgentExecutor(Protocol):
    """Minimal executor interface consumed by the runtime bridge."""

    async def run(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model: Any | None = None,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> str: ...


AgentExecutorFactory = Callable[[], RuntimeAgentExecutor]


class ModelNotConfiguredError(RuntimeError):
    """Raised when no runtime model is configured for the default executor."""


class AgentExecutionError(RuntimeError):
    """Raised when a runtime agent executor cannot complete a text run."""


class _PydanticAITextStream:
    def __init__(
        self,
        *,
        stream_context: AbstractAsyncContextManager[StreamedRunResult[Any, Any]],
        resolved_model_id: str,
    ) -> None:
        self.resolved_model_id = resolved_model_id
        self._stream_context = stream_context
        self._stream_result: StreamedRunResult[Any, Any] | None = None

    async def __aenter__(self) -> _PydanticAITextStream:
        self._stream_result = await self._stream_context.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: Any,
    ) -> bool | None:
        return await self._stream_context.__aexit__(exc_type, exc, tb)

    async def iter_deltas(self) -> AsyncIterator[str]:
        result = self._require_stream_result()
        async for delta in result.stream_text(delta=True, debounce_by=None):
            if delta == "":
                continue
            yield delta

    async def get_output(self) -> str:
        result = self._require_stream_result()
        output = await result.get_output()
        if not isinstance(output, str):
            raise AgentExecutionError("PydanticAI agent returned a non-text output.")
        if output.strip() == "":
            raise AgentExecutionError("PydanticAI agent returned an empty text response.")
        return output

    def _require_stream_result(self) -> StreamedRunResult[Any, Any]:
        if self._stream_result is None:
            raise RuntimeError("PydanticAI text stream has not been entered.")
        return self._stream_result


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
        model: Any | None = None,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> str:
        if agent_name != self.agent_name:
            raise AgentExecutionError(f"Unsupported agent '{agent_name}'.")

        resolved_model = self.resolve_model(model_override=model)
        _ = tuple(enabled_tools)
        _ = dict(request_options or {})
        try:
            result = await self._agent.run(
                user_prompt,
                message_history=message_history,
                model=resolved_model,
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

    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: Sequence[str] = (),
        request_options: Mapping[str, Any] | None = None,
    ) -> _PydanticAITextStream:
        if agent_name != self.agent_name:
            raise AgentExecutionError(f"Unsupported agent '{agent_name}'.")

        _ = tuple(enabled_tools)
        _ = dict(request_options or {})
        resolved_model = self.resolve_model(model_override=self._build_stream_model(model_route))
        return _PydanticAITextStream(
            stream_context=cast(
                AbstractAsyncContextManager[StreamedRunResult[Any, Any]],
                self._agent.run_stream(
                    user_prompt,
                    message_history=message_history,
                    model=resolved_model,
                ),
            ),
            resolved_model_id=model_route.model_id,
        )

    def resolve_model(self, *, model_override: Any | None = None) -> Any:
        explicit_model = self._resolved_explicit_model(model_override)
        if explicit_model is not None:
            return explicit_model

        model_name = self._configured_model_name()
        if model_name is None:
            raise ModelNotConfiguredError(
                "No runtime model is configured. Pass --model or set COPILOT_RUNTIME_MODEL or COPILOT_MODEL."
            )
        return model_name

    def _build_stream_model(self, model_route: ResolvedRuntimeModelRoute) -> OpenAIModel:
        if model_route.endpoint_type not in _SUPPORTED_STREAM_ENDPOINT_TYPES:
            raise AgentExecutionError(
                f"Unsupported model endpoint type '{model_route.endpoint_type}' for streamed execution."
            )
        provider = OpenAIProvider(
            base_url=model_route.base_url,
            api_key=model_route.api_key,
        )
        return OpenAIModel(model_route.model_id, provider=provider)

    def _resolved_explicit_model(self, model_override: Any | None = None) -> Any | None:
        candidate = self._model_override if model_override is None else model_override
        if candidate is None:
            return None
        if isinstance(candidate, str):
            value = candidate.strip()
            return value or None
        return candidate

    def _configured_model_name(self) -> str | None:
        for key in MODEL_ENVIRONMENT_KEYS:
            raw_value = self._env.get(key)
            if raw_value is None:
                continue
            value = raw_value.strip()
            if value:
                return value
        return None
