from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest

from app.copilot_runtime.agent_registry import AgentRegistry, build_default_agent_registry
from app.copilot_runtime.bridge import AgentNotFoundError, RuntimeBridge, SessionNotFoundError
from app.copilot_runtime.debug_logging import summarize_runtime_thinking_capability
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
    RuntimeRunStartRequest,
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
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
from app.copilot_runtime.session_store import (
    InMemorySessionStore,
    RuntimeStoredModelRoute,
    RuntimeStoredModelRouteSnapshot,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
    RuntimeStoredThinkingSelection,
)
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


class _EchoModelRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute):
        return __import__("app.copilot_runtime.model_routes", fromlist=["ResolvedRuntimeModelRoute"]).ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider=model_route.snapshot.provider,
            endpoint_type=model_route.snapshot.endpoint_type,
            base_url=model_route.snapshot.base_url,
            model_id=model_route.snapshot.model_id,
            api_key="test-api-key",
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


def test_start_run_stores_provider_specific_thinking_selection_value_payload_and_rehydrates_request() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )
    thinking_selection = RuntimeThinkingSelection(
        series="qwen-thinking-switch-v1",
        value=RuntimeThinkingValue(valueType="code", code="true", labelZh="开启"),
    )

    run = bridge.start_run(
        request=_build_run_start_request(
            thread_id="thread-1",
            model_route=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://unknown.example.com/v1",
                    model_id="unknown-model",
                ),
            ),
            thinking_selection=thinking_selection,
            thinking_capability_override={
                "supported": True,
                "series": "qwen-thinking-switch-v1",
                "template": {
                    "editorType": "discrete",
                    "allowedValues": [
                        {"valueType": "code", "code": "false", "labelZh": "关闭"},
                        {"valueType": "code", "code": "true", "labelZh": "开启"},
                    ],
                    "defaultValue": {"valueType": "code", "code": "true", "labelZh": "开启"},
                },
                "source": "settings-page",
            },
        )
    )

    stored_selection = run.request.policy.thinking_selection
    assert stored_selection is not None
    assert stored_selection.value_payload == thinking_selection.value.to_dict()

    message_request, legacy_fallback_used, rehydrate_error = bridge._to_message_send_request(run)

    assert legacy_fallback_used is False
    assert rehydrate_error is None
    assert message_request.policy.resolve_thinking_selection() == thinking_selection



def test_to_message_send_request_rehydrates_legacy_thinking_selection_from_legacy_fields() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )
    run = store.create_run(
        thread_id="thread-1",
        run_id="run-legacy",
        request=RuntimeStoredRunInput(
            message_role="user",
            message_content="Hello",
            policy=RuntimeStoredRunPolicy(
                model_route=RuntimeStoredModelRoute(
                    provider_profile_id="provider-1",
                    snapshot=RuntimeStoredModelRouteSnapshot(
                        provider="openai",
                        endpoint_type="openai-compatible",
                        base_url="https://example.com/v1",
                        model_id="gpt-4.1",
                    ),
                ),
                thinking_selection=RuntimeStoredThinkingSelection(
                    series="compat-discrete-selection-v1",
                    mode="preset",
                    level="medium",
                ),
            ),
            agent_id="default",
        ),
    )

    message_request, legacy_fallback_used, rehydrate_error = bridge._to_message_send_request(run)
    selection = message_request.policy.resolve_thinking_selection()

    assert selection is not None
    assert selection.series == "compat-discrete-selection-v1"
    assert selection.to_legacy_level_intent() == "medium"
    assert legacy_fallback_used is True
    assert rehydrate_error is None



def test_to_message_send_request_preserves_empty_thinking_selection_path() -> None:
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

    message_request, legacy_fallback_used, rehydrate_error = bridge._to_message_send_request(run)

    assert message_request.policy.resolve_thinking_selection() is None
    assert legacy_fallback_used is False
    assert rehydrate_error is None



def test_resolve_initial_run_metadata_fail_soft_logs_rehydrate_skip(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
    )
    run = store.create_run(
        thread_id="thread-1",
        run_id="run-invalid",
        request=RuntimeStoredRunInput(
            message_role="user",
            message_content="Hello",
            policy=RuntimeStoredRunPolicy(
                model_route=RuntimeStoredModelRoute(
                    provider_profile_id="provider-1",
                    snapshot=RuntimeStoredModelRouteSnapshot(
                        provider="openai",
                        endpoint_type="openai-compatible",
                        base_url="https://example.com/v1",
                        model_id="gpt-4.1",
                    ),
                ),
                thinking_selection=RuntimeStoredThinkingSelection(
                    series="qwen-thinking-switch-v1",
                    value_payload={"valueType": "code"},
                ),
            ),
            agent_id="default",
        ),
    )
    captured_logs: list[tuple[str, dict[str, object]]] = []
    bridge_module = __import__("app.copilot_runtime.bridge", fromlist=["log_runtime_chain_debug"])

    def _capture_log(event_name: str, *, enabled: bool | None = None, **payload: object) -> None:
        captured_logs.append((event_name, payload))

    monkeypatch.setattr(bridge_module, "log_runtime_chain_debug", _capture_log)

    with caplog.at_level("WARNING", logger="uvicorn.error"):
        metadata = asyncio.run(
            bridge._resolve_initial_run_metadata(
                run=run,
                runtime_method="run/start",
                request_id="req-1",
            )
        )

    warning_logs = [
        record.getMessage()
        for record in caplog.records
        if "thinking selection rehydrate skipped" in record.getMessage()
    ]
    skip_logs = [payload for name, payload in captured_logs if name == "thinking.run_metadata_rehydrate_skipped"]

    assert metadata["requestedThinkingSelection"] is None
    assert len(warning_logs) == 1
    assert "request_id=req-1" in warning_logs[0]
    assert "runtime_method=run/start" in warning_logs[0]
    assert "thread_id=thread-1" in warning_logs[0]
    assert "run_id=run-invalid" in warning_logs[0]
    assert "phase=prime_run_metadata" in warning_logs[0]
    assert "legacy_fallback_used=False" in warning_logs[0]
    assert "exception_type=ValueError" in warning_logs[0]
    assert "exception_summary=Stored provider-specific thinkingSelection payload is invalid." in warning_logs[0]
    assert len(skip_logs) == 1
    assert skip_logs[0]["requestId"] == "req-1"
    assert skip_logs[0]["runtimeMethod"] == "run/start"
    assert skip_logs[0]["runId"] == "run-invalid"
    assert skip_logs[0]["threadId"] == "thread-1"
    assert skip_logs[0]["phase"] == "prime_run_metadata"
    assert skip_logs[0]["legacyFallbackUsed"] is False
    assert skip_logs[0]["skippedThinkingSelectionRehydrate"] is True
    assert skip_logs[0]["error"] == {
        "type": "ValueError",
        "message": "Stored provider-specific thinkingSelection payload is invalid.",
    }



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
        "series": "fixed-off-v1",
        "controlSpec": {
            "kind": "fixed",
            "selectionKind": "preset",
            "presetOptions": [{"kind": "preset", "value": "off"}],
            "fixedSelection": {"kind": "preset", "value": "off"},
        },
        "defaultSelection": {"kind": "preset", "value": "off"},
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
        "provenance": {
            "routeStatus": "unknown",
            "override": {
                "present": False,
                "applied": False,
                "source": None,
                "format": None,
            },
        },
        "visibility": {
            "reasoning": "visible",
            "supportsSuppression": True,
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
                    "requestedThinkingSelection": {
                        "series": "compat-discrete-selection-v1",
                        "mode": "preset",
                        "level": "medium",
                        "budgetTokens": None,
                    },
                    "appliedThinkingSelection": None,
                    "requestedThinkingLevel": "medium",
                    "appliedThinkingLevel": None,
                    "thinkingCapabilitySnapshot": thinking_capability_snapshot,
                    "thinkingSeriesDecision": {
                        "requestedSelection": {"kind": "preset", "value": "medium"},
                        "appliedSelection": None,
                        "requestedThinkingLevel": "medium",
                        "appliedThinkingLevel": None,
                        "applied": False,
                        "reasonCode": "requested_level_not_in_capability",
                        "errorCode": "thinking_not_supported_for_route",
                        "mappingReasonCode": "selection_not_allowed_by_capability",
                        "providerMapping": None,
                        "capabilityStatus": "unknown-without-override",
                        "capabilitySource": "unknown",
                        "overridePresent": False,
                        "overrideApplied": False,
                    },
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
    assert updated_run.metadata["requestedThinkingSelection"] == {
        "series": "compat-discrete-selection-v1",
        "value": {
            "valueType": "code",
            "code": "medium",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "medium",
        },
    }
    assert updated_run.metadata["appliedThinkingSelection"] is None
    assert updated_run.metadata["thinkingCapabilitySnapshot"] == thinking_capability_snapshot
    assert updated_run.metadata["thinkingSeriesDecision"] == {
        "requestedSelection": {"kind": "preset", "value": "medium"},
        "appliedSelection": None,
        "requestedThinkingLevel": "medium",
        "appliedThinkingLevel": None,
        "applied": False,
        "reasonCode": "requested_level_not_in_capability",
        "errorCode": "thinking_not_supported_for_route",
        "mappingReasonCode": "selection_not_allowed_by_capability",
        "providerMapping": None,
        "capabilityStatus": "unknown-without-override",
        "capabilitySource": "unknown",
        "overridePresent": False,
        "overrideApplied": False,
    }
    run_view = scaffold.build_run_view(run=updated_run)
    assert run_view.requestedThinkingSelection is not None
    assert run_view.requestedThinkingSelection.to_dict() == {
        "series": "compat-discrete-selection-v1",
        "value": {
            "valueType": "code",
            "code": "medium",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "medium",
        },
    }
    assert run_view.appliedThinkingSelection is None
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


def test_get_thinking_capability_returns_structured_capability_response() -> None:
    store = InMemorySessionStore()
    session = store.create(bound_agent_id="default", session_id="session-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        model_route_resolver=_EchoModelRouteResolver(),
    )

    response = asyncio.run(
        bridge.get_thinking_capability(
            session_id=session.session_id,
            model_route=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            thinking_capability_override={
                "supported": True,
                "levels": ["low", "high"],
                "defaultLevel": "high",
                "source": "settings-page",
            },
        )
    )

    assert response.ok is True
    assert response.sessionId == "session-1"
    assert response.capabilitySchemaVersion == "canonical-thinking-capability-v2"
    assert response.capability == {
        "status": "verified-supported",
        "source": "verified",
        "series": "openai-4-level-minimal-v1",
        "seriesLabelZh": "OpenAI 4 档 Minimal 系",
        "editorType": "discrete",
        "allowedValues": [
            {"valueType": "code", "code": "minimal", "mode": None, "budgetTokens": None, "labelZh": "极简"},
            {"valueType": "code", "code": "low", "mode": None, "budgetTokens": None, "labelZh": "低"},
            {"valueType": "code", "code": "medium", "mode": None, "budgetTokens": None, "labelZh": "中"},
            {"valueType": "code", "code": "high", "mode": None, "budgetTokens": None, "labelZh": "高"},
        ],
        "defaultValue": {
            "valueType": "code",
            "code": "medium",
            "mode": None,
            "budgetTokens": None,
            "labelZh": "中",
        },
        "providerBuilderKey": "openai_reasoning_effort_v1",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
    }
    assert summarize_runtime_thinking_capability(response.capability) == {
        "status": "verified-supported",
        "source": "verified",
        "series": "openai-4-level-minimal-v1",
        "seriesLabelZh": "OpenAI 4 档 Minimal 系",
        "editorType": "discrete",
        "allowedValues": [
            {"valueType": "code", "code": "minimal", "labelZh": "极简"},
            {"valueType": "code", "code": "low", "labelZh": "低"},
            {"valueType": "code", "code": "medium", "labelZh": "中"},
            {"valueType": "code", "code": "high", "labelZh": "高"},
        ],
        "defaultValue": {
            "valueType": "code",
            "code": "medium",
            "labelZh": "中",
        },
        "providerBuilderKey": "openai_reasoning_effort_v1",
        "reasonCode": "verified_series_resolved",
        "routeFingerprint": {
            "providerProfileId": "provider-1",
            "provider": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
        },
    }


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


def _build_run_start_request(
    *,
    thread_id: str,
    model_route: RuntimeModelRoute | None = None,
    thinking_selection: RuntimeThinkingSelection | None = None,
    thinking_capability_override: dict[str, object] | None = None,
) -> RuntimeRunStartRequest:
    return RuntimeRunStartRequest(
        thread_id=thread_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=model_route
            or RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
                    model_id="gpt-4.1",
                ),
            ),
            thinkingSelection=thinking_selection,
            thinkingCapabilityOverride=thinking_capability_override,
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
