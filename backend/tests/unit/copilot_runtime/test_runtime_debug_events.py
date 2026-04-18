from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import PydanticAIAgentExecutor
from app.copilot_runtime.agent_registry import build_default_agent_registry
from app.copilot_runtime.bridge import RuntimeBridge
from app.copilot_runtime.contracts import build_runtime_scaffold
from app.copilot_runtime.debug_log_store import (
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogLevel,
    DebugLogStore,
    RuntimeDebugLogWriter,
)
from app.copilot_runtime.message_runs import RuntimeMessageRunOrchestrator
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID, build_default_tool_registry
from app.copilot_runtime.transport.http_handlers import build_router


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


def _build_bridge_and_writer(tmp_path: Path) -> tuple[RuntimeBridge, DebugLogStore, PydanticAIAgentExecutor]:
    runtime_store = InMemorySessionStore()
    tool_registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model=TestModel(custom_output_text="unused"), tool_registry=tool_registry)
    agent_registry = build_default_agent_registry(
        executor_factory=lambda: executor,
        toolset_name=tool_registry.get_default().name,
    )
    scaffold = build_runtime_scaffold(
        session_store_type=runtime_store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    bridge = RuntimeBridge(
        session_store=runtime_store,
        agent_registry=agent_registry,
        scaffold=scaffold,
        message_run_orchestrator=RuntimeMessageRunOrchestrator(
            session_store=runtime_store,
            agent_registry=agent_registry,
            scaffold=scaffold,
            model_route_resolver=_ResolvedRouteResolver(),
            provider_adapter_registry=executor.provider_adapter_registry,
        ),
        model_route_resolver=_ResolvedRouteResolver(),
        provider_adapter_registry=executor.provider_adapter_registry,
    )
    debug_store = DebugLogStore(db_path=tmp_path / "debug-log.sqlite3")
    writer = RuntimeDebugLogWriter(
        store=debug_store,
        environment=DebugLogEnvironmentMode.TEST,
    )
    bridge.set_debug_event_logger(writer)
    executor.set_debug_event_logger(writer)
    return bridge, debug_store, executor


def test_runtime_bridge_logs_thread_and_run_lifecycle_events(tmp_path: Path) -> None:
    bridge, debug_store, _executor = _build_bridge_and_writer(tmp_path)

    thread = bridge.create_thread(agent_id="default")
    run_request = {
        "threadId": thread.thread_id,
        "agentId": "default",
        "message": {"role": "user", "content": "hello"},
        "policy": {
            "modelRoute": {
                "routeRef": {
                    "routeKind": "provider-model",
                    "profileId": "profile-1",
                    "modelId": "gpt-4.1",
                },
            }
        },
    }

    from app.copilot_runtime.protocol import RuntimeProtocolParser

    parser = RuntimeProtocolParser(bridge._scaffold)  # type: ignore[attr-defined]
    run = bridge.start_run(request=parser.extract_run_start_request({"body": run_request}))
    asyncio.run(
        bridge.prime_run_metadata(
            run_id=run.run_id,
            runtime_method="run/start",
            request_id="req-runtime-1",
        )
    )

    events = list(debug_store.list_recent_events(limit=10))
    event_names = {event.event_name for event in events}
    assert "runtime.thread.create.succeeded" in event_names
    assert "runtime.run.start.succeeded" in event_names
    assert "runtime.run.metadata.succeeded" in event_names
    start_event = next(event for event in events if event.event_name == "runtime.run.start.succeeded")
    assert start_event.run_id == run.run_id
    assert start_event.thread_id == thread.thread_id
    metadata_event = next(event for event in events if event.event_name == "runtime.run.metadata.succeeded")
    assert metadata_event.request_id == "req-runtime-1"
    assert metadata_event.correlation_id == "req-runtime-1"


def test_tool_debug_logs_capture_redacted_input_and_failure_details(tmp_path: Path) -> None:
    _bridge, debug_store, executor = _build_bridge_and_writer(tmp_path)
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    writer = RuntimeDebugLogWriter(
        store=debug_store,
        environment=DebugLogEnvironmentMode.TEST,
    )
    executor.set_debug_event_logger(writer)

    ctx = SimpleNamespace(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset(),
            emit_tool_event=lambda _event: None,
            run_id="run-tool-1",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            cast(Any, ctx),
            tool_id=WEATHER_CURRENT_TOOL_ID,
            arguments={"location": "Shenzhen", "password": "super-secret"},
        )
    )

    assert result["status"] == "error"
    events = [event for event in debug_store.list_recent_events(limit=10) if event.category == DebugLogCategory.TOOL]
    started = next(event for event in events if event.event_name == "tool.execution.started")
    failed = next(event for event in events if event.event_name == "tool.execution.failed")
    assert started.run_id == "run-tool-1"
    assert started.correlation_id == f"{WEATHER_CURRENT_TOOL_ID}:call-1"
    assert "super-secret" not in str(started.summary)
    assert failed.level == DebugLogLevel.WARN
    assert failed.summary["status"] == "failed"


def test_transport_debug_logs_cover_run_start_and_run_stream_failure(tmp_path: Path) -> None:
    bridge, debug_store, executor = _build_bridge_and_writer(tmp_path)
    runtime_store = bridge._session_store  # type: ignore[attr-defined]
    tool_registry = build_default_tool_registry()
    agent_registry = build_default_agent_registry(
        executor_factory=lambda: executor,
        toolset_name=tool_registry.get_default().name,
    )
    scaffold = build_runtime_scaffold(
        session_store_type=runtime_store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    writer = RuntimeDebugLogWriter(
        store=debug_store,
        environment=DebugLogEnvironmentMode.TEST,
    )
    app = FastAPI()
    app.include_router(build_router(scaffold, bridge, writer))

    with TestClient(app) as client:
        thread_response = client.post("/", json={"method": "thread/create", "body": {"agentId": "default"}})
        thread_id = thread_response.json()["threadId"]
        start_response = client.post(
            "/",
            json={
                "method": "run/start",
                "body": {
                    "threadId": thread_id,
                    "agentId": "default",
                    "message": {"role": "user", "content": "hello"},
                        "policy": {
                            "modelRoute": {
                                "routeRef": {
                                    "routeKind": "provider-model",
                                    "profileId": "profile-1",
                                    "modelId": "gpt-4.1",
                            },
                        }
                    },
                },
            },
        )
        stream_response = client.post("/", json={"method": "run/stream", "body": {"runId": "run-missing"}})

    assert start_response.status_code == 200
    assert stream_response.status_code == 404
    events = [event for event in debug_store.list_recent_events(limit=20) if event.category == DebugLogCategory.TRANSPORT]
    event_names = {event.event_name for event in events}
    assert "transport.http.run_start.received" in event_names
    assert "transport.http.run_start.succeeded" in event_names
    assert "transport.http.run_stream.failed" in event_names
    failed = next(event for event in events if event.event_name == "transport.http.run_stream.failed")
    assert failed.request_id is not None
    assert failed.exception_type == "RunNotFoundError"


def test_transport_request_succeeds_when_debug_log_write_fails(tmp_path: Path) -> None:
    bridge, debug_store, executor = _build_bridge_and_writer(tmp_path)
    runtime_store = bridge._session_store  # type: ignore[attr-defined]
    tool_registry = build_default_tool_registry()
    agent_registry = build_default_agent_registry(
        executor_factory=lambda: executor,
        toolset_name=tool_registry.get_default().name,
    )
    scaffold = build_runtime_scaffold(
        session_store_type=runtime_store.storage_type,
        model_configured=executor.model_configured,
        model_environment_keys=executor.model_environment_keys,
        agent_registry=agent_registry,
        tool_registry=tool_registry,
    )
    writer = RuntimeDebugLogWriter(
        store=debug_store,
        environment=DebugLogEnvironmentMode.TEST,
    )
    debug_store.write_event = Mock(side_effect=RuntimeError("database locked"))  # type: ignore[method-assign]

    app = FastAPI()
    app.include_router(build_router(scaffold, bridge, writer))

    with TestClient(app) as client:
        thread_response = client.post("/", json={"method": "thread/create", "body": {"agentId": "default"}})
        thread_id = thread_response.json()["threadId"]
        start_response = client.post(
            "/",
            json={
                "method": "run/start",
                "body": {
                    "threadId": thread_id,
                    "agentId": "default",
                    "message": {"role": "user", "content": "hello"},
                    "policy": {
                        "modelRoute": {
                            "routeRef": {
                                "routeKind": "provider-model",
                                "profileId": "profile-1",
                                "modelId": "gpt-4.1",
                            },
                        }
                    },
                },
            },
        )

    assert start_response.status_code == 200
