from __future__ import annotations

import asyncio

import pytest

from app.copilot_runtime.agent_registry import AgentRegistry, build_default_agent_registry
from app.copilot_runtime.bridge import AgentNotFoundError, RuntimeBridge, SessionNotFoundError
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    build_runtime_scaffold,
)
from app.copilot_runtime.model_routes import RuntimeModelRoute, RuntimeModelRouteSnapshot
from app.copilot_runtime.run_events import RUN_STARTED_EVENT_TYPE, RuntimeRunEvent, RuntimeRunEventFactory
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.tool_registry import build_default_tool_registry


class _StubMessageRunOrchestrator:
    def __init__(self, *, events: list[RuntimeRunEvent]) -> None:
        self._events = list(events)
        self.received_requests: list[RuntimeMessageSendRequest] = []
        self.received_disconnect_callbacks: list[object] = []

    async def stream_events(
        self,
        *,
        request: RuntimeMessageSendRequest,
        is_client_disconnected=None,
    ):
        self.received_requests.append(request)
        self.received_disconnect_callbacks.append(is_client_disconnected)
        for event in self._events:
            yield event



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

    async def is_client_disconnected() -> bool:
        return False

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
    assert orchestrator.received_disconnect_callbacks == [is_client_disconnected]



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
