from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import closing
from typing import Literal, TypedDict, cast
from unittest.mock import MagicMock

import pytest

from app.copilot_runtime import RuntimeToolApprovalCoordinator
from app.copilot_runtime.agent_registry import (
    AgentRegistry,
    build_default_agent_registry,
)
from app.copilot_runtime.bridge import (
    AgentNotFoundError,
    RunNotFoundError,
    RuntimeBridge,
    SessionNotFoundError,
    ThreadNotFoundError,
)
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeRunStartRequest,
    RuntimeToolApprovalResolveRequest,
    RuntimeThinkingSelection,
    RuntimeThinkingValue,
    RuntimeToolPermissionPolicy,
    build_runtime_scaffold,
)
from app.copilot_runtime.model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
    RuntimeModelRouteResolver,
)
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
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
    RuntimeStoredThinkingSelection,
)
from app.copilot_runtime.tool_registry import build_default_tool_registry
from app.copilot_runtime.runs.message_run_services import RuntimeMessageRunOrchestrator


class _ToolPermissionPolicyPayload(TypedDict):
    schemaVersion: int
    defaultMode: Literal["allow", "ask", "delay", "deny"]
    toolModes: dict[str, Literal["allow", "ask", "delay", "deny"]]
    toolTimeoutSeconds: dict[str, int | str]
    toolTimeoutActions: dict[str, Literal["approve", "deny"]]


class _StubMessageRunOrchestrator:
    def __init__(self, *, events: list[RuntimeRunEvent]) -> None:
        self._events = list(events)
        self.received_requests: list[RuntimeRunStartRequest] = []
        self.received_run_ids: list[str | None] = []
        self.received_disconnect_callbacks: list[
            Callable[[], Awaitable[bool]] | None
        ] = []

    async def stream_events(
        self,
        *,
        request: RuntimeRunStartRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
        run_id: str | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
        self.received_requests.append(request)
        self.received_run_ids.append(run_id)
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
        request: RuntimeRunStartRequest,
        is_client_disconnected: Callable[[], Awaitable[bool]] | None = None,
        run_id: str | None = None,
    ) -> AsyncIterator[RuntimeRunEvent]:
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
                payload={
                    "assistantMessageId": assistant_message_id,
                    "reason": "cancelled",
                },
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


def test_stream_run_delegates_to_orchestrator_and_preserves_request() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    request = _build_run_start_request(thread_id="thread-1")
    seed_bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )
    run = seed_bridge.start_run(request=request)
    expected_events = [
        RuntimeRunEventFactory(session_id="thread-1", run_id=run.run_id).build(
            RUN_STARTED_EVENT_TYPE,
            payload={"assistantMessageId": f"{run.run_id}:assistant"},
        )
    ]
    orchestrator = _StubMessageRunOrchestrator(events=expected_events)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        message_run_orchestrator=cast(RuntimeMessageRunOrchestrator, orchestrator),
    )

    disconnected = False

    async def is_client_disconnected() -> bool:
        return disconnected

    events = asyncio.run(
        _collect_events(
            bridge.stream_run(
                run_id=run.run_id,
                is_client_disconnected=is_client_disconnected,
            )
        )
    )

    assert events == expected_events
    assert orchestrator.received_requests == [request]
    assert orchestrator.received_run_ids == [run.run_id]

    checker = orchestrator.received_disconnect_callbacks[0]
    assert checker is not None
    assert checker is not is_client_disconnected
    assert asyncio.run(_invoke_disconnect_callback(checker)) is False

    disconnected = True
    assert asyncio.run(_invoke_disconnect_callback(checker)) is True

    disconnected = False
    assert asyncio.run(_invoke_disconnect_callback(checker)) is False


def test_start_run_stores_provider_specific_thinking_selection_value_payload_and_rehydrates_request() -> (
    None
):
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
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id="provider-1",
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
                    "defaultValue": {
                        "valueType": "code",
                        "code": "true",
                        "labelZh": "开启",
                    },
                },
                "source": "settings-page",
            },
        )
    )

    stored_selection = run.request.policy.thinking_selection
    assert stored_selection is not None
    assert stored_selection.value_payload == thinking_selection.value.to_dict()

    run_start_request, legacy_fallback_used, rehydrate_error = (
        bridge._to_run_start_request(run)
    )

    assert legacy_fallback_used is False
    assert rehydrate_error is None
    assert run_start_request.policy.resolve_thinking_selection() == thinking_selection


def test_start_run_round_trips_tool_permission_policy() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    run = bridge.start_run(
        request=_build_run_start_request(
            thread_id="thread-1",
            tool_permission_policy={
                "schemaVersion": 1,
                "defaultMode": "ask",
                "toolModes": {"tool.weather-current": "delay"},
                "toolTimeoutSeconds": {"tool.weather-current": 27},
                "toolTimeoutActions": {"tool.weather-current": "approve"},
            },
        )
    )

    assert run.request.policy.tool_permission_policy == {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {"tool.weather-current": "delay"},
        "toolTimeoutSeconds": {"tool.weather-current": 27},
        "toolTimeoutActions": {"tool.weather-current": "approve"},
    }

    run_start_request, legacy_fallback_used, rehydrate_error = (
        bridge._to_run_start_request(run)
    )

    assert legacy_fallback_used is False
    assert rehydrate_error is None
    assert run_start_request.policy.toolPermissionPolicy is not None
    assert run_start_request.policy.toolPermissionPolicy.to_dict() == {
        "schemaVersion": 1,
        "defaultMode": "ask",
        "toolModes": {"tool.weather-current": "delay"},
        "toolTimeoutSeconds": {"tool.weather-current": 27},
        "toolTimeoutActions": {"tool.weather-current": "approve"},
    }


def test_resolve_tool_approval_calls_coordinator_and_builds_response() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)

    with closing(asyncio.new_event_loop()) as approval_loop:
        approval_coordinator = RuntimeToolApprovalCoordinator(
            _loop_provider=lambda: approval_loop,
        )
        bridge = RuntimeBridge(
            session_store=store,
            agent_registry=registry,
            scaffold=scaffold,
            approval_coordinator=approval_coordinator,
        )
        approval_coordinator.create_request(
            run_id="run-approve",
            tool_call_id="call-approve",
            tool_id="tool.fs.read",
            mode="ask",
        )

        response = bridge.resolve_tool_approval(
            request=RuntimeToolApprovalResolveRequest(
                run_id="run-approve",
                tool_call_id="call-approve",
                decision="approved",
            )
        )

    payload = response.to_dict()
    assert payload["ok"] is True
    assert payload["runId"] == "run-approve"
    assert payload["toolCallId"] == "call-approve"
    assert payload["decision"] == "approved"
    assert payload["status"] == "approved"
    assert payload["source"] == "manual"
    assert payload["details"] == {
        "toolId": "tool.fs.read",
        "mode": "ask",
    }
    assert payload["resolvedAt"]


def test_to_message_send_request_rehydrates_legacy_thinking_selection_from_legacy_fields() -> (
    None
):
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
                    route_ref=RuntimeModelRouteRef(
                        route_kind="provider-model",
                        profile_id="provider-1",
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

    run_start_request, legacy_fallback_used, rehydrate_error = (
        bridge._to_run_start_request(run)
    )
    selection = run_start_request.policy.resolve_thinking_selection()

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

    run_start_request, legacy_fallback_used, rehydrate_error = (
        bridge._to_run_start_request(run)
    )

    assert run_start_request.policy.resolve_thinking_selection() is None
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
                    route_ref=RuntimeModelRouteRef(
                        route_kind="provider-model",
                        profile_id="provider-1",
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
    bridge_module = __import__(
        "app.copilot_runtime.bridge", fromlist=["log_runtime_chain_debug"]
    )

    def _capture_log(
        event_name: str, *, enabled: bool | None = None, **payload: object
    ) -> None:
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
    skip_logs = [
        payload
        for name, payload in captured_logs
        if name == "thinking.run_metadata_rehydrate_skipped"
    ]

    assert metadata["requestedThinkingSelection"] is None
    assert len(warning_logs) == 1
    assert "request_id=req-1" in warning_logs[0]
    assert "runtime_method=run/start" in warning_logs[0]
    assert "thread_id=thread-1" in warning_logs[0]
    assert "run_id=run-invalid" in warning_logs[0]
    assert "phase=prime_run_metadata" in warning_logs[0]
    assert "legacy_fallback_used=False" in warning_logs[0]
    assert "exception_type=ValueError" in warning_logs[0]
    assert (
        "exception_summary=Stored provider-specific thinkingSelection payload is invalid."
        in warning_logs[0]
    )
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
                payload={
                    "assistantMessageId": f"{run.run_id}:assistant",
                    "delta": "Hello back",
                },
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
        message_run_orchestrator=cast(RuntimeMessageRunOrchestrator, orchestrator),
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
    assert (
        updated_run.metadata["thinkingCapabilitySnapshot"]
        == thinking_capability_snapshot
    )
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
    assert [
        (event.event_type, event.sequence)
        for event in store.list_run_events(run.run_id)
    ] == [
        (RUN_STARTED_EVENT_TYPE, 1),
        (RUN_METADATA_EVENT_TYPE, 2),
        (TEXT_DELTA_EVENT_TYPE, 3),
        (RUN_COMPLETED_EVENT_TYPE, 4),
    ]
    assert [
        (message.role, message.content) for message in store.list_messages("thread-1")
    ] == [
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
        message_run_orchestrator=cast(RuntimeMessageRunOrchestrator, orchestrator),
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
    assert [(message.role, message.content) for message in store.list_messages("thread-1")] == [
        ("user", "Hello"),
        ("assistant", "partial"),
    ]


def test_get_capabilities_returns_tool_catalog_recommendations_and_version() -> None:
    store = InMemorySessionStore()
    thread = store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    capabilities = bridge.get_capabilities(session_id=thread.thread_id)

    assert capabilities.sessionId == thread.thread_id
    assert capabilities.boundAgent.agentId == "default"
    assert capabilities.toolSelectionMode == "recommendation-only"
    assert capabilities.recommendedTools == ("tool.fs.read",)
    assert capabilities.capabilitiesVersion == "capabilities:agents-v1:tools-v1"
    tool_ids = {tool.toolId for tool in capabilities.tools}
    assert "tool.fs.read" in tool_ids
    assert any(
        tool.toolId == "tool.fs.read"
        and tool.displayName in {"File Read", "文件读取"}
        for tool in capabilities.tools
    )


def test_get_capabilities_raises_session_not_found_error_for_unknown_session() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    with pytest.raises(
        SessionNotFoundError, match="Unknown session 'missing-session'."
    ):
        bridge.get_capabilities(session_id="missing-session")


def test_get_capabilities_raises_agent_not_found_for_unknown_bound_agent() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="missing-agent", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    with pytest.raises(AgentNotFoundError, match="Unknown agent 'missing-agent'."):
        bridge.get_capabilities(session_id="thread-1")


async def _collect_events(events) -> list[RuntimeRunEvent]:
    return [event async for event in events]


async def _invoke_disconnect_callback(
    callback: Callable[[], Awaitable[bool]],
) -> bool:
    return await callback()


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
    tool_permission_policy: _ToolPermissionPolicyPayload | None = None,
) -> RuntimeRunStartRequest:
    resolved_tool_permission_policy = (
        None
        if tool_permission_policy is None
        else RuntimeToolPermissionPolicy(
            schemaVersion=tool_permission_policy["schemaVersion"],
            defaultMode=tool_permission_policy["defaultMode"],
            toolModes=dict(tool_permission_policy["toolModes"]),
            toolTimeoutSeconds=dict(tool_permission_policy["toolTimeoutSeconds"]),
            toolTimeoutActions=dict(tool_permission_policy["toolTimeoutActions"]),
        )
    )
    return RuntimeRunStartRequest(
        thread_id=thread_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=model_route
            or RuntimeModelRoute(
                provider_profile_id="provider-1",
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id="provider-1",
                    model_id="gpt-4.1",
                ),
            ),
            thinkingSelection=thinking_selection,
            thinkingCapabilityOverride=thinking_capability_override,
            enabledTools=(),
            toolPermissionPolicy=resolved_tool_permission_policy,
            requestOptions={},
        ),
        agent_id="default",
    )


class _FakeModelRouteResolver:
    def __init__(self, resolved_route: ResolvedRuntimeModelRoute) -> None:
        self._resolved_route = resolved_route

    async def resolve(
        self, model_route: RuntimeModelRoute
    ) -> ResolvedRuntimeModelRoute:
        return self._resolved_route


def test_create_thread_happy_path() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    thread = bridge.create_thread(agent_id="default")
    assert thread.bound_agent_id == "default"
    stored = store.get_thread(thread.thread_id)
    assert stored is not None
    assert stored.bound_agent_id == "default"


def test_create_thread_raises_agent_not_found_error() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    with pytest.raises(AgentNotFoundError, match="Unknown agent 'nonexistent'."):
        bridge.create_thread(agent_id="nonexistent")


def test_get_thread_returns_existing_thread() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    thread = store.create_thread(bound_agent_id="default", thread_id="thread-1")
    result = bridge.get_thread(thread_id="thread-1")
    assert result == thread
    assert result.thread_id == "thread-1"
    assert result.bound_agent_id == "default"


def test_get_thread_raises_thread_not_found_error() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    with pytest.raises(ThreadNotFoundError, match="Unknown thread 'missing-thread'."):
        bridge.get_thread(thread_id="missing-thread")


def test_cancel_run_successful() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    run = bridge.start_run(request=_build_run_start_request(thread_id="thread-1"))
    record, changed = bridge.cancel_run(run_id=run.run_id)
    assert record.run_id == run.run_id
    assert changed is True
    assert record.cancel_requested is True


def test_cancel_run_raises_run_not_found_error() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    with pytest.raises(RunNotFoundError, match="Unknown run 'nonexistent'."):
        bridge.cancel_run(run_id="nonexistent")


def test_get_run_returns_existing_run() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    run = bridge.start_run(request=_build_run_start_request(thread_id="thread-1"))
    result = bridge.get_run(run_id=run.run_id)
    assert result == run
    assert result.run_id == run.run_id


def test_get_run_raises_run_not_found_error() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    with pytest.raises(RunNotFoundError, match="Unknown run 'nonexistent'."):
        bridge.get_run(run_id="nonexistent")


def test_set_debug_event_logger_writes_events() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)

    mock_logger = MagicMock()
    bridge.set_debug_event_logger(mock_logger)
    bridge.create_thread(agent_id="default")

    assert mock_logger.write.call_count >= 1
    call_kwargs = mock_logger.write.call_args_list[-1][1]
    assert call_kwargs["event_name"] == "runtime.thread.create.succeeded"


def test_set_debug_event_logger_clears_correctly() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)

    mock_logger = MagicMock()
    bridge.set_debug_event_logger(mock_logger)
    bridge.create_thread(agent_id="default")
    assert mock_logger.write.called

    mock_logger.reset_mock()
    bridge.set_debug_event_logger(None)
    bridge.create_thread(agent_id="default")
    mock_logger.write.assert_not_called()


def test_get_thinking_capability_happy_path() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)

    resolved_route = ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id="gpt-4.1",
        api_key="sk-test",
    )
    fake_resolver = _FakeModelRouteResolver(resolved_route)

    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        model_route_resolver=cast(RuntimeModelRouteResolver, fake_resolver),
    )

    model_route = RuntimeModelRoute(
        provider_profile_id="provider-1",
        route_ref=RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id="provider-1",
            model_id="gpt-4.1",
        ),
    )

    result = asyncio.run(
        bridge.get_thinking_capability(
            session_id="thread-1",
            model_route=model_route,
        )
    )

    assert result.ok is True
    assert result.sessionId == "thread-1"
    assert "capability" in result.to_dict()


def test_get_thinking_capability_raises_when_scaffold_none() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)

    model_route = RuntimeModelRoute(
        provider_profile_id="provider-1",
        route_ref=RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id="provider-1",
            model_id="gpt-4.1",
        ),
    )

    with pytest.raises(
        RuntimeError,
        match="Runtime scaffold is required for thinking capability queries.",
    ):
        asyncio.run(
            bridge.get_thinking_capability(
                session_id="thread-1",
                model_route=model_route,
            )
        )


def test_get_thinking_capability_raises_when_thread_not_found() -> None:
    store = InMemorySessionStore()
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)
    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
    )

    model_route = RuntimeModelRoute(
        provider_profile_id="provider-1",
        route_ref=RuntimeModelRouteRef(
            route_kind="provider-model",
            profile_id="provider-1",
            model_id="gpt-4.1",
        ),
    )

    with pytest.raises(
        SessionNotFoundError,
        match="Unknown session 'missing-thread'.",
    ):
        asyncio.run(
            bridge.get_thinking_capability(
                session_id="missing-thread",
                model_route=model_route,
            )
        )


def test_prime_run_metadata_without_resolver() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    bridge = RuntimeBridge(session_store=store, agent_registry=registry)
    run = bridge.start_run(request=_build_run_start_request(thread_id="thread-1"))

    updated = asyncio.run(
        bridge.prime_run_metadata(
            run_id=run.run_id,
            runtime_method="run/start",
            request_id="req-1",
        )
    )

    assert updated.run_id == run.run_id
    assert "requestedThinkingSelection" in updated.metadata
    assert updated.metadata["requestedThinkingSelection"] is None


def test_prime_run_metadata_with_thinking_selection() -> None:
    store = InMemorySessionStore()
    store.create_thread(bound_agent_id="default", thread_id="thread-1")
    registry = build_default_agent_registry()
    scaffold = _build_scaffold(agent_registry=registry, session_store=store)

    resolved_route = ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id="gpt-4.1",
        api_key="sk-test",
    )
    fake_resolver = _FakeModelRouteResolver(resolved_route)

    bridge = RuntimeBridge(
        session_store=store,
        agent_registry=registry,
        scaffold=scaffold,
        model_route_resolver=cast(RuntimeModelRouteResolver, fake_resolver),
    )

    thinking_selection = RuntimeThinkingSelection(
        series="compat-discrete-selection-v1",
        level="medium",
        labelZh="medium",
    )
    run = bridge.start_run(
        request=_build_run_start_request(
            thread_id="thread-1",
            thinking_selection=thinking_selection,
        )
    )

    updated = asyncio.run(
        bridge.prime_run_metadata(
            run_id=run.run_id,
            runtime_method="run/start",
            request_id="req-1",
        )
    )

    assert updated.run_id == run.run_id
    assert "requestedThinkingSelection" in updated.metadata
    assert updated.metadata["requestedThinkingSelection"] == thinking_selection.to_dict()
    assert "resolvedModelRoute" in updated.metadata
