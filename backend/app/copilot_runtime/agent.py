from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterable, AsyncIterator, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol, cast

from datetime import UTC, datetime

from pydantic_ai import Agent, Tool
from pydantic_ai._run_context import RunContext
from pydantic_ai.messages import (
    BuiltinToolCallEvent,
    BuiltinToolResultEvent,
    FinalResultEvent,
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessage,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_ai.result import StreamedRunResult
from pydantic_ai.settings import ModelSettings

from .debug_logging import (
    log_runtime_chain_debug,
    preview_text,
    summarize_event_types,
    summarize_exception,
    summarize_runtime_execution_event,
    summarize_runtime_model_route,
    summarize_runtime_tool_event,
)
from .execution_event_graph import (
    TOOL_COMPLETED_EVENT_TYPE,
    TOOL_FAILED_EVENT_TYPE,
    TOOL_STARTED_EVENT_TYPE,
    TOOL_WAITING_APPROVAL_EVENT_TYPE,
    RuntimeExecutionEvent,
    RuntimeExecutionEventBuffer,
    RuntimeExecutionEventFactory,
    RuntimeExecutionEventType,
)
from .model_routes import ResolvedRuntimeModelRoute
from .provider_adapter_registry import (
    RuntimeProviderAdapterError,
    RuntimeProviderAdapterRegistry,
    build_default_provider_adapter_registry,
)
from .tool_approval_coordinator import (
    RuntimeToolApprovalCoordinator,
    RuntimeToolApprovalResolution,
)
from .tool_permissions import RuntimeToolPermissionResolver
from .tool_registry import (
    DEFAULT_WEATHER_LOCATION,
    ToolRegistry,
    WEATHER_CURRENT_TOOL_DESCRIPTION,
    WEATHER_CURRENT_TOOL_ID,
    build_default_tool_registry,
    summarize_tool_arguments,
    summarize_tool_result,
)
from app.tooling.runtime_adapter.copilot_runtime import (
    CONTRACT_RUNTIME_TOOL_KIND,
    RuntimeExecutableToolError,
    RuntimeToolExecutionContext,
    runtime_tool_execution_scope,
)

DEFAULT_AGENT_NAME = "default"
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available."
)
_RETRYABLE_TOOL_ERROR_CODES = frozenset(
    {
        "authentication_required",
        "cancelled",
        "conflict",
        "invalid_input",
        "not_found",
        "permission_denied",
        "rate_limited",
        "temporarily_unavailable",
        "timeout",
    }
)
ToolLifecyclePhase = Literal["started", "waiting_approval", "completed", "failed"]
_EVENT_STREAM_DONE = object()
AgentStreamEvent = (
    PartStartEvent
    | PartDeltaEvent
    | PartEndEvent
    | FinalResultEvent
    | FunctionToolCallEvent
    | FunctionToolResultEvent
    | BuiltinToolCallEvent
    | BuiltinToolResultEvent
)


class RuntimeAgentExecutor(Protocol):
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


def _coerce_model_settings(model_settings: Mapping[str, Any] | None) -> ModelSettings | None:
    if model_settings is None:
        return None
    normalized = dict(model_settings)
    if len(normalized) == 0:
        return None
    return cast(ModelSettings, normalized)


class ModelNotConfiguredError(RuntimeError):
    pass


class AgentExecutionError(RuntimeError):
    pass


class ToolInvocationError(AgentExecutionError):
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


class ProviderAdapterExecutionError(AgentExecutionError):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.details = dict(details or {})
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
    approval: dict[str, Any] | None = None

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
        if self.approval is not None:
            payload["approval"] = dict(self.approval)
        return payload


def _serialize_tool_result_for_display(result: Any) -> str:
    try:
        return json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True)
    except TypeError:
        return json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, default=str)


ToolLifecycleSink = Callable[[RuntimeToolLifecycleEvent], None]


def tool_lifecycle_event_to_execution_event(
    tool_event: RuntimeToolLifecycleEvent,
) -> RuntimeExecutionEvent:
    if tool_event.phase == "started":
        event_type: RuntimeExecutionEventType = TOOL_STARTED_EVENT_TYPE
    elif tool_event.phase == "waiting_approval":
        event_type = TOOL_WAITING_APPROVAL_EVENT_TYPE
    elif tool_event.phase == "completed":
        event_type = TOOL_COMPLETED_EVENT_TYPE
    else:
        event_type = TOOL_FAILED_EVENT_TYPE
    return RuntimeExecutionEvent(type=event_type, payload=tool_event.to_payload())


@dataclass(slots=True)
class _PydanticAIAgentRunDeps:
    tool_registry: ToolRegistry
    enabled_tool_ids: frozenset[str]
    emit_tool_event: ToolLifecycleSink
    workspace_root: str
    default_root: str
    tool_permission_resolver: RuntimeToolPermissionResolver
    approval_coordinator: RuntimeToolApprovalCoordinator
    run_id: str | None = None
    debug_enabled: bool = False


@dataclass(slots=True)
class _ObservedToolCall:
    part_index: int
    tool_name: str | None = None
    tool_call_id: str | None = None
    args: str | dict[str, Any] | None = None
    observation_emitted: bool = False
    arguments_completed_emitted: bool = False


class _PydanticAIEventStream:
    def __init__(
        self,
        *,
        run_id: str,
        agent: Agent[Any, Any],
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        resolved_model: Any,
        deps: _PydanticAIAgentRunDeps,
        resolved_model_id: str,
        event_buffer: RuntimeExecutionEventBuffer,
        model_settings: Mapping[str, Any] | None = None,
        model_route_summary: Mapping[str, Any] | None = None,
        debug_enabled: bool = False,
    ) -> None:
        self.resolved_model_id = resolved_model_id
        self._run_id = run_id
        self._agent = agent
        self._user_prompt = user_prompt
        self._message_history = tuple(message_history)
        self._resolved_model = resolved_model
        self._deps = deps
        self._model_settings = dict(model_settings or {})
        self._stream_context: AbstractAsyncContextManager[StreamedRunResult[Any, Any]] | None = None
        self._stream_result: StreamedRunResult[Any, Any] | None = None
        self._event_buffer = event_buffer
        self._model_route_summary = dict(model_route_summary or {})
        self._debug_enabled = debug_enabled
        self._text_delta_index = 0
        self._reasoning_delta_index = 0
        self._cached_output: str | None = None
        self._observed_tool_calls: dict[int, _ObservedToolCall] = {}
        self._raw_tool_call_observation_count = 0
        self._raw_tool_call_arguments_completed_count = 0
        self._event_queue: asyncio.Queue[RuntimeExecutionEvent | object] = asyncio.Queue()
        self._run_task: asyncio.Task[None] | None = None
        self._run_exception: BaseException | None = None
        self._tool_lifecycle_emitted_ids: set[str] = set()

    async def __aenter__(self) -> "_PydanticAIEventStream":
        if self._run_task is None:
            self._run_task = asyncio.create_task(self._run_agent(), name=f"copilot-runtime-run:{self._run_id}")
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool | None:
        run_task = self._run_task
        if run_task is None:
            return None
        if not run_task.done():
            run_task.cancel()
        try:
            await run_task
        except asyncio.CancelledError:
            return None
        return None

    async def iter_events(self) -> AsyncIterator[RuntimeExecutionEvent]:
        run_task = self._require_run_task()
        while True:
            queued = await self._event_queue.get()
            if queued is _EVENT_STREAM_DONE:
                break
            yield cast(RuntimeExecutionEvent, queued)
        try:
            await run_task
        except asyncio.CancelledError:
            pass
        if self._run_exception is not None:
            raise self._run_exception

    def record_tool_lifecycle_event(self, tool_event: RuntimeToolLifecycleEvent) -> None:
        self._tool_lifecycle_emitted_ids.add(tool_event.tool_call_id)
        self._event_buffer.record_event(tool_lifecycle_event_to_execution_event(tool_event))
        self._flush_pending_events_to_queue(reason=f"tool_lifecycle_{tool_event.phase}")

    async def _run_agent(self) -> None:
        try:
            result = await self._agent.run(
                self._user_prompt,
                message_history=self._message_history,
                model=self._resolved_model,
                deps=self._deps,
                model_settings=_coerce_model_settings(self._model_settings),
                event_stream_handler=self._handle_runtime_events,
            )
            output = result.output
            if not isinstance(output, str):
                raise AgentExecutionError("Runtime agent returned non-text output.")
            normalized_output = output.strip()
            if normalized_output == "":
                raise AgentExecutionError("Runtime agent returned empty text response.")
            self._cached_output = normalized_output
            self._raise_if_raw_tool_call_left_unexecuted()
        except BaseException as exc:
            self._run_exception = exc
        finally:
            self._event_buffer.finish_assistant_segment()
            self._event_buffer.finish_reasoning_segment()
            self._flush_pending_events_to_queue(reason="run_finished")
            await self._event_queue.put(_EVENT_STREAM_DONE)

    async def _handle_runtime_events(
        self,
        _run_context: Any,
        events: AsyncIterable[AgentStreamEvent],
    ) -> None:
        async for event in events:
            if isinstance(event, PartStartEvent):
                part = event.part
                if isinstance(part, TextPart):
                    self._record_text_delta(part.content)
                    self._flush_pending_events_to_queue(reason="assistant_part")
                elif isinstance(part, ThinkingPart):
                    self._record_reasoning_delta(part.content)
                    self._flush_pending_events_to_queue(reason="reasoning_part")
                elif isinstance(part, ToolCallPart):
                    state = self._observed_tool_calls.get(event.index)
                    if state is None:
                        state = _ObservedToolCall(part_index=event.index)
                    state.tool_name = part.tool_name or state.tool_name
                    state.tool_call_id = part.tool_call_id or state.tool_call_id
                    if part.args is not None:
                        state.args = part.args
                    self._observed_tool_calls[event.index] = state
                    self._emit_tool_call_observation_if_needed(state=state)
                    self._flush_pending_events_to_queue(reason="tool_call_part")
            elif isinstance(event, PartDeltaEvent):
                delta = event.delta
                if isinstance(delta, TextPartDelta):
                    self._record_text_delta(delta.content_delta)
                    self._flush_pending_events_to_queue(reason="assistant_delta")
                elif isinstance(delta, ThinkingPartDelta):
                    self._record_reasoning_delta(delta.content_delta)
                    self._flush_pending_events_to_queue(reason="reasoning_delta")
                elif isinstance(delta, ToolCallPartDelta):
                    state = self._observed_tool_calls.get(event.index)
                    if state is None:
                        state = _ObservedToolCall(part_index=event.index)
                    if delta.tool_name_delta:
                        state.tool_name = f"{state.tool_name or ''}{delta.tool_name_delta}"
                    if delta.tool_call_id is not None:
                        state.tool_call_id = delta.tool_call_id
                    if delta.args_delta is not None:
                        state.args = self._merge_tool_call_arguments(
                            current=state.args,
                            update=delta.args_delta,
                        )
                    self._observed_tool_calls[event.index] = state
                    self._emit_tool_call_observation_if_needed(state=state)
                    self._flush_pending_events_to_queue(reason="tool_call_delta")

    def _record_text_delta(self, delta: str) -> None:
        if delta == "":
            return
        self._text_delta_index += 1
        self._event_buffer.record_assistant_delta(delta)

    def _record_reasoning_delta(self, delta: str | None) -> None:
        if delta in (None, ""):
            return
        self._reasoning_delta_index += 1
        self._event_buffer.record_reasoning_delta(delta)

    def _merge_tool_call_arguments(
        self,
        *,
        current: str | dict[str, Any] | None,
        update: str | dict[str, Any] | None,
    ) -> str | dict[str, Any] | None:
        if update is None:
            return current
        if current is None:
            return update
        if isinstance(current, str) and isinstance(update, str):
            return current + update
        if isinstance(current, dict) and isinstance(update, dict):
            merged = dict(current)
            merged.update(update)
            return merged
        return update

    def _parse_tool_call_arguments(
        self,
        value: str | dict[str, Any] | None,
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        if isinstance(value, dict):
            return dict(value)
        normalized_value = value.strip()
        if normalized_value == "":
            return None
        try:
            parsed = json.loads(normalized_value)
        except json.JSONDecodeError:
            return None
        return dict(parsed) if isinstance(parsed, dict) else None

    def _is_tool_call_identified(self, state: _ObservedToolCall) -> bool:
        return bool(state.tool_name) and bool(state.tool_call_id)

    def _emit_tool_call_observation_if_needed(self, *, state: _ObservedToolCall) -> None:
        parsed_arguments = self._parse_tool_call_arguments(state.args)
        arguments_complete = parsed_arguments is not None or isinstance(state.args, dict)
        if not state.observation_emitted and self._is_tool_call_identified(state):
            self._event_buffer.record_event(
                self._event_buffer.event_factory.build_diagnostic(
                    code="raw_tool_call_observed",
                    message="Observed provider tool call in raw collector.",
                    details=self._build_tool_call_diagnostic_details(
                        state=state,
                        observation_kind="observed",
                        parsed_arguments=parsed_arguments,
                    ),
                    stage="collect_raw_stream",
                )
            )
            state.observation_emitted = True
            self._raw_tool_call_observation_count += 1
            if arguments_complete:
                state.arguments_completed_emitted = True
                self._raw_tool_call_arguments_completed_count += 1
            return
        if state.observation_emitted and not state.arguments_completed_emitted and arguments_complete:
            self._event_buffer.record_event(
                self._event_buffer.event_factory.build_diagnostic(
                    code="raw_tool_call_arguments_completed",
                    message="Provider tool call arguments became complete in raw collector.",
                    details=self._build_tool_call_diagnostic_details(
                        state=state,
                        observation_kind="arguments_completed",
                        parsed_arguments=parsed_arguments,
                    ),
                    stage="collect_raw_stream",
                )
            )
            state.arguments_completed_emitted = True
            self._raw_tool_call_arguments_completed_count += 1

    def _build_tool_call_diagnostic_details(
        self,
        *,
        state: _ObservedToolCall,
        observation_kind: str,
        parsed_arguments: dict[str, Any] | None,
    ) -> dict[str, Any]:
        details: dict[str, Any] = {
            "source": "pydantic_raw_stream",
            "providerEndpointType": self._model_route_summary.get("endpointType"),
            "observationKind": observation_kind,
            "partIndex": state.part_index,
            "toolCallId": state.tool_call_id,
            "toolName": state.tool_name,
            "argumentsComplete": parsed_arguments is not None or isinstance(state.args, dict),
        }
        if parsed_arguments is not None:
            details["toolArguments"] = parsed_arguments
        elif isinstance(state.args, dict):
            details["toolArguments"] = dict(state.args)
        elif isinstance(state.args, str) and state.args.strip() != "":
            details["toolArgumentsJson"] = state.args
        return details

    def _raise_if_raw_tool_call_left_unexecuted(self) -> None:
        pending_states = [
            state
            for state in self._observed_tool_calls.values()
            if state.arguments_completed_emitted
            and state.tool_call_id is not None
            and state.tool_call_id not in self._tool_lifecycle_emitted_ids
        ]
        for state in pending_states:
            tool_call_id = state.tool_call_id
            if tool_call_id is None:
                continue
            parsed_arguments = self._parse_tool_call_arguments(state.args)
            details = self._build_tool_call_diagnostic_details(
                state=state,
                observation_kind="execution_missing",
                parsed_arguments=parsed_arguments,
            )
            self._event_buffer.record_event(
                self._event_buffer.event_factory.build_diagnostic(
                    code="raw_tool_call_unexecuted",
                    message="Provider tool call arguments became complete, but no actual tool execution followed.",
                    details=details,
                    stage="drive_raw_tool_call",
                )
            )
            raw_tool_input = (
                parsed_arguments
                if parsed_arguments is not None
                else dict(state.args)
                if isinstance(state.args, dict)
                else None
            )
            self.record_tool_lifecycle_event(
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=self._resolve_tool_id_from_tool_name(state.tool_name),
                    phase="failed",
                    title="工具调用失败",
                    summary="模型产生了工具调用，但运行时未真正执行该调用。",
                    input_summary=(None if raw_tool_input is None else summarize_tool_arguments(raw_tool_input)),
                    error_summary="Provider tool call arguments became complete, but no actual tool execution followed.",
                )
            )

    def _resolve_tool_id_from_tool_name(self, tool_name: str | None) -> str:
        normalized_tool_name = None if tool_name is None else tool_name.strip()
        if not normalized_tool_name:
            return "tool.unknown"
        if normalized_tool_name == "weather_current":
            return WEATHER_CURRENT_TOOL_ID
        for registered_tool_id in self._deps.tool_registry.list_tool_ids():
            try:
                executable_tool = self._deps.tool_registry.resolve_tool(registered_tool_id)
            except LookupError:
                continue
            if executable_tool.function_name == normalized_tool_name:
                return registered_tool_id
        return normalized_tool_name

    async def get_output(self) -> str:
        run_task = self._require_run_task()
        await run_task
        if self._run_exception is not None:
            raise self._run_exception
        if self._cached_output is None:
            raise AgentExecutionError("Runtime agent stream completed without output.")
        return self._cached_output

    def _require_run_task(self) -> asyncio.Task[None]:
        if self._run_task is None:
            raise RuntimeError("PydanticAI event stream has not been opened.")
        return self._run_task

    def _flush_pending_events_to_queue(self, *, reason: str) -> None:
        pending_events = self._event_buffer.drain()
        for pending_event in pending_events:
            self._event_queue.put_nowait(pending_event)


class PydanticAIAgentExecutor:
    def __init__(
        self,
        *,
        model: Any | None = None,
        env: Mapping[str, str] | None = None,
        tool_registry: ToolRegistry | None = None,
        workspace_root: str | Path | None = None,
        default_root: str | Path | None = None,
        provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
        approval_coordinator: RuntimeToolApprovalCoordinator | None = None,
    ) -> None:
        self.agent_name = DEFAULT_AGENT_NAME
        self._model_override = model
        self._env = dict(env or {})
        self._tool_registry = tool_registry or build_default_tool_registry()
        self._workspace_root = str(workspace_root or Path.cwd())
        self._default_root = str(default_root or self._workspace_root)
        self.provider_adapter_registry = provider_adapter_registry or build_default_provider_adapter_registry()
        self._approval_coordinator = approval_coordinator or RuntimeToolApprovalCoordinator()
        self._agent = self._build_runtime_agent(
            enabled_tools=None,
            resolved_model=self._resolved_explicit_model(),
        )

    @property
    def model_configured(self) -> bool:
        return self._model_override is not None

    @property
    def model_environment_keys(self) -> tuple[str, ...]:
        return ()

    def resolve_model(self) -> Any:
        candidate = self._resolved_explicit_model()
        if candidate is None:
            raise ModelNotConfiguredError("Provide an explicit executor model")
        return candidate

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
        stream = self.open_event_stream(
            run_id="run-inline",
            agent_name=agent_name,
            user_prompt=user_prompt,
            message_history=message_history,
            model_route=ResolvedRuntimeModelRoute(
                provider_profile_id="default",
                provider="openai",
                endpoint_type="openai-compatible",
                base_url="https://example.com/v1",
                model_id="test-model",
                api_key="test-api-key",
                route_ref=None,
            ),
            enabled_tools=enabled_tools,
            request_options=request_options,
            model_override=model,
        )
        async with stream as opened:
            async for _event in opened.iter_events():
                pass
            return await opened.get_output()

    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: Sequence[str] = (),
        debug_enabled: bool = False,
        request_options: Mapping[str, Any] | None = None,
        model_settings: Mapping[str, Any] | None = None,
        model_override: Any | None = None,
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> _PydanticAIEventStream:
        resolved_model = self._resolved_explicit_model(model_override)
        if resolved_model is None:
            resolved_model = (
                self._build_stream_model(model_route)
                if model_route.route_ref is not None
                else self.resolve_model()
            )
        enabled_tool_ids = tuple(dict.fromkeys(enabled_tools))
        event_buffer = RuntimeExecutionEventBuffer(
            event_factory=RuntimeExecutionEventFactory(run_id=run_id),
            debug_enabled=debug_enabled,
        )
        stream: _PydanticAIEventStream | None = None

        def emit_tool_event(tool_event: RuntimeToolLifecycleEvent) -> None:
            if stream is None:
                raise RuntimeError("PydanticAI event stream is not initialized.")
            stream.record_tool_lifecycle_event(tool_event)

        deps = self._build_runtime_deps(
            enabled_tools=enabled_tool_ids,
            emit_tool_event=emit_tool_event,
            run_id=run_id,
            debug_enabled=debug_enabled,
            tool_permission_resolver=tool_permission_resolver,
        )
        agent = self._agent if len(enabled_tool_ids) == 0 else self._build_runtime_agent(
            enabled_tools=enabled_tool_ids,
            resolved_model=resolved_model,
        )
        stream = _PydanticAIEventStream(
            run_id=run_id,
            agent=agent,
            user_prompt=user_prompt,
            message_history=message_history,
            resolved_model=resolved_model,
            deps=deps,
            resolved_model_id=model_route.model_id,
            event_buffer=event_buffer,
            model_settings=model_settings,
            model_route_summary=model_route.to_public_dict(),
            debug_enabled=debug_enabled,
        )
        return stream

    def _build_runtime_agent(
        self,
        *,
        enabled_tools: Sequence[str] | None,
        resolved_model: Any,
    ) -> Agent[Any, Any]:
        _ = resolved_model
        agent = Agent(
            output_type=str,
            system_prompt=DEFAULT_AGENT_SYSTEM_PROMPT,
            deps_type=_PydanticAIAgentRunDeps,
            name=self.agent_name,
            tools=self._build_contract_agent_tools(enabled_tools=enabled_tools),
            defer_model_check=True,
        )
        self._register_weather_tool(agent, enabled_tools)
        return agent

    def _build_runtime_deps(
        self,
        *,
        enabled_tools: Sequence[str],
        emit_tool_event: ToolLifecycleSink,
        run_id: str | None = None,
        debug_enabled: bool = False,
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> _PydanticAIAgentRunDeps:
        return _PydanticAIAgentRunDeps(
            tool_registry=self._tool_registry,
            enabled_tool_ids=frozenset(self._normalize_enabled_tools(enabled_tools)),
            emit_tool_event=emit_tool_event,
            workspace_root=self._workspace_root,
            default_root=self._default_root,
            tool_permission_resolver=tool_permission_resolver or RuntimeToolPermissionResolver(),
            approval_coordinator=self._approval_coordinator,
            run_id=run_id,
            debug_enabled=debug_enabled,
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

    def _build_contract_agent_tools(
        self,
        *,
        enabled_tools: Sequence[str] | None,
    ) -> tuple[Tool[Any], ...]:
        allowed_tool_ids = None if enabled_tools is None else frozenset(self._normalize_enabled_tools(enabled_tools))
        tools: list[Tool[Any]] = []
        for tool_id in self._tool_registry.list_tool_ids():
            if allowed_tool_ids is not None and tool_id not in allowed_tool_ids:
                continue
            executable_tool = self._tool_registry.resolve_tool(tool_id)
            if executable_tool.function_name is None or executable_tool.parameters_json_schema is None:
                continue
            if tool_id == WEATHER_CURRENT_TOOL_ID:
                continue
            tools.append(
                self._build_contract_agent_tool(
                    tool_id=tool_id,
                    function_name=executable_tool.function_name,
                    description=executable_tool.descriptor.description,
                    parameters_json_schema=executable_tool.parameters_json_schema,
                )
            )
        return tuple(tools)

    def _build_contract_agent_tool(
        self,
        *,
        tool_id: str,
        function_name: str,
        description: str | None,
        parameters_json_schema: Mapping[str, Any],
    ) -> Tool[Any]:
        async def runtime_contract_tool(
            ctx: RunContext[_PydanticAIAgentRunDeps],
            **arguments: Any,
        ) -> dict[str, Any]:
            return await self._execute_bound_tool(
                ctx,
                tool_id=tool_id,
                arguments=arguments,
            )

        tool = Tool.from_schema(
            runtime_contract_tool,
            name=function_name,
            description=description,
            json_schema=dict(parameters_json_schema),
            takes_ctx=True,
        )
        tool.max_retries = 0
        return tool

    def _build_stream_model(self, model_route: ResolvedRuntimeModelRoute) -> Any:
        try:
            return self.provider_adapter_registry.build_stream_model(model_route=model_route)
        except RuntimeProviderAdapterError as exc:
            raise ProviderAdapterExecutionError(
                code=exc.code,
                message=str(exc),
                details=exc.details,
            ) from exc

    def _register_weather_tool(self, agent: Agent[Any, Any], enabled_tools: Sequence[str] | None) -> None:
        try:
            tool = self._tool_registry.resolve_tool(WEATHER_CURRENT_TOOL_ID)
        except LookupError:
            return
        if enabled_tools is not None and WEATHER_CURRENT_TOOL_ID not in frozenset(enabled_tools):
            return

        @agent.tool(
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
        normalized_arguments = {key: value for key, value in dict(arguments or {}).items() if value is not None}
        input_summary = summarize_tool_arguments(normalized_arguments)

        try:
            tool = ctx.deps.tool_registry.resolve_tool(tool_id)
        except LookupError:
            error_message = f"Unknown tool '{tool_id}'."
            self._emit_failed_tool_event(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具未注册。",
                input_summary=input_summary,
                error_summary=error_message,
            )
            return self._build_tool_failure_result(
                tool_id=tool_id,
                tool_call_id=tool_call_id,
                code="tool_not_found",
                message=error_message,
            )

        started_title, started_summary = self._build_started_copy(
            tool_id=tool_id,
            arguments=normalized_arguments,
            display_name=tool.descriptor.display_name or tool_id,
        )
        self._emit_tool_event(
            ctx,
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="started",
                title=started_title,
                summary=started_summary,
                input_summary=input_summary,
            ),
        )

        if tool_id not in ctx.deps.enabled_tool_ids:
            error_message = f"Tool '{tool_id}' is not enabled for this run."
            self._emit_failed_tool_event(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="当前运行未启用该工具。",
                input_summary=input_summary,
                error_summary=error_message,
            )
            return self._build_tool_failure_result(
                tool_id=tool_id,
                tool_call_id=tool_call_id,
                code="tool_not_enabled",
                message=error_message,
            )

        gate_result = await self._await_tool_approval_if_needed(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            input_summary=input_summary,
        )
        if gate_result is not None:
            return gate_result

        workspace_root = getattr(ctx.deps, "workspace_root", None)
        default_root = getattr(ctx.deps, "default_root", workspace_root)
        file_system_state: dict[str, Any] = {}
        if isinstance(workspace_root, str) and workspace_root.strip() != "":
            file_system_state["workspaceRoot"] = workspace_root
        if isinstance(default_root, str) and default_root.strip() != "":
            file_system_state["defaultRoot"] = default_root

        execution_context = RuntimeToolExecutionContext(
            tool_call_id=tool_call_id,
            run_id=ctx.deps.run_id,
            actor="agent",
            requested_at=datetime.now(UTC),
            trace={"toolCallId": tool_call_id, "toolId": tool_id},
            metadata={
                "displayName": tool.descriptor.display_name or tool_id,
                "enabledToolIds": sorted(ctx.deps.enabled_tool_ids),
                "fileSystemState": file_system_state,
            },
        )
        try:
            with runtime_tool_execution_scope(execution_context):
                result = await tool.execute(normalized_arguments)
        except RuntimeExecutableToolError as exc:
            self._emit_failed_tool_event(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=exc.message,
            )
            return self._build_tool_failure_result(
                tool_id=tool_id,
                tool_call_id=tool_call_id,
                code=exc.code,
                message=exc.message,
                details=exc.details,
            )
        except Exception as exc:
            error_message = f"Tool '{tool_id}' failed: {exc}"
            self._emit_failed_tool_event(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=str(exc),
            )
            return self._build_tool_failure_result(
                tool_id=tool_id,
                tool_call_id=tool_call_id,
                code="tool_execution_failed",
                message=error_message,
                details={"exceptionType": type(exc).__name__},
            )

        if tool.descriptor.kind == CONTRACT_RUNTIME_TOOL_KIND:
            status = result.get("status")
            if status == "error":
                error_payload = result.get("error")
                error_message = error_payload.get("message") if isinstance(error_payload, Mapping) else None
                normalized_error_message = (
                    error_message.strip()
                    if isinstance(error_message, str) and error_message.strip() != ""
                    else "Contract tool execution failed."
                )
                self._emit_failed_tool_event(
                    ctx,
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    summary="工具执行失败。",
                    input_summary=input_summary,
                    error_summary=normalized_error_message,
                )
                return result

        if tool_id == "tool.fs.switch_root":
            current_root = result.get("output", {}).get("data", {}).get("currentRoot")
            if isinstance(current_root, str) and current_root.strip() != "":
                ctx.deps.default_root = current_root.strip()

        result_summary = summarize_tool_result(result)
        result_payload = _serialize_tool_result_for_display(result)
        completed_title = self._build_completed_title(
            tool_id=tool_id,
            display_name=tool.descriptor.display_name or tool_id,
        )
        self._emit_tool_event(
            ctx,
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="completed",
                title=completed_title,
                summary=result_payload,
                input_summary=input_summary,
                result_summary=result_summary,
            ),
        )
        return result

    async def _await_tool_approval_if_needed(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        input_summary: str,
    ) -> dict[str, Any] | None:
        mode = ctx.deps.tool_permission_resolver.resolve_mode(tool_id)
        if mode == "allow":
            return None
        timeout_seconds = ctx.deps.tool_permission_resolver.resolve_timeout_seconds(tool_id)
        timeout_action = ctx.deps.tool_permission_resolver.resolve_timeout_action(tool_id)
        request, _future = ctx.deps.approval_coordinator.create_request(
            run_id=ctx.deps.run_id or "run-unknown",
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            mode=mode,
            input_summary=input_summary,
            timeout_seconds=timeout_seconds if mode == "delay" else None,
            timeout_action=timeout_action if mode == "delay" else None,
        )
        approval_payload: dict[str, Any] = {
            "mode": request.mode,
            "timeoutSeconds": request.timeout_seconds,
            "timeoutAction": request.timeout_action,
        }
        if request.timeout_at is not None:
            approval_payload["timeoutAt"] = request.timeout_at.isoformat()

        self._emit_tool_event(
            ctx,
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="waiting_approval",
                title="工具等待审批",
                summary="工具调用正在等待审批决议。",
                input_summary=input_summary,
                approval=approval_payload,
            ),
        )
        resolution = await ctx.deps.approval_coordinator.wait_for_resolution(
            run_id=request.run_id,
            tool_call_id=request.tool_call_id,
        )
        if resolution.decision == "approved":
            return None
        self._emit_failed_tool_event(
            ctx,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            summary="工具调用被拒绝。",
            input_summary=input_summary,
            error_summary=self._build_rejection_message(resolution),
        )
        return self._build_tool_failure_result(
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            code="tool_approval_rejected",
            message=self._build_rejection_message(resolution),
            details={
                "decision": resolution.decision,
                "source": resolution.source,
                "mode": resolution.mode,
            },
            retryable=False,
        )

    def _build_rejection_message(self, resolution: RuntimeToolApprovalResolution) -> str:
        if resolution.source == "timeout":
            return "Tool approval timed out and was automatically rejected."
        return "Tool call was rejected by the user."

    def _build_tool_failure_result(
        self,
        *,
        tool_id: str,
        tool_call_id: str,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
        retryable: bool | None = None,
    ) -> dict[str, Any]:
        normalized_code = code.strip() or "tool_execution_failed"
        normalized_message = message.strip() or "Tool execution failed."
        normalized_details = {} if details is None else dict(details)
        resolved_retryable = normalized_code in _RETRYABLE_TOOL_ERROR_CODES if retryable is None else retryable
        error_payload: dict[str, Any] = {
            "code": normalized_code,
            "message": normalized_message,
            "retryable": resolved_retryable,
        }
        if normalized_details:
            error_payload["details"] = normalized_details
        return {
            "status": "error",
            "error": error_payload,
            "artifacts": [],
            "metadata": {
                "toolId": tool_id,
                "toolCallId": tool_call_id,
            },
        }

    def _emit_failed_tool_event(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_call_id: str,
        tool_id: str,
        summary: str,
        input_summary: str | None,
        error_summary: str,
    ) -> None:
        self._emit_tool_event(
            ctx,
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="failed",
                title="工具调用失败",
                summary=summary,
                input_summary=input_summary,
                error_summary=error_summary,
            ),
        )

    def _emit_tool_event(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        event: RuntimeToolLifecycleEvent,
    ) -> None:
        ctx.deps.emit_tool_event(event)
        log_runtime_chain_debug(
            "tool.lifecycle_event",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolEvent=summarize_runtime_tool_event(event),
        )

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

    def _build_completed_title(
        self,
        *,
        tool_id: str,
        display_name: str,
    ) -> str:
        if tool_id == WEATHER_CURRENT_TOOL_ID:
            return "天气工具已返回结果"
        return f"{display_name} 已返回结果"

    def _resolved_explicit_model(self, model_override: Any | None = None) -> Any | None:
        candidate = self._model_override if model_override is None else model_override
        if candidate is None:
            return None
        if isinstance(candidate, str):
            normalized = candidate.strip()
            return normalized or None
        return candidate
