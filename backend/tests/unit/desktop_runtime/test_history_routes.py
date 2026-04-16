from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.copilot_runtime.model_routes import (
    ProviderProfileNotFoundError,
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
)
from app.copilot_runtime.session_store import InMemorySessionStore, RuntimeStoredModelRoute, RuntimeStoredRunInput, RuntimeStoredRunPolicy
from app.desktop_runtime.config import LOCAL_TOKEN_HEADER_NAME, DesktopRuntimeConfig, DesktopRuntimePaths
from app.desktop_runtime.server import create_app



def test_history_routes_expose_persisted_threads_details_and_run_replay(tmp_path: Path) -> None:
    app = create_app(
        _build_config(tmp_path, local_token="history-token"),
        model_route_resolver=_StaticTestModelRouteResolver(),
    )

    with TestClient(app) as client:
        store = app.state.copilot_runtime_session_store
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(
                user_text="What changed after restart?",
                enabled_tools=("tool.weather-current",),
            ),
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

    assert threads_payload["threads"][0]["driftSummary"]["status"] == "no_drift"
    assert threads_payload["threads"][0]["driftSummary"]["historicalModelId"] == "gpt-4.1"
    assert threads_payload["threads"][0]["driftSummary"]["historicalToolIds"] == ["tool.weather-current"]
    assert threads_payload["threads"][0]["driftSummary"]["warnings"] == []
    assert threads_payload["threads"][0]["driftSummary"]["requiresExplicitRebind"] is False

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
    assert detail_payload["availabilityDrift"]["status"] == "no_drift"
    assert detail_payload["availabilityDrift"]["historicalModelId"] == "gpt-4.1"
    assert detail_payload["availabilityDrift"]["historicalToolIds"] == ["tool.weather-current"]
    assert detail_payload["availabilityDrift"]["warnings"] == []

    assert replay_payload["ok"] is True
    assert replay_payload["run"]["runId"] == "run-1"
    assert [event["eventType"] for event in replay_payload["orderedEvents"]] == [
        "text_delta",
        "tool_event",
        "run_completed",
    ]
    assert replay_payload["toolCallBlocks"][0]["toolCallId"] == "tool.weather-current:call-1"
    assert replay_payload["terminalState"]["status"] == "completed"
    assert replay_payload["availabilityInterpretation"]["status"] == "no_drift"
    assert replay_payload["availabilityInterpretation"]["historicalModelId"] == "gpt-4.1"
    assert replay_payload["availabilityInterpretation"]["historicalToolIds"] == ["tool.weather-current"]
    assert replay_payload["availabilityInterpretation"]["warnings"] == []
    assert replay_payload["availabilityInterpretation"]["requiresExplicitRebind"] is False



def test_history_routes_surface_backend_drift_conclusions_in_thread_detail_and_replay(tmp_path: Path) -> None:
    app = create_app(
        _build_config(tmp_path, local_token="history-token"),
        model_route_resolver=_MissingProviderModelRouteResolver(),
    )

    with TestClient(app) as client:
        store = app.state.copilot_runtime_session_store
        store.create_thread(bound_agent_id="default", thread_id="thread-legacy")
        store.create_run(
            thread_id="thread-legacy",
            run_id="run-legacy",
            request=_build_stored_run_input(
                user_text="Continue my legacy thread",
                enabled_tools=("tool.legacy-removed",),
            ),
        )
        store.mark_run_completed("run-legacy", assistant_text="Legacy reply")

        headers = {LOCAL_TOKEN_HEADER_NAME: "history-token"}
        threads_response = client.get("/history/threads", headers=headers)
        detail_response = client.get("/history/threads/thread-legacy", headers=headers)
        replay_response = client.get("/history/runs/run-legacy/replay", headers=headers)

    assert threads_response.status_code == 200
    assert detail_response.status_code == 200
    assert replay_response.status_code == 200

    threads_payload = threads_response.json()
    detail_payload = detail_response.json()
    replay_payload = replay_response.json()

    assert threads_payload["threads"][0]["driftSummary"]["status"] == "multiple_issues"
    assert threads_payload["threads"][0]["driftSummary"]["historicalModelId"] == "gpt-4.1"
    assert threads_payload["threads"][0]["driftSummary"]["historicalToolIds"] == ["tool.legacy-removed"]
    assert [warning["code"] for warning in threads_payload["threads"][0]["driftSummary"]["warnings"]] == [
        "historical_provider_removed",
        "historical_tool_unregistered",
    ]
    assert threads_payload["threads"][0]["driftSummary"]["requiresExplicitRebind"] is True

    assert detail_payload["availabilityDrift"]["status"] == "multiple_issues"
    assert detail_payload["availabilityDrift"]["historicalModelId"] == "gpt-4.1"
    assert detail_payload["availabilityDrift"]["historicalToolIds"] == ["tool.legacy-removed"]
    assert [warning["code"] for warning in detail_payload["availabilityDrift"]["warnings"]] == [
        "historical_provider_removed",
        "historical_tool_unregistered",
    ]
    assert detail_payload["availabilityDrift"]["requiresExplicitRebind"] is True

    assert replay_payload["availabilityInterpretation"]["status"] == "multiple_issues"
    assert replay_payload["availabilityInterpretation"]["historicalModelId"] == "gpt-4.1"
    assert replay_payload["availabilityInterpretation"]["historicalToolIds"] == ["tool.legacy-removed"]
    assert [warning["code"] for warning in replay_payload["availabilityInterpretation"]["warnings"]] == [
        "historical_provider_removed",
        "historical_tool_unregistered",
    ]
    assert replay_payload["availabilityInterpretation"]["requiresExplicitRebind"] is True



def test_history_routes_support_rename_and_duplicate_for_persisted_threads(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="history-token"))

    with TestClient(app) as client:
        store = app.state.copilot_runtime_session_store
        store.create_thread(bound_agent_id="default", thread_id="thread-1")
        store.create_run(
            thread_id="thread-1",
            run_id="run-1",
            request=_build_stored_run_input(user_text="复制这段对话"),
        )
        store.record_run_event(
            "run-1",
            event_type="text_delta",
            payload={"assistantMessageId": "run-1:assistant", "delta": "已复制的回复"},
        )
        store.record_run_event(
            "run-1",
            event_type="run_completed",
            payload={
                "assistantMessageId": "run-1:assistant",
                "assistantText": "已复制的回复",
            },
        )
        store.mark_run_completed("run-1", assistant_text="已复制的回复")

        headers = {LOCAL_TOKEN_HEADER_NAME: "history-token"}
        rename_response = client.post(
            "/history/threads/thread-1/rename",
            headers=headers,
            json={"title": "手动标题"},
        )
        duplicate_response = client.post(
            "/history/threads/thread-1/duplicate",
            headers=headers,
            json={},
        )

        duplicate_payload = duplicate_response.json()
        duplicate_thread_id = duplicate_payload["thread"]["threadId"]
        duplicate_run_id = duplicate_payload["thread"]["lastRunId"]
        threads_response = client.get("/history/threads", headers=headers)
        duplicate_detail_response = client.get(f"/history/threads/{duplicate_thread_id}", headers=headers)
        duplicate_replay_response = client.get(f"/history/runs/{duplicate_run_id}/replay", headers=headers)

    assert rename_response.status_code == 200
    assert duplicate_response.status_code == 200
    assert threads_response.status_code == 200
    assert duplicate_detail_response.status_code == 200
    assert duplicate_replay_response.status_code == 200

    rename_payload = rename_response.json()
    threads_payload = threads_response.json()
    duplicate_detail_payload = duplicate_detail_response.json()
    duplicate_replay_payload = duplicate_replay_response.json()

    assert rename_payload["thread"]["title"] == "手动标题"
    assert rename_payload["thread"]["titleSource"] == "manual"
    assert duplicate_payload["thread"]["threadId"] != "thread-1"
    assert duplicate_payload["thread"]["title"] == "手动标题（副本）"
    assert duplicate_payload["thread"]["titleSource"] == "manual"
    assert duplicate_payload["thread"]["lastRunId"] != "run-1"
    assert [thread["title"] for thread in threads_payload["threads"]] == [
        "手动标题（副本）",
        "手动标题",
    ]
    assert duplicate_detail_payload["thread"]["title"] == "手动标题（副本）"
    assert [run["requestedMessageText"] for run in duplicate_detail_payload["runSummaries"]] == ["复制这段对话"]
    assert [item["text"] for item in duplicate_detail_payload["timelineItems"] if "text" in item] == [
        "复制这段对话",
        "已复制的回复",
    ]
    assert [event["eventType"] for event in duplicate_replay_payload["orderedEvents"]] == [
        "text_delta",
        "run_completed",
    ]
    assert duplicate_replay_payload["run"]["threadId"] == duplicate_thread_id
    assert duplicate_replay_payload["run"]["assistantText"] == "已复制的回复"



def test_history_routes_support_delete_backup_and_restore(tmp_path: Path) -> None:
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
        deleted_replay_response = client.get("/history/runs/run-1/replay", headers=headers)
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
    assert deleted_detail_response.status_code == 404
    assert deleted_replay_response.status_code == 404
    assert restore_response.status_code == 200
    assert restored_threads_response.status_code == 200
    assert invalid_restore_response.status_code == 400

    backup_payload = backup_response.json()
    delete_payload = delete_response.json()
    hidden_threads_payload = hidden_threads_response.json()
    deleted_detail_payload = deleted_detail_response.json()
    deleted_replay_payload = deleted_replay_response.json()
    restore_payload = restore_response.json()
    restored_threads_payload = restored_threads_response.json()
    invalid_restore_payload = invalid_restore_response.json()

    assert Path(backup_payload["backupPath"]).is_file()
    assert backup_payload["databasePath"].endswith("copilot-chat.db")
    assert delete_payload["threadId"] == "thread-1"
    assert delete_payload["deletedAt"] is not None
    assert [thread["threadId"] for thread in hidden_threads_payload["threads"]] == []
    assert deleted_detail_payload["detail"]["code"] == "thread_not_found"
    assert deleted_detail_payload["detail"]["threadId"] == "thread-1"
    assert deleted_replay_payload["detail"]["code"] == "run_not_found"
    assert deleted_replay_payload["detail"]["runId"] == "run-1"
    assert restore_payload["sourcePath"] == backup_payload["backupPath"]
    assert [thread["threadId"] for thread in restored_threads_payload["threads"]] == ["thread-1"]
    assert invalid_restore_payload["detail"]["code"] == "restore_source_path_required"



def test_history_routes_reject_in_place_backup_and_restore_requests(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path, local_token="history-token"))

    with TestClient(app) as client:
        headers = {LOCAL_TOKEN_HEADER_NAME: "history-token"}
        backup_response = client.post(
            "/history/database/backup",
            headers=headers,
            json={"targetPath": "copilot-chat.db"},
        )
        restore_response = client.post(
            "/history/database/restore",
            headers=headers,
            json={"sourcePath": "copilot-chat.db"},
        )

    assert backup_response.status_code == 400
    assert restore_response.status_code == 400
    assert backup_response.json()["detail"]["code"] == "invalid_backup_request"
    assert "Cannot backup the live database file in place." in backup_response.json()["detail"]["message"]
    assert restore_response.json()["detail"]["code"] == "invalid_restore_request"
    assert "Cannot restore the live database file in place." in restore_response.json()["detail"]["message"]



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



def _build_stored_run_input(
    *,
    user_text: str,
    enabled_tools: tuple[str, ...] = (),
) -> RuntimeStoredRunInput:
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
            enabled_tools=enabled_tools,
            request_options={},
        ),
        agent_id="default",
    )



class _StaticTestModelRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            route_ref=model_route.route_ref,
            provider="openai",
            provider_id="openai",
            adapter_id="openai",
            runtime_status="enabled",
            catalog_revision=model_route.catalog_revision or "2026-04-06-provider-catalog-v1",
            endpoint_family="openai",
            endpoint_type="openai-compatible",
            base_url="https://api.example.com/v1",
            model_id=model_route.model_id,
            auth_kind="api-key",
            api_key="history-test-key",
        )



class _MissingProviderModelRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        raise ProviderProfileNotFoundError(provider_profile_id=model_route.provider_profile_id)



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
