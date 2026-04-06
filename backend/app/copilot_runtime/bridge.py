"""Bridge layer between the runtime protocol and registry-resolved agent executors."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any, cast

from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import (
    RuntimeCapabilitiesResponse,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeRunStartRequest,
    RuntimeScaffold,
    RuntimeThinkingCapabilityResponse,
    RuntimeThinkingSelection,
    _build_reasoning_suppression_basis as build_reasoning_suppression_basis,
)
from .debug_logging import (
    log_runtime_chain_debug,
    summarize_exception,
    summarize_runtime_model_route,
    summarize_runtime_reasoning_suppression_basis,
    summarize_runtime_thinking_capability,
    summarize_runtime_thinking_selection_result,
)
from .execution_support import (
    AgentNotFoundError,
    RunNotFoundError,
    SessionNotFoundError,
    ThreadNotFoundError,
)
from .message_runs import RuntimeMessageRunOrchestrator
from .model_routes import RuntimeModelRoute, RuntimeModelRouteResolver, RuntimeModelRouteSnapshot
from .run_events import (
    RUN_CANCELLED_EVENT_TYPE,
    RUN_COMPLETED_EVENT_TYPE,
    RUN_FAILED_EVENT_TYPE,
    RuntimeRunEvent,
    RuntimeRunEventFactory,
)
from .session_store import (
    InMemorySessionStore,
    RuntimeMessageRole,
    RuntimeRunRecord,
    RuntimeStoredModelRoute,
    RuntimeStoredModelRouteSnapshot,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
    RuntimeStoredThinkingSelection,
    RuntimeThreadRecord,
)


from .thinking_adapter import adapt_thinking_selection, resolve_canonical_thinking_capability


class RuntimeBridge:
    """Coordinates thread/run state, executor resolution, and compat projections."""

    def __init__(
        self,
        *,
        session_store: InMemorySessionStore,
        agent_registry: AgentRegistry,
        scaffold: RuntimeScaffold | None = None,
        message_run_orchestrator: RuntimeMessageRunOrchestrator | None = None,
        model_route_resolver: RuntimeModelRouteResolver | None = None,
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry
        self._scaffold = scaffold
        self._message_run_orchestrator = message_run_orchestrator
        self._model_route_resolver = model_route_resolver

    def create_thread(self, *, agent_id: str) -> RuntimeThreadRecord:
        self._resolve_agent(agent_id)
        return self._session_store.create_thread(bound_agent_id=agent_id)

    def create_session(self, *, agent_id: str) -> RuntimeThreadRecord:
        self._resolve_agent(agent_id)
        return self._session_store.create(bound_agent_id=agent_id)

    def get_thread(self, *, thread_id: str) -> RuntimeThreadRecord:
        thread = self._session_store.get_thread(thread_id)
        if thread is None:
            raise ThreadNotFoundError(thread_id)
        self._resolve_agent(thread.bound_agent_id)
        return thread

    def start_run(self, *, request: RuntimeRunStartRequest) -> RuntimeRunRecord:
        self.get_thread(thread_id=request.thread_id)
        return self._create_run_record(request=request, validate_thread=False)

    def stream_run(
        self,
        *,
        run_id: str,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        run = self.get_run(run_id=run_id)
        return self._stream_run(run=run, is_client_disconnected=is_client_disconnected)

    def cancel_run(self, *, run_id: str) -> tuple[RuntimeRunRecord, bool]:
        try:
            return self._session_store.request_run_cancel(run_id)
        except LookupError as exc:
            raise RunNotFoundError(run_id) from exc

    def stream_message(
        self,
        *,
        request: RuntimeMessageSendRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        async def _stream() -> AsyncIterator[RuntimeRunEvent]:
            compat_run = self._create_run_record(
                request=RuntimeRunStartRequest(
                    thread_id=request.session_id,
                    message=request.message,
                    policy=request.policy,
                    agent_id=request.agent_id,
                ),
                validate_thread=False,
            )
            await self.prime_run_metadata(run_id=compat_run.run_id)
            async for event in self.stream_run(
                run_id=compat_run.run_id,
                is_client_disconnected=is_client_disconnected,
            ):
                yield event

        return _stream()

    def get_capabilities(self, *, session_id: str) -> RuntimeCapabilitiesResponse:
        if self._scaffold is None:
            raise RuntimeError("Runtime scaffold is required for capabilities queries.")
        session = self._session_store.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        self._resolve_agent(session.bound_agent_id)
        return self._scaffold.build_capabilities_response(session=session)

    async def get_thinking_capability(
        self,
        *,
        session_id: str,
        model_route: RuntimeModelRoute,
        thinking_capability_override: dict[str, Any] | None = None,
    ) -> RuntimeThinkingCapabilityResponse:
        if self._scaffold is None:
            raise RuntimeError("Runtime scaffold is required for thinking capability queries.")
        session = self._session_store.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        self._resolve_agent(session.bound_agent_id)
        resolver = self._require_model_route_resolver()
        resolved_model_route = await resolver.resolve(model_route)
        capability = resolve_canonical_thinking_capability(
            model_route=resolved_model_route,
            thinking_capability_override=thinking_capability_override,
        )
        log_runtime_chain_debug(
            "thinking.capability_query_resolved",
            sessionId=session_id,
            resolvedModelRoute=summarize_runtime_model_route(resolved_model_route),
            capability=summarize_runtime_thinking_capability(capability),
            overrideInput=thinking_capability_override,
        )
        return self._scaffold.build_thinking_capability_response(
            session_id=session_id,
            capability=capability.to_public_dict(),
        )

    def get_run(self, *, run_id: str) -> RuntimeRunRecord:
        run = self._session_store.get_run(run_id)
        if run is None:
            raise RunNotFoundError(run_id)
        return run

    async def prime_run_metadata(self, *, run_id: str) -> RuntimeRunRecord:
        run = self.get_run(run_id=run_id)
        metadata = await self._resolve_initial_run_metadata(run=run)
        if metadata:
            run.touch(metadata=metadata)
        return run

    def _create_run_record(
        self,
        *,
        request: RuntimeRunStartRequest,
        validate_thread: bool,
    ) -> RuntimeRunRecord:
        if validate_thread:
            self.get_thread(thread_id=request.thread_id)
        return self._session_store.create_run(
            thread_id=request.thread_id,
            request=self._to_stored_run_input(request),
        )

    async def _stream_run(
        self,
        *,
        run: RuntimeRunRecord,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        if run.status == "cancelled" and run.started_at is None:
            async for event in self._emit_preemptively_cancelled_run(run=run):
                yield event
            return

        request = self._to_message_send_request(run)
        self._session_store.mark_run_streaming(
            run.run_id,
            metadata={"assistant_message_id": f"{run.run_id}:assistant"},
        )

        terminal_seen = False
        async for raw_event in self._call_orchestrator_stream_events(
            request=request,
            run_id=run.run_id,
            is_client_disconnected=self._build_run_cancellation_checker(
                run_id=run.run_id,
                is_client_disconnected=is_client_disconnected,
            ),
        ):
            event = self._augment_run_event_with_metadata(run_id=run.run_id, event=raw_event)
            self._update_run_state_from_event(run_id=run.run_id, event=event)
            if event.type in {RUN_COMPLETED_EVENT_TYPE, RUN_FAILED_EVENT_TYPE, RUN_CANCELLED_EVENT_TYPE}:
                terminal_seen = True
            yield event

        if not terminal_seen:
            self._session_store.mark_run_failed(
                run.run_id,
                metadata={
                    "terminal_event": RUN_FAILED_EVENT_TYPE,
                    "terminal_payload": {
                        "code": "agent_execution_failed",
                        "message": "Run stream ended without a terminal event.",
                        "details": {},
                    },
                },
            )

    def _build_run_cancellation_checker(
        self,
        *,
        run_id: str,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> Callable[[], Awaitable[bool]]:
        async def _checker() -> bool:
            if is_client_disconnected is not None and await is_client_disconnected():
                return True
            run = self._session_store.get_run(run_id)
            return run.cancel_requested if run is not None else False

        return _checker

    async def _call_orchestrator_stream_events(
        self,
        *,
        request: RuntimeMessageSendRequest,
        run_id: str,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        orchestrator = self._require_message_run_orchestrator()
        try:
            events = orchestrator.stream_events(
                request=request,
                is_client_disconnected=is_client_disconnected,
                run_id=run_id,
            )
        except TypeError as exc:
            if "run_id" not in str(exc):
                raise
            events = orchestrator.stream_events(
                request=request,
                is_client_disconnected=is_client_disconnected,
            )

        async for event in events:
            yield event

    async def _emit_preemptively_cancelled_run(
        self,
        *,
        run: RuntimeRunRecord,
    ) -> AsyncIterator[RuntimeRunEvent]:
        events = RuntimeRunEventFactory(session_id=run.thread_id, run_id=run.run_id)
        event = events.build(
            RUN_CANCELLED_EVENT_TYPE,
            payload={
                "assistantMessageId": self._assistant_message_id_for_run(run),
                "reason": "cancelled",
            },
        )
        self._session_store.record_run_event(
            run.run_id,
            event_type=event.type,
            payload=event.payload,
            sequence=event.sequence,
        )
        yield event

    def _update_run_state_from_event(self, *, run_id: str, event: RuntimeRunEvent) -> None:
        self._session_store.record_run_event(
            run_id,
            event_type=event.type,
            payload=event.payload,
            sequence=event.sequence,
        )
        metadata = {"last_event_type": event.type}
        if event.type == "run_metadata":
            self._session_store.mark_run_streaming(
                run_id,
                metadata={
                    **metadata,
                    **self._extract_thinking_metadata_from_payload(event.payload),
                },
            )
            return
        if event.type == RUN_COMPLETED_EVENT_TYPE:
            assistant_text = event.payload.get("assistantText")
            self._session_store.mark_run_completed(
                run_id,
                assistant_text=assistant_text if isinstance(assistant_text, str) else None,
                metadata={**metadata, "terminal_event": event.type, "terminal_payload": dict(event.payload)},
            )
            return
        if event.type == RUN_FAILED_EVENT_TYPE:
            self._session_store.mark_run_failed(
                run_id,
                metadata={**metadata, "terminal_event": event.type, "terminal_payload": dict(event.payload)},
            )
            return
        if event.type == RUN_CANCELLED_EVENT_TYPE:
            self._session_store.mark_run_cancelled(
                run_id,
                metadata={**metadata, "terminal_event": event.type, "terminal_payload": dict(event.payload)},
            )
            return
        if event.type == "run_started":
            self._session_store.mark_run_streaming(
                run_id,
                metadata={
                    **metadata,
                    "assistant_message_id": str(
                        event.payload.get("assistantMessageId", self._assistant_message_id_from_run_id(run_id))
                    ),
                    **self._extract_thinking_metadata_from_payload(event.payload),
                },
            )
            return
        run = self._session_store.get_run(run_id)
        if run is not None:
            run.touch(metadata=metadata)

    def _assistant_message_id_for_run(self, run: RuntimeRunRecord) -> str:
        stored = run.metadata.get("assistant_message_id")
        if isinstance(stored, str) and stored.strip() != "":
            return stored.strip()
        return self._assistant_message_id_from_run_id(run.run_id)

    def _assistant_message_id_from_run_id(self, run_id: str) -> str:
        return f"{run_id}:assistant"

    def _to_stored_run_input(self, request: RuntimeRunStartRequest) -> RuntimeStoredRunInput:
        resolved_thinking_selection = request.policy.resolve_thinking_selection()
        return RuntimeStoredRunInput(
            message_role=cast(RuntimeMessageRole, request.message.role),
            message_content=request.message.content,
            policy=RuntimeStoredRunPolicy(
                model_route=RuntimeStoredModelRoute(
                    provider_profile_id=request.policy.modelRoute.provider_profile_id,
                    snapshot=RuntimeStoredModelRouteSnapshot(
                        provider=request.policy.modelRoute.snapshot.provider,
                        endpoint_type=request.policy.modelRoute.snapshot.endpoint_type,
                        base_url=request.policy.modelRoute.snapshot.base_url,
                        model_id=request.policy.modelRoute.snapshot.model_id,
                    ),
                ),
                thinking_selection=_to_stored_thinking_selection(resolved_thinking_selection),
                thinking_level_intent=request.policy.thinkingLevelIntent,
                thinking_capability_override=None
                if request.policy.thinkingCapabilityOverride is None
                else dict(request.policy.thinkingCapabilityOverride),
                enabled_tools=tuple(request.policy.enabledTools),
                debug_mode_enabled=request.policy.debugModeEnabled,
                request_options=dict(request.policy.requestOptions),
            ),
            agent_id=request.agent_id,
        )

    def _to_message_send_request(self, run: RuntimeRunRecord) -> RuntimeMessageSendRequest:
        stored_request = run.request
        stored_policy = stored_request.policy
        stored_route = stored_policy.model_route
        runtime_thinking_selection = _to_runtime_thinking_selection(stored_policy.thinking_selection)
        return RuntimeMessageSendRequest(
            session_id=run.thread_id,
            message=RuntimeMessagePayload(
                role=stored_request.message_role,
                content=stored_request.message_content,
            ),
            policy=RuntimeMessageExecutionPolicy(
                modelRoute=RuntimeModelRoute(
                    provider_profile_id=stored_route.provider_profile_id,
                    snapshot=RuntimeModelRouteSnapshot(
                        provider=stored_route.snapshot.provider,
                        endpoint_type=stored_route.snapshot.endpoint_type,
                        base_url=stored_route.snapshot.base_url,
                        model_id=stored_route.snapshot.model_id,
                    ),
                ),
                thinkingSelection=runtime_thinking_selection,
                thinkingLevelIntent=(
                    stored_policy.thinking_level_intent
                    if runtime_thinking_selection is None
                    else None
                ),
                thinkingCapabilityOverride=None
                if stored_policy.thinking_capability_override is None
                else dict(stored_policy.thinking_capability_override),
                enabledTools=tuple(stored_policy.enabled_tools),
                debugModeEnabled=stored_policy.debug_mode_enabled,
                requestOptions=dict(stored_policy.request_options),
            ),
            agent_id=stored_request.agent_id,
        )

    async def _resolve_initial_run_metadata(self, *, run: RuntimeRunRecord) -> dict[str, Any]:
        request = self._to_message_send_request(run)
        requested_thinking_selection = request.policy.resolve_thinking_selection()
        metadata: dict[str, Any] = {
            "requestedThinkingSelection": (
                None if requested_thinking_selection is None else requested_thinking_selection.to_dict()
            ),
            "requestedThinkingLevel": request.policy.resolve_thinking_level_intent(),
        }
        resolver = self._model_route_resolver
        if resolver is None:
            return metadata

        try:
            resolved_model_route = await resolver.resolve(request.policy.modelRoute)
            adaptation = adapt_thinking_selection(
                selection=requested_thinking_selection,
                model_route=resolved_model_route,
                thinking_capability_override=request.policy.thinkingCapabilityOverride,
            )
            applied_thinking_selection = _resolve_runtime_applied_thinking_selection(
                requested_selection=requested_thinking_selection,
                requested_selection_payload=adaptation.requested_selection,
                applied_selection_payload=adaptation.applied_selection,
                capability_series=adaptation.capability.series,
            )
            thinking_selection_result = adaptation.to_public_dict()
            capability_snapshot = adaptation.capability.to_public_dict()
            reasoning_suppression_basis = build_reasoning_suppression_basis(
                capability=capability_snapshot,
                applied_thinking_level=adaptation.applied_intent,
            )
            metadata.update(
                {
                    "appliedThinkingSelection": (
                        None if applied_thinking_selection is None else applied_thinking_selection.to_dict()
                    ),
                    "appliedThinkingLevel": adaptation.applied_intent,
                    "thinkingCapabilitySnapshot": capability_snapshot,
                    "thinkingSelectionResult": thinking_selection_result,
                    "reasoningSuppressionBasis": reasoning_suppression_basis,
                }
            )
            log_runtime_chain_debug(
                "thinking.run_metadata_primed",
                runId=run.run_id,
                threadId=run.thread_id,
                requestedThinkingSelection=(
                    None if requested_thinking_selection is None else requested_thinking_selection.to_dict()
                ),
                appliedThinkingSelection=(
                    None if applied_thinking_selection is None else applied_thinking_selection.to_dict()
                ),
                requestedThinkingLevel=adaptation.requested_intent,
                appliedThinkingLevel=adaptation.applied_intent,
                capability=summarize_runtime_thinking_capability(adaptation.capability),
                selectionResult=summarize_runtime_thinking_selection_result(thinking_selection_result),
                reasoningSuppressionBasis=summarize_runtime_reasoning_suppression_basis(
                    reasoning_suppression_basis
                ),
                overrideInput=request.policy.thinkingCapabilityOverride,
                resolvedModelRoute=summarize_runtime_model_route(resolved_model_route),
            )
        except Exception as exc:  # pragma: no cover - defensive priming fallback
            log_runtime_chain_debug(
                "thinking.run_metadata_prime_failed",
                runId=run.run_id,
                threadId=run.thread_id,
                requestedThinkingSelection=(
                    None if requested_thinking_selection is None else requested_thinking_selection.to_dict()
                ),
                requestedThinkingLevel=request.policy.resolve_thinking_level_intent(),
                overrideInput=request.policy.thinkingCapabilityOverride,
                error=summarize_exception(exc),
            )
        return metadata

    def _augment_run_event_with_metadata(
        self,
        *,
        run_id: str,
        event: RuntimeRunEvent,
    ) -> RuntimeRunEvent:
        if event.type not in {"run_started", "run_metadata"}:
            return event
        run = self._session_store.get_run(run_id)
        if run is None:
            return event
        metadata_payload = self._build_run_metadata_payload(run=run)
        if len(metadata_payload) == 0:
            return event
        payload = dict(event.payload)
        for key, value in metadata_payload.items():
            payload.setdefault(key, value)
        if payload == event.payload:
            return event
        return RuntimeRunEvent(
            type=event.type,
            runId=event.runId,
            sessionId=event.sessionId,
            sequence=event.sequence,
            payload=payload,
        )

    def _build_run_metadata_payload(self, *, run: RuntimeRunRecord) -> dict[str, Any]:
        if self._scaffold is not None:
            run_view = self._scaffold.build_run_view(run=run)
            payload = {
                "requestedThinkingSelection": (
                    None
                    if run_view.requestedThinkingSelection is None
                    else run_view.requestedThinkingSelection.to_dict()
                ),
                "appliedThinkingSelection": (
                    None
                    if run_view.appliedThinkingSelection is None
                    else run_view.appliedThinkingSelection.to_dict()
                ),
                "requestedThinkingLevel": run_view.requestedThinkingLevel,
                "appliedThinkingLevel": run_view.appliedThinkingLevel,
                "thinkingCapabilitySnapshot": run_view.thinkingCapabilitySnapshot,
                "thinkingSelectionResult": run_view.thinkingSelectionResult,
                "reasoningSuppressionBasis": run_view.reasoningSuppressionBasis,
            }
            return {key: value for key, value in payload.items() if value is not None}
        payload = self._extract_thinking_metadata_from_payload(run.metadata)
        return {key: value for key, value in payload.items() if value is not None}

    def _extract_thinking_metadata_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "requestedThinkingSelection": _normalize_thinking_selection_payload(
                payload.get("requestedThinkingSelection")
            ),
            "appliedThinkingSelection": _normalize_thinking_selection_payload(
                payload.get("appliedThinkingSelection")
            ),
            "requestedThinkingLevel": payload.get("requestedThinkingLevel"),
            "appliedThinkingLevel": payload.get("appliedThinkingLevel"),
            "thinkingCapabilitySnapshot": (
                dict(payload.get("thinkingCapabilitySnapshot"))
                if isinstance(payload.get("thinkingCapabilitySnapshot"), dict)
                else None
            ),
            "thinkingSelectionResult": (
                dict(payload.get("thinkingSelectionResult"))
                if isinstance(payload.get("thinkingSelectionResult"), dict)
                else None
            ),
            "reasoningSuppressionBasis": (
                dict(payload.get("reasoningSuppressionBasis"))
                if isinstance(payload.get("reasoningSuppressionBasis"), dict)
                else None
            ),
        }
        return metadata

    def _require_message_run_orchestrator(self) -> RuntimeMessageRunOrchestrator:
        if self._message_run_orchestrator is None:
            raise RuntimeError("Runtime message run orchestrator is not configured.")
        return self._message_run_orchestrator

    def _require_model_route_resolver(self) -> RuntimeModelRouteResolver:
        if self._model_route_resolver is None:
            raise RuntimeError("Runtime model route resolver is not configured.")
        return self._model_route_resolver

    def _resolve_agent(self, agent_name: str) -> AgentDescriptor:
        descriptor = self._agent_registry.get(agent_name)
        if descriptor is None:
            raise AgentNotFoundError(agent_name)
        return descriptor



def _to_stored_thinking_selection(
    selection: RuntimeThinkingSelection | None,
) -> RuntimeStoredThinkingSelection | None:
    if selection is None:
        return None
    return RuntimeStoredThinkingSelection(
        series=selection.series,
        mode=selection.mode,
        level=selection.level,
        budget_tokens=selection.budgetTokens,
    )



def _to_runtime_thinking_selection(
    selection: RuntimeStoredThinkingSelection | None,
) -> RuntimeThinkingSelection | None:
    if selection is None:
        return None
    return RuntimeThinkingSelection(
        series=selection.series,
        mode=selection.mode,
        level=selection.level,
        budgetTokens=selection.budget_tokens,
    )



def _normalize_thinking_selection_payload(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    normalized: dict[str, Any] = {}
    for key in ("series", "mode", "level", "budgetTokens"):
        if key in value:
            normalized[key] = value[key]
    return normalized or None



def _resolve_runtime_applied_thinking_selection(
    *,
    requested_selection: RuntimeThinkingSelection | None,
    requested_selection_payload: Any,
    applied_selection_payload: Any,
    capability_series: str,
) -> RuntimeThinkingSelection | None:
    if applied_selection_payload is None:
        return None
    if requested_selection is not None and applied_selection_payload == requested_selection_payload:
        return requested_selection
    return _to_runtime_thinking_selection_payload(
        selection=applied_selection_payload,
        series=capability_series,
    )



def _to_runtime_thinking_selection_payload(
    *,
    selection: Any,
    series: str,
) -> RuntimeThinkingSelection | None:
    kind = getattr(selection, "kind", None)
    if kind == "budget":
        budget_tokens = getattr(selection, "budget_tokens", None)
        if not isinstance(budget_tokens, int) or isinstance(budget_tokens, bool) or budget_tokens < 0:
            return None
        return RuntimeThinkingSelection(
            series=series,
            mode="budget",
            level=None,
            budgetTokens=budget_tokens,
        )
    if kind != "preset":
        return None
    value = getattr(selection, "value", None)
    if not isinstance(value, str):
        return None
    return RuntimeThinkingSelection(
        series=series,
        mode="preset",
        level=cast(Any, value),
        budgetTokens=None,
    )



__all__ = [
    "AgentNotFoundError",
    "RunNotFoundError",
    "RuntimeBridge",
    "SessionNotFoundError",
    "ThreadNotFoundError",
]
