from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.persistence import SQLiteSessionStore, create_session_factory
from app.copilot_runtime.persistence.models.chat import RunProjectionModel, ThreadProjectionModel
from app.copilot_runtime.persistence.projections import ProjectionRebuildStats, ProjectionService
from app.copilot_runtime.persistence.repositories import run_lifecycle_transaction
from app.copilot_runtime.session_store import (
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
)



def test_projection_service_refreshes_thread_and_run_projections(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    session_factory = create_session_factory(store.engine)
    completed_payload = {
        "assistantMessageId": "run-1:assistant",
        "assistantText": "Shenzhen 晴 / 24°C",
        "resolvedToolIds": ["tool.weather-current"],
        "requestOptions": {"temperature": 0},
        "resolvedModelId": "gpt-4.1",
        "resolvedModelRoute": {
            "providerProfileId": "provider-1",
            "provider": "OpenAI",
            "providerId": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://example.com/v1",
            "modelId": "gpt-4.1",
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": "provider-1",
                "modelId": "gpt-4.1",
            },
        },
    }
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="How is the weather in Shenzhen today?"),
        )
        store.touch_run(
            "run-1",
            metadata={
                "requestedThinkingSelection": {
                    "series": "compat-discrete-selection-v1",
                    "mode": "preset",
                    "level": "medium",
                },
                "appliedThinkingSelection": {
                    "series": "compat-discrete-selection-v1",
                    "mode": "preset",
                    "level": "medium",
                },
                "resolvedModelRoute": completed_payload["resolvedModelRoute"],
                "thinkingCapabilitySnapshot": {
                    "supported": True,
                    "source": "unit-test",
                },
            },
        )
        store.record_run_event(
            "run-1",
            event_type="run_started",
            payload={"assistantMessageId": "run-1:assistant"},
        )
        store.record_run_event(
            "run-1",
            event_type="run_metadata",
            payload={
                "requestedThinkingSelection": {
                    "series": "compat-discrete-selection-v1",
                    "mode": "preset",
                    "level": "medium",
                },
                "appliedThinkingSelection": {
                    "series": "compat-discrete-selection-v1",
                    "mode": "preset",
                    "level": "medium",
                },
            },
        )
        store.record_run_event(
            "run-1",
            event_type="reasoning_delta",
            payload={"delta": "先分析天气信息"},
        )
        store.record_run_event(
            "run-1",
            event_type="reasoning_delta",
            payload={"delta": "，再总结结果。"},
        )
        store.record_run_event(
            "run-1",
            event_type="tool_event",
            payload={
                "toolCallId": "tool.weather-current:call-1",
                "toolId": "tool.weather-current",
                "phase": "started",
                "title": "调用天气工具",
                "summary": "正在获取 Shenzhen 的天气。",
                "inputSummary": '{"location": "Shenzhen"}',
            },
        )
        store.record_run_event(
            "run-1",
            event_type="tool_event",
            payload={
                "toolCallId": "tool.weather-current:call-1",
                "toolId": "tool.weather-current",
                "phase": "completed",
                "title": "天气工具已返回结果",
                "summary": "Shenzhen：晴 / 24°C",
                "resultSummary": "Shenzhen：晴 / 24°C",
            },
        )
        store.record_run_event(
            "run-1",
            event_type="run_diagnostic",
            payload={
                "code": "tool_latency",
                "message": "Tool responded slower than expected.",
                "stage": "execute_model",
                "details": {"latencyMs": 123},
            },
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"assistantMessageId": "run-1:assistant", "delta": "Shenzhen "},
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"assistantMessageId": "run-1:assistant", "delta": "晴 / 24°C"},
        )
        store.record_run_event(
            "run-1",
            event_type="run_completed",
            payload=completed_payload,
        )
        store.mark_run_completed(
            "run-1",
            assistant_text="Shenzhen 晴 / 24°C",
            metadata={
                "terminal_event": "run_completed",
                "terminal_payload": completed_payload,
            },
        )

        with run_lifecycle_transaction(session_factory) as repositories:
            run_projection = repositories.projections.get_run_projection("run-1")
            thread_projection = repositories.projections.get_thread_projection("thread-1")

            assert run_projection is not None
            assert thread_projection is not None
            assert run_projection.assistant_text_final == "Shenzhen 晴 / 24°C"
            assert [item["kind"] for item in run_projection.timeline_items_json or []] == [
                "user_message",
                "reasoning_block",
                "tool_call_block",
                "diagnostic_block",
                "assistant_message",
                "terminal_block",
            ]
            assert (run_projection.timeline_items_json or [])[1]["text"] == "先分析天气信息，再总结结果。"
            assert (run_projection.tool_call_blocks_json or [])[0]["toolCallId"] == "tool.weather-current:call-1"
            assert [phase["phase"] for phase in (run_projection.tool_call_blocks_json or [])[0]["phases"]] == [
                "started",
                "completed",
            ]
            assert (run_projection.diagnostic_blocks_json or [])[0]["code"] == "tool_latency"
            terminal_state = run_projection.terminal_state_json
            assert terminal_state is not None
            assert terminal_state == {
                "status": "completed",
                "eventType": "run_completed",
                "assistantText": "Shenzhen 晴 / 24°C",
                "payload": completed_payload,
                "endedAt": terminal_state["endedAt"],
                "failureCode": None,
                "failureMessage": None,
                "cancelReason": None,
            }
            assert thread_projection.display_title == "How is the weather in Shenzhen today?"
            assert thread_projection.display_summary == "Shenzhen 晴 / 24°C"
            assert thread_projection.last_run_status == "completed"
            assert thread_projection.last_effective_model_snapshot_json == {
                "selectedModelRoute": {
                    "providerProfileId": "provider-1",
                    "routeRef": {
                        "routeKind": "provider-model",
                        "profileId": "provider-1",
                        "modelId": "gpt-4.1",
                    },
                },
                "resolvedModelRoute": completed_payload["resolvedModelRoute"],
                "resolvedModelId": "gpt-4.1",
                "requestedThinkingSelection": {
                    "series": "compat-discrete-selection-v1",
                    "mode": "preset",
                    "level": "medium",
                },
                "appliedThinkingSelection": {
                    "series": "compat-discrete-selection-v1",
                    "mode": "preset",
                    "level": "medium",
                },
                "thinkingCapabilityOverride": None,
                "thinkingLevelIntent": None,
                "debugModeEnabled": None,
            }
            assert thread_projection.last_effective_tools_snapshot_json == {
                "enabledToolIds": [],
                "resolvedToolIds": ["tool.weather-current"],
            }
            assert thread_projection.drift_summary_json == {
                "status": "not_evaluated",
                "historicalModelId": "gpt-4.1",
                "historicalToolIds": ["tool.weather-current"],
            }
            assert [item["kind"] for item in thread_projection.timeline_preview_json or []] == [
                "diagnostic_block",
                "assistant_message",
                "terminal_block",
            ]
    finally:
        store.dispose()



def test_projection_service_rebuilds_cached_rows_from_truth_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    session_factory = create_session_factory(store.engine)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="Persist this run"),
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"assistantMessageId": "run-1:assistant", "delta": "Persisted reply"},
        )
        store.record_run_event(
            "run-1",
            event_type="run_completed",
            payload={
                "assistantMessageId": "run-1:assistant",
                "assistantText": "Persisted reply",
            },
        )
        store.mark_run_completed(
            "run-1",
            assistant_text="Persisted reply",
            metadata={
                "terminal_event": "run_completed",
                "terminal_payload": {
                    "assistantMessageId": "run-1:assistant",
                    "assistantText": "Persisted reply",
                },
            },
        )

        with run_lifecycle_transaction(session_factory) as repositories:
            repositories.session.execute(delete(RunProjectionModel))
            repositories.session.execute(delete(ThreadProjectionModel))

        stats = ProjectionService(session_factory).rebuild_all()

        assert stats == ProjectionRebuildStats(rebuilt_run_count=1, rebuilt_thread_count=1)

        with run_lifecycle_transaction(session_factory) as repositories:
            run_projection = repositories.projections.get_run_projection("run-1")
            thread_projection = repositories.projections.get_thread_projection("thread-1")

            assert run_projection is not None
            assert run_projection.assistant_text_final == "Persisted reply"
            assert thread_projection is not None
            assert thread_projection.display_title == "Persist this run"
            assert thread_projection.display_summary == "Persisted reply"
    finally:
        store.dispose()



def test_projection_service_prefers_last_run_pointer_then_activity_fallback(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    store = SQLiteSessionStore(db_path=db_path)
    session_factory = create_session_factory(store.engine)
    try:
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="First request"),
        )
        store.mark_run_completed("run-1", assistant_text="First reply")
        store.create_run(
            thread_id="thread-1",
            run_id="run-2",
            request=_build_stored_run_input(user_text="Second request"),
        )

        with run_lifecycle_transaction(session_factory) as repositories:
            run_one = repositories.runs.require("run-1")
            run_two = repositories.runs.require("run-2")
            thread = repositories.threads.require("thread-1")

            run_one.ended_at = run_one.updated_at
            run_two.updated_at = run_two.created_at
            run_two.ended_at = None
            thread.last_run_id = "run-1"
            repositories.session.flush()

            ProjectionService.refresh_thread_in_transaction(repositories, "thread-1")
            thread_projection = repositories.projections.get_thread_projection("thread-1")
            assert thread_projection is not None
            assert thread_projection.last_run_status == "completed"
            assert thread_projection.last_activity_at == run_one.ended_at

            thread.last_run_id = None
            run_two.updated_at = run_one.updated_at
            run_two.ended_at = run_one.ended_at
            repositories.session.flush()

            ProjectionService.refresh_thread_in_transaction(repositories, "thread-1")
            refreshed_projection = repositories.projections.get_thread_projection("thread-1")
            assert refreshed_projection is not None
            assert refreshed_projection.last_run_status == "pending"
            assert refreshed_projection.last_activity_at is not None
            assert refreshed_projection.last_activity_at.replace(tzinfo=None) == run_two.ended_at
    finally:
        store.dispose()



def _build_stored_run_input(*, user_text: str) -> RuntimeStoredRunInput:
    return RuntimeStoredRunInput(
        message_role="user",
        message_content=user_text,
        policy=RuntimeStoredRunPolicy(
            model_route=RuntimeStoredModelRoute(
                provider_profile_id="provider-1",
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id="provider-1",
                    model_id="gpt-4.1",
                ),
            ),
            enabled_tools=(),
            request_options={},
        ),
        agent_id="default",
    )
