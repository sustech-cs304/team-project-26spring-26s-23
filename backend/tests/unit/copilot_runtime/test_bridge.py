from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest

from app.copilot_runtime.agent_registry import AgentRegistry, build_default_agent_registry
from app.copilot_runtime.bridge import AgentNotFoundError, RuntimeBridge, SessionNotFoundError
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeRunStartRequest,
    build_runtime_scaffold,
)
from app.copilot_runtime.model_routes import RuntimeModelRoute, RuntimeModelRouteSnapshot
from app.copilot_runtime.run_events import (
    RUN_CANCELLED_EVENT_TYPE,
    RUN_COMPLETED_EVENT_TYPE,
    RUN_METADATA_EVENT_TYPE,
    RUN_STARTED_EVENT_TYPE,
    TEXT_DELTA_EVENT_TYPE,
    RuntimeRunEvent,
    RuntimeRunEventFactory,
)
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.tool_registry import build_default_tool_registry


class _StubMessageRunOrchestrator:
    def __init__(self, *, events: list[RuntimeRunEvent]) -> None:
        self._events = list(events)
        self.received_requests: list[RuntimeMessageSendRequest] = []
        self.received_disconnect_callbacks: list[Callable[[], Awaitable[bool]] | None] = []

    async def stream_events(
        self,
        *,
        request: RuntimeMessageSendRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
    ):
        self.received_requests.append(request)
        self.received_disconnect_callbacks.append(is_client_disconnected)
        for event in self._events:
            yield event


class _CancelAwareMessageRunOrchestrator:
    def __init__(self, *, session_id: str, run_id: str, request_cancel) -> None:
        self._events = RuntimeRunEventFactory(session_id=session_id, run_id=run_id)
        self._request_cancel = request_cancel

    async def stream_events(
        self,
        *,
        request: RuntimeMessageSendRequest,
        is_client_disconnected=None,
    ):
        assistant_message_id = f"{self._events.run_id}:assistant"
        yield self._events.build(
            RUN_STARTED_EVENT_TYPE,
            payload={"assistantMessageId": assistant_message_id},
        )
        yield self._events.build(
            TEXT_DELTA_EVENT_TYPE,
            payload={"assistantMessageId": assistant_message_id, "delta": "partial"},
        )
        self._request_cancel()
        if is_client_disconnected is not None and await is_client_disconnected():
            yield self._events.build(
                RUN_CANCELLED_EVENT_TYPE,
                payload={"assistantMessageId": assistant_message_id, "reason": "cancelled"},
            )
            return
        yield self._events.build(
            RUN_COMPLETED_EVENT_TYPE,
            payload={
                "assistantMessageId": assistant_message_id,
                "assistantText": "late completion",
                "resolvedToolIds": [],
                "requestOptions": {},
            },
        )


def test_stream_message_delegates_to_orchestrator_and_preserves_request() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    request = _build_message_send_request(session_id="session-1")
    expected_events = [
        RuntimeRunEventFactory(session_id="session-1", run_id="run-test").build(
            RUN_STARTED_EVENT_TYPE,
            payload={"assistantMessageId": "run-test:assistant"},
        )
    ]
    orchestrator = _StubMessageRunOrchestrator(events=expected_events)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        message_run_orchestrator=orchestrator,
    )

    disconnected = False

    async def is_client_disconnected() -> bool:
        return disconnected

    events = asyncio.run(
        _collect_events(
            bridge.stream_message(
                request=request,
                is_client_disconnected=is_client_disconnected,
            )
        )
    )

    assert events == expected_events
    assert orchestrator.received_requests == [request]

    checker = orchestrator.received_disconnect_callbacks[0]
    assert checker is not None
    assert checker is not is_client_disconnected
    assert asyncio.run(checker()) is False

    disconnected = True
    assert asyncio.run(checker()) is True

    disconnected = False
    assert asyncio.run(checker()) is False


def test_stream_run_updates_run_record_and_projects_compat_messages() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )
    run = bridge.start_run(request=_build_run_start_request(thread_id="thread-1"))
    events_factory = RuntimeRunEventFactory(session_id="thread-1", run_id=run.run_id)
    thinking_capability_snapshot = {
        "status": "unknown-without-override",
        "source": "unknown",
        "supported": False,
        "supportedLevels": [],
        "defaultLevel": None,
        "reasonCode": "route_not_verified",
        "providerHint": "unknown-route",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
        "overrideLevels": [],
    }
    orchestrator = _StubMessageRunOrchestrator(
        events=[
            events_factory.build(
                RUN_STARTED_EVENT_TYPE,
                payload={"assistantMessageId": f"{run.run_id}:assistant"},
            ),
            events_factory.build(
                RUN_METADATA_EVENT_TYPE,
                payload={
                    "requestedThinkingLevel": "medium",
                    "appliedThinkingLevel": None,
                    "thinkingCapabilitySnapshot": thinking_capability_snapshot,
                },
            ),
            events_factory.build(
                TEXT_DELTA_EVENT_TYPE,
                payload={"assistantMessageId": f"{run.run_id}:assistant", "delta": "Hello back"},
            ),
            events_factory.build(
                RUN_COMPLETED_EVENT_TYPE,
                payload={
                    "assistantMessageId": f"{run.run_id}:assistant",
                    "assistantText": "Hello back",
                    "resolvedToolIds": [],
                    "requestOptions": {},
                },
            ),
        ]
    )
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        message_run_orchestrator=orchestrator,
    )

    events = asyncio.run(_collect_events(bridge.stream_run(run_id=run.run_id)))
    updated_run = bridge.get_run(run_id=run.run_id)

    assert [event.type for event in events] == [
        RUN_STARTED_EVENT_TYPE,
        RUN_METADATA_EVENT_TYPE,
        TEXT_DELTA_EVENT_TYPE,
        RUN_COMPLETED_EVENT_TYPE,
    ]
    assert updated_run.status == "completed"
    assert updated_run.assistant_text == "Hello back"
    assert updated_run.metadata["requestedThinkingLevel"] == "medium"
    assert updated_run.metadata["appliedThinkingLevel"] is None
    assert updated_run.metadata["thinkingCapabilitySnapshot"] == thinking_capability_snapshot
    run_view = scaffold.build_run_view(run=updated_run)
    assert run_view.requestedThinkingLevel == "medium"
    assert run_view.appliedThinkingLevel is None
    assert run_view.thinkingCapabilitySnapshot == thinking_capability_snapshot
    assert [(event.event_type, event.sequence) for event in store.list_run_events(run.run_id)] == [
        (RUN_STARTED_EVENT_TYPE, 1),
        (RUN_METADATA_EVENT_TYPE, 2),
        (TEXT_DELTA_EVENT_TYPE, 3),
        (RUN_COMPLETED_EVENT_TYPE, 4),
    ]
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "Hello"),
        ("assistant", "Hello back"),
    ]


def test_stream_run_honors_cancel_requested_state_for_started_runs() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    seed_bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )
    run = seed_bridge.start_run(request=_build_run_start_request(thread_id="thread-1"))
    orchestrator = _CancelAwareMessageRunOrchestrator(
        session_id="thread-1",
        run_id=run.run_id,
        request_cancel=lambda: store.request_run_cancel(run.run_id),
    )
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        message_run_orchestrator=orchestrator,
    )

    events = asyncio.run(_collect_events(bridge.stream_run(run_id=run.run_id)))
    updated_run = bridge.get_run(run_id=run.run_id)

    assert [event.type for event in events] == [
        RUN_STARTED_EVENT_TYPE,
        TEXT_DELTA_EVENT_TYPE,
        RUN_CANCELLED_EVENT_TYPE,
    ]
    assert updated_run.status == "cancelled"
    assert updated_run.cancel_requested is True
    assert store.list_messages("thread-1") == ()



def test_get_capabilities_returns_tool_catalog_recommendations_and_version() -> None:
    store = InMemorySessionStore()
    session = store.create(bound_agent_id="default", session_id="session-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    capabilities = bridge.get_capabilities(session_id=session.session_id)

    assert capabilities.sessionId == "session-1"
    assert capabilities.boundAgent.agentId == "default"
    assert capabilities.toolSelectionMode == "recommendation-only"
    assert capabilities.recommendedTools == ("tool.file-convert",)
    assert capabilities.capabilitiesVersion == "capabilities:agents-v1:tools-v1"
    assert capabilities.tools[0].toolId == "tool.file-convert"
    assert capabilities.tools[0].displayName == "File Convert"


def test_get_capabilities_raises_session_not_found_error_for_unknown_session() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    with pytest.raises(SessionNotFoundError, match="Unknown session 'missing-session'."):
        bridge.get_capabilities(session_id="missing-session")


def test_get_capabilities_raises_agent_not_found_for_unknown_bound_agent() -> None:
    store = InMemorySessionStore()
    store.create(bound_agent_id="missing-agent", session_id="session-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    with pytest.raises(AgentNotFoundError, match="Unknown agent 'missing-agent'."):
        bridge.get_capabilities(session_id="session-1")


async def _collect_events(events) -> list[RuntimeRunEvent]:
    return [event async for event in events]


def _build_scaffold(
    *,
    agent_registry: AgentRegistry,
    session_store: InMemorySessionStore,
):
    return build_runtime_scaffold(
        session_store_type=session_store.storage_type,
        model_configured=True,
        agent_registry=agent_registry,
        tool_registry=build_default_tool_registry(),
    )


def _build_run_start_request(*, thread_id: str) -> RuntimeRunStartRequest:
    return RuntimeRunStartRequest(
        thread_id=thread_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            enabledTools=(),
            requestOptions={},
        ),
        agent_id="default",
    )


def _build_message_send_request(*, session_id: str) -> RuntimeMessageSendRequest:
    return RuntimeMessageSendRequest(
        session_id=session_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            enabledTools=(),
            requestOptions={},
        ),
        agent_id="default",
    )
