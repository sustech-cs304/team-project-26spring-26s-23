"""Service-layer orchestration for streamed runtime message runs."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from .message_run_handlers import build_run_started_event, create_message_run_context
from .message_run_mappers import (
    build_thinking_fail_fast_message,
    resolve_applied_thinking_selection,
)
from .message_run_stream import (
    build_failed_execution_events,
    next_run_id,
    open_execution_stream,
    raise_if_client_disconnected,
)
from ..agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    ProviderAdapterExecutionError,
    ToolInvocationError,
)
from ..agent_registry import AgentDescriptor, AgentRegistry
from ..contracts import (
    RuntimeRunStartRequest,
    RuntimeScaffold,
    _build_reasoning_suppression_basis as build_reasoning_suppression_basis,
)
from ..debug_logging import (
    log_runtime_chain_debug,
    preview_text,
    summarize_exception,
    summarize_runtime_execution_event,
    summarize_runtime_model_route,
    summarize_runtime_reasoning_suppression_basis,
    summarize_runtime_run_event,
    summarize_runtime_thinking_capability,
    summarize_runtime_thinking_selection_result,
)
from ..execution_support import (
    AgentNotFoundError,
    InvalidSessionHistoryError,
    ThreadNotFoundError,
    ToolNotFoundError,
    build_message_history,
    extract_unknown_tool_id,
)
from ..model_routes import (
    RuntimeModelRouteResolutionError,
    RuntimeModelRouteResolver,
)
from ..provider_adapter_registry import (
    RuntimeProviderAdapterError,
    RuntimeProviderAdapterRegistry,
    build_default_provider_adapter_registry,
)
from ..run_events import RuntimeRunEvent
from ..session_store import BoundAgentMismatchError, InMemorySessionStore
from ..thinking_adapter import adapt_thinking_selection


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
        context = create_message_run_context(
            request=request,
            run_id=run_id,
            next_run_id_factory=next_run_id,
        )

        run_started = build_run_started_event(context=context, request=request)
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
            applied_thinking_selection = resolve_applied_thinking_selection(
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
                enabled=context.debug_enabled,
                runId=context.run_id,
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
                enabled=context.debug_enabled,
                runId=context.run_id,
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
                enabled=context.debug_enabled,
                runId=context.run_id,
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
            run_metadata = context.projector.build_run_metadata(
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
                enabled=context.debug_enabled,
                runId=context.run_id,
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
                    enabled=context.debug_enabled,
                    runId=context.run_id,
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
                for event in build_failed_execution_events(
                    execution_events=context.execution_events,
                    code=fail_fast_code,
                    message=build_thinking_fail_fast_message(
                        code=fail_fast_code,
                        requested_selection=requested_thinking_selection,
                    ),
                    details=fail_fast_details,
                    diagnostic_stage="adapt_thinking",
                ):
                    for projected in context.projector.project(event):
                        yield projected
                return
            agent_executor = self._build_streaming_executor(agent_descriptor)
            log_runtime_chain_debug(
                "orchestrator.execution_prepared",
                enabled=context.debug_enabled,
                runId=context.run_id,
                threadId=request.thread_id,
                boundAgentId=thread.bound_agent_id,
                enabledToolIds=list(resolved_tool_ids),
                modelRoute=summarize_runtime_model_route(resolved_model_route),
                historyMessageCount=len(message_history),
                executorType=type(agent_executor).__name__,
            )
        except RuntimeModelRouteResolutionError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code=exc.code,
                message=str(exc),
                details=exc.details,
                diagnostic_stage="resolve_model_route",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except RuntimeProviderAdapterError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
                diagnostic_stage="resolve_thinking_capability",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except ThreadNotFoundError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="thread_not_found",
                message=str(exc),
                details={"threadId": exc.thread_id},
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except BoundAgentMismatchError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="agent_mismatch",
                message=str(exc),
                details={
                    "sessionId": exc.session_id,
                    "boundAgentId": exc.expected_agent_id,
                    "requestedAgentId": exc.actual_agent_id,
                },
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except ToolNotFoundError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="tool_not_found",
                message=str(exc),
                details={"toolId": exc.tool_id},
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except AgentNotFoundError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="agent_not_found",
                message=str(exc),
                details={"agentName": exc.agent_name},
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except InvalidSessionHistoryError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="invalid_message_history",
                message=str(exc),
                details={},
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except ModelNotConfiguredError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except AgentExecutionError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="prepare_execution",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="prepare_execution",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return

        context.projector.configure_completion_context(
            resolved_model_route=resolved_model_route,
            resolved_tool_ids=resolved_tool_ids,
            request_options=request.policy.requestOptions,
        )

        assistant_text: str
        try:
            async with open_execution_stream(
                agent_executor=agent_executor,
                run_id=context.run_id,
                agent_name=thread.bound_agent_id,
                user_prompt=request.message.content,
                message_history=message_history,
                model_route=resolved_model_route,
                enabled_tools=resolved_tool_ids,
                debug_enabled=context.debug_enabled,
                request_options=request.policy.requestOptions,
                model_settings=thinking_adaptation.model_settings,
            ) as stream:
                log_runtime_chain_debug(
                    "orchestrator.stream_opened",
                    enabled=context.debug_enabled,
                    runId=context.run_id,
                    threadId=request.thread_id,
                    resolvedModelId=stream.resolved_model_id,
                )
                async for event in stream.iter_events():
                    projected_events = context.projector.project(event)
                    if (
                        event.type == "reasoning_segment_delta"
                        and isinstance(reasoning_suppression_basis_summary, dict)
                        and reasoning_suppression_basis_summary.get("shouldSuppress") is True
                    ):
                        log_runtime_chain_debug(
                            "thinking.reasoning_suppressed",
                            enabled=context.debug_enabled,
                            runId=context.run_id,
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
                        enabled=context.debug_enabled,
                        runId=context.run_id,
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
                    await raise_if_client_disconnected(
                        is_client_disconnected,
                        run_id=context.run_id,
                        thread_id=request.thread_id,
                    )
                    for projected in projected_events:
                        log_runtime_chain_debug(
                            "orchestrator.yield_projected_event",
                            enabled=context.debug_enabled,
                            runId=context.run_id,
                            threadId=request.thread_id,
                            projectedEvent=summarize_runtime_run_event(projected),
                        )
                        yield projected
                await raise_if_client_disconnected(
                    is_client_disconnected,
                    run_id=context.run_id,
                    thread_id=request.thread_id,
                )
                assistant_text = await stream.get_output()
                log_runtime_chain_debug(
                    "orchestrator.stream_output",
                    enabled=context.debug_enabled,
                    runId=context.run_id,
                    threadId=request.thread_id,
                    assistantTextLength=len(assistant_text),
                    assistantTextPreview=preview_text(assistant_text),
                )
                await raise_if_client_disconnected(
                    is_client_disconnected,
                    run_id=context.run_id,
                    thread_id=request.thread_id,
                )
        except asyncio.CancelledError:
            projected_events = context.projector.project(
                context.execution_events.build_run_cancelled(reason="cancelled")
            )
            log_runtime_chain_debug(
                "orchestrator.terminal",
                enabled=context.debug_enabled,
                runId=context.run_id,
                threadId=request.thread_id,
                terminalReason="cancelled",
                projectedEventTypes=[projected.type for projected in projected_events],
                projectedEvents=[summarize_runtime_run_event(projected) for projected in projected_events],
            )
            for projected in projected_events:
                yield projected
            return
        except ToolInvocationError as exc:
            projected_events = context.projector.project(
                context.execution_events.build_run_failed(
                    code=exc.code,
                    message=str(exc),
                    details=dict(exc.details),
                )
            )
            log_runtime_chain_debug(
                "orchestrator.terminal",
                enabled=context.debug_enabled,
                runId=context.run_id,
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
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="model_not_configured",
                message=str(exc),
                details={"modelEnvironmentKeys": list(self._scaffold.model_environment_keys)},
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except ProviderAdapterExecutionError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
                diagnostic_stage="execute_model",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except AgentExecutionError as exc:
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage="execute_model",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return
        except Exception as exc:  # pragma: no cover - defensive fallback
            for event in build_failed_execution_events(
                execution_events=context.execution_events,
                code="agent_execution_failed",
                message=f"Unexpected agent execution failure: {exc}",
                details={},
                diagnostic_stage="execute_model",
            ):
                for projected in context.projector.project(event):
                    yield projected
            return

        await raise_if_client_disconnected(
            is_client_disconnected,
            run_id=context.run_id,
            thread_id=request.thread_id,
        )
        projected_events = context.projector.project(
            context.execution_events.build_run_completed(assistant_text=assistant_text)
        )
        log_runtime_chain_debug(
            "orchestrator.terminal",
            enabled=context.debug_enabled,
            runId=context.run_id,
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


__all__ = ["RuntimeMessageRunOrchestrator"]
