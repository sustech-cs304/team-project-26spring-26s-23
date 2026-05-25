from __future__ import annotations

import asyncio
import base64
import binascii
import json
from collections.abc import AsyncIterable, AsyncIterator, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

from datetime import UTC, datetime

from pydantic_ai import Agent, Tool
from pydantic_ai._run_context import RunContext
from pydantic_ai.messages import (
    BinaryImage,
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
    ToolReturn,
)
from pydantic_ai.result import StreamedRunResult
from pydantic_ai.settings import ModelSettings

from .debug_logging import (
    log_runtime_chain_debug,
    preview_text,
    summarize_runtime_tool_event,
)
from .skill_snapshot_provider import (
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
    SkillRuntimeIndex,
)
from .debug_log_store import DebugLogCategory, DebugLogLevel, RuntimeDebugLogWriter
from .execution_event_graph import (
    RuntimeExecutionEvent,
    RuntimeExecutionEventBuffer,
    RuntimeExecutionEventFactory,
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
    REQUEST_USER_FORM_TOOL_ID,
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

from .agent_exceptions import (
    AgentExecutionError,
    AwaitingUserInputError,
    ModelNotConfiguredError,
    ProviderAdapterExecutionError,
)
from .agent_tool_lifecycle import (
    RuntimeToolLifecycleEvent,
    ToolLifecycleSink,
    _sanitize_tool_result_for_display,
    tool_lifecycle_event_to_execution_event,
)

from app.tooling.prompts import PromptContext, get_tool_description
from app.tooling.prompts.system import SHARED_CONVENTIONS, TOOL_SELECTION_GUIDE

DEFAULT_AGENT_NAME = "default"
DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are the SUSTech Copilot backend assistant. "
    "Provide concise, accurate, text-only answers. "
    "Do not claim to have used tools when no tools are available. "
    "When structured user input would be clearer than a free-text follow-up, prefer the request_user_form tool, including for a single well-defined field. "
    "After sending a form, wait for the user's next message to continue. "
    "Do not use forms to request file uploads or sensitive credentials such as secrets, passwords, or tokens."
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


def _coerce_model_settings(
    model_settings: Mapping[str, Any] | None,
) -> ModelSettings | None:
    if model_settings is None:
        return None
    normalized = dict(model_settings)
    if len(normalized) == 0:
        return None
    return cast(ModelSettings, normalized)


@dataclass(slots=True)
class _PydanticAIAgentRunDeps:
    tool_registry: ToolRegistry
    enabled_tool_ids: frozenset[str]
    emit_tool_event: ToolLifecycleSink
    workspace_root: str
    default_root: str
    tool_permission_resolver: RuntimeToolPermissionResolver
    approval_coordinator: RuntimeToolApprovalCoordinator
    user_data_dir: str | None = None
    resolved_model_route: dict[str, Any] | None = None
    run_id: str | None = None
    debug_enabled: bool = False
    skill_runtime_index: SkillRuntimeIndex | None = None


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
        self._stream_context: (
            AbstractAsyncContextManager[StreamedRunResult[Any, Any]] | None
        ) = None
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
        self._event_queue: asyncio.Queue[RuntimeExecutionEvent | object] = (
            asyncio.Queue()
        )
        self._run_task: asyncio.Task[None] | None = None
        self._run_exception: BaseException | None = None
        self._tool_lifecycle_emitted_ids: set[str] = set()

    async def __aenter__(self) -> "_PydanticAIEventStream":
        if self._run_task is None:
            self._run_task = asyncio.create_task(
                self._run_agent(), name=f"copilot-runtime-run:{self._run_id}"
            )
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

    def record_tool_lifecycle_event(
        self, tool_event: RuntimeToolLifecycleEvent
    ) -> None:
        self._tool_lifecycle_emitted_ids.add(tool_event.tool_call_id)
        self._event_buffer.record_event(
            tool_lifecycle_event_to_execution_event(tool_event)
        )
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
        except asyncio.CancelledError as exc:
            self._run_exception = exc
            raise
        except Exception as exc:
            self._run_exception = exc
        finally:
            self._deps.approval_coordinator.discard_run(run_id=self._run_id)
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
                        state.tool_name = (
                            f"{state.tool_name or ''}{delta.tool_name_delta}"
                        )
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

    def _emit_tool_call_observation_if_needed(
        self, *, state: _ObservedToolCall
    ) -> None:
        parsed_arguments = self._parse_tool_call_arguments(state.args)
        arguments_complete = parsed_arguments is not None or isinstance(
            state.args, dict
        )
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
        if (
            state.observation_emitted
            and not state.arguments_completed_emitted
            and arguments_complete
        ):
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
            "argumentsComplete": parsed_arguments is not None
            or isinstance(state.args, dict),
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
                    input_summary=(
                        None
                        if raw_tool_input is None
                        else summarize_tool_arguments(raw_tool_input)
                    ),
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
                executable_tool = self._deps.tool_registry.resolve_tool(
                    registered_tool_id
                )
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
        user_data_dir: str | Path | None = None,
        provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
        approval_coordinator: RuntimeToolApprovalCoordinator | None = None,
    ) -> None:
        self.agent_name = DEFAULT_AGENT_NAME
        self._model_override = model
        self._env = dict(env or {})
        self._tool_registry = tool_registry or build_default_tool_registry()
        configured_workspace_root = (
            Path(workspace_root)
            if workspace_root is not None
            else self._tool_registry.workspace_root or Path.cwd()
        )
        self._workspace_root = configured_workspace_root.resolve(
            strict=False
        ).as_posix()
        resolved_default_root = (
            Path(default_root).resolve(strict=False).as_posix()
            if default_root is not None
            else self._workspace_root
        )
        self._default_root = resolved_default_root
        self._user_data_dir = (
            Path(user_data_dir).resolve(strict=False).as_posix()
            if user_data_dir is not None
            else None
        )
        self.provider_adapter_registry = (
            provider_adapter_registry or build_default_provider_adapter_registry()
        )
        self._approval_coordinator = (
            approval_coordinator or RuntimeToolApprovalCoordinator()
        )
        self._debug_event_logger: RuntimeDebugLogWriter | None = None
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

    def set_debug_event_logger(self, logger: RuntimeDebugLogWriter | None) -> None:
        self._debug_event_logger = logger

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
        resolved_model_override = self._resolved_explicit_model(model)
        if resolved_model_override is None:
            resolved_model_override = self.resolve_model()
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
            model_override=resolved_model_override,
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
        skill_runtime_index: SkillRuntimeIndex | None = None,
        skill_system_prompt: str | None = None,
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
            resolved_model_route=model_route,
            run_id=run_id,
            debug_enabled=debug_enabled,
            tool_permission_resolver=tool_permission_resolver,
            skill_runtime_index=skill_runtime_index,
        )
        agent = self._build_runtime_agent(
            enabled_tools=enabled_tool_ids,
            resolved_model=resolved_model,
            skill_system_prompt=skill_system_prompt,
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
        skill_system_prompt: str | None = None,
    ) -> Agent[Any, Any]:
        _ = resolved_model
        agent = Agent(
            output_type=str,
            system_prompt=self._compose_system_prompt(skill_system_prompt),
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
        resolved_model_route: ResolvedRuntimeModelRoute | None = None,
        run_id: str | None = None,
        debug_enabled: bool = False,
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
        skill_runtime_index: SkillRuntimeIndex | None = None,
    ) -> _PydanticAIAgentRunDeps:
        return _PydanticAIAgentRunDeps(
            tool_registry=self._tool_registry,
            enabled_tool_ids=frozenset(self._normalize_enabled_tools(enabled_tools)),
            emit_tool_event=emit_tool_event,
            workspace_root=self._workspace_root,
            default_root=self._default_root,
            tool_permission_resolver=tool_permission_resolver
            or RuntimeToolPermissionResolver(),
            approval_coordinator=self._approval_coordinator,
            user_data_dir=self._user_data_dir,
            resolved_model_route=(
                None
                if resolved_model_route is None
                else resolved_model_route.to_resolved_route_dict()
            ),
            run_id=run_id,
            debug_enabled=debug_enabled,
            skill_runtime_index=skill_runtime_index,
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
        allowed_tool_ids = (
            None
            if enabled_tools is None
            else frozenset(self._normalize_enabled_tools(enabled_tools))
        )
        tools: list[Tool[Any]] = []
        for tool_id in self._tool_registry.list_tool_ids():
            if allowed_tool_ids is not None and tool_id not in allowed_tool_ids:
                continue
            executable_tool = self._tool_registry.resolve_tool(tool_id)
            if (
                executable_tool.function_name is None
                or executable_tool.parameters_json_schema is None
            ):
                continue
            if tool_id == WEATHER_CURRENT_TOOL_ID:
                continue
            description = (
                get_tool_description(tool_id)
                or executable_tool.descriptor.description
            )
            tools.append(
                self._build_contract_agent_tool(
                    tool_id=tool_id,
                    function_name=executable_tool.function_name,
                    description=description,
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
        ) -> Any:
            result = await self._execute_bound_tool(
                ctx,
                tool_id=tool_id,
                arguments=arguments,
            )
            return self._build_model_visible_tool_result(
                tool_id=tool_id,
                result=result,
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

    def _build_model_visible_tool_result(
        self,
        *,
        tool_id: str,
        result: dict[str, Any],
    ) -> Any:
        if tool_id != "tool.fs.read":
            return result
        image = self._extract_read_image_binary(result)
        if image is None:
            return result
        sanitized_result = self._build_read_image_model_return_value(
            result=result,
            image=image,
        )
        image_label = self._build_read_image_model_label(
            result=sanitized_result,
            image=image,
        )
        return ToolReturn(
            return_value=sanitized_result,
            content=[image_label, image],
            metadata={
                "toolId": tool_id,
                "imageIdentifier": image.identifier,
                "mediaType": image.media_type,
                "byteLength": len(image.data),
            },
        )

    def _extract_read_image_binary(self, result: Mapping[str, Any]) -> BinaryImage | None:
        if result.get("status") != "success":
            return None
        output = result.get("output")
        if not isinstance(output, Mapping):
            return None
        data = output.get("data")
        if not isinstance(data, Mapping) or data.get("kind") != "image":
            return None
        content = data.get("content")
        if not isinstance(content, Mapping):
            return None
        image_payload = content.get("image")
        if not isinstance(image_payload, Mapping):
            return None
        data_base64 = image_payload.get("dataBase64")
        if not isinstance(data_base64, str) or data_base64.strip() == "":
            return None
        media_type = image_payload.get("mediaType") or content.get("mimeType")
        if not isinstance(media_type, str) or media_type.strip() == "":
            return None
        try:
            raw = base64.b64decode(data_base64, validate=True)
            return BinaryImage(data=raw, media_type=media_type.strip())
        except (ValueError, binascii.Error):
            return None

    def _build_read_image_model_return_value(
        self,
        *,
        result: Mapping[str, Any],
        image: BinaryImage,
    ) -> dict[str, Any]:
        sanitized = deepcopy(dict(result))
        self._remove_inline_image_base64_fields(sanitized)
        data = sanitized.get("output", {}).get("data")
        if isinstance(data, dict):
            content = data.get("content")
            if isinstance(content, dict):
                image_payload = content.get("image")
                if isinstance(image_payload, dict):
                    image_payload.update(
                        {
                            "source": "pydantic-ai-binary-image",
                            "attachedToModel": True,
                            "identifier": image.identifier,
                            "byteLength": len(image.data),
                        }
                    )
            metadata = data.get("metadata")
            if isinstance(metadata, dict):
                metadata["source"] = "pydantic-ai-binary-image"
                metadata["modelAttachment"] = {
                    "identifier": image.identifier,
                    "mediaType": image.media_type,
                    "byteLength": len(image.data),
                }
        return sanitized

    def _remove_inline_image_base64_fields(self, value: Any) -> None:
        if isinstance(value, dict):
            for key in list(value.keys()):
                if key == "dataBase64":
                    value.pop(key, None)
                    continue
                self._remove_inline_image_base64_fields(value[key])
        elif isinstance(value, list):
            for item in value:
                self._remove_inline_image_base64_fields(item)

    def _build_read_image_model_label(
        self,
        *,
        result: Mapping[str, Any],
        image: BinaryImage,
    ) -> str:
        output = result.get("output")
        data = output.get("data") if isinstance(output, Mapping) else None
        path_payload = data.get("path") if isinstance(data, Mapping) else None
        path = None
        if isinstance(path_payload, Mapping):
            path = path_payload.get("path") or path_payload.get("resolvedPath")
        path_text = str(path).strip() if path is not None else ""
        source = f" from {path_text}" if path_text else ""
        return (
            f"tool.fs.read attached image{source} "
            f"({image.media_type}, {len(image.data)} bytes). "
            "Use the attached image content directly for visual understanding."
        )

    def _compose_system_prompt(self, skill_system_prompt: str | None) -> str:
        context = PromptContext(
            current_month_year=datetime.now(UTC).strftime("%Y年%m月"),
        )
        parts = [
            DEFAULT_AGENT_SYSTEM_PROMPT,
            context.inject(TOOL_SELECTION_GUIDE),
            context.inject(SHARED_CONVENTIONS),
        ]
        if skill_system_prompt and skill_system_prompt.strip():
            parts.append(skill_system_prompt.strip())
        return "\n\n".join(parts)

    def _build_stream_model(self, model_route: ResolvedRuntimeModelRoute) -> Any:
        try:
            return self.provider_adapter_registry.build_stream_model(
                model_route=model_route
            )
        except RuntimeProviderAdapterError as exc:
            raise ProviderAdapterExecutionError(
                code=exc.code,
                message=str(exc),
                details=exc.details,
            ) from exc

    def _register_weather_tool(
        self, agent: Agent[Any, Any], enabled_tools: Sequence[str] | None
    ) -> None:
        try:
            tool = self._tool_registry.resolve_tool(WEATHER_CURRENT_TOOL_ID)
        except LookupError:
            return
        if enabled_tools is not None and WEATHER_CURRENT_TOOL_ID not in frozenset(
            enabled_tools
        ):
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
        enabled_tool_ids = sorted(ctx.deps.enabled_tool_ids)
        (
            tool_call_id,
            normalized_arguments,
            input_summary,
            approval_input_summary,
        ) = self._prepare_bound_tool_execution(
            ctx,
            tool_id=tool_id,
            arguments=arguments,
            enabled_tool_ids=enabled_tool_ids,
        )
        tool, failure_result = self._resolve_bound_tool(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            input_summary=input_summary,
        )
        if failure_result is not None:
            return failure_result
        if tool is None:
            raise RuntimeError(
                "Bound tool resolution returned no tool without a failure result."
            )

        display_name = tool.descriptor.display_name or tool_id
        self._emit_started_bound_tool_event(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            arguments=normalized_arguments,
            display_name=display_name,
            input_summary=input_summary,
        )

        disabled_result = self._reject_disabled_bound_tool(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            input_summary=input_summary,
        )
        if disabled_result is not None:
            return disabled_result

        gate_result = await self._await_tool_approval_if_needed(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            input_summary=approval_input_summary,
        )
        if gate_result is not None:
            return gate_result

        executed, result = await self._execute_bound_tool_with_runtime_scope(
            ctx,
            tool=tool,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            arguments=normalized_arguments,
            display_name=display_name,
            enabled_tool_ids=enabled_tool_ids,
            input_summary=input_summary,
        )
        if not executed:
            return result

        contract_result = self._maybe_resolve_contract_tool_result(
            ctx,
            tool=tool,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            input_summary=input_summary,
            result=result,
        )
        if contract_result is not None:
            return contract_result

        return self._complete_bound_tool_execution(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            display_name=display_name,
            input_summary=input_summary,
            result=result,
        )

    def _prepare_bound_tool_execution(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        arguments: Mapping[str, Any] | None,
        enabled_tool_ids: Sequence[str],
    ) -> tuple[str, dict[str, Any], str | None, str]:
        tool_call_id = ctx.tool_call_id or f"{tool_id}:call"
        normalized_arguments = {
            key: value
            for key, value in dict(arguments or {}).items()
            if value is not None
        }
        input_summary = summarize_tool_arguments(normalized_arguments)
        approval_input_summary = input_summary or "{}"
        log_runtime_chain_debug(
            "tool.execute_enter",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            enabledToolIds=list(enabled_tool_ids),
            inputSummary=preview_text(input_summary, limit=160),
        )
        self._write_debug_event(
            level=DebugLogLevel.INFO,
            event_name="tool.execution.started",
            message="Tool execution started.",
            run_id=ctx.deps.run_id,
            correlation_id=tool_call_id,
            phase="started",
            summary={
                "toolId": tool_id,
                "toolCallId": tool_call_id,
                "inputSummary": input_summary,
                "enabledToolIds": list(enabled_tool_ids),
                "status": "started",
            },
        )
        return (
            tool_call_id,
            normalized_arguments,
            input_summary,
            approval_input_summary,
        )

    def _resolve_bound_tool(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        input_summary: str | None,
    ) -> tuple[Any | None, dict[str, Any] | None]:
        try:
            return ctx.deps.tool_registry.resolve_tool(tool_id), None
        except LookupError:
            error_message = f"Unknown tool '{tool_id}'."
            return None, self._fail_bound_tool(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具未注册。",
                input_summary=input_summary,
                error_summary=error_message,
                code="tool_not_found",
                message=error_message,
                debug_level=DebugLogLevel.ERROR,
                debug_message="Tool execution failed because tool was not found.",
            )

    def _emit_started_bound_tool_event(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        arguments: Mapping[str, Any],
        display_name: str,
        input_summary: str | None,
    ) -> None:
        started_title, started_summary = self._build_started_copy(
            tool_id=tool_id,
            arguments=arguments,
            display_name=display_name,
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

    def _reject_disabled_bound_tool(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        input_summary: str | None,
    ) -> dict[str, Any] | None:
        if tool_id in ctx.deps.enabled_tool_ids:
            return None
        error_message = f"Tool '{tool_id}' is not enabled for this run."
        return self._fail_bound_tool(
            ctx,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            summary="当前运行未启用该工具。",
            input_summary=input_summary,
            error_summary=error_message,
            code="tool_not_enabled",
            message=error_message,
            debug_level=DebugLogLevel.WARN,
            debug_message="Tool execution rejected because tool was not enabled.",
        )

    async def _execute_bound_tool_with_runtime_scope(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool: Any,
        tool_id: str,
        tool_call_id: str,
        arguments: Mapping[str, Any],
        display_name: str,
        enabled_tool_ids: Sequence[str],
        input_summary: str | None,
    ) -> tuple[bool, dict[str, Any]]:
        execution_context = self._build_bound_tool_execution_context(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            display_name=display_name,
            enabled_tool_ids=enabled_tool_ids,
        )
        try:
            with runtime_tool_execution_scope(execution_context):
                return True, await tool.execute(arguments)
        except RuntimeExecutableToolError as exc:
            return False, self._fail_bound_tool(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=exc.message,
                code=exc.code,
                message=exc.message,
                details=exc.details,
                debug_level=DebugLogLevel.ERROR,
                debug_message="Tool execution raised a runtime tool error.",
                error=exc,
            )
        except Exception as exc:
            error_message = f"Tool '{tool_id}' failed: {exc}"
            return False, self._fail_bound_tool(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=str(exc),
                code="tool_execution_failed",
                message=error_message,
                details={"exceptionType": type(exc).__name__},
                debug_level=DebugLogLevel.ERROR,
                debug_message="Tool execution raised an unexpected exception.",
                error=exc,
            )

    def _build_bound_tool_execution_context(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        display_name: str,
        enabled_tool_ids: Sequence[str],
    ) -> RuntimeToolExecutionContext:
        metadata: dict[str, Any] = {
            "displayName": display_name,
            "enabledToolIds": list(enabled_tool_ids),
            "fileSystemState": self._build_bound_tool_file_system_state(ctx),
            "skillRuntime": self._build_bound_tool_skill_runtime_state(ctx, tool_id),
        }
        runtime_paths = self._build_bound_tool_runtime_paths_state(ctx)
        if runtime_paths:
            metadata["runtimePaths"] = runtime_paths
        resolved_model_route = getattr(ctx.deps, "resolved_model_route", None)
        if isinstance(resolved_model_route, Mapping):
            metadata["resolvedModelRoute"] = dict(resolved_model_route)
        return RuntimeToolExecutionContext(
            tool_call_id=tool_call_id,
            run_id=ctx.deps.run_id,
            actor="agent",
            requested_at=datetime.now(UTC),
            trace={"toolCallId": tool_call_id, "toolId": tool_id},
            metadata=metadata,
        )

    def _build_bound_tool_file_system_state(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
    ) -> dict[str, Any]:
        workspace_root = getattr(ctx.deps, "workspace_root", None)
        default_root = getattr(ctx.deps, "default_root", workspace_root)
        file_system_state: dict[str, Any] = {}
        if isinstance(workspace_root, str) and workspace_root.strip() != "":
            file_system_state["workspaceRoot"] = workspace_root
        if isinstance(default_root, str) and default_root.strip() != "":
            file_system_state["defaultRoot"] = default_root
        return file_system_state

    def _build_bound_tool_runtime_paths_state(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
    ) -> dict[str, Any]:
        user_data_dir = getattr(ctx.deps, "user_data_dir", None)
        runtime_paths: dict[str, Any] = {}
        if isinstance(user_data_dir, str) and user_data_dir.strip() != "":
            runtime_paths["userDataDir"] = user_data_dir
        return runtime_paths

    def _build_bound_tool_skill_runtime_state(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        tool_id: str,
    ) -> dict[str, Any]:
        if tool_id not in {SKILL_ACTIVATE_TOOL_ID, SKILL_READ_RESOURCE_TOOL_ID}:
            return {}
        skill_runtime_index = getattr(ctx.deps, "skill_runtime_index", None)
        if skill_runtime_index is None or not skill_runtime_index.has_available_skills:
            return {}
        return {"index": skill_runtime_index}

    def _maybe_resolve_contract_tool_result(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool: Any,
        tool_id: str,
        tool_call_id: str,
        input_summary: str | None,
        result: dict[str, Any],
    ) -> dict[str, Any] | None:
        if tool.descriptor.kind not in {CONTRACT_RUNTIME_TOOL_KIND, "mcp"}:
            return None
        status = result.get("status")
        if status not in {"success", "error"}:
            error_message = (
                f"Contract tool '{tool_id}' returned an invalid status: {status!r}."
            )
            return self._fail_bound_tool(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=error_message,
                code="tool_execution_failed",
                message=error_message,
                details={"integrity": "invalid_status", "status": status},
                debug_level=DebugLogLevel.ERROR,
                debug_message="Tool execution returned an invalid contract status.",
            )
        if status != "error":
            return None
        return self._handle_contract_tool_error_result(
            ctx,
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            input_summary=input_summary,
            result=result,
        )

    def _handle_contract_tool_error_result(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        input_summary: str | None,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        error_payload = result.get("error")
        error_code = (
            error_payload.get("code") if isinstance(error_payload, Mapping) else None
        )
        if not isinstance(error_code, str) or error_code.strip() == "":
            integrity_message = (
                "Contract tool returned an error result without a valid error code."
            )
            return self._fail_bound_tool(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=integrity_message,
                code="tool_execution_failed",
                message=integrity_message,
                details={"integrity": "invalid_error_code"},
                retryable=False,
                debug_level=DebugLogLevel.ERROR,
                debug_message="Tool execution returned an invalid contract error code.",
            )
        error_message = (
            error_payload.get("message") if isinstance(error_payload, Mapping) else None
        )
        if not isinstance(error_message, str) or error_message.strip() == "":
            integrity_message = (
                "Contract tool returned an error result without a valid error message."
            )
            return self._fail_bound_tool(
                ctx,
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                summary="工具执行失败。",
                input_summary=input_summary,
                error_summary=integrity_message,
                code="tool_execution_failed",
                message=integrity_message,
                details={"integrity": "invalid_error_message"},
                debug_level=DebugLogLevel.ERROR,
                debug_message=(
                    "Tool execution returned an invalid contract error message."
                ),
            )
        normalized_error_message = error_message.strip()
        self._report_failed_bound_tool(
            ctx,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            summary="工具执行失败。",
            input_summary=input_summary,
            error_summary=normalized_error_message,
            debug_level=DebugLogLevel.WARN,
            debug_message="Tool execution returned a contract error result.",
        )
        return result

    def _complete_bound_tool_execution(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        tool_call_id: str,
        display_name: str,
        input_summary: str | None,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        self._apply_bound_tool_side_effects(
            ctx,
            tool_id=tool_id,
            result=result,
        )
        result_summary = (
            "表单请求已发送，等待用户提交。"
            if tool_id == REQUEST_USER_FORM_TOOL_ID
            else summarize_tool_result(result, tool_id=tool_id)
        )
        result_payload = _sanitize_tool_result_for_display(tool_id, result)
        form_request = (
            result.get("formRequest")
            if isinstance(result.get("formRequest"), Mapping)
            else None
        )
        completed_title = self._build_completed_title(
            tool_id=tool_id,
            display_name=display_name,
        )
        awaiting_user_input_error = (
            None
            if tool_id != REQUEST_USER_FORM_TOOL_ID or form_request is None
            else AwaitingUserInputError(
                tool_id=tool_id,
                tool_call_id=tool_call_id,
                form_request=form_request,
                summary=result_payload,
            )
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
                form_request=None if form_request is None else dict(form_request),
            ),
        )
        self._write_debug_event(
            level=DebugLogLevel.INFO,
            event_name="tool.execution.completed",
            message="Tool execution completed.",
            run_id=ctx.deps.run_id,
            correlation_id=tool_call_id,
            phase="completed",
            summary={
                "toolId": tool_id,
                "toolCallId": tool_call_id,
                "inputSummary": input_summary,
                "resultSummary": result_summary,
                "status": "succeeded",
            },
        )
        if awaiting_user_input_error is not None:
            raise awaiting_user_input_error
        return result

    def _apply_bound_tool_side_effects(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_id: str,
        result: dict[str, Any],
    ) -> None:
        if tool_id != "tool.fs.switch_root":
            return
        current_root = result.get("output", {}).get("data", {}).get("currentRoot")
        if isinstance(current_root, str) and current_root.strip() != "":
            ctx.deps.default_root = current_root.strip()

    def _report_failed_bound_tool(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_call_id: str,
        tool_id: str,
        summary: str,
        input_summary: str | None,
        error_summary: str,
        debug_level: DebugLogLevel,
        debug_message: str,
        error: BaseException | None = None,
    ) -> None:
        self._emit_failed_tool_event(
            ctx,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            summary=summary,
            input_summary=input_summary,
            error_summary=error_summary,
        )
        self._write_debug_event(
            level=debug_level,
            event_name="tool.execution.failed",
            message=debug_message,
            run_id=ctx.deps.run_id,
            correlation_id=tool_call_id,
            phase="failed",
            summary={
                "toolId": tool_id,
                "toolCallId": tool_call_id,
                "inputSummary": input_summary,
                "errorSummary": error_summary,
                "status": "failed",
            },
            error=error,
        )

    def _fail_bound_tool(
        self,
        ctx: RunContext[_PydanticAIAgentRunDeps],
        *,
        tool_call_id: str,
        tool_id: str,
        summary: str,
        input_summary: str | None,
        error_summary: str,
        code: str,
        message: str,
        details: Mapping[str, Any] | None = None,
        retryable: bool | None = None,
        debug_level: DebugLogLevel,
        debug_message: str,
        error: BaseException | None = None,
    ) -> dict[str, Any]:
        self._report_failed_bound_tool(
            ctx,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            summary=summary,
            input_summary=input_summary,
            error_summary=error_summary,
            debug_level=debug_level,
            debug_message=debug_message,
            error=error,
        )
        return self._build_tool_failure_result(
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            code=code,
            message=message,
            details=details,
            retryable=retryable,
        )

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
        timeout_seconds = ctx.deps.tool_permission_resolver.resolve_timeout_seconds(
            tool_id
        )
        timeout_action = ctx.deps.tool_permission_resolver.resolve_timeout_action(
            tool_id
        )
        log_runtime_chain_debug(
            "tool.approval_gate.enter",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            mode=mode,
            timeoutSeconds=timeout_seconds,
            timeoutAction=timeout_action,
        )
        request, _future = ctx.deps.approval_coordinator.create_request(
            run_id=ctx.deps.run_id or "run-unknown",
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            mode=mode,
            input_summary=input_summary,
            timeout_seconds=timeout_seconds if mode == "delay" else None,
            timeout_action=timeout_action if mode == "delay" else None,
            debug_enabled=ctx.deps.debug_enabled,
        )
        log_runtime_chain_debug(
            "tool.approval_gate.request_created",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            request=request.to_payload(),
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
        log_runtime_chain_debug(
            "tool.approval_gate.resolution_received",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            resolution=resolution.to_payload(),
        )
        if resolution.decision == "approved":
            log_runtime_chain_debug(
                "tool.approval_gate.resume_execution",
                enabled=ctx.deps.debug_enabled,
                runId=ctx.deps.run_id,
                toolCallId=tool_call_id,
                toolId=tool_id,
                source=resolution.source,
                status=resolution.status,
            )
            return None
        rejection_message = self._build_rejection_message(resolution)
        log_runtime_chain_debug(
            "tool.approval_gate.reject_execution",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            source=resolution.source,
            status=resolution.status,
            rejectionMessage=rejection_message,
        )
        self._emit_failed_tool_event(
            ctx,
            tool_call_id=tool_call_id,
            tool_id=tool_id,
            summary="工具调用被拒绝。",
            input_summary=input_summary,
            error_summary=rejection_message,
        )
        return self._build_tool_failure_result(
            tool_id=tool_id,
            tool_call_id=tool_call_id,
            code="tool_approval_rejected",
            message=rejection_message,
            details={
                "decision": resolution.decision,
                "source": resolution.source,
                "mode": resolution.mode,
            },
            retryable=False,
        )

    def _build_rejection_message(
        self, resolution: RuntimeToolApprovalResolution
    ) -> str:
        if resolution.source == "timeout":
            return "Tool approval timed out and was automatically rejected."
        return "Tool call was rejected by the user."

    def _write_debug_event(
        self,
        *,
        level: DebugLogLevel,
        event_name: str,
        message: str,
        run_id: str | None,
        correlation_id: str | None,
        phase: str,
        summary: Mapping[str, Any],
        error: BaseException | None = None,
    ) -> None:
        if self._debug_event_logger is None:
            return
        self._debug_event_logger.write(
            category=DebugLogCategory.TOOL,
            level=level,
            event_name=event_name,
            message=message,
            component="copilot_runtime.agent",
            operation="execute_bound_tool",
            phase=phase,
            run_id=run_id,
            correlation_id=correlation_id,
            summary=summary,
            error=error,
        )

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
        resolved_retryable = (
            normalized_code in _RETRYABLE_TOOL_ERROR_CODES
            if retryable is None
            else retryable
        )
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
            location = (
                raw_location
                if isinstance(raw_location, str) and raw_location.strip()
                else DEFAULT_WEATHER_LOCATION
            )
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
