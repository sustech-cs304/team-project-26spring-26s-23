from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import DEFAULT_AGENT_NAME, PydanticAIAgentExecutor
from app.copilot_runtime.composition import RuntimeDependencies, build_default_runtime_dependencies
from app.copilot_runtime.contracts import (
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeMessageSendRequest,
)
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute, RuntimeModelRoute, RuntimeModelRouteSnapshot
from app.copilot_runtime.session_store import InMemorySessionStore
from app.desktop_runtime.config import DesktopRuntimeConfig, DesktopRuntimePaths


TEST_MODEL_REPLY = "Hello from the composition test model."


class _ImmediateTextStream:
    def __init__(self, *, output: str, resolved_model_id: str) -> None:
        self.resolved_model_id = resolved_model_id
        self._output = output

    async def __aenter__(self) -> "_ImmediateTextStream":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None

    async def iter_deltas(self):
        yield self._output

    async def get_output(self) -> str:
        return self._output


class _StreamingExecutor:
    def __init__(self, *, output: str, model_configured: bool = True) -> None:
        self.model_configured = model_configured
        self.model_environment_keys: tuple[str, ...] = ()
        self._output = output

    def open_text_stream(
        self,
        *,
        agent_name: str,
        user_prompt: str,
        message_history: list[object],
        model_route: ResolvedRuntimeModelRoute,
        enabled_tools: tuple[str, ...] = (),
        request_options: dict[str, object] | None = None,
    ) -> _ImmediateTextStream:
        return _ImmediateTextStream(output=self._output, resolved_model_id=model_route.model_id)


class _ResolvedRouteResolver:
    async def resolve(self, model_route: RuntimeModelRoute) -> ResolvedRuntimeModelRoute:
        return ResolvedRuntimeModelRoute(
            provider_profile_id=model_route.provider_profile_id,
            provider=model_route.snapshot.provider,
            endpoint_type=model_route.snapshot.endpoint_type,
            base_url=model_route.snapshot.base_url,
            model_id=model_route.snapshot.model_id,
            api_key="test-api-key",
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
        "session/create",
        "capabilities/get",
        "message/send",
    )
    assert dependencies.scaffold.diagnostics_summary()["available_agents"] == [DEFAULT_AGENT_NAME]
    assert dependencies.scaffold.diagnostics_summary()["available_toolsets"] == ["default"]



def test_build_default_runtime_dependencies_streams_message_through_orchestrator() -> None:
    dependencies = build_default_runtime_dependencies(
        agent_executor=_StreamingExecutor(output=TEST_MODEL_REPLY),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    dependencies.session_store.create(bound_agent_id=DEFAULT_AGENT_NAME, session_id="session-1")

    events = asyncio.run(
        _collect_events(
            dependencies.runtime_bridge.stream_message(
                request=_build_message_request(session_id="session-1")
            )
        )
    )

    assert events[0].type == "run_started"
    assert any(event.type == "text_delta" for event in events)
    assert events[-1].type == "run_completed"
    assert events[-1].payload["assistantText"] == TEST_MODEL_REPLY
    assert [
        (message.role, message.content)
        for message in dependencies.session_store.list_messages("session-1")
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



def test_build_default_runtime_dependencies_uses_environment_backed_executor_even_with_runtime_config(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("COPILOT_RUNTIME_MODEL", "runtime-env-model")
    monkeypatch.setenv("COPILOT_MODEL", "legacy-env-model")

    dependencies = build_default_runtime_dependencies(
        runtime_config=_build_runtime_config(tmp_path)
    )

    assert dependencies.agent_executor.resolve_model() == "runtime-env-model"
    assert dependencies.scaffold.model_configured is True


async def _collect_events(events):
    return [event async for event in events]



def _build_test_agent_executor() -> PydanticAIAgentExecutor:
    return PydanticAIAgentExecutor(model=TestModel(custom_output_text=TEST_MODEL_REPLY))



def _build_message_request(*, session_id: str) -> RuntimeMessageSendRequest:
    return RuntimeMessageSendRequest(
        session_id=session_id,
        message=RuntimeMessagePayload(role="user", content="Hello"),
        policy=RuntimeMessageExecutionPolicy(
            modelRoute=RuntimeModelRoute(
                provider_profile_id="provider-1",
                snapshot=RuntimeModelRouteSnapshot(
                    provider="openai",
                    endpoint_type="openai-compatible",
                    base_url="https://example.com/v1",
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
