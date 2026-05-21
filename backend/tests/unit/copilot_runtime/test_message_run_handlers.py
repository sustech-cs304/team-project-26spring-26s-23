from __future__ import annotations

import pytest

from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeRunStartRequest,
)
from app.copilot_runtime.model_routes import (
    RuntimeModelRoute,
    RuntimeModelRouteRef,
)
from app.copilot_runtime.debug_logging import (
    COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR,
)
from app.copilot_runtime.runs.message_run_handlers import (
    MessageRunExecutionContext,
    build_run_started_event,
    create_message_run_context,
)


def _build_policy(*, debug_mode_enabled: bool | None = None) -> RuntimeMessageExecutionPolicy:
    return RuntimeMessageExecutionPolicy(
        modelRoute=RuntimeModelRoute(
            provider_profile_id="provider-1",
            route_ref=RuntimeModelRouteRef(
                route_kind="provider-model",
                profile_id="provider-1",
                model_id="gpt-4.1",
            ),
        ),
        debugModeEnabled=debug_mode_enabled,
        requestOptions={},
    )


def _build_request(
    *,
    thread_id: str = "thread-1",
    debug_mode_enabled: bool | None = None,
) -> RuntimeRunStartRequest:
    return RuntimeRunStartRequest(
        thread_id=thread_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=_build_policy(debug_mode_enabled=debug_mode_enabled),
        agent_id="default",
    )


class TestCreateMessageRunContext:
    def test_with_explicit_run_id(self) -> None:
        request = _build_request()
        call_count = 0

        def fallback() -> str:
            nonlocal call_count
            call_count += 1
            return "should-not-be-used"

        context = create_message_run_context(
            request=request,
            run_id="explicit-run",
            next_run_id_factory=fallback,
        )

        assert call_count == 0
        assert context.run_id == "explicit-run"
        assert context.assistant_message_id == "explicit-run:assistant"
        assert context.events is not None
        assert context.projector is not None
        assert context.execution_events is not None

    def test_without_run_id_uses_factory(self) -> None:
        request = _build_request()

        context = create_message_run_context(
            request=request,
            run_id=None,
            next_run_id_factory=lambda: "factory-run",
        )

        assert context.run_id == "factory-run"
        assert context.assistant_message_id == "factory-run:assistant"

    def test_debug_explicitly_enabled(self) -> None:
        request = _build_request(debug_mode_enabled=True)

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        assert context.debug_enabled is True

    def test_debug_explicitly_disabled(self) -> None:
        request = _build_request(debug_mode_enabled=False)

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        assert context.debug_enabled is False

    def test_debug_falls_back_to_env_when_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR, "1")
        request = _build_request(debug_mode_enabled=None)

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        assert context.debug_enabled is True

    def test_debug_falls_back_to_env_when_env_not_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(COPILOT_RUNTIME_CHAIN_DEBUG_ENV_VAR, raising=False)
        request = _build_request(debug_mode_enabled=None)

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        assert context.debug_enabled is False

    def test_context_has_correct_types(self) -> None:
        request = _build_request()

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        assert isinstance(context, MessageRunExecutionContext)
        assert isinstance(context.run_id, str)
        assert isinstance(context.debug_enabled, bool)
        assert isinstance(context.assistant_message_id, str)

    def test_events_factory_uses_thread_id_as_session(self) -> None:
        request = _build_request(thread_id="thread-99")

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        event = context.events.build("run_started")
        assert event.sessionId == "thread-99"
        assert event.runId == "run-1"


class TestBuildRunStartedEvent:
    def test_produces_correct_shape(self) -> None:
        request = _build_request(thread_id="thread-1")

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        event = build_run_started_event(context=context, request=request)

        assert event.type == "run_started"
        assert event.runId == "run-1"
        assert event.sessionId == "thread-1"
        assert event.sequence == 1
        assert event.payload == {"assistantMessageId": "run-1:assistant"}

    def test_uses_custom_run_id_in_payload(self) -> None:
        request = _build_request(thread_id="thread-abc")

        context = create_message_run_context(
            request=request,
            run_id="custom-run-id",
            next_run_id_factory=lambda: "fallback",
        )

        event = build_run_started_event(context=context, request=request)

        assert event.runId == "custom-run-id"
        assert event.payload["assistantMessageId"] == "custom-run-id:assistant"

    def test_returns_runtime_run_event_instance(self) -> None:
        from app.copilot_runtime.run_events import RuntimeRunEvent

        request = _build_request()

        context = create_message_run_context(
            request=request,
            run_id="run-1",
            next_run_id_factory=lambda: "fallback",
        )

        event = build_run_started_event(context=context, request=request)

        assert isinstance(event, RuntimeRunEvent)
