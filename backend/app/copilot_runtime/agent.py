"""PydanticAI-backed default executor implementation for the Copilot runtime."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterable, AsyncIterator, Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Any, Literal, Protocol, cast

from pydantic_ai import Agent
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
    TOOL_CANCELLED_EVENT_TYPE,
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
ToolLifecyclePhase = Literal["started", "completed", "failed", "waiting_approval", "cancelled"]
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


def _coerce_model_settings(model_settings: Mapping[str, Any] | None) -> ModelSettings | None:
    if model_settings is None:
        return None
    normalized = dict(model_settings)
    if len(normalized) == 0:
        return None
    return cast(ModelSettings, normalized)


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


class ToolApprovalSuspensionError(Exception):
    """Raised when a runtime tool call is suspended pending human approval."""

    def __init__(
        self,
        *,
        message: str,
        tool_id: str,
        tool_call_id: str | None = None,
    ) -> None:
        self.tool_id = tool_id
        self.tool_call_id = tool_call_id
        super().__init__(message)


class ProviderAdapterExecutionError(AgentExecutionError):
    """Raised when provider adapter registry cannot build a runtime execution model."""

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
    security_level: str | None = None
    security_approval_method: str | None = None

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
        if self.security_level is not None:
            payload["security"] = {
                "riskLevel": self.security_level,
                "approvalMethod": self.security_approval_method or "button_click"
            }
        return payload


ToolLifecycleSink = Callable[[RuntimeToolLifecycleEvent], None]


def tool_lifecycle_event_to_execution_event(
    tool_event: RuntimeToolLifecycleEvent,
) -> RuntimeExecutionEvent:
    if tool_event.phase == "started":
        event_type: RuntimeExecutionEventType = TOOL_STARTED_EVENT_TYPE
    elif tool_event.phase == "completed":
        event_type = TOOL_COMPLETED_EVENT_TYPE
    elif tool_event.phase == "waiting_approval":
        event_type = TOOL_WAITING_APPROVAL_EVENT_TYPE
    elif tool_event.phase == "cancelled":
        event_type = TOOL_CANCELLED_EVENT_TYPE
    else:
        event_type = TOOL_FAILED_EVENT_TYPE
    return RuntimeExecutionEvent(type=event_type, payload=tool_event.to_payload())


@dataclass(slots=True)
class _PydanticAIAgentRunDeps:
    tool_registry: ToolRegistry
    enabled_tool_ids: frozenset[str]
    emit_tool_event: ToolLifecycleSink
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
        self._function_tool_call_ids: set[str] = set()
        self._function_tool_result_ids: set[str] = set()

    async def __aenter__(self) -> _PydanticAIEventStream:
        if self._run_task is None:
            self._run_task = asyncio.create_task(
                self._run_agent(),
                name=f"copilot-runtime-run:{self._run_id}",
            )
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: Any,
    ) -> bool | None:
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
        log_runtime_chain_debug(
            "collector.stream_opened",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            modelRoute=self._model_route_summary,
            collectorMode="agent_graph",
        )
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
            log_runtime_chain_debug(
                "collector.stream_exception",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                collectorMode="agent_graph",
                error=summarize_exception(self._run_exception),
                observedAssistantTextLength=len(self._event_buffer.observed_assistant_text),
                observedAssistantTextPreview=preview_text(self._event_buffer.observed_assistant_text),
                observedReasoningTextLength=len(self._event_buffer.observed_reasoning_text),
                observedReasoningTextPreview=preview_text(self._event_buffer.observed_reasoning_text),
                rawToolCallObservationCount=self._raw_tool_call_observation_count,
                rawToolCallArgumentsCompletedCount=self._raw_tool_call_arguments_completed_count,
                toolLifecycleEmissionCount=len(self._tool_lifecycle_emitted_ids),
                functionToolCallCount=len(self._function_tool_call_ids),
                functionToolResultCount=len(self._function_tool_result_ids),
            )
            raise self._run_exception
        log_runtime_chain_debug(
            "collector.stream_completed",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            collectorMode="agent_graph",
            totalTextDeltaCount=self._text_delta_index,
            totalReasoningDeltaCount=self._reasoning_delta_index,
            observedAssistantTextLength=len(self._event_buffer.observed_assistant_text),
            observedAssistantTextPreview=preview_text(self._event_buffer.observed_assistant_text),
            observedReasoningTextLength=len(self._event_buffer.observed_reasoning_text),
            observedReasoningTextPreview=preview_text(self._event_buffer.observed_reasoning_text),
            rawToolCallObservationCount=self._raw_tool_call_observation_count,
            rawToolCallArgumentsCompletedCount=self._raw_tool_call_arguments_completed_count,
            toolLifecycleEmissionCount=len(self._tool_lifecycle_emitted_ids),
            functionToolCallCount=len(self._function_tool_call_ids),
            functionToolResultCount=len(self._function_tool_result_ids),
        )

    def record_tool_lifecycle_event(
        self,
        tool_event: RuntimeToolLifecycleEvent,
    ) -> None:
        self._tool_lifecycle_emitted_ids.add(tool_event.tool_call_id)
        self._event_buffer.record_event(tool_lifecycle_event_to_execution_event(tool_event))
        self._flush_pending_events_to_queue(
            reason=f"tool_lifecycle_{tool_event.phase}"
        )

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
                raise AgentExecutionError("PydanticAI agent returned a non-text output.")
            if output.strip() == "":
                raise AgentExecutionError("PydanticAI agent returned an empty text response.")
            self._cached_output = output
            self._raise_if_raw_tool_call_left_unexecuted()
        except asyncio.CancelledError as exc:
            self._run_exception = exc
            raise
        except ToolApprovalSuspensionError as exc:
            self._suspension_state = True
            import json
            self._cached_output = json.dumps({"tool_calls": list(self._function_tool_call_ids)})
        except Exception as exc:
            self._run_exception = exc
        finally:
            if not getattr(self, "_suspension_state", False):
                self._event_buffer.finish_assistant_segment()
            self._event_buffer.finish_reasoning_segment()
            self._flush_pending_events_to_queue(reason="run_finished")
            self._event_queue.put_nowait(_EVENT_STREAM_DONE)

    async def _handle_runtime_events(
        self,
        _ctx: RunContext[_PydanticAIAgentRunDeps],
        stream: AsyncIterable[AgentStreamEvent],
    ) -> None:
        async for runtime_event in stream:
            self._process_runtime_stream_event(runtime_event)
            self._flush_pending_events_to_queue(
                reason=f"after_runtime_{self._raw_event_reason(runtime_event)}"
            )

    def _process_runtime_stream_event(self, runtime_event: Any) -> None:
        if isinstance(runtime_event, (PartStartEvent, PartDeltaEvent, FinalResultEvent)):
            self._process_raw_stream_event(runtime_event)
            return
        if isinstance(runtime_event, FunctionToolCallEvent):
            self._function_tool_call_ids.add(runtime_event.tool_call_id)
            log_runtime_chain_debug(
                "collector.function_tool_call",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                toolCallId=runtime_event.tool_call_id,
                toolName=runtime_event.part.tool_name,
                argsValid=runtime_event.args_valid,
                argumentsPreview=self._tool_call_arguments_preview(runtime_event.part.args),
            )
            return
        if isinstance(runtime_event, FunctionToolResultEvent):
            self._function_tool_result_ids.add(runtime_event.tool_call_id)
            log_runtime_chain_debug(
                "collector.function_tool_result",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                toolCallId=runtime_event.tool_call_id,
                resultKind=getattr(
                    runtime_event.result,
                    "part_kind",
                    type(runtime_event.result).__name__,
                ),
                contentPreview=preview_text(getattr(runtime_event, "content", None)),
            )
            return
        log_runtime_chain_debug(
            "collector.runtime_event_ignored",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            eventKind=getattr(runtime_event, "event_kind", type(runtime_event).__name__),
        )

    def _flush_pending_events_to_queue(self, *, reason: str) -> None:
        for event in self._drain_events(reason=reason):
            self._event_queue.put_nowait(event)

    def _raise_if_raw_tool_call_left_unexecuted(self) -> None:
        pending_states = [
            state
            for state in self._observed_tool_calls.values()
            if state.arguments_completed_emitted
            and state.tool_call_id is not None
            and state.tool_call_id not in self._tool_lifecycle_emitted_ids
        ]
        if not pending_states:
            return
        for state in pending_states:
            parsed_arguments = self._parse_tool_call_arguments(state.args)
            details: dict[str, Any] = {
                "source": "pydantic_raw_stream",
                "providerEndpointType": self._model_route_summary.get("endpointType"),
                "observationKind": "execution_missing",
                "partIndex": state.part_index,
                "toolCallId": state.tool_call_id,
                "toolName": state.tool_name,
                "argumentsComplete": True,
            }
            if parsed_arguments is not None:
                details["toolArguments"] = parsed_arguments
            elif isinstance(state.args, dict):
                details["toolArguments"] = dict(state.args)
            elif isinstance(state.args, str) and state.args.strip() != "":
                details["toolArgumentsJson"] = state.args
            self._event_buffer.record_event(
                self._event_buffer.event_factory.build_diagnostic(
                    code="raw_tool_call_unexecuted",
                    message="Provider tool call arguments became complete, but no actual tool execution followed.",
                    details=details,
                    stage="drive_raw_tool_call",
                )
            )
        raise AgentExecutionError(
            "Observed provider tool call arguments became complete, but no actual tool execution followed."
        )

    def _require_run_task(self) -> asyncio.Task[None]:
        if self._run_task is None:
            raise RuntimeError("PydanticAI event stream has not been entered.")
        return self._run_task

    async def _iter_raw_events(
        self,
        *,
        result: StreamedRunResult[Any, Any],
        raw_stream: AsyncIterator[Any],
    ) -> AsyncIterator[RuntimeExecutionEvent]:
        try:
            for event in self._drain_events(reason="pre_stream"):
                yield event
            async for raw_event in raw_stream:
                self._process_raw_stream_event(raw_event)
                for event in self._drain_events(
                    reason=f"after_raw_{self._raw_event_reason(raw_event)}"
                ):
                    yield event
            self._cached_output = await self._read_output(result)
            for event in self._drain_events(reason="after_raw_stream_output"):
                yield event
        except Exception as exc:
            log_runtime_chain_debug(
                "collector.stream_exception",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                collectorMode="raw",
                error=summarize_exception(exc),
                observedAssistantTextLength=len(self._event_buffer.observed_assistant_text),
                observedAssistantTextPreview=preview_text(self._event_buffer.observed_assistant_text),
                rawToolCallObservationCount=self._raw_tool_call_observation_count,
                rawToolCallArgumentsCompletedCount=self._raw_tool_call_arguments_completed_count,
            )
            self._event_buffer.finish_assistant_segment()
            for event in self._drain_events(reason="exception_finish_segment"):
                yield event
            raise

        self._event_buffer.finish_assistant_segment()
        for event in self._drain_events(reason="stream_completed"):
            yield event
        log_runtime_chain_debug(
            "collector.stream_completed",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            collectorMode="raw",
            totalTextDeltaCount=self._text_delta_index,
            observedAssistantTextLength=len(self._event_buffer.observed_assistant_text),
            observedAssistantTextPreview=preview_text(self._event_buffer.observed_assistant_text),
            rawToolCallObservationCount=self._raw_tool_call_observation_count,
            rawToolCallArgumentsCompletedCount=self._raw_tool_call_arguments_completed_count,
        )

    async def _iter_text_events(
        self,
        *,
        result: StreamedRunResult[Any, Any],
    ) -> AsyncIterator[RuntimeExecutionEvent]:
        try:
            for event in self._drain_events(reason="pre_stream"):
                yield event
            async for delta in result.stream_text(delta=True, debounce_by=None):
                for event in self._drain_events(reason="before_text_delta"):
                    yield event
                if delta == "":
                    log_runtime_chain_debug(
                        "collector.empty_text_delta",
                        enabled=self._debug_enabled,
                        runId=self._run_id,
                        resolvedModelId=self.resolved_model_id,
                        collectorMode="text_fallback",
                    )
                else:
                    self._record_text_delta(
                        delta,
                        part_index=None,
                        source_event_kind="stream_text",
                    )
                for event in self._drain_events(reason="after_text_delta"):
                    yield event
        except Exception as exc:
            log_runtime_chain_debug(
                "collector.stream_exception",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                collectorMode="text_fallback",
                error=summarize_exception(exc),
                observedAssistantTextLength=len(self._event_buffer.observed_assistant_text),
                observedAssistantTextPreview=preview_text(self._event_buffer.observed_assistant_text),
            )
            self._event_buffer.finish_assistant_segment()
            for event in self._drain_events(reason="exception_finish_segment"):
                yield event
            raise

        self._event_buffer.finish_assistant_segment()
        for event in self._drain_events(reason="stream_completed"):
            yield event
        log_runtime_chain_debug(
            "collector.stream_completed",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            collectorMode="text_fallback",
            totalTextDeltaCount=self._text_delta_index,
            observedAssistantTextLength=len(self._event_buffer.observed_assistant_text),
            observedAssistantTextPreview=preview_text(self._event_buffer.observed_assistant_text),
        )

    def _process_raw_stream_event(self, raw_event: Any) -> None:
        log_runtime_chain_debug(
            "collector.raw_event",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            rawEvent=self._summarize_raw_event(raw_event),
        )
        if isinstance(raw_event, PartStartEvent):
            self._handle_part_start(raw_event)
            return
        if isinstance(raw_event, PartDeltaEvent):
            self._handle_part_delta(raw_event)
            return
        if isinstance(raw_event, FinalResultEvent):
            log_runtime_chain_debug(
                "collector.final_result_event",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                toolName=raw_event.tool_name,
                toolCallId=raw_event.tool_call_id,
            )

    def _handle_part_start(self, raw_event: PartStartEvent) -> None:
        part = raw_event.part
        if isinstance(part, TextPart):
            self._record_text_delta(
                part.content,
                part_index=raw_event.index,
                source_event_kind=raw_event.event_kind,
            )
            return
        if isinstance(part, ThinkingPart):
            self._record_reasoning_delta(
                part.content,
                part_index=raw_event.index,
                source_event_kind=raw_event.event_kind,
            )
            return
        if isinstance(part, ToolCallPart):
            state = self._observed_tool_calls.get(raw_event.index)
            if state is None:
                state = _ObservedToolCall(part_index=raw_event.index)
            state.tool_name = part.tool_name or state.tool_name
            state.tool_call_id = part.tool_call_id or state.tool_call_id
            if part.args is not None:
                state.args = part.args
            self._observed_tool_calls[raw_event.index] = state
            self._emit_tool_call_observation_if_needed(
                state=state,
                observation_source=raw_event.event_kind,
            )

    def _handle_part_delta(self, raw_event: PartDeltaEvent) -> None:
        delta = raw_event.delta
        if isinstance(delta, TextPartDelta):
            self._record_text_delta(
                delta.content_delta,
                part_index=raw_event.index,
                source_event_kind=raw_event.event_kind,
            )
            return
        if isinstance(delta, ThinkingPartDelta):
            self._record_reasoning_delta(
                delta.content_delta,
                part_index=raw_event.index,
                source_event_kind=raw_event.event_kind,
            )
            return
        if isinstance(delta, ToolCallPartDelta):
            state = self._observed_tool_calls.get(raw_event.index)
            if state is None:
                state = _ObservedToolCall(part_index=raw_event.index)
            if delta.tool_name_delta:
                state.tool_name = f"{state.tool_name or ''}{delta.tool_name_delta}"
            if delta.tool_call_id:
                state.tool_call_id = delta.tool_call_id
            if delta.args_delta is not None:
                state.args = self._merge_tool_call_arguments(
                    current=state.args,
                    update=delta.args_delta,
                )
            self._observed_tool_calls[raw_event.index] = state
            self._emit_tool_call_observation_if_needed(
                state=state,
                observation_source=raw_event.event_kind,
            )

    def _record_text_delta(
        self,
        delta: str,
        *,
        part_index: int | None,
        source_event_kind: str,
    ) -> None:
        if delta == "":
            log_runtime_chain_debug(
                "collector.empty_text_delta",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                collectorMode="raw" if part_index is not None else "text_fallback",
                partIndex=part_index,
                rawEventKind=source_event_kind,
            )
            return
        self._text_delta_index += 1
        log_runtime_chain_debug(
            "collector.text_delta",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            collectorMode="raw" if part_index is not None else "text_fallback",
            rawEventKind=source_event_kind,
            partIndex=part_index,
            deltaIndex=self._text_delta_index,
            deltaLength=len(delta),
            deltaPreview=preview_text(delta),
        )
        self._event_buffer.record_assistant_delta(delta)

    def _record_reasoning_delta(
        self,
        delta: str | None,
        *,
        part_index: int | None,
        source_event_kind: str,
    ) -> None:
        if delta in (None, ""):
            log_runtime_chain_debug(
                "collector.empty_reasoning_delta",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                collectorMode="raw",
                partIndex=part_index,
                rawEventKind=source_event_kind,
            )
            return
        self._reasoning_delta_index += 1
        log_runtime_chain_debug(
            "collector.reasoning_delta",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            collectorMode="raw",
            rawEventKind=source_event_kind,
            partIndex=part_index,
            deltaIndex=self._reasoning_delta_index,
            deltaLength=len(delta),
            deltaPreview=preview_text(delta),
        )
        self._event_buffer.record_reasoning_delta(delta)

    def _emit_tool_call_observation_if_needed(
        self,
        *,
        state: _ObservedToolCall,
        observation_source: str,
    ) -> None:
        parsed_arguments = self._parse_tool_call_arguments(state.args)
        arguments_complete = parsed_arguments is not None or isinstance(state.args, dict)
        log_runtime_chain_debug(
            "collector.tool_call_chunk",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            partIndex=state.part_index,
            observationSource=observation_source,
            toolCallId=state.tool_call_id,
            toolName=state.tool_name,
            argumentsComplete=arguments_complete,
            argumentsPreview=self._tool_call_arguments_preview(state.args),
        )
        if not state.observation_emitted and self._is_tool_call_identified(state):
            self._emit_tool_call_diagnostic(
                state=state,
                observation_kind="observed",
                parsed_arguments=parsed_arguments,
            )
            state.observation_emitted = True
            self._raw_tool_call_observation_count += 1
            if arguments_complete:
                state.arguments_completed_emitted = True
                self._raw_tool_call_arguments_completed_count += 1
            return
        if state.observation_emitted and not state.arguments_completed_emitted and arguments_complete:
            self._emit_tool_call_diagnostic(
                state=state,
                observation_kind="arguments_completed",
                parsed_arguments=parsed_arguments,
            )
            state.arguments_completed_emitted = True
            self._raw_tool_call_arguments_completed_count += 1

    def _emit_tool_call_diagnostic(
        self,
        *,
        state: _ObservedToolCall,
        observation_kind: str,
        parsed_arguments: dict[str, Any] | None,
    ) -> None:
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
        self._event_buffer.record_event(
            self._event_buffer.event_factory.build_diagnostic(
                code=(
                    "raw_tool_call_observed"
                    if observation_kind == "observed"
                    else "raw_tool_call_arguments_completed"
                ),
                message=(
                    "Observed provider tool call in raw collector."
                    if observation_kind == "observed"
                    else "Provider tool call arguments became complete in raw collector."
                ),
                details=details,
                stage="collect_raw_stream",
            )
        )

    def _resolve_raw_stream(
        self,
        result: StreamedRunResult[Any, Any],
    ) -> AsyncIterator[Any] | None:
        endpoint_type = str(self._model_route_summary.get("endpointType") or "")
        provider_id = str(
            self._model_route_summary.get("providerId")
            or self._model_route_summary.get("provider")
            or ""
        )
        adapter_id = str(self._model_route_summary.get("adapterId") or "")
        raw_stream = getattr(result, "_stream_response", None)
        if raw_stream is None or not hasattr(raw_stream, "__aiter__"):
            log_runtime_chain_debug(
                "collector.raw_stream_unavailable",
                enabled=self._debug_enabled,
                runId=self._run_id,
                resolvedModelId=self.resolved_model_id,
                reason="missing_stream_response",
                providerId=provider_id,
                adapterId=adapter_id,
                endpointType=endpoint_type,
            )
            return None
        log_runtime_chain_debug(
            "collector.raw_stream_selected",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            providerId=provider_id,
            adapterId=adapter_id,
            endpointType=endpoint_type,
        )
        return cast(AsyncIterator[Any], raw_stream)

    def _raw_event_reason(self, raw_event: Any) -> str:
        return str(getattr(raw_event, "event_kind", type(raw_event).__name__)).replace("-", "_")

    def _summarize_raw_event(self, raw_event: Any) -> dict[str, Any]:
        summary: dict[str, Any] = {
            "eventKind": getattr(raw_event, "event_kind", type(raw_event).__name__),
        }
        part_index = getattr(raw_event, "index", None)
        if part_index is not None:
            summary["partIndex"] = part_index
        previous_part_kind = getattr(raw_event, "previous_part_kind", None)
        if previous_part_kind is not None:
            summary["previousPartKind"] = previous_part_kind
        part = getattr(raw_event, "part", None)
        if isinstance(part, TextPart):
            summary["partKind"] = "text"
            summary["deltaPreview"] = preview_text(part.content)
        elif isinstance(part, ThinkingPart):
            summary["partKind"] = "thinking"
            summary["deltaPreview"] = preview_text(part.content)
        elif isinstance(part, ToolCallPart):
            summary["partKind"] = "tool-call"
            summary["toolCallId"] = part.tool_call_id
            summary["toolName"] = part.tool_name
            summary["argumentsPreview"] = self._tool_call_arguments_preview(part.args)
        delta = getattr(raw_event, "delta", None)
        if isinstance(delta, TextPartDelta):
            summary["deltaKind"] = "text"
            summary["deltaPreview"] = preview_text(delta.content_delta)
        elif isinstance(delta, ThinkingPartDelta):
            summary["deltaKind"] = "thinking"
            summary["deltaPreview"] = preview_text(delta.content_delta)
        elif isinstance(delta, ToolCallPartDelta):
            summary["deltaKind"] = "tool-call"
            if delta.tool_call_id is not None:
                summary["toolCallId"] = delta.tool_call_id
            if delta.tool_name_delta is not None:
                summary["toolNameDelta"] = delta.tool_name_delta
            summary["argumentsPreview"] = self._tool_call_arguments_preview(delta.args_delta)
        if isinstance(raw_event, FinalResultEvent):
            summary["toolCallId"] = raw_event.tool_call_id
            summary["toolName"] = raw_event.tool_name
        return summary

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
        if isinstance(parsed, dict):
            return cast(dict[str, Any], parsed)
        return None

    def _tool_call_arguments_preview(self, value: str | dict[str, Any] | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, dict):
            return preview_text(json.dumps(value, ensure_ascii=False, sort_keys=True))
        return preview_text(value)

    def _is_tool_call_identified(self, state: _ObservedToolCall) -> bool:
        return bool(state.tool_name) and bool(state.tool_call_id)

    def _drain_events(self, *, reason: str) -> tuple[RuntimeExecutionEvent, ...]:
        drained = self._event_buffer.drain()
        log_runtime_chain_debug(
            "collector.execution_drain",
            enabled=self._debug_enabled,
            runId=self._run_id,
            resolvedModelId=self.resolved_model_id,
            reason=reason,
            executionEventTypes=summarize_event_types(drained),
            executionEvents=[
                summarize_runtime_execution_event(event)
                for event in drained
            ],
        )
        return drained

    async def get_output(self) -> str:
        if self._cached_output is not None:
            return self._cached_output
        run_task = self._require_run_task()
        try:
            await run_task
        except asyncio.CancelledError:
            pass
        if self._run_exception is not None:
            raise self._run_exception
        if self._cached_output is None:
            raise AgentExecutionError("PydanticAI event stream did not produce a text output.")
        return self._cached_output

    async def _read_output(self, result: StreamedRunResult[Any, Any]) -> str:
        output = await result.get_output()
        if not isinstance(output, str):
            raise AgentExecutionError("PydanticAI agent returned a non-text output.")
        if output.strip() == "":
            raise AgentExecutionError("PydanticAI agent returned an empty text response.")
        return output

    def _require_stream_result(self) -> StreamedRunResult[Any, Any]:
        if self._stream_result is None:
            raise RuntimeError("PydanticAI event stream has not been entered.")
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
        provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
    ) -> None:
        _ = env
        self.agent_name = agent_name
        self._model_override = model
        self._tool_registry = tool_registry or build_default_tool_registry()
        self._provider_adapter_registry = (
            provider_adapter_registry or build_default_provider_adapter_registry()
        )
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
        return self._resolved_explicit_model() is not None

    @property
    def model_environment_keys(self) -> tuple[str, ...]:
        return ()

    @property
    def provider_adapter_registry(self) -> RuntimeProviderAdapterRegistry:
        return self._provider_adapter_registry

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
    ) -> _PydanticAIEventStream:
        if agent_name != self.agent_name:
            raise AgentExecutionError(f"Unsupported agent '{agent_name}'.")

        _ = dict(request_options or {})
        stream_model = self._resolved_explicit_model()
        if stream_model is None:
            stream_model = self._build_stream_model(model_route)
        resolved_model = self.resolve_model(model_override=stream_model)
        event_buffer = RuntimeExecutionEventBuffer(
            event_factory=RuntimeExecutionEventFactory(run_id=run_id),
            debug_enabled=debug_enabled,
        )
        model_route_summary = summarize_runtime_model_route(model_route)
        log_runtime_chain_debug(
            "collector.stream_created",
            enabled=debug_enabled,
            runId=run_id,
            resolvedModelId=model_route.model_id,
            modelRoute=model_route_summary,
            enabledToolIds=list(enabled_tools),
            userPromptPreview=preview_text(user_prompt),
        )
        stream: _PydanticAIEventStream | None = None

        def emit_tool_event(tool_event: RuntimeToolLifecycleEvent) -> None:
            if stream is None:
                raise RuntimeError("PydanticAI event stream is not initialized.")
            stream.record_tool_lifecycle_event(tool_event)

        deps = self._build_runtime_deps(
            enabled_tools=enabled_tools,
            emit_tool_event=emit_tool_event,
            run_id=run_id,
            debug_enabled=debug_enabled,
        )
        stream = _PydanticAIEventStream(
            run_id=run_id,
            agent=self._agent,
            user_prompt=user_prompt,
            message_history=message_history,
            resolved_model=resolved_model,
            deps=deps,
            resolved_model_id=model_route.model_id,
            event_buffer=event_buffer,
            model_settings=model_settings,
            model_route_summary=model_route_summary,
            debug_enabled=debug_enabled,
        )
        return stream

    def resolve_model(self, *, model_override: Any | None = None) -> Any:
        explicit_model = self._resolved_explicit_model(model_override)
        if explicit_model is not None:
            return explicit_model
        raise ModelNotConfiguredError(
            "No runtime model is configured. Provide an explicit executor model."
        )

    def _build_stream_model(self, model_route: ResolvedRuntimeModelRoute) -> Any:
        try:
            return self._provider_adapter_registry.build_stream_model(
                model_route=model_route
            )
        except RuntimeProviderAdapterError as exc:
            raise ProviderAdapterExecutionError(
                code=exc.code,
                message=str(exc),
                details=exc.details,
            ) from exc

    def _build_runtime_deps(
        self,
        *,
        enabled_tools: Sequence[str],
        emit_tool_event: ToolLifecycleSink,
        run_id: str | None = None,
        debug_enabled: bool = False,
    ) -> _PydanticAIAgentRunDeps:
        return _PydanticAIAgentRunDeps(
            tool_registry=self._tool_registry,
            enabled_tool_ids=frozenset(self._normalize_enabled_tools(enabled_tools)),
            emit_tool_event=emit_tool_event,
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
        log_runtime_chain_debug(
            "tool.execute_enter",
            enabled=ctx.deps.debug_enabled,
            runId=ctx.deps.run_id,
            toolCallId=tool_call_id,
            toolId=tool_id,
            enabledToolIds=sorted(ctx.deps.enabled_tool_ids),
            inputSummary=preview_text(input_summary, limit=160),
        )

        try:
            tool = ctx.deps.tool_registry.resolve_tool(tool_id)
        except LookupError as exc:
            error_message = f"Unknown tool '{tool_id}'."
            self._emit_tool_event(
                ctx,
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="failed",
                    title="工具调用失败",
                    summary="工具未注册。",
                    input_summary=input_summary,
                    error_summary=error_message,
                ),
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
            self._emit_tool_event(
                ctx,
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="failed",
                    title="工具调用失败",
                    summary="当前运行未启用该工具。",
                    input_summary=input_summary,
                    error_summary=error_message,
                ),
            )
            raise ToolInvocationError(
                code="tool_not_enabled",
                message=error_message,
                tool_id=tool_id,
                tool_call_id=tool_call_id,
            )

        # INTERCEPTOR: Check Security Level
        security_config = tool.descriptor.security
        risk_level_value = getattr(security_config.risk_level, "value", security_config.risk_level)
        if risk_level_value in ["medium", "high"]:
            risk_level_label = {"medium": "中危", "high": "高危"}.get(risk_level_value, "需授权")
            self._emit_tool_event(
                ctx,
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="waiting_approval",
                    title=f"等待授权 ({risk_level_label}): {tool.descriptor.display_name or tool_id}",
                    summary=f"此操作被评估为{risk_level_label}，需要用户手动批准验证。",
                    input_summary=input_summary,
                    security_level=risk_level_value,
                    security_approval_method=security_config.approval_method
                ),
            )
            # Stop the execution manually providing a non-failure control signal.
            raise ToolApprovalSuspensionError(
                message="Tool execution suspended, waiting for human in the loop approval.",
                tool_id=tool_id,
                tool_call_id=tool_call_id,
            )

        try:
            result = await tool.execute(normalized_arguments)
        except (ToolInvocationError, ToolApprovalSuspensionError):
            raise
        except Exception as exc:
            error_message = f"Tool '{tool_id}' failed: {exc}"
            log_runtime_chain_debug(
                "tool.execute_exception",
                enabled=ctx.deps.debug_enabled,
                runId=ctx.deps.run_id,
                toolCallId=tool_call_id,
                toolId=tool_id,
                error=summarize_exception(exc),
            )
            self._emit_tool_event(
                ctx,
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=tool_id,
                    phase="failed",
                    title="工具调用失败",
                    summary="工具执行失败。",
                    input_summary=input_summary,
                    error_summary=str(exc),
                ),
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
        self._emit_tool_event(
            ctx,
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="completed",
                title=completed_title,
                summary=completed_summary,
                input_summary=input_summary,
                result_summary=result_summary,
            ),
        )
        return result

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

__all__ = [
    "AgentExecutionError",
    "AgentExecutorFactory",
    "DEFAULT_AGENT_NAME",
    "DEFAULT_AGENT_SYSTEM_PROMPT",
    "ModelNotConfiguredError",
    "PydanticAIAgentExecutor",
    "RuntimeAgentExecutor",
    "RuntimeToolLifecycleEvent",
    "ToolInvocationError",
    "ToolLifecyclePhase",
]
