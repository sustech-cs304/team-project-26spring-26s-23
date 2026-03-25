from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app.copilot_runtime import PydanticAIAgentExecutor

from app.desktop_runtime.config import (
    DEFAULT_HOST,
    ENV_HOST,
    ENV_PORT,
    ENV_USER_DATA_DIR,
    LOCAL_TOKEN_HEADER_NAME,
    DesktopRuntimeConfig,
    DesktopRuntimePaths,
)
from app.desktop_runtime.server import BACKEND_DIR, create_app


def test_create_app_returns_fastapi_instance(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path), agent_executor=_build_test_agent_executor())
    assert isinstance(app, FastAPI)


def test_create_app_mounts_runtime_dependencies_from_composition(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path), agent_executor=_build_test_agent_executor())

    with TestClient(app):
        dependencies = app.state.copilot_runtime_dependencies

        assert dependencies.session_store is app.state.copilot_runtime_session_store
        assert dependencies.agent_registry is app.state.copilot_runtime_agent_registry
        assert dependencies.tool_registry is app.state.copilot_runtime_tool_registry
        assert dependencies.agent_executor is app.state.copilot_runtime_agent_executor
        assert dependencies.runtime_bridge is app.state.copilot_runtime_bridge
        assert dependencies.scaffold is app.state.copilot_runtime_scaffold
        assert dependencies.agent_registry.get_default().name == "default"
        assert dependencies.tool_registry.get_default().name == "default"


def test_minimal_contract_endpoints_return_expected_payloads(tmp_path: Path) -> None:
    app = create_app(_build_config(tmp_path), agent_executor=_build_test_agent_executor())

    with TestClient(app) as client:
        runtime_info_response = client.post("/", json={"method": "info"})
        connect_response = client.post("/", json=_build_connect_request())
        run_response = client.post("/", json=_build_run_request())
        preflight_response = client.options(
            "/",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        health_response = client.get("/health")
        ready_response = client.get("/ready")
        version_response = client.get("/version")
        build_response = client.get("/build-info")
        diagnostics_response = client.get("/diagnostics/runtime-info")

    assert runtime_info_response.status_code == 200
    assert connect_response.status_code == 200
    assert preflight_response.status_code == 200
    assert health_response.status_code == 200
    assert ready_response.status_code == 200
    assert version_response.status_code == 200
    assert build_response.status_code == 200
    assert diagnostics_response.status_code == 200

    runtime_info_payload = runtime_info_response.json()
    connect_events = _parse_sse_events(connect_response.text)
    run_events = _parse_sse_events(run_response.text)
    connect_payload = connect_events[-1]["result"]
    run_payload = run_events[-1]["result"]
    health_payload = health_response.json()
    ready_payload = ready_response.json()
    version_payload = version_response.json()
    build_payload = build_response.json()
    diagnostics_payload = diagnostics_response.json()

    assert runtime_info_payload["actions"] == []
    assert list(runtime_info_payload["agents"]) == ["default"]
    assert runtime_info_payload["agents"]["default"] == {
        "name": "default",
        "description": "Minimal default agent exposed by the Copilot runtime run bridge.",
    }
    assert runtime_info_payload["defaultAgent"] == "default"
    assert runtime_info_payload["supportedMethods"] == ["info", "agent/connect", "agent/run"]
    assert runtime_info_payload["protocol"] == "single-endpoint"
    assert runtime_info_payload["stage"] == "phase3-run-bridge"
    assert connect_response.headers["content-type"].startswith("text/event-stream")
    assert run_response.headers["content-type"].startswith("text/event-stream")
    assert preflight_response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "POST" in preflight_response.headers["access-control-allow-methods"]
    assert [event["type"] for event in connect_events] == [
        "RUN_STARTED",
        "STATE_SNAPSHOT",
        "MESSAGES_SNAPSHOT",
        "RUN_FINISHED",
    ]
    assert connect_payload["ok"] is True
    assert connect_payload["agentName"] == "default"
    assert connect_payload["threadId"] == "thread-1"
    assert connect_payload["runId"] == "run-1"
    assert connect_payload["session"]["newlyCreated"] is True
    assert connect_payload["session"]["metadata"] == {"last_connect_run_id": "run-1"}
    assert [event["type"] for event in run_events] == [
        "RUN_STARTED",
        "STATE_SNAPSHOT",
        "TEXT_MESSAGE_START",
        "TEXT_MESSAGE_CONTENT",
        "TEXT_MESSAGE_END",
        "RUN_FINISHED",
    ]
    assert run_payload["ok"] is True
    assert run_payload["agentName"] == "default"
    assert run_payload["threadId"] == "thread-1"
    assert run_payload["runId"] == "run-1"
    assert run_payload["output"] == "Hello from the desktop runtime test model."
    assert run_payload["session"]["metadata"] == {
        "last_connect_run_id": "run-1",
        "last_run_id": "run-1",
    }
    assert health_payload["status"] == "ok"
    assert health_payload["ready"] is True
    assert ready_payload["status"] == "ready"
    assert ready_payload["startup_complete"] is True
    assert version_payload["version"]
    assert version_payload["build"]["entrypoint"] == "app.desktop_runtime.server"
    assert build_payload == version_payload
    assert diagnostics_payload["runtime"]["ready"] is True
    assert diagnostics_payload["configuration"]["host"] == DEFAULT_HOST
    assert diagnostics_payload["configuration"]["paths"]["config_dir"].endswith("config")
    assert diagnostics_payload["configuration"]["paths"]["logs_dir"].endswith("logs")
    assert diagnostics_payload["configuration"]["paths"]["database_dir"].endswith("database")
    assert diagnostics_payload["configuration"]["paths"]["state_dir"].endswith("state")
    assert diagnostics_payload["capabilities"]["domain_routes_registered"] is False
    assert diagnostics_payload["capabilities"]["chat_runtime_registered"] is True
    assert diagnostics_payload["capabilities"]["chat_protocol"] == "single-endpoint"
    assert diagnostics_payload["capabilities"]["chat_runtime_path"] == "/"
    assert diagnostics_payload["capabilities"]["available_agents"] == ["default"]
    assert diagnostics_payload["capabilities"]["default_agent"] == "default"
    assert diagnostics_payload["capabilities"]["supported_methods"] == ["info", "agent/connect", "agent/run"]
    assert diagnostics_payload["capabilities"]["chat_runtime_stage"] == "phase3-run-bridge"
    assert diagnostics_payload["capabilities"]["session_store_type"] == "in-memory"
    assert diagnostics_payload["capabilities"]["current_stage_supports_info_only"] is False
    assert diagnostics_payload["capabilities"]["current_stage_supports_connect"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_run"] is True
    assert diagnostics_payload["capabilities"]["model_configured"] is True
    assert diagnostics_payload["capabilities"]["model_environment_keys"] == [
        "COPILOT_RUNTIME_MODEL",
        "COPILOT_MODEL",
    ]
    assert "/" in diagnostics_payload["capabilities"]["contract_paths"]
    assert diagnostics_payload["auth"]["token_configured"] is False
    assert Path(diagnostics_payload["runtime"]["working_directory"]).exists()


def test_create_app_without_explicit_config_reads_environment_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_HOST, "127.0.0.1")
    monkeypatch.setenv(ENV_PORT, "9988")
    monkeypatch.setenv(ENV_USER_DATA_DIR, "env-user-data")

    app = create_app(agent_executor=_build_test_agent_executor())

    with TestClient(app) as client:
        response = client.get("/health")
        runtime_config = app.state.runtime_config

    assert response.status_code == 200
    assert runtime_config.host == "127.0.0.1"
    assert runtime_config.port == 9988
    assert runtime_config.user_data_dir == (BACKEND_DIR / "env-user-data").resolve()


def test_diagnostics_requires_local_token_when_configured(tmp_path: Path) -> None:
    app = create_app(
        _build_config(tmp_path, local_token="super-secret-token"),
        agent_executor=_build_test_agent_executor(),
    )

    with TestClient(app) as client:
        unauthorized = client.get("/diagnostics")
        authorized = client.get(
            "/diagnostics",
            headers={LOCAL_TOKEN_HEADER_NAME: "super-secret-token"},
        )

    assert unauthorized.status_code == 401
    assert authorized.status_code == 200

    authorized_payload = authorized.json()
    rendered_payload = json.dumps(authorized_payload, ensure_ascii=False)

    assert authorized_payload["auth"]["token_configured"] is True
    assert "super-secret-token" not in rendered_payload
    assert authorized_payload["auth"]["header_name"] == LOCAL_TOKEN_HEADER_NAME


def _build_connect_request() -> dict[str, Any]:
    return {
        "method": "agent/connect",
        "params": {"agentId": "default"},
        "body": {
            "threadId": "thread-1",
            "runId": "run-1",
            "messages": [],
            "state": {},
            "tools": [],
            "context": [],
            "forwardedProps": {},
        },
    }


def _build_run_request() -> dict[str, Any]:
    return {
        "method": "agent/run",
        "params": {"agentId": "default"},
        "body": {
            "threadId": "thread-1",
            "runId": "run-1",
            "messages": [
                {
                    "id": "u1",
                    "role": "user",
                    "content": "hello desktop runtime",
                }
            ],
            "state": {},
            "actions": [],
            "metaEvents": [],
            "forwardedProps": {},
        },
    }


def _parse_sse_events(raw_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for chunk in raw_text.strip().split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
        if not lines:
            continue
        payload = "\n".join(line[6:] for line in lines)
        events.append(json.loads(payload))
    return events


def _build_test_agent_executor() -> PydanticAIAgentExecutor:
    return PydanticAIAgentExecutor(
        model=TestModel(custom_output_text="Hello from the desktop runtime test model.")
    )


def _build_config(tmp_path: Path, *, local_token: str | None = None) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host=DEFAULT_HOST,
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
