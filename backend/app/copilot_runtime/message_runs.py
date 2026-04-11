"""Run orchestration for streamed [`run/start`](docs/system/chat-runtime-contract.md:268) execution."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from types import TracebackType
from typing import Any, Protocol, cast
from uuid import uuid4

from pydantic_ai.messages import ModelMessage

from .agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    ProviderAdapterExecutionError,
    ToolInvocationError,
)
from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import (
    RuntimeRunStartRequest,
    RuntimeScaffold,
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
    _build_reasoning_suppression_basis as build_reasoning_suppression_basis,
)
from .debug_logging import (
    is_runtime_chain_debug_enabled,
    log_runtime_chain_debug,
    preview_text,
    summarize_exception,
    summarize_runtime_execution_event,
    summarize_runtime_model_route,
    summarize_runtime_reasoning_suppression_basis,
    summarize_runtime_run_event,
    summarize_runtime_thinking_capability,
    summarize_runtime_thinking_selection_result,
    summarize_runtime_tool_event,
)
from .execution_event_graph import RuntimeExecutionEvent, RuntimeExecutionEventFactory
from .execution_support import (
    AgentNotFoundError,
    InvalidSessionHistoryError,
    ThreadNotFoundError,
    ToolNotFoundError,
    build_message_history,
    extract_unknown_tool_id,
)
from .legacy_event_projection import RuntimeRunEventProjector
from .model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
)
from .provider_adapter_registry import (
    RuntimeProviderAdapterError,
    RuntimeProviderAdapterRegistry,
    build_default_provider_adapter_registry,
)
from .run_events import RuntimeRunEvent, RuntimeRunEventFactory
from .session_store import BoundAgentMismatchError, InMemorySessionStore
from .thinking_adapter import adapt_thinking_selection


class RuntimeAgentExecutionEventStream(Protocol):
    resolved_model_id: str

    async def __aenter__(self) -> "RuntimeAgentExecutionEventStream": ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> bool | None: ...

    def iter_events(self) -> AsyncIterator[RuntimeExecutionEvent]: ...

    async def get_output(self) -> str: ...


class RuntimeStreamingAgentExecutor(Protocol):
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
    ) -> RuntimeAgentExecutionEventStream: ...


class RuntimeMessageRunOrchestrator:
    """Coordinates request-scoped route resolution, streaming execution, and final archival."""

    def __init__(
        self,
        *,
        session_store: InMemorySessionStore,
        agent_registry: AgentRegistry,
        scaffold: RuntimeScaffold,
        model_route_resolver: RuntimeModelRouteResolver,
        provider_adapter_registry: RuntimeProviderAdapterRegistry | None = None,
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry
        self._scaffold = scaffold
        self._model_route_resolver = model_route_resolver
        self._provider_adapter_registry = (
            provider_adapter_registry or build_default_provider_adapter_registry()
        )

    async def stream_events(
        self,
        *,
        request: RuntimeRunStartRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
        run_id: str | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        resolved_run_id = run_id or _next_run_id()
        request_debug_enabled = request.policy.debugModeEnabled
        debug_enabled = (
            is_runtime_chain_debug_enabled()
            if request_debug_enabled is None
            else request_debug_enabled
        )
        assistant_message_id = f"{resolved_run_id}:assistant"
        events = RuntimeRunEventFactory(session_id=request.thread_id, run_id=resolved_run_id)
        projector = RuntimeRunEventProjector(
            events=events,
            assistant_message_id=assistant_message_id,
        )
        execution_events = RuntimeExecutionEventFactory(run_id=resolved_run_id)

        run_started = projector.build_run_started()
        log_runtime_chain_debug(
            "orchestrator.run_started",
            enabled=debug_enabled,
            runId=resolved_run_id,
            threadId=request.thread_id,
            agentId=request.agent_id,
            userPromptPreview=preview_text(request.message.content),
            yieldedEvent=summarize_runtime_run_event(run_started),
        )
        yield run_started

        try:
            thread = self._require_thread(request)
            agent_descriptor = self._resolve_agent(thread.bound_agent_id)
            resolved_tool_ids = self._resolve_enabled_tools(
                agent_id=thread.bound_agent_id,
                enabled_tools=request.policy.enabledTools,
            )
            message_history = build_message_history(
                self._session_store.list_messages(thread.thread_id)
            )
            resolved_model_route = await self._model_route_resolver.resolve(request.policy.modelRoute)
            requested_thinking_selection = request.policy.resolve_thinking_selection()
            thinking_adaptation = adapt_thinking_selection(
                selection=requested_thinking_selection,
                model_route=resolved_model_route,
                thinking_capability_override=request.policy.thinkingCapabilityOverride,
                provider_adapter_registry=self._provider_adapter_registry,
            )
            capability_series = (
                thinking_adaptation.capability.series
                or (
                    requested_thinking_selection.series
                    if requested_thinking_selection is not None
                    else None
                )
                or "compat-discrete-selection-v1"
            )
            applied_thinking_selection = _resolve_applied_thinking_selection(
                requested_selection=requested_thinking_selection,
                requested_canonical_selection=thinking_adaptation.requested_selection,
                applied_canonical_selection=thinking_adaptation.applied_selection,
                capability_series=capability_series,
            )
            selection_result = thinking_adaptation.to_public_dict()
            selection_result_summary = summarize_runtime_thinking_selection_result(selection_result)
            reasoning_suppression_basis = build_reasoning_suppression_basis(
                capability=thinking_adaptation.capability.to_public_dict(),
                applied_selection=applied_thinking_selection,
            )
            reasoning_suppression_basis_summary = summarize_runtime_reasoning_suppression_basis(
                reasoning_suppression_basis
            )
            log_runtime_chain_debug(
                "thinking.capability_resolved",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                requestedThinkingSelection=(
                    None if requested_thinking_selection is None else requested_thinking_selection.to_dict()
                ),
                appliedThinkingSelection=(
                    None if applied_thinking_selection is None else applied_thinking_selection.to_dict()
                ),
                resolvedModelRoute=summarize_runtime_model_route(resolved_model_route),
                overrideInput=request.policy.thinkingCapabilityOverride,
                capability=summarize_runtime_thinking_capability(thinking_adaptation.capability),
                selectionResult=selection_result_summary,
                reasoningSuppressionBasis=reasoning_suppression_basis_summary,
            )
            log_runtime_chain_debug(
                "thinking.request_validated",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                requestedThinkingSelection=(
                    None if requested_thinking_selection is None else requested_thinking_selection.to_dict()
                ),
                appliedThinkingSelection=(
                    None if applied_thinking_selection is None else applied_thinking_selection.to_dict()
                ),
                applied=thinking_adaptation.applied,
                reason=thinking_adaptation.reason,
                capability=summarize_runtime_thinking_capability(thinking_adaptation.capability),
                selectionResult=selection_result_summary,
                reasoningSuppressionBasis=reasoning_suppression_basis_summary,
            )
            log_runtime_chain_debug(
                "thinking.provider_mapping_resolved",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                requestedThinkingSelection=(
                    None if requested_thinking_selection is None else requested_thinking_selection.to_dict()
                ),
                appliedThinkingSelection=(
                    None if applied_thinking_selection is None else applied_thinking_selection.to_dict()
                ),
                providerBuilderKey=thinking_adaptation.provider_builder_key,
                modelSettings=thinking_adaptation.model_settings,
                mappingReasonCode=thinking_adaptation.mapping_reason_code,
                reason=thinking_adaptation.reason,
                capability=summarize_runtime_thinking_capability(thinking_adaptation.capability),
                selectionResult=selection_result_summary,
                reasoningSuppressionBasis=reasoning_suppression_basis_summary,
            )
            run_metadata = projector.build_run_metadata(
                requested_thinking_selection=None
                if requested_thinking_selection is None
                else requested_thinking_selection.to_dict(),
                applied_thinking_selection=None
                if applied_thinking_selection is None
                else applied_thinking_selection.to_dict(),
                thinking_capability_snapshot=thinking_adaptation.capability.to_public_dict(),
                thinking_series_decision=selection_result,
                reasoning_suppression_basis=reasoning_suppression_basis,
            )
            log_runtime_chain_debug(
                "thinking.run_metadata_attached",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                yieldedEvent=summarize_runtime_run_event(run_metadata),
            )
            yield run_metadata
            if requested_thinking_selection is not None and not thinking_adaptation.applied:
                fail_fast_code = (
                    thinking_adaptation.error_code or "thinking_series_not_supported_for_route"
                )
                fail_fast_details = {
                    **thinking_adaptation.diagnostics,
                    "reason": thinking_adaptation.reason,
                }
                log_runtime_chain_debug(
                    "thinking.fail_fast",
                    enabled=debug_enabled,
                    runId=resolved_run_id,
                    threadId=request.thread_id,
                    code=fail_fast_code,
                    requestedThinkingSelection=requested_thinking_selection.to_dict(),
                    appliedThinkingSelection=(
                        None if applied_thinking_selection is None else applied_thinking_selection.to_dict()
                    ),
                    reason=thinking_adaptation.reason,
                    capability=summarize_runtime_thinking_capability(thinking_adaptation.capability),
                    diagnostics=fail_fast_details,
                    selectionResult=selection_result_summary,
                    reasoningSuppressionBasis=reasoning_suppression_basis_summary,
                )
                for event in self._build_failed_execution_events(
                    execution_events=execution_events,
                    code=fail_fast_code,
                    message=_build_thinking_fail_fast_message(
                        code=fail_fast_code,
                        requested_selection=requested_thinking_selection,
                    ),
                    details=fail_fast_details,
                    diagnostic_stage="adapt_thinking",
                ):
                    for projected in projector.project(event):
                        yield projected
                return
            agent_executor = self._build_streaming_executor(agent_descriptor)
            log_runtime_chain_debug(
                "orchestrator.execution_prepared",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                boundAgentId=thread.bound_agent_id,
                enabledToolIds=list(resolved_tool_ids),
                modelRoute=summarize_runtime_model_route(resolved_model_route),
                historyMessageCount=len(message_history),
                executorType=type(agent_executor).__name__,
            )
        except RuntimeModelRouteResolutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code=exc.code,
                message=str(exc),
                details=exc.details,
                diagnostic_stage="resolve_model_route",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except RuntimeProviderAdapterError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
                diagnostic_stage="resolve_thinking_capability",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except ThreadNotFoundError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="thread_not_found",
                message=str(exc),
                details={"threadId": exc.thread_id},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except BoundAgentMismatchError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_mismatch",
                message=str(exc),
                details={
                    "sessionId": exc.session_id,
                    "boundAgentId": exc.expected_agent_id,
                    "requestedAgentId": exc.actual_agent_id,
                },
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except ToolNotFoundError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="tool_not_found",
                message=str(exc),
                details={"toolId": exc.tool_id},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except AgentNotFoundError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_not_found",
                message=str(exc),
                details={"agentName": exc.agent_name},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except InvalidSessionHistoryError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="invalid_message_history",
                message=str(exc),
                details={},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except ModelNotConfiguredError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except AgentExecutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="prepare_execution",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="prepare_execution",
            ):
                for projected in projector.project(event):
                    yield projected
            return

        projector.configure_completion_context(
            resolved_model_route=resolved_model_route,
            resolved_tool_ids=resolved_tool_ids,
            request_options=request.policy.requestOptions,
        )

        assistant_text: str
        try:
            async with self._open_execution_stream(
                agent_executor=agent_executor,
                run_id=resolved_run_id,
                agent_name=thread.bound_agent_id,
                user_prompt=request.message.content,
                message_history=message_history,
                model_route=resolved_model_route,
                enabled_tools=resolved_tool_ids,
                debug_enabled=debug_enabled,
                request_options=request.policy.requestOptions,
                model_settings=thinking_adaptation.model_settings,
            ) as stream:
                log_runtime_chain_debug(
                    "orchestrator.stream_opened",
                    enabled=debug_enabled,
                    runId=resolved_run_id,
                    threadId=request.thread_id,
                    resolvedModelId=stream.resolved_model_id,
                )
                async for event in stream.iter_events():
                    projected_events = projector.project(event)
                    if (
                        event.type == "reasoning_segment_delta"
                        and isinstance(reasoning_suppression_basis_summary, dict)
                        and reasoning_suppression_basis_summary.get("shouldSuppress") is True
                    ):
                        log_runtime_chain_debug(
                            "thinking.reasoning_suppressed",
                            enabled=debug_enabled,
                            runId=resolved_run_id,
                            threadId=request.thread_id,
                            suppressionEnabled=True,
                            suppressionSource=reasoning_suppression_basis_summary.get("source"),
                            suppressionReasonCode=reasoning_suppression_basis_summary.get("reasonCode"),
                            reasoningSuppressionBasis=reasoning_suppression_basis_summary,
                            executionEvent=summarize_runtime_execution_event(event),
                            projectedEventTypes=[projected.type for projected in projected_events],
                        )
                    log_runtime_chain_debug(
                        "orchestrator.execution_event_projected",
                        enabled=debug_enabled,
                        runId=resolved_run_id,
                        threadId=request.thread_id,
                        executionEvent=summarize_runtime_execution_event(event),
                        projectedEventTypes=[projected.type for projected in projected_events],
                        projectedEvents=[
                            summarize_runtime_run_event(projected)
                            for projected in projected_events
                        ],
                    )
                    if len(projected_events) == 0:
                        continue
                    await self._raise_if_client_disconnected(
                        is_client_disconnected,
                        run_id=resolved_run_id,
                        thread_id=request.thread_id,
                    )
                    for projected in projected_events:
                        log_runtime_chain_debug(
                            "orchestrator.yield_projected_event",
                            enabled=debug_enabled,
                            runId=resolved_run_id,
                            threadId=request.thread_id,
                            projectedEvent=summarize_runtime_run_event(projected),
                        )
                        yield projected
                await self._raise_if_client_disconnected(
                    is_client_disconnected,
                    run_id=resolved_run_id,
                    thread_id=request.thread_id,
                )
                assistant_text = await stream.get_output()
                log_runtime_chain_debug(
                    "orchestrator.stream_output",
                    enabled=debug_enabled,
                    runId=resolved_run_id,
                    threadId=request.thread_id,
                    assistantTextLength=len(assistant_text),
                    assistantTextPreview=preview_text(assistant_text),
                )
                await self._raise_if_client_disconnected(
                    is_client_disconnected,
                    run_id=resolved_run_id,
                    thread_id=request.thread_id,
                )
        except asyncio.CancelledError:
            projected_events = projector.project(
                execution_events.build_run_cancelled(reason="cancelled")
            )
            log_runtime_chain_debug(
                "orchestrator.terminal",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                terminalReason="cancelled",
                projectedEventTypes=[projected.type for projected in projected_events],
                projectedEvents=[summarize_runtime_run_event(projected) for projected in projected_events],
            )
            for projected in projected_events:
                yield projected
            return
        except ToolInvocationError as exc:
            projected_events = projector.project(
                execution_events.build_run_failed(
                    code=exc.code,
                    message=str(exc),
                    details=dict(exc.details),
                )
            )
            log_runtime_chain_debug(
                "orchestrator.terminal",
                enabled=debug_enabled,
                runId=resolved_run_id,
                threadId=request.thread_id,
                terminalReason="failed",
                error=summarize_exception(exc),
                projectedEventTypes=[projected.type for projected in projected_events],
                projectedEvents=[summarize_runtime_run_event(projected) for projected in projected_events],
            )
            for projected in projected_events:
                yield projected
            return
        except ModelNotConfiguredError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except ProviderAdapterExecutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
                diagnostic_stage="execute_model",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except AgentExecutionError as exc:
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="execute_model",
            ):
                for projected in projector.project(event):
                    yield projected
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            for event in self._build_failed_execution_events(
                execution_events=execution_events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="execute_model",
            ):
                for projected in projector.project(event):
                    yield projected
            return

        await self._raise_if_client_disconnected(
            is_client_disconnected,
            run_id=resolved_run_id,
            thread_id=request.thread_id,
        )
        projected_events = projector.project(
            execution_events.build_run_completed(assistant_text=assistant_text)
        )
        log_runtime_chain_debug(
            "orchestrator.terminal",
            enabled=debug_enabled,
            runId=resolved_run_id,
            threadId=request.thread_id,
            terminalReason="completed",
            projectedEventTypes=[projected.type for projected in projected_events],
            projectedEvents=[summarize_runtime_run_event(projected) for projected in projected_events],
        )
        for projected in projected_events:
            yield projected

    def _require_thread(self, request: RuntimeRunStartRequest):
        thread = self._session_store.get_thread(request.thread_id)
        if thread is None:
            raise ThreadNotFoundError(request.thread_id)
        if request.agent_id is not None and request.agent_id != thread.bound_agent_id:
            raise BoundAgentMismatchError(
                session_id=thread.thread_id,
                expected_agent_id=thread.bound_agent_id,
                actual_agent_id=request.agent_id,
            )
        return thread

    def _resolve_agent(self, agent_name: str) -> AgentDescriptor:
        descriptor = self._agent_registry.get(agent_name)
        if descriptor is None:
            raise AgentNotFoundError(agent_name)
        return descriptor

    def _build_streaming_executor(self, descriptor: AgentDescriptor) -> Any:
        executor_factory = descriptor.executor_factory
        if executor_factory is None:
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' has no executor factory configured."
            )
        executor = executor_factory()
        if not hasattr(executor, "open_event_stream"):
            raise AgentExecutionError(
                f"Agent '{descriptor.name}' must provide open_event_stream() for streamed execution."
            )
        return executor

    def _open_execution_stream(
        self,
        *,
        agent_executor: Any,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: Sequence[ModelMessage],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...],
        debug_enabled: bool,
        request_options: Mapping[str, Any] | None,
        model_settings: Mapping[str, Any] | None,
    ) -> RuntimeAgentExecutionEventStream:
        open_event_stream = getattr(agent_executor, "open_event_stream", None)
        if not callable(open_event_stream):
            raise AgentExecutionError(
                f"Agent '{agent_name}' must provide open_event_stream() for streamed execution."
            )
        log_runtime_chain_debug(
            "orchestrator.open_execution_stream",
            runId=run_id,
            agentName=agent_name,
            streamKind="event_stream",
            enabledToolIds=list(enabled_tools),
            modelRoute=summarize_runtime_model_route(model_route),
        )
        try:
            stream = open_event_stream(
                run_id=run_id,
                agent_name=agent_name,
                user_prompt=user_prompt,
                message_history=message_history,
                model_route=model_route,
                enabled_tools=enabled_tools,
                debug_enabled=debug_enabled,
                request_options=request_options,
                model_settings=model_settings,
            )
        except TypeError as exc:
            if "model_settings" not in str(exc):
                raise
            stream = open_event_stream(
                run_id=run_id,
                agent_name=agent_name,
                user_prompt=user_prompt,
                message_history=message_history,
                model_route=model_route,
                enabled_tools=enabled_tools,
                debug_enabled=debug_enabled,
                request_options=request_options,
            )
        return cast(RuntimeAgentExecutionEventStream, stream)

    def _resolve_enabled_tools(
        self,
        *,
        agent_id: str,
        enabled_tools: tuple[str, ...],
    ) -> tuple[str, ...]:
        try:
            return self._scaffold.resolve_enabled_tool_ids(
                agent_id=agent_id,
                enabled_tools=enabled_tools,
            )
        except LookupError as exc:
            raise ToolNotFoundError(extract_unknown_tool_id(exc)) from exc

    async def _raise_if_client_disconnected(
        self,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
        *,
        run_id: str,
        thread_id: str,
    ) -> None:
        if await self._is_client_disconnected(is_client_disconnected):
            log_runtime_chain_debug(
                "orchestrator.client_disconnected",
                runId=run_id,
                threadId=thread_id,
            )
            raise asyncio.CancelledError()

    async def _is_client_disconnected(
        self,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> bool:
        if is_client_disconnected is None:
            return False
        return await is_client_disconnected()

    def _build_failed_execution_events(
        self,
        *,
        execution_events: RuntimeExecutionEventFactory,
        code: str,
        message: str,
        details: dict[str, Any],
        diagnostic_stage: str | None = None,
    ) -> tuple[RuntimeExecutionEvent, ...]:
        if diagnostic_stage is None:
            return (
                execution_events.build_run_failed(
                    code=code,
                    message=message,
                    details=details,
                ),
            )
        return (
            execution_events.build_diagnostic(
                code=code,
                message=message,
                details=details,
                stage=diagnostic_stage,
            ),
            execution_events.build_run_failed(
                code=code,
                message=message,
                details=details,
            ),
        )


def _resolve_applied_thinking_selection(
    *,
    requested_selection: RuntimeThinkingSelection | None,
    requested_canonical_selection: Any,
    applied_canonical_selection: Any,
    capability_series: str,
) -> RuntimeThinkingSelection | None:
    if applied_canonical_selection is None:
        return None
    if (
        requested_selection is not None
        and requested_canonical_selection is not None
        and requested_canonical_selection == applied_canonical_selection
    ):
        return requested_selection
    return _to_runtime_thinking_selection(
        selection=applied_canonical_selection,
        series=capability_series,
    )



def _to_runtime_thinking_selection(
    *,
    selection: Any,
    series: str,
) -> RuntimeThinkingSelection | None:
    if isinstance(selection, RuntimeThinkingSelection):
        return selection

    if isinstance(selection, dict):
        kind = selection.get("kind")
        budget_tokens = selection.get("budget_tokens", selection.get("budgetTokens"))
        preset_value = selection.get("value")
    else:
        kind = getattr(selection, "kind", None)
        budget_tokens = getattr(selection, "budget_tokens", getattr(selection, "budgetTokens", None))
        preset_value = getattr(selection, "value", None)

    if kind == "budget":
        if not isinstance(budget_tokens, int) or isinstance(budget_tokens, bool) or budget_tokens < 0:
            return None
        return RuntimeThinkingSelection(
            series=series,
            value=RuntimeThinkingValue(
                valueType="budget",
                mode="budget",
                budgetTokens=budget_tokens,
            ),
        )

    if kind != "preset":
        return None

    normalized_value = preset_value.strip() if isinstance(preset_value, str) else None
    if not normalized_value:
        return None
    return RuntimeThinkingSelection(
        series=series,
        value=RuntimeThinkingValue(
            valueType="code",
            code=normalized_value,
        ),
    )



def _build_thinking_fail_fast_message(
    *,
    code: str,
    requested_selection: RuntimeThinkingSelection,
) -> str:
    requested_value = requested_selection.value.to_dict()
    if code == "thinking_series_mapping_failed":
        return (
            f"Thinking 系列 '{requested_selection.series}' 的请求值 {requested_value} 无法映射为当前模型路由的 provider 参数，"
            "请求已在执行前终止。"
        )
    if code == "thinking_series_value_not_allowed":
        return (
            f"Thinking 系列 '{requested_selection.series}' 的请求值 {requested_value} 不在当前模型路由允许集合中。"
        )
    if code == "thinking_series_builder_missing":
        return (
            f"当前模型路由缺少 Thinking 系列 '{requested_selection.series}' 的 provider builder。"
        )
    if code == "thinking_series_unknown_without_override":
        return "当前模型路由未解析出 Thinking 系列，且未提供 override 系列模板，无法发送 Thinking 请求。"
    return (
        f"Thinking 系列 '{requested_selection.series}' 不适用于当前模型路由，请求已终止。"
    )



def _next_run_id() -> str:
    return f"run-{uuid4().hex}"


__all__ = [
    "RuntimeAgentExecutionEventStream",
    "RuntimeMessageRunOrchestrator",
    "RuntimeStreamingAgentExecutor",
]

