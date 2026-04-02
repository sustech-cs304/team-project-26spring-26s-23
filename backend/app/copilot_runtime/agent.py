"""PydanticAI-backed default executor implementation for the Copilot runtime."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from pydantic_ai import Agent
from pydantic_ai._run_context import RunContext
from pydantic_ai.messages import ModelMessage
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.result import StreamedRunResult

from .model_routes import ResolvedRuntimeModelRoute
from .tool_registry import (
    DEFAULT_WEATHER_LOCATION,
    ToolRegistry,
    WEATHER_CURRENT_TOOL_DESCRIPTION,
    WEATHER_CURRENT_TOOL_ID,
    build_default_tool_registry,
    summarize_tool_arguments,
    summarize_tool_result,
)

DEFAULT_AGENT_NAME = "default"
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available."
)
MODEL_ENVIRONMENT_KEYS = ("COPILOT_RUNTIME_MODEL", "COPILOT_MODEL")
_SUPPORTED_STREAM_ENDPOINT_TYPES = frozenset({"openai-compatible"})
ToolLifecyclePhase = Literal["started", "completed", "failed"]


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


class ToolInvocationError(AgentExecutionError):
    """Raised when a runtime tool call fails with a stable error code."""

    def __init__(
        self,
        *,
        code: str,
        message: str,
        tool_id: str,
        tool_call_id: str | None = None,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.tool_id = tool_id
        self.tool_call_id = tool_call_id
        normalized_details: dict[str, Any] = {"toolId": tool_id}
        if tool_call_id is not None:
            normalized_details["toolCallId"] = tool_call_id
        if details is not None:
            normalized_details.update(dict(details))
        self.details = normalized_details
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class RuntimeToolLifecycleEvent:
    tool_call_id: str
    tool_id: str
    phase: ToolLifecyclePhase
    title: str
    summary: str
    input_summary: str | None = None
    result_summary: str | None = None
    error_summary: str | None = None

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "toolCallId": self.tool_call_id,
            "toolId": self.tool_id,
            "phase": self.phase,
            "title": self.title,
            "summary": self.summary,
        }
        if self.input_summary is not None:
            payload["inputSummary"] = self.input_summary
        if self.result_summary is not None:
            payload["resultSummary"] = self.result_summary
        if self.error_summary is not None:
            payload["errorSummary"] = self.error_summary
        return payload


ToolLifecycleSink = Callable[[RuntimeToolLifecycleEvent], None]


@dataclass(slots=True)
class _PydanticAIAgentRunDeps:
    tool_registry: ToolRegistry
    enabled_tool_ids: frozenset[str]
    emit_tool_event: ToolLifecycleSink


class _PydanticAITextStream:
    def __init__(
        self,
        *,
        stream_context: AbstractAsyncContextManager[StreamedRunResult[Any, Any]],
        resolved_model_id: str,
        tool_events: list[RuntimeToolLifecycleEvent],
    ) -> None:
        self.resolved_model_id = resolved_model_id
        self._stream_context = stream_context
        self._stream_result: StreamedRunResult[Any, Any] | None = None
        self._tool_events = tool_events

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

    def drain_tool_events(self) -> tuple[RuntimeToolLifecycleEvent, ...]:
        drained = tuple(self._tool_events)
        self._tool_events.clear()
        return drained

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
        tool_registry: ToolRegistry | None = None,
    ) -> None:
        self.agent_name = agent_name
        self._model_override = model
        self._env = dict(os.environ if env is None else env)
        self._tool_registry = tool_registry or build_default_tool_registry()
        self._agent = Agent(
            name=agent_name,
            output_type=str,
            system_prompt=DEFAULT_AGENT_SYSTEM_PROMPT,
            deps_type=_PydanticAIAgentRunDeps,
            defer_model_check=True,
        )
        self._register_weather_tool()

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
        _ = dict(request_options or {})
        run_kwargs: dict[str, Any] = {
            "message_history": message_history,
            "model": resolved_model,
        }
        if tuple(enabled_tools):
            run_kwargs["deps"] = self._build_runtime_deps(
                enabled_tools=enabled_tools,
                emit_tool_event=lambda _event: None,
            )
        try:
            result = await self._agent.run(
                user_prompt,
                **run_kwargs,
            )
        except ModelNotConfiguredError:
            raise
        except ToolInvocationError:
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

        _ = dict(request_options or {})
        stream_model = self._resolved_explicit_model()
        if stream_model is None:
            stream_model = self._build_stream_model(model_route)
        resolved_model = self.resolve_model(model_override=stream_model)
        tool_events: list[RuntimeToolLifecycleEvent] = []
        deps = self._build_runtime_deps(
            enabled_tools=enabled_tools,
            emit_tool_event=tool_events.append,
        )
        return _PydanticAITextStream(
            stream_context=cast(
                AbstractAsyncContextManager[StreamedRunResult[Any, Any]],
                self._agent.run_stream(
                    user_prompt,
                    message_history=message_history,
                    model=resolved_model,
                    deps=deps,
                ),
            ),
            resolved_model_id=model_route.model_id,
            tool_events=tool_events,
        )

    def resolve_model(self, *, model_override: Any | None = None) -> Any:
        explicit_model = self._resolved_explicit_model(model_override)
        if explicit_model is not None:
            return explicit_model

        model_name = self._configured_model_name()
        if model_name is None:
            raise ModelNotConfiguredError(
                "No runtime model is configured. Provide an explicit executor model or set COPILOT_RUNTIME_MODEL or COPILOT_MODEL."
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

    def _build_runtime_deps(
        self,
        *,
        enabled_tools: Sequence[str],
        emit_tool_event: ToolLifecycleSink,
    ) -> _PydanticAIAgentRunDeps:
        return _PydanticAIAgentRunDeps(
            tool_registry=self._tool_registry,
            enabled_tool_ids=frozenset(self._normalize_enabled_tools(enabled_tools)),
            emit_tool_event=emit_tool_event,
        )

    def _normalize_enabled_tools(self, enabled_tools: Sequence[str]) -> tuple[str, ...]:
        normalized: list[str] = []
        seen: set[str] = set()
        for tool_id in enabled_tools:
            if tool_id in seen:
                continue
            seen.add(tool_id)
            normalized.append(tool_id)
        return tuple(normalized)

    def _register_weather_tool(self) -> None:
        try:
            tool = self._tool_registry.resolve_tool(WEATHER_CURRENT_TOOL_ID)
        except LookupError:
            return

        @self._agent.tool(
            name="weather_current",
            description=tool.descriptor.description or WEATHER_CURRENT_TOOL_DESCRIPTION,
            retries=0,
        )
        async def weather_current(
            ctx: RunContext[_PydanticAIAgentRunDeps],
            location: str | None = None,
        ) -> dict[str, Any]:
            arguments: dict[str, Any] = {}
            if location is not None:
                arguments["location"] = location
            return await self._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments=arguments,
            )

    async def _execute_bound_tool(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        arguments: Mapping[str, Any] | None,
    ) -> dict[str, Any]:
        tool_call_id = ctx.tool_call_id or f"{tool_id}:call"
        normalized_arguments = {
            key: value for key, value in dict(arguments or {}).items() if value is not None
        }
        input_summary = summarize_tool_arguments(normalized_arguments)

        try:
            tool = ctx.deps.tool_registry.resolve_tool(tool_id)
        except LookupError as exc:
            error_message = f"Unknown tool '{tool_id}'."
            ctx.deps.emit_tool_event(
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="failed",
                    title="工具调用失败",
                    summary="工具未注册。",
                    input_summary=input_summary,
                    error_summary=error_message,
                )
            )
            raise ToolInvocationError(
                code="tool_not_found",
                message=error_message,
                tool_id=tool_id,
                tool_call_id=tool_call_id,
            ) from exc

        started_title, started_summary = self._build_started_copy(
            tool_id=tool_id,
            arguments=normalized_arguments,
            display_name=tool.descriptor.display_name or tool_id,
        )
        ctx.deps.emit_tool_event(
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="started",
                title=started_title,
                summary=started_summary,
                input_summary=input_summary,
            )
        )

        if tool_id not in ctx.deps.enabled_tool_ids:
            error_message = f"Tool '{tool_id}' is not enabled for this run."
            ctx.deps.emit_tool_event(
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="failed",
                    title="工具调用失败",
                    summary="当前运行未启用该工具。",
                    input_summary=input_summary,
                    error_summary=error_message,
                )
            )
            raise ToolInvocationError(
                code="tool_not_enabled",
                message=error_message,
                tool_id=tool_id,
                tool_call_id=tool_call_id,
            )

        try:
            result = await tool.execute(normalized_arguments)
        except ToolInvocationError:
            raise
        except Exception as exc:
            error_message = f"Tool '{tool_id}' failed: {exc}"
            ctx.deps.emit_tool_event(
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="failed",
                    title="工具调用失败",
                    summary="工具执行失败。",
                    input_summary=input_summary,
                    error_summary=str(exc),
                )
            )
            raise ToolInvocationError(
                code="tool_execution_failed",
                message=error_message,
                tool_id=tool_id,
                tool_call_id=tool_call_id,
            ) from exc

        result_summary = summarize_tool_result(result)
        completed_title, completed_summary = self._build_completed_copy(
            tool_id=tool_id,
            display_name=tool.descriptor.display_name or tool_id,
            result_summary=result_summary,
        )
        ctx.deps.emit_tool_event(
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="completed",
                title=completed_title,
                summary=completed_summary,
                input_summary=input_summary,
                result_summary=result_summary,
            )
        )
        return result

    def _build_started_copy(
        self,
        *,
        tool_id: str,
        arguments: Mapping[str, Any],
        display_name: str,
    ) -> tuple[str, str]:
        if tool_id == WEATHER_CURRENT_TOOL_ID:
            raw_location = arguments.get("location")
            location = raw_location if isinstance(raw_location, str) and raw_location.strip() else DEFAULT_WEATHER_LOCATION
            return ("调用天气工具", f"正在获取 {location} 的天气。")
        return (f"调用 {display_name}", f"正在执行 {display_name}。")

    def _build_completed_copy(
        self,
        *,
        tool_id: str,
        display_name: str,
        result_summary: str | None,
    ) -> tuple[str, str]:
        if tool_id == WEATHER_CURRENT_TOOL_ID:
            return (
                "天气工具已返回结果",
                result_summary or "天气工具已返回占位天气结果。",
            )
        return (f"{display_name} 已返回结果", result_summary or f"{display_name} 已执行完成。")

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


__all__ = [
    "AgentExecutionError",
    "AgentExecutorFactory",
    "DEFAULT_AGENT_NAME",
    "DEFAULT_AGENT_SYSTEM_PROMPT",
    "MODEL_ENVIRONMENT_KEYS",
    "ModelNotConfiguredError",
    "PydanticAIAgentExecutor",
    "RuntimeAgentExecutor",
    "RuntimeToolLifecycleEvent",
    "ToolInvocationError",
    "ToolLifecyclePhase",
]
