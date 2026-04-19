"""Service-layer orchestration for streamed runtime message runs."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
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
from ..runtime_session_store import RuntimeSessionStore
from ..session_store import BoundAgentMismatchError
from ..thinking_adapter import adapt_thinking_selection
from ..tool_permissions import RuntimeToolPermissionResolver


@dataclass(frozen=True)
class _PreparedStreamExecution:
    thread: Any
    tool_permission_resolver: RuntimeToolPermissionResolver
    resolved_tool_ids: tuple[str, ...]
    message_history: Any
    resolved_model_route: Any
    thinking_adaptation: Any
    reasoning_suppression_basis_summary: dict[str, Any] | None
    agent_executor: Any
    run_metadata: RuntimeRunEvent
    preflight_failure: _FailureEventDetails | None = None


@dataclass
class _ExecutionStreamResult:
    assistant_text: str | None = None
    completed: bool = False


@dataclass(frozen=True)
class _FailureEventDetails:
    code: str
    message: str
    details: dict[str, Any]
    diagnostic_stage: str | None = None


class RuntimeMessageRunOrchestrator:
    """Coordinates request-scoped route resolution, streaming execution, and final archival."""

    def __init__(
        self,
        *,
        session_store: RuntimeSessionStore,
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
            prepared = await self._prepare_stream_execution(
                context=context, request=request
            )
        except Exception as exc:  # pragma: no cover - consolidated fallback path
            async for projected in self._yield_failed_execution_from_exception(
                context=context,
                exc=exc,
                stage="prepare_execution",
            ):
                yield projected
            return

        yield prepared.run_metadata
        if prepared.preflight_failure is not None:
            async for projected in self._yield_failed_execution(
                context=context,
                failure=prepared.preflight_failure,
            ):
                yield projected
            return

        context.projector.configure_completion_context(
            resolved_model_route=prepared.resolved_model_route,
            resolved_tool_ids=prepared.resolved_tool_ids,
            request_options=request.policy.requestOptions,
        )

        execution_result = _ExecutionStreamResult()
        async for projected in self._stream_execution_events(
            context=context,
            request=request,
            prepared=prepared,
            is_client_disconnected=is_client_disconnected,
            result=execution_result,
        ):
            yield projected
        if not execution_result.completed or execution_result.assistant_text is None:
            return

        await raise_if_client_disconnected(
            is_client_disconnected,
            run_id=context.run_id,
            thread_id=request.thread_id,
        )
        projected_events = context.projector.project(
            context.execution_events.build_run_completed(
                assistant_text=execution_result.assistant_text
            )
        )
        log_runtime_chain_debug(
            "orchestrator.terminal",
            enabled=context.debug_enabled,
            runId=context.run_id,
            threadId=request.thread_id,
            terminalReason="completed",
            projectedEventTypes=[projected.type for projected in projected_events],
            projectedEvents=[
                summarize_runtime_run_event(projected) for projected in projected_events
            ],
        )
        for projected in projected_events:
            yield projected

    async def _prepare_stream_execution(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
    ) -> _PreparedStreamExecution:
        thread = self._require_thread(request)
        agent_descriptor = self._resolve_agent(thread.bound_agent_id)
        tool_permission_resolver = RuntimeToolPermissionResolver.from_policy(
            request.policy.toolPermissionPolicy
        )
        resolved_tool_ids = self._resolve_enabled_tools(
            agent_id=thread.bound_agent_id,
            enabled_tools=request.policy.enabledTools,
            tool_permission_resolver=tool_permission_resolver,
        )
        message_history = build_message_history(
            self._session_store.list_messages(thread.thread_id)
        )
        resolved_model_route = await self._model_route_resolver.resolve(
            request.policy.modelRoute
        )
        (
            thinking_adaptation,
            run_metadata,
            reasoning_suppression_basis_summary,
            preflight_failure,
        ) = self._resolve_thinking_state(
            context=context,
            request=request,
            resolved_model_route=resolved_model_route,
        )
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
        return _PreparedStreamExecution(
            thread=thread,
            tool_permission_resolver=tool_permission_resolver,
            resolved_tool_ids=resolved_tool_ids,
            message_history=message_history,
            resolved_model_route=resolved_model_route,
            thinking_adaptation=thinking_adaptation,
            reasoning_suppression_basis_summary=reasoning_suppression_basis_summary,
            agent_executor=agent_executor,
            run_metadata=run_metadata,
            preflight_failure=preflight_failure,
        )

    def _resolve_thinking_state(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
        resolved_model_route: Any,
    ) -> tuple[
        Any, RuntimeRunEvent, dict[str, Any] | None, _FailureEventDetails | None
    ]:
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
        selection_result_summary = summarize_runtime_thinking_selection_result(
            selection_result
        )
        reasoning_suppression_basis = build_reasoning_suppression_basis(
            capability=thinking_adaptation.capability.to_public_dict(),
            applied_selection=applied_thinking_selection,
        )
        reasoning_suppression_basis_summary = (
            summarize_runtime_reasoning_suppression_basis(reasoning_suppression_basis)
        )
        self._log_thinking_resolution(
            context=context,
            request=request,
            resolved_model_route=resolved_model_route,
            requested_thinking_selection=requested_thinking_selection,
            applied_thinking_selection=applied_thinking_selection,
            thinking_adaptation=thinking_adaptation,
            selection_result_summary=selection_result_summary,
            reasoning_suppression_basis_summary=reasoning_suppression_basis_summary,
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
        preflight_failure = self._build_thinking_fail_fast_failure(
            context=context,
            request=request,
            requested_thinking_selection=requested_thinking_selection,
            applied_thinking_selection=applied_thinking_selection,
            thinking_adaptation=thinking_adaptation,
            selection_result_summary=selection_result_summary,
            reasoning_suppression_basis_summary=reasoning_suppression_basis_summary,
        )
        return (
            thinking_adaptation,
            run_metadata,
            reasoning_suppression_basis_summary,
            preflight_failure,
        )

    def _log_thinking_resolution(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
        resolved_model_route: Any,
        requested_thinking_selection: Any,
        applied_thinking_selection: Any,
        thinking_adaptation: Any,
        selection_result_summary: dict[str, Any] | None,
        reasoning_suppression_basis_summary: dict[str, Any] | None,
    ) -> None:
        requested_selection_payload = self._selection_payload(
            requested_thinking_selection
        )
        applied_selection_payload = self._selection_payload(applied_thinking_selection)
        summarized_capability = summarize_runtime_thinking_capability(
            thinking_adaptation.capability
        )
        common_fields = {
            "enabled": context.debug_enabled,
            "runId": context.run_id,
            "threadId": request.thread_id,
            "requestedThinkingSelection": requested_selection_payload,
            "appliedThinkingSelection": applied_selection_payload,
            "capability": summarized_capability,
            "selectionResult": selection_result_summary,
            "reasoningSuppressionBasis": reasoning_suppression_basis_summary,
        }
        log_runtime_chain_debug(
            "thinking.capability_resolved",
            resolvedModelRoute=summarize_runtime_model_route(resolved_model_route),
            overrideInput=request.policy.thinkingCapabilityOverride,
            **common_fields,
        )
        log_runtime_chain_debug(
            "thinking.request_validated",
            applied=thinking_adaptation.applied,
            reason=thinking_adaptation.reason,
            **common_fields,
        )
        log_runtime_chain_debug(
            "thinking.provider_mapping_resolved",
            providerBuilderKey=thinking_adaptation.provider_builder_key,
            modelSettings=thinking_adaptation.model_settings,
            mappingReasonCode=thinking_adaptation.mapping_reason_code,
            reason=thinking_adaptation.reason,
            **common_fields,
        )

    def _build_thinking_fail_fast_failure(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
        requested_thinking_selection: Any,
        applied_thinking_selection: Any,
        thinking_adaptation: Any,
        selection_result_summary: dict[str, Any] | None,
        reasoning_suppression_basis_summary: dict[str, Any] | None,
    ) -> _FailureEventDetails | None:
        if requested_thinking_selection is None or thinking_adaptation.applied:
            return None
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
            appliedThinkingSelection=self._selection_payload(
                applied_thinking_selection
            ),
            reason=thinking_adaptation.reason,
            capability=summarize_runtime_thinking_capability(
                thinking_adaptation.capability
            ),
            diagnostics=fail_fast_details,
            selectionResult=selection_result_summary,
            reasoningSuppressionBasis=reasoning_suppression_basis_summary,
        )
        return _FailureEventDetails(
            code=fail_fast_code,
            message=build_thinking_fail_fast_message(
                code=fail_fast_code,
                requested_selection=requested_thinking_selection,
            ),
            details=fail_fast_details,
            diagnostic_stage="adapt_thinking",
        )

    async def _stream_execution_events(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
        prepared: _PreparedStreamExecution,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
        result: _ExecutionStreamResult,
    ) -> AsyncIterator[RuntimeRunEvent]:
        try:
            async with open_execution_stream(
                agent_executor=prepared.agent_executor,
                run_id=context.run_id,
                agent_name=prepared.thread.bound_agent_id,
                user_prompt=request.message.content,
                message_history=prepared.message_history,
                model_route=prepared.resolved_model_route,
                enabled_tools=prepared.resolved_tool_ids,
                debug_enabled=context.debug_enabled,
                request_options=request.policy.requestOptions,
                model_settings=prepared.thinking_adaptation.model_settings,
                tool_permission_resolver=prepared.tool_permission_resolver,
            ) as stream:
                log_runtime_chain_debug(
                    "orchestrator.stream_opened",
                    enabled=context.debug_enabled,
                    runId=context.run_id,
                    threadId=request.thread_id,
                    resolvedModelId=stream.resolved_model_id,
                )
                async for projected in self._yield_projected_stream_events(
                    context=context,
                    request=request,
                    stream=stream,
                    reasoning_suppression_basis_summary=(
                        prepared.reasoning_suppression_basis_summary
                    ),
                    is_client_disconnected=is_client_disconnected,
                ):
                    yield projected
                await raise_if_client_disconnected(
                    is_client_disconnected,
                    run_id=context.run_id,
                    thread_id=request.thread_id,
                )
                result.assistant_text = await stream.get_output()
                log_runtime_chain_debug(
                    "orchestrator.stream_output",
                    enabled=context.debug_enabled,
                    runId=context.run_id,
                    threadId=request.thread_id,
                    assistantTextLength=len(result.assistant_text),
                    assistantTextPreview=preview_text(result.assistant_text),
                )
                await raise_if_client_disconnected(
                    is_client_disconnected,
                    run_id=context.run_id,
                    thread_id=request.thread_id,
                )
                result.completed = True
        except asyncio.CancelledError:
            async for projected in self._yield_cancelled_execution(
                context=context, request=request
            ):
                yield projected
        except Exception as exc:  # pragma: no cover - consolidated fallback path
            async for projected in self._yield_failed_execution_from_exception(
                context=context,
                exc=exc,
                stage="execute_model",
            ):
                yield projected

    async def _yield_projected_stream_events(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
        stream: Any,
        reasoning_suppression_basis_summary: dict[str, Any] | None,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        async for event in stream.iter_events():
            projected_events = context.projector.project(event)
            self._log_projected_execution_event(
                context=context,
                request=request,
                event=event,
                projected_events=projected_events,
                reasoning_suppression_basis_summary=reasoning_suppression_basis_summary,
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

    def _log_projected_execution_event(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
        event: Any,
        projected_events: list[RuntimeRunEvent],
        reasoning_suppression_basis_summary: dict[str, Any] | None,
    ) -> None:
        suppression_basis = reasoning_suppression_basis_summary
        if (
            self._is_reasoning_suppressed_event(
                event=event,
                reasoning_suppression_basis_summary=suppression_basis,
            )
            and suppression_basis is not None
        ):
            log_runtime_chain_debug(
                "thinking.reasoning_suppressed",
                enabled=context.debug_enabled,
                runId=context.run_id,
                threadId=request.thread_id,
                suppressionEnabled=True,
                suppressionSource=suppression_basis.get("source"),
                suppressionReasonCode=suppression_basis.get("reasonCode"),
                reasoningSuppressionBasis=suppression_basis,
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
                summarize_runtime_run_event(projected) for projected in projected_events
            ],
        )

    def _is_reasoning_suppressed_event(
        self,
        *,
        event: Any,
        reasoning_suppression_basis_summary: dict[str, Any] | None,
    ) -> bool:
        return (
            event.type == "reasoning_segment_delta"
            and isinstance(reasoning_suppression_basis_summary, dict)
            and reasoning_suppression_basis_summary.get("shouldSuppress") is True
        )

    async def _yield_cancelled_execution(
        self,
        *,
        context: Any,
        request: RuntimeRunStartRequest,
    ) -> AsyncIterator[RuntimeRunEvent]:
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
            projectedEvents=[
                summarize_runtime_run_event(projected) for projected in projected_events
            ],
        )
        for projected in projected_events:
            yield projected

    async def _yield_failed_execution_from_exception(
        self,
        *,
        context: Any,
        exc: Exception,
        stage: str,
    ) -> AsyncIterator[RuntimeRunEvent]:
        failure = self._describe_failure(exc=exc, stage=stage)
        async for projected in self._yield_failed_execution(
            context=context,
            failure=failure,
        ):
            yield projected

    async def _yield_failed_execution(
        self,
        *,
        context: Any,
        failure: _FailureEventDetails,
    ) -> AsyncIterator[RuntimeRunEvent]:
        for event in build_failed_execution_events(
            execution_events=context.execution_events,
            code=failure.code,
            message=failure.message,
            details=failure.details,
            diagnostic_stage=failure.diagnostic_stage,
        ):
            for projected in context.projector.project(event):
                yield projected

    def _describe_failure(self, *, exc: Exception, stage: str) -> _FailureEventDetails:
        if isinstance(exc, RuntimeModelRouteResolutionError):
            return _FailureEventDetails(
                code=exc.code,
                message=str(exc),
                details=exc.details,
                diagnostic_stage="resolve_model_route",
            )
        if isinstance(exc, RuntimeProviderAdapterError):
            return _FailureEventDetails(
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
                diagnostic_stage="resolve_thinking_capability",
            )
        if isinstance(exc, ThreadNotFoundError):
            return _FailureEventDetails(
                code="thread_not_found",
                message=str(exc),
                details={"threadId": exc.thread_id},
            )
        if isinstance(exc, BoundAgentMismatchError):
            return _FailureEventDetails(
                code="agent_mismatch",
                message=str(exc),
                details={
                    "sessionId": exc.session_id,
                    "boundAgentId": exc.expected_agent_id,
                    "requestedAgentId": exc.actual_agent_id,
                },
            )
        if isinstance(exc, ToolNotFoundError):
            return _FailureEventDetails(
                code="tool_not_found",
                message=str(exc),
                details={"toolId": exc.tool_id},
            )
        if isinstance(exc, AgentNotFoundError):
            return _FailureEventDetails(
                code="agent_not_found",
                message=str(exc),
                details={"agentName": exc.agent_name},
            )
        if isinstance(exc, InvalidSessionHistoryError):
            return _FailureEventDetails(
                code="invalid_message_history",
                message=str(exc),
                details={},
            )
        if isinstance(exc, ModelNotConfiguredError):
            return _FailureEventDetails(
                code="model_not_configured",
                message=str(exc),
                details={
                    "modelEnvironmentKeys": list(self._scaffold.model_environment_keys)
                },
            )
        if isinstance(exc, ProviderAdapterExecutionError):
            return _FailureEventDetails(
                code=exc.code,
                message=str(exc),
                details=dict(exc.details),
                diagnostic_stage="execute_model",
            )
        if isinstance(exc, AgentExecutionError):
            return _FailureEventDetails(
                code="agent_execution_failed",
                message=str(exc),
                details={},
                diagnostic_stage=stage,
            )
        return _FailureEventDetails(
            code="agent_execution_failed",
            message=f"Unexpected agent execution failure: {exc}",
            details={},
            diagnostic_stage=stage,
        )

    def _selection_payload(self, selection: Any) -> dict[str, Any] | None:
        return None if selection is None else selection.to_dict()

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
        tool_permission_resolver: RuntimeToolPermissionResolver | None = None,
    ) -> tuple[str, ...]:
        try:
            return self._scaffold.resolve_enabled_tool_ids(
                agent_id=agent_id,
                enabled_tools=enabled_tools,
                tool_permission_resolver=tool_permission_resolver,
            )
        except LookupError as exc:
            raise ToolNotFoundError(extract_unknown_tool_id(exc)) from exc


__all__ = ["RuntimeMessageRunOrchestrator"]
