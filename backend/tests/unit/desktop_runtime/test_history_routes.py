from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.copilot_runtime.model_routes import RuntimeModelRouteRef
from app.copilot_runtime.session_store import InMemorySessionStore, RuntimeStoredModelRoute, RuntimeStoredRunInput, RuntimeStoredRunPolicy
from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig, DesktopRuntimePaths
from app.desktop_runtime.server import create_app



def test_history_routes_expose_persisted_threads_details_and_run_replay(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="history-token"))

    with TestClient(app) as client:
        store = app.state.copilot_runtime_session_store
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="What changed after restart?"),
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"assistantMessageId": "run-1:assistant", "delta": "Persistent reply"},
        )
        store.record_run_event(
            "run-1",
            event_type="tool_event",
            payload={
                "toolCallId": "tool.weather-current:call-1",
                "toolId": "tool.weather-current",
                "phase": "completed",
                "title": "Weather tool finished",
                "summary": "Shenzhen: sunny",
            },
        )
        store.record_run_event(
            "run-1",
            event_type="run_completed",
            payload={
                "assistantMessageId": "run-1:assistant",
                "assistantText": "Persistent reply",
                "resolvedToolIds": ["tool.weather-current"],
            },
        )
        store.mark_run_completed(
            "run-1",
            assistant_text="Persistent reply",
            metadata={
                "terminal_event": "run_completed",
                "terminal_payload": {
                    "assistantMessageId": "run-1:assistant",
                    "assistantText": "Persistent reply",
                    "resolvedToolIds": ["tool.weather-current"],
                },
            },
        )

        headers = {LOCAL_TOKEN_HEADER_NAME: "history-token"}
        threads_response = client.get("/history/threads", headers=headers)
        detail_response = client.get("/history/threads/thread-1", headers=headers)
        replay_response = client.get("/history/runs/run-1/replay", headers=headers)

    assert threads_response.status_code == 200
    assert detail_response.status_code == 200
    assert replay_response.status_code == 200

    threads_payload = threads_response.json()
    detail_payload = detail_response.json()
    replay_payload = replay_response.json()

    assert threads_payload["ok"] is True
    assert threads_payload["version"] == "chat-history-v1"
    assert threads_payload["threads"][0]["threadId"] == "thread-1"
    assert threads_payload["threads"][0]["title"] == "What changed after restart?"
    assert threads_payload["threads"][0]["summary"] == "Persistent reply"
    assert threads_payload["threads"][0]["lastRunStatus"] == "completed"

    assert detail_payload["ok"] is True
    assert detail_payload["thread"]["threadId"] == "thread-1"
    assert [item["kind"] for item in detail_payload["timelineItems"]] == [
        "user_message",
        "assistant_message",
        "tool_call_block",
        "terminal_block",
    ]
    assert detail_payload["runSummaries"][0]["runId"] == "run-1"
    assert detail_payload["latestConfigurationSnapshot"]["runId"] == "run-1"
    assert detail_payload["availabilityDrift"]["status"] == "not_evaluated"

    assert replay_payload["ok"] is True
    assert replay_payload["run"]["runId"] == "run-1"
    assert [event["eventType"] for event in replay_payload["orderedEvents"]] == [
        "text_delta",
        "tool_event",
        "run_completed",
    ]
    assert replay_payload["toolCallBlocks"][0]["toolCallId"] == "tool.weather-current:call-1"
    assert replay_payload["terminalState"]["status"] == "completed"
    assert replay_payload["availabilityInterpretation"]["status"] == "not_evaluated"



def test_history_routes_support_delete_purge_backup_and_restore(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="history-token"))

    with TestClient(app) as client:
        store = app.state.copilot_runtime_session_store
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="Can you recover this thread?"),
        )
        store.mark_run_streaming("run-1")
        store.mark_run_completed("run-1", assistant_text="Recovered reply")

        headers = {LOCAL_TOKEN_HEADER_NAME: "history-token"}
        backup_response = client.post(
            "/history/database/backup",
            headers=headers,
            json={"targetPath": "backups/copilot-chat-backup.db"},
        )
        delete_response = client.request("DELETE", "/history/threads/thread-1", headers=headers)
        hidden_threads_response = client.get("/history/threads", headers=headers)
        deleted_detail_response = client.get("/history/threads/thread-1", headers=headers)
        purge_response = client.request("DELETE", "/history/threads/thread-1/purge", headers=headers)
        purged_detail_response = client.get("/history/threads/thread-1", headers=headers)
        restore_response = client.post(
            "/history/database/restore",
            headers=headers,
            json={"sourcePath": backup_response.json()["backupPath"]},
        )
        restored_threads_response = client.get("/history/threads", headers=headers)
        invalid_restore_response = client.post(
            "/history/database/restore",
            headers=headers,
            json={},
        )

    assert backup_response.status_code == 200
    assert delete_response.status_code == 200
    assert hidden_threads_response.status_code == 200
    assert deleted_detail_response.status_code == 200
    assert purge_response.status_code == 200
    assert purged_detail_response.status_code == 404
    assert restore_response.status_code == 200
    assert restored_threads_response.status_code == 200
    assert invalid_restore_response.status_code == 400

    backup_payload = backup_response.json()
    delete_payload = delete_response.json()
    hidden_threads_payload = hidden_threads_response.json()
    deleted_detail_payload = deleted_detail_response.json()
    purge_payload = purge_response.json()
    restore_payload = restore_response.json()
    restored_threads_payload = restored_threads_response.json()
    invalid_restore_payload = invalid_restore_response.json()

    assert Path(backup_payload["backupPath"]).is_file()
    assert backup_payload["databasePath"].endswith("copilot-chat.db")
    assert delete_payload["threadId"] == "thread-1"
    assert hidden_threads_payload["threads"] == []
    assert deleted_detail_payload["thread"]["threadId"] == "thread-1"
    assert purge_payload["threadId"] == "thread-1"
    assert purge_payload["deletedAt"] is not None
    assert restore_payload["sourcePath"] == backup_payload["backupPath"]
    assert [thread["threadId"] for thread in restored_threads_payload["threads"]] == ["thread-1"]
    assert invalid_restore_payload["detail"]["code"] == "restore_source_path_required"



def test_history_routes_require_local_token_and_handle_missing_records(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="history-token"))

    with TestClient(app) as client:
        unauthorized = client.get("/history/threads")
        missing_thread = client.get(
            "/history/threads/missing-thread",
            headers={LOCAL_TOKEN_HEADER_NAME: "history-token"},
        )
        missing_run = client.get(
            "/history/runs/missing-run/replay",
            headers={LOCAL_TOKEN_HEADER_NAME: "history-token"},
        )

    assert unauthorized.status_code == 401
    assert unauthorized.json()["detail"]["code"] == "invalid_local_token"
    assert missing_thread.status_code == 404
    assert missing_thread.json()["detail"]["code"] == "thread_not_found"
    assert missing_run.status_code == 404
    assert missing_run.json()["detail"]["code"] == "run_not_found"



def test_history_routes_report_service_unavailable_for_non_sqlite_store(tmp_path: Path) -> None:
    app = create_app(
        _build_config(tmp_path),
        session_store=InMemorySessionStore(),
    )

    with TestClient(app) as client:
        response = client.get("/history/threads")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "history_query_service_unavailable"



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



def _build_config(tmp_path: Path, *, local_token: str | None = None) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host="127.0.0.1",
        port=8765,
        local_token=local_token,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=runtime_root_dir / "config",
            logs_dir=runtime_root_dir / "logs",
            database_dir=runtime_root_dir / "database",
            state_dir=runtime_root_dir / "state",
            copilot_settings_file=runtime_root_dir / "config" / "copilot-settings.json",
            host_log_file=runtime_root_dir / "logs" / "electron-host.log",
            backend_stdout_log_file=runtime_root_dir / "logs" / "backend.stdout.log",
            backend_stderr_log_file=runtime_root_dir / "logs" / "backend.stderr.log",
            runtime_snapshot_file=runtime_root_dir / "state" / "runtime-snapshot.json",
            last_failure_file=runtime_root_dir / "state" / "last-failure.json",
        ),
        app_mode="desktop",
        environment="test",
    )
