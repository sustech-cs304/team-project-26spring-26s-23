"""Bridge layer between the runtime protocol and registry-resolved agent executors."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import cast

from .agent_registry import AgentDescriptor, AgentRegistry
from .contracts import (
    RuntimeCapabilitiesResponse,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeRunStartRequest,
    RuntimeScaffold,
)
from .execution_support import (
    AgentNotFoundError,
    RunNotFoundError,
    SessionNotFoundError,
    ThreadNotFoundError,
)
from .message_runs import RuntimeMessageRunOrchestrator
from .model_routes import RuntimeModelRoute, RuntimeModelRouteSnapshot
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
    RuntimeThreadRecord,
)


class RuntimeBridge:
    """Coordinates thread/run state, executor resolution, and compat projections."""

    def __init__(
        self,
        *,
        session_store: InMemorySessionStore,
        agent_registry: AgentRegistry,
        scaffold: RuntimeScaffold | None = None,
        message_run_orchestrator: RuntimeMessageRunOrchestrator | None = None,
    ) -> None:
        self._session_store = session_store
        self._agent_registry = agent_registry
        self._scaffold = scaffold
        self._message_run_orchestrator = message_run_orchestrator

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
        compat_run = self._create_run_record(
            request=RuntimeRunStartRequest(
                thread_id=request.session_id,
                message=request.message,
                policy=request.policy,
                agent_id=request.agent_id,
            ),
            validate_thread=False,
        )
        return self.stream_run(
            run_id=compat_run.run_id,
            is_client_disconnected=is_client_disconnected,
        )

    def get_capabilities(self, *, session_id: str) -> RuntimeCapabilitiesResponse:
        if self._scaffold is None:
            raise RuntimeError("Runtime scaffold is required for capabilities queries.")
        session = self._session_store.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        self._resolve_agent(session.bound_agent_id)
        return self._scaffold.build_capabilities_response(session=session)

    def get_run(self, *, run_id: str) -> RuntimeRunRecord:
        run = self._session_store.get_run(run_id)
        if run is None:
            raise RunNotFoundError(run_id)
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
        async for event in self._call_orchestrator_stream_events(
            request=request,
            run_id=run.run_id,
            is_client_disconnected=self._build_run_cancellation_checker(
                run_id=run.run_id,
                is_client_disconnected=is_client_disconnected,
            ),
        ):
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
                enabledTools=tuple(stored_policy.enabled_tools),
                debugModeEnabled=stored_policy.debug_mode_enabled,
                requestOptions=dict(stored_policy.request_options),
            ),
            agent_id=stored_request.agent_id,
        )

    def _require_message_run_orchestrator(self) -> RuntimeMessageRunOrchestrator:
        if self._message_run_orchestrator is None:
            raise RuntimeError("Runtime message run orchestrator is not configured.")
        return self._message_run_orchestrator

    def _resolve_agent(self, agent_name: str) -> AgentDescriptor:
        descriptor = self._agent_registry.get(agent_name)
        if descriptor is None:
            raise AgentNotFoundError(agent_name)
        return descriptor


__all__ = [
    "AgentNotFoundError",
    "RunNotFoundError",
    "RuntimeBridge",
    "SessionNotFoundError",
    "ThreadNotFoundError",
]
