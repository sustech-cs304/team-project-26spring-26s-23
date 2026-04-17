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
        self._cached_output: str | None = None
        self._event_queue: asyncio.Queue[RuntimeExecutionEvent | object] = asyncio.Queue()
        self._run_task: asyncio.Task[None] | None = None
        self._run_exception: BaseException | None = None

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
        except BaseException as exc:
            self._run_exception = exc
        finally:
            await self._event_queue.put(_EVENT_STREAM_DONE)

    async def _handle_runtime_events(
        self,
        _run_context: Any,
        events: AsyncIterable[AgentStreamEvent],
    ) -> None:
        async for event in events:
            if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                segment_id = self._event_buffer.event_factory.next_assistant_segment_id()
                self._event_buffer.record_event(
                    self._event_buffer.event_factory.build_assistant_segment_started(segment_id=segment_id)
                )
                self._event_buffer.record_event(
                    self._event_buffer.event_factory.build_assistant_segment_delta(
                        segment_id=segment_id,
                        delta=event.part.content,
                    )
                )
                self._event_buffer.record_event(
                    self._event_buffer.event_factory.build_assistant_segment_completed(segment_id=segment_id)
                )
                self._flush_pending_events_to_queue(reason="assistant_part")
            elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
                segment_id = self._event_buffer.event_factory.next_assistant_segment_id()
                self._event_buffer.record_event(
                    self._event_buffer.event_factory.build_assistant_segment_started(segment_id=segment_id)
                )
                self._event_buffer.record_event(
                    self._event_buffer.event_factory.build_assistant_segment_delta(
                        segment_id=segment_id,
                        delta=event.delta.content_delta,
                    )
                )
                self._event_buffer.record_event(
                    self._event_buffer.event_factory.build_assistant_segment_completed(segment_id=segment_id)
                )
                self._flush_pending_events_to_queue(reason="assistant_delta")

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
        self._model_override = model
        self._env = dict(env or {})
        self._tool_registry = tool_registry or build_default_tool_registry()
        self._workspace_root = str(workspace_root or Path.cwd())
        self._default_root = str(default_root or self._workspace_root)
        self.provider_adapter_registry = provider_adapter_registry or build_default_provider_adapter_registry()
        self._approval_coordinator = approval_coordinator or RuntimeToolApprovalCoordinator()
        self._agent = Agent("test")

    @property
    def model_configured(self) -> bool:
        return self._model_override is not None

    @property
    def model_environment_keys(self) -> tuple[str, ...]:
        return ()

    def resolve_model(self) -> Any:
        if self._model_override is None:
            raise ModelNotConfiguredError("Provide an explicit executor model")
        return self._model_override

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

        deps = _PydanticAIAgentRunDeps(
            tool_registry=self._tool_registry,
            enabled_tool_ids=frozenset(enabled_tool_ids),
            emit_tool_event=emit_tool_event,
            workspace_root=self._workspace_root,
            default_root=self._default_root,
            tool_permission_resolver=tool_permission_resolver or RuntimeToolPermissionResolver(),
            approval_coordinator=self._approval_coordinator,
            run_id=run_id,
            debug_enabled=debug_enabled,
        )
        agent = self._build_runtime_agent(
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
        agent = Agent(resolved_model)
        self._register_weather_tool(agent, enabled_tools)
        return agent

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
        self._emit_tool_event(
            ctx,
            RuntimeToolLifecycleEvent(
                tool_call_id=tool_call_id,
                tool_id=tool_id,
                phase="waiting_approval",
                title="工具等待审批",
                summary="工具调用正在等待审批决议。",
                input_summary=input_summary,
                approval={
                    "mode": request.mode,
                    "timeoutAt": None if request.timeout_at is None else request.timeout_at.isoformat(),
                    "timeoutSeconds": request.timeout_seconds,
                    "timeoutAction": request.timeout_action,
                },
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
        return candidate
