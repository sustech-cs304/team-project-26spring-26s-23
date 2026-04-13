from __future__ import annotations

from pathlib import Path

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.persistence import create_session_factory, create_sqlite_engine, upgrade_database
from app.copilot_runtime.persistence.repositories import run_lifecycle_transaction
from app.copilot_runtime.session_store import (
    RuntimeRunRecord,
    RuntimeStoredModelRoute,
    RuntimeStoredRunInput,
    RuntimeStoredRunPolicy,
    RuntimeThreadRecord,
)



def test_repositories_round_trip_truth_rows_and_projection_rows(tmp_path: Path) -> None:
    db_path = tmp_path / "database" / "chat.db"
    upgrade_database(db_path=db_path)
    engine = create_sqlite_engine(db_path=db_path)
    session_factory = create_session_factory(engine)
    try:
        thread = RuntimeThreadRecord(
            thread_id="thread-1",
            bound_agent_id="default",
            metadata={"source": "test"},
        )
        run = RuntimeRunRecord(
            run_id="run-1",
            thread_id="thread-1",
            request=_build_stored_run_input(user_text="hello persistence"),
            metadata={"resolvedModelRoute": {"modelId": "gpt-4.1"}},
        )

        with run_lifecycle_transaction(session_factory) as repositories:
            thread_model = repositories.threads.create_from_runtime_record(thread)
            run_model = repositories.runs.create_from_runtime_record(run)
            repositories.threads.touch_for_run(thread_model, run)
            first_event = repositories.events.append_event(
                run_id=run.run_id,
                event_type="run_started",
                payload={
                    "assistantMessageId": "run-1:assistant",
                    "apiKey": "super-secret",
                },
            )
            second_event = repositories.events.append_event(
                run_id=run.run_id,
                event_type="text_delta",
                payload={"delta": "hello back"},
            )
            thread_projection = repositories.projections.upsert_thread_projection(
                thread_id=thread.thread_id,
                last_run_status="pending",
                last_activity_at=run.created_at,
                display_title="hello persistence",
                display_summary="hello back",
            )
            run_projection = repositories.projections.upsert_run_projection(
                run_id=run.run_id,
                assistant_text_final="hello back",
                timeline_items_json=[{"kind": "assistant_message", "text": "hello back"}],
            )

            assert thread_model.last_run_id == "run-1"
            assert run_model.resolved_model_id == "gpt-4.1"
            assert first_event.seq == 1
            assert second_event.seq == 2
            assert first_event.is_redacted is True
            assert first_event.payload_json["apiKey"] == "[redacted]"
            assert thread_projection.display_title == "hello persistence"
            assert run_projection.assistant_text_final == "hello back"

        with run_lifecycle_transaction(session_factory) as repositories:
            stored_thread = repositories.threads.to_runtime_record(repositories.threads.require("thread-1"))
            stored_run = repositories.runs.to_runtime_record(repositories.runs.require("run-1"))
            stored_events = [
                repositories.events.to_runtime_record(model)
                for model in repositories.events.list_for_run("run-1")
            ]
            stored_thread_projection = repositories.projections.get_thread_projection("thread-1")
            stored_run_projection = repositories.projections.get_run_projection("run-1")

            assert stored_thread.last_run_id == "run-1"
            assert stored_run.request.message_content == "hello persistence"
            assert [(event.event_type, event.sequence) for event in stored_events] == [
                ("run_started", 1),
                ("text_delta", 2),
            ]
            assert stored_events[0].payload["apiKey"] == "[redacted]"
            assert stored_thread_projection is not None
            assert stored_thread_projection.display_summary == "hello back"
            assert stored_run_projection is not None
            assert stored_run_projection.timeline_items_json == [
                {"kind": "assistant_message", "text": "hello back"}
            ]
    finally:
        engine.dispose()



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
