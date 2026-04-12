from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

_ELECTRON_TEST_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) CanDue/1.0.0 Electron/35.1.4 Safari/537.36"
)
_BROWSER_TEST_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
)

from app.copilot_runtime import PydanticAIAgentExecutor
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.contracts import (
    AGENTS_LIST_METHOD,
    CAPABILITIES_GET_METHOD,
    RUN_CANCEL_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
)
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute
from app.copilot_runtime.provider_adapter_registry import build_default_provider_adapter_registry
from app.copilot_runtime.tool_registry import FILE_CONVERT_TOOL_ID

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


class _ImmediateEventStream:
    def __init__(self, *, output: str, resolved_model_id: str, events: list[RuntimeExecutionEvent]) -> None:
        self.resolved_model_id = resolved_model_id
        self._output = output
        self._events = list(events)

    async def __aenter__(self) -> "_ImmediateEventStream":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_events(self):
        for event in self._events:
            yield event

    async def get_output(self) -> str:
        return self._output


class _StreamingExecutor:
    def __init__(
        self,
        *,
        reply: str,
        model_configured: bool = True,
        model_environment_keys: tuple[str, ...] = (),
    ) -> None:
        self.model_configured = model_configured
        self.model_environment_keys = model_environment_keys
        self.provider_adapter_registry = build_default_provider_adapter_registry()
        self._reply = reply

    def open_event_stream(
        self,
        *,
        run_id: str,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        debug_enabled: bool = False,
        request_options: dict[str, object] | None = None,
        model_settings: dict[str, object] | None = None,
    ) -> _ImmediateEventStream:
        _ = (
            agent_name,
            user_prompt,
            message_history,
            enabled_tools,
            debug_enabled,
            request_options,
            model_settings,
        )
        return _ImmediateEventStream(
            output=self._reply,
            resolved_model_id=model_route.model_id,
            events=_build_text_execution_events(run_id=run_id, text=self._reply),
        )


class _ResolvedRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider="openai",
            endpoint_type="openai-compatible",
            base_url="https://example.com/v1",
            model_id=model_route.route_ref.model_id,
            api_key="test-api-key",
            route_ref=model_route.route_ref,
        )


def _build_text_execution_events(*, run_id: str, text: str) -> list[RuntimeExecutionEvent]:
    return [
        RuntimeExecutionEvent(
            type="assistant_segment_delta",
            payload={
                "segmentId": f"{run_id}:assistant-segment-1",
                "delta": text,
            },
        )
    ]


SUPPORTED_METHODS = [
    AGENTS_LIST_METHOD,
    THREAD_CREATE_METHOD,
    THREAD_GET_METHOD,
    RUN_START_METHOD,
    RUN_STREAM_METHOD,
    RUN_CANCEL_METHOD,
    CAPABILITIES_GET_METHOD,
    THINKING_CAPABILITY_GET_METHOD,
]


def test_create_app_returns_fastapi_instance(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)
    assert isinstance(app, FastAPI)



def test_create_app_mounts_runtime_dependencies_from_composition(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

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



def test_diagnostics_exposes_registry_backed_agent_and_tool_summaries(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        response = client.get("/diagnostics")

    assert response.status_code == 200

    capabilities = response.json()["capabilities"]
    assert capabilities["available_agents"] == ["default"]
    assert capabilities["default_agent"] == "default"
    assert capabilities["available_toolsets"] == ["default"]
    assert capabilities["default_toolset"] == "default"
    agent_summaries = capabilities["agent_summaries"]
    assert len(agent_summaries) == 1

    agent_summary = agent_summaries[0]
    assert agent_summary["name"] == "default"
    assert agent_summary["label"] == "Default"
    assert (
        agent_summary["description"]
        == "Minimal default agent exposed by the Copilot runtime run bridge."
    )
    assert agent_summary["default"] is True
    assert agent_summary["status"] == "active"
    assert agent_summary["toolsetName"] == "default"
    assert agent_summary["recommendedTools"] == [FILE_CONVERT_TOOL_ID]
    assert agent_summary["iconKey"] is None
    assert agent_summary["hasExecutorFactory"] is True

    toolset_summaries = capabilities["toolset_summaries"]
    assert len(toolset_summaries) == 1

    toolset_summary = toolset_summaries[0]
    assert toolset_summary["name"] == "default"
    assert toolset_summary["label"] == "Default"
    assert toolset_summary["default"] is True
    assert toolset_summary["toolCount"] == 3
    assert len(toolset_summary["tools"]) == 3
    assert toolset_summary["tools"][0] == {
        "toolId": FILE_CONVERT_TOOL_ID,
        "kind": "builtin",
        "availability": "available",
        "displayName": "File Convert",
        "description": "Convert DOCX, PDF, and PPTX files into text.",
    }
    assert toolset_summary["tools"][1] == {
        "toolId": "tool.weather-current",
        "kind": "builtin",
        "availability": "available",
        "displayName": "Current Weather",
        "description": "Return a placeholder current-weather result for a requested location.",
    }
    assert toolset_summary["tools"][2] == {
        "toolId": "tool.campus-info.search",
        "kind": "builtin",
        "availability": "available",
        "displayName": "Campus Info Search",
        "description": "Search indexed campus official documents and return cited snippets.",
    }



def test_create_app_ignores_retired_startup_model_environment_variables(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_MODEL", "runtime-env-model")
    monkeypatch.setenv("COPILOT_MODEL", "legacy-env-model")

    app = create_app(_build_config(tmp_path))

    with TestClient(app) as client:
        response = client.get("/diagnostics")
        runtime_executor = app.state.copilot_runtime_agent_executor

    assert response.status_code == 200
    with pytest.raises(RuntimeError, match="Provide an explicit executor model"):
        runtime_executor.resolve_model()

    payload = response.json()
    assert "model" not in payload["configuration"]
    assert payload["capabilities"]["model_configured"] is False



def test_minimal_contract_endpoints_return_expected_payloads(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        agents_response = client.post("/", json={"method": "agents/list"})
        thread_response = client.post("/", json=_build_thread_create_request())
        thread_payload = thread_response.json()
        capabilities_response = client.post(
            "/",
            json={"method": "capabilities/get", "body": {"sessionId": thread_payload["threadId"]}},
        )
        run_start_response = client.post(
            "/",
            json=_build_run_start_request(thread_id=thread_payload["threadId"]),
        )
        run_id = run_start_response.json()["run"]["runId"]
        run_stream_response = client.post(
            "/",
            json=_build_run_stream_request(run_id=run_id),
        )
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

    assert agents_response.status_code == 200
    assert thread_response.status_code == 200
    assert capabilities_response.status_code == 200
    assert run_start_response.status_code == 200
    assert run_stream_response.status_code == 200
    assert preflight_response.status_code == 200
    assert health_response.status_code == 200
    assert ready_response.status_code == 200
    assert version_response.status_code == 200
    assert build_response.status_code == 200
    assert diagnostics_response.status_code == 200

    agents_payload = agents_response.json()
    capabilities_payload = capabilities_response.json()
    run_events = _parse_sse_events(run_stream_response.text)
    run_payload = run_events[-1]["payload"]
    health_payload = health_response.json()
    ready_payload = ready_response.json()
    version_payload = version_response.json()
    build_payload = build_response.json()
    diagnostics_payload = diagnostics_response.json()

    assert agents_payload["defaultAgentId"] == "default"
    assert agents_payload["agents"][0]["agentId"] == "default"
    _assert_supported_methods(diagnostics_payload["capabilities"]["supported_methods"])
    assert capabilities_payload["sessionId"] == thread_payload["threadId"]
    assert capabilities_payload["boundAgent"]["agentId"] == "default"
    assert capabilities_payload["tools"][0]["toolId"] == FILE_CONVERT_TOOL_ID
    assert run_stream_response.headers["content-type"].startswith("text/event-stream")
    assert preflight_response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "POST" in preflight_response.headers["access-control-allow-methods"]
    assert [event["type"] for event in run_events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]
    assert run_payload["assistantText"] == "Hello from the desktop runtime test model."
    assert run_payload["resolvedModelId"] == "gpt-4.1"
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
    assert diagnostics_payload["capabilities"]["chat_runtime_stage"] == "phase3-run-bridge"
    assert diagnostics_payload["capabilities"]["session_store_type"] == "in-memory"
    assert diagnostics_payload["capabilities"]["current_stage_supports_agents_list"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_thread_create"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_thread_get"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_run_start"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_run_stream"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_run_cancel"] is True
    assert diagnostics_payload["capabilities"]["current_stage_supports_capabilities_get"] is True
    assert diagnostics_payload["capabilities"]["model_configured"] is True
    assert diagnostics_payload["capabilities"]["model_environment_keys"] == []
    assert "/" in diagnostics_payload["capabilities"]["contract_paths"]
    assert diagnostics_payload["auth"]["token_configured"] is False
    assert Path(diagnostics_payload["runtime"]["working_directory"]).exists()


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://[::1]:5173",
    ],
)
def test_cors_preflight_allows_loopback_origins(tmp_path: Path, origin: str) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        response = client.options("/", headers=_build_cors_preflight_headers(origin))

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    assert "POST" in response.headers["access-control-allow-methods"]



def test_cors_preflight_allows_packaged_electron_null_origin(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        response = client.options(
            "/",
            headers=_build_cors_preflight_headers(
                "null",
                user_agent=_ELECTRON_TEST_USER_AGENT,
            ),
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"
    assert "POST" in response.headers["access-control-allow-methods"]



def test_cors_simple_request_allows_packaged_electron_null_origin(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        response = client.post(
            "/",
            json={"method": "agents/list"},
            headers={
                "Origin": "null",
                "User-Agent": _ELECTRON_TEST_USER_AGENT,
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"



def test_runtime_run_start_logs_also_emit_runtime_chain_debug_lines_to_uvicorn_error(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = _create_test_app(tmp_path)

    with caplog.at_level("INFO", logger="uvicorn.error"):
        with TestClient(app, raise_server_exceptions=False) as client:
            thread_response = client.post("/", json=_build_thread_create_request())
            thread_id = thread_response.json()["threadId"]
            response = client.post(
                "/",
                json=_build_run_start_request(thread_id=thread_id, debug_mode_enabled=True),
                headers={"Origin": "http://localhost:5173"},
            )

    chain_logs = [
        record.getMessage()
        for record in caplog.records
        if "copilot-runtime-chain" in record.getMessage()
    ]

    assert thread_response.status_code == 200
    assert response.status_code == 200
    assert any('"event":"run_start.request_received"' in message for message in chain_logs)
    assert any(
        '"event":"run_start.prime_run_metadata.enter"' in message
        and '"phase":"prime_run_metadata"' in message
        and '"requestId":' in message
        and '"threadId":"' in message
        for message in chain_logs
    )
    assert any(
        '"event":"thinking.run_metadata_primed"' in message
        and '"phase":"prime_run_metadata"' in message
        and '"requestId":' in message
        for message in chain_logs
    )



def test_runtime_run_start_unexpected_failure_preserves_cors_headers(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    class _FailingRunStartSessionStore(InMemorySessionStore):
        def create_run(self, *args: Any, **kwargs: Any):
            raise RuntimeError("forced run/start failure")

    app = create_app(
        _build_config(tmp_path),
        session_store=_FailingRunStartSessionStore(),
        agent_executor=_build_test_agent_executor(),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    with caplog.at_level("ERROR", logger="uvicorn.error"):
        with TestClient(app, raise_server_exceptions=False) as client:
            thread_response = client.post("/", json=_build_thread_create_request())
            thread_id = thread_response.json()["threadId"]
            response = client.post(
                "/",
                json=_build_run_start_request(thread_id=thread_id),
                headers={"Origin": "http://localhost:5173"},
            )

    payload = response.json()
    request_id = payload["error"]["details"]["requestId"]
    run_start_logs = [
        record.getMessage()
        for record in caplog.records
        if "run/start unexpected exception" in record.getMessage()
    ]

    assert thread_response.status_code == 200
    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert payload["ok"] is False
    assert payload["error"]["code"] == "internal_server_error"
    assert payload["error"]["requestedMethod"] == "run/start"
    assert request_id
    assert len(run_start_logs) == 1
    assert f"request_id={request_id}" in run_start_logs[0]
    assert "http_method=POST" in run_start_logs[0]
    assert "path=/" in run_start_logs[0]
    assert "origin=http://localhost:5173" in run_start_logs[0]
    assert "runtime_method=run/start" in run_start_logs[0]
    assert f"thread_id={thread_id}" in run_start_logs[0]
    assert "agent_id=default" in run_start_logs[0]
    assert "phase=create_run_record" in run_start_logs[0]
    assert "exception_type=RuntimeError" in run_start_logs[0]
    assert "exception_summary=forced run/start failure" in run_start_logs[0]
    assert all(
        "desktop-runtime unexpected exception" not in record.getMessage()
        for record in caplog.records
    )



def test_runtime_failure_envelope_logs_request_context_fields(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    app = _create_test_app(tmp_path)

    @app.get("/boom")
    def _boom(request: Request) -> dict[str, str]:
        request.state.copilot_runtime_requested_method = RUN_START_METHOD
        request.state.copilot_runtime_thread_id = "thread-log"
        request.state.copilot_runtime_agent_id = "default"
        request.state.copilot_runtime_run_id = "run-log"
        request.state.copilot_runtime_phase = "build_run_start_response"
        raise RuntimeError("forced middleware failure")

    with caplog.at_level("ERROR", logger="uvicorn.error"):
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/boom", headers={"Origin": "http://localhost:5173"})

    payload = response.json()
    request_id = payload["error"]["details"]["requestId"]
    unexpected_logs = [
        record.getMessage()
        for record in caplog.records
        if "desktop-runtime unexpected exception" in record.getMessage()
    ]

    assert response.status_code == 500
    assert payload["error"]["code"] == "internal_server_error"
    assert request_id
    assert len(unexpected_logs) == 1
    assert f"request_id={request_id}" in unexpected_logs[0]
    assert "http_method=GET" in unexpected_logs[0]
    assert "path=/boom" in unexpected_logs[0]
    assert "origin=http://localhost:5173" in unexpected_logs[0]
    assert "runtime_method=run/start" in unexpected_logs[0]
    assert "thread_id=thread-log" in unexpected_logs[0]
    assert "agent_id=default" in unexpected_logs[0]
    assert "run_id=run-log" in unexpected_logs[0]
    assert "phase=build_run_start_response" in unexpected_logs[0]
    assert "exception_type=RuntimeError" in unexpected_logs[0]
    assert "exception_summary=forced middleware failure" in unexpected_logs[0]



def test_cors_preflight_rejects_non_electron_null_origin(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        response = client.options(
            "/",
            headers=_build_cors_preflight_headers(
                "null",
                user_agent=_BROWSER_TEST_USER_AGENT,
            ),
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers



def test_cors_simple_request_rejects_non_electron_null_origin(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app) as client:
        response = client.get(
            "/health",
            headers={
                "Origin": "null",
                "User-Agent": _BROWSER_TEST_USER_AGENT,
            },
        )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers



def test_create_app_without_explicit_config_reads_environment_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_HOST, "127.0.0.1")
    monkeypatch.setenv(ENV_PORT, "9988")
    monkeypatch.setenv(ENV_USER_DATA_DIR, "env-user-data")

    app = create_app(agent_executor=_build_test_agent_executor(), model_route_resolver=_ResolvedRouteResolver())

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
        model_route_resolver=_ResolvedRouteResolver(),
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



def test_create_app_without_model_keeps_diagnostics_unconfigured_but_route_scoped_run_still_runs(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.delenv("COPILOT_RUNTIME_MODEL", raising=False)
    monkeypatch.delenv("COPILOT_MODEL", raising=False)

    app = create_app(
        _build_config(tmp_path),
        agent_executor=_StreamingExecutor(
            reply="Hello from the desktop runtime test model.",
            model_configured=False,
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )

    with TestClient(app) as client:
        agents_response = client.post("/", json={"method": "agents/list"})
        thread_response = client.post("/", json=_build_thread_create_request())
        thread_id = thread_response.json()["threadId"]
        run_start_response = client.post("/", json=_build_run_start_request(thread_id=thread_id))
        run_id = run_start_response.json()["run"]["runId"]
        run_stream_response = client.post("/", json=_build_run_stream_request(run_id=run_id))
        diagnostics_response = client.get("/diagnostics")

    events = _parse_sse_events(run_stream_response.text)

    assert agents_response.status_code == 200
    assert thread_response.status_code == 200
    assert run_start_response.status_code == 200
    assert run_stream_response.status_code == 200
    assert [event["type"] for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]
    assert events[-1]["payload"]["assistantText"] == "Hello from the desktop runtime test model."
    assert diagnostics_response.status_code == 200
    assert diagnostics_response.json()["capabilities"]["model_configured"] is False



def test_create_app_closes_host_model_route_bridge_client_on_shutdown(tmp_path: Path) -> None:
    app = _create_test_app(tmp_path)

    with TestClient(app):
        bridge_client = app.state.host_model_route_bridge_client
        http_client = bridge_client._get_client()
        assert isinstance(http_client, httpx.AsyncClient)
        assert bridge_client._client is http_client
        assert http_client.is_closed is False

    assert bridge_client._client is None
    assert http_client.is_closed is True



def _create_test_app(tmp_path: Path) -> FastAPI:
    return create_app(
        _build_config(tmp_path),
        agent_executor=_build_test_agent_executor(),
        model_route_resolver=_ResolvedRouteResolver(),
    )



def _build_thread_create_request() -> dict[str, Any]:
    return {
        "method": "thread/create",
        "body": {
            "agentId": "default",
        },
    }



def _build_run_start_request(*, thread_id: str, debug_mode_enabled: bool = False) -> dict[str, Any]:
    return {
        "method": "run/start",
        "body": {
            "threadId": thread_id,
            "agent": "default",
            "message": {
                "role": "user",
                "content": "hello desktop runtime",
            },
            "policy": {
                "modelRoute": {
                    "routeRef": {
                        "routeKind": "provider-model",
                        "profileId": "provider-1",
                        "modelId": "gpt-4.1",
                    },
                },
                "enabledTools": [],
                "debugModeEnabled": debug_mode_enabled,
                "requestOptions": {},
            },
        },
    }



def _build_run_stream_request(*, run_id: str) -> dict[str, Any]:
    return {
        "method": "run/stream",
        "body": {
            "runId": run_id,
        },
    }



def _build_cors_preflight_headers(origin: str, *, user_agent: str | None = None) -> dict[str, str]:
    headers = {
        "Origin": origin,
        "Access-Control-Request-Method": "POST",
    }
    if user_agent is not None:
        headers["User-Agent"] = user_agent
    return headers



def _parse_sse_events(raw_text: str) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for chunk in raw_text.strip().split("\n\n"):
        lines = [line for line in chunk.splitlines() if line.startswith("data: ")]
        if not lines:
            continue
        payload = "\n".join(line[6:] for line in lines)
        events.append(json.loads(payload))
    return events



def _assert_supported_methods(supported_methods: list[str]) -> None:
    assert set(supported_methods) == set(SUPPORTED_METHODS)



def _build_test_agent_executor() -> _StreamingExecutor:
    return _StreamingExecutor(reply="Hello from the desktop runtime test model.")



def _build_config(
    tmp_path: Path,
    *,
    local_token: str | None = None,
) -> DesktopRuntimeConfig:
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
