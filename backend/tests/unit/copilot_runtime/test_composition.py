from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import DEFAULT_AGENT_NAME, PydanticAIAgentExecutor
from app.copilot_runtime.composition import RuntimeDependencies, build_default_runtime_dependencies
from app.copilot_runtime.contracts import (
    THINKING_CAPABILITY_GET_METHOD,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeRunStartRequest,
)
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute, RuntimeModelRouteRef
from app.copilot_runtime.provider_adapter_registry import build_default_provider_adapter_registry
from app.copilot_runtime.session_store import InMemorySessionStore
from app.desktop_runtime.config import DesktopRuntimeConfig, DesktopRuntimePaths


TEST_MODEL_REPLY = "Hello from the composition test model."


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
    def __init__(self, *, output: str, model_configured: bool = True) -> None:
        self.model_configured = model_configured
        self.model_environment_keys: tuple[str, ...] = ()
        self.provider_adapter_registry = build_default_provider_adapter_registry()
        self._output = output

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
            output=self._output,
            resolved_model_id=model_route.model_id,
            events=[
                RuntimeExecutionEvent(
                    type="assistant_segment_delta",
                    payload={
                        "segmentId": f"{run_id}:assistant-segment-1",
                        "delta": self._output,
                    },
                )
            ],
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



def test_build_default_runtime_dependencies_returns_complete_default_graph() -> None:
    dependencies = build_default_runtime_dependencies(agent_executor=_build_test_agent_executor())

    assert isinstance(dependencies, RuntimeDependencies)
    assert dependencies.session_store.storage_type == "in-memory"
    assert dependencies.agent_registry.get_default().name == DEFAULT_AGENT_NAME
    assert dependencies.tool_registry.get_default().name == "default"

    default_agent = dependencies.agent_registry.get_default()
    assert default_agent.toolset_name == dependencies.tool_registry.get_default().name
    executor_factory = default_agent.executor_factory
    assert executor_factory is not None
    assert executor_factory() is dependencies.agent_executor

    assert dependencies.scaffold.default_agent == default_agent.name
    assert dependencies.scaffold.supported_methods == (
        "agents/list",
        "thread/create",
        "thread/get",
        "run/start",
        "run/stream",
        "run/cancel",
        "capabilities/get",
        THINKING_CAPABILITY_GET_METHOD,
    )
    assert dependencies.scaffold.diagnostics_summary()["available_agents"] == [DEFAULT_AGENT_NAME]
    assert dependencies.scaffold.diagnostics_summary()["available_toolsets"] == ["default"]



def test_build_default_runtime_dependencies_streams_run_through_orchestrator() -> None:
    dependencies = build_default_runtime_dependencies(
        agent_executor=_StreamingExecutor(output=TEST_MODEL_REPLY),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    dependencies.session_store.create_thread(bound_agent_id=DEFAULT_AGENT_NAME, thread_id="thread-1")
    run = dependencies.runtime_bridge.start_run(request=_build_run_request(thread_id="thread-1"))

    events = asyncio.run(
        _collect_events(
            dependencies.runtime_bridge.stream_run(run_id=run.run_id)
        )
    )

    assert events[0].type == "run_started"
    assert any(event.type == "text_delta" for event in events)
    assert events[-1].type == "run_completed"
    assert events[-1].payload["assistantText"] == TEST_MODEL_REPLY
    assert [
        (message.role, message.content)
        for message in dependencies.session_store.list_messages("thread-1")
    ] == [
        ("user", "Hello"),
        ("assistant", TEST_MODEL_REPLY),
    ]



def test_build_default_runtime_dependencies_reuses_explicit_store_and_executor() -> None:
    session_store = InMemorySessionStore()
    agent_executor = _build_test_agent_executor()

    dependencies = build_default_runtime_dependencies(
        session_store=session_store,
        agent_executor=agent_executor,
    )

    assert dependencies.session_store is session_store
    assert dependencies.agent_executor is agent_executor

    executor_factory = dependencies.agent_registry.get_default().executor_factory
    assert executor_factory is not None
    assert executor_factory() is agent_executor



def test_build_default_runtime_dependencies_default_executor_is_unconfigured_without_explicit_model(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_MODEL", "runtime-env-model")
    monkeypatch.setenv("COPILOT_MODEL", "legacy-env-model")

    dependencies = build_default_runtime_dependencies(
        runtime_config=_build_runtime_config(tmp_path)
    )

    assert dependencies.scaffold.model_configured is False
    assert dependencies.scaffold.model_environment_keys == ()


async def _collect_events(events):
    return [event async for event in events]



def _build_test_agent_executor() -> PydanticAIAgentExecutor:
    return PydanticAIAgentExecutor(model=TestModel(custom_output_text=TEST_MODEL_REPLY))



def _build_run_request(*, thread_id: str) -> RuntimeRunStartRequest:
    return RuntimeRunStartRequest(
        thread_id=thread_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id="provider-1",
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id="provider-1",
                    model_id="gpt-4.1",
                ),
            ),
            enabledTools=(),
            requestOptions={},
        ),
        agent_id=DEFAULT_AGENT_NAME,
    )



def _build_runtime_config(tmp_path: Path) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    return DesktopRuntimeConfig(
        host="127.0.0.1",
        port=8765,
        local_token=None,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=runtime_root_dir / "config",
            logs_dir=runtime_root_dir / "logs",
            database_dir=runtime_root_dir / "database",
            state_dir=runtime_root_dir / "state",
            debug_log_database_file=runtime_root_dir / "database" / "copilot-debug-log.db",
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
