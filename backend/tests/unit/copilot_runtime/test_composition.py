from __future__ import annotations

import asyncio
from pathlib import Path

from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import DEFAULT_AGENT_NAME, PydanticAIAgentExecutor
from app.copilot_runtime.composition import RuntimeDependencies, build_default_runtime_dependencies
from app.copilot_runtime.contracts import RuntimeRunRequest
from app.copilot_runtime.session_store import InMemorySessionStore
from app.desktop_runtime.config import DesktopRuntimeConfig, DesktopRuntimePaths


TEST_MODEL_REPLY = "Hello from the composition test model."


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
    assert dependencies.scaffold.remote_agent_registry[DEFAULT_AGENT_NAME].name == DEFAULT_AGENT_NAME
    assert dependencies.scaffold.diagnostics_summary()["available_agents"] == [DEFAULT_AGENT_NAME]
    assert dependencies.scaffold.diagnostics_summary()["available_toolsets"] == ["default"]


def test_build_default_runtime_dependencies_wires_bridge_to_registry_backed_factory() -> None:
    dependencies = build_default_runtime_dependencies(agent_executor=_build_test_agent_executor())

    result = asyncio.run(
        dependencies.runtime_bridge.run(
            request=_build_run_request(
                thread_id="thread-1",
                run_id="run-1",
                user_message_text="Hello",
            )
        )
    )

    assert result.assistant_text == TEST_MODEL_REPLY
    assert result.session.agent_name == DEFAULT_AGENT_NAME
    assert result.session.metadata == {"last_run_id": "run-1"}
    assert [(message.role, message.content) for message in dependencies.session_store.list_messages("thread-1")] == [
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



def _build_test_agent_executor() -> PydanticAIAgentExecutor:
    return PydanticAIAgentExecutor(model=TestModel(custom_output_text=TEST_MODEL_REPLY))



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

def _build_run_request(*, thread_id: str, run_id: str, user_message_text: str) -> RuntimeRunRequest:
    return RuntimeRunRequest(
        agent_name=DEFAULT_AGENT_NAME,
        thread_id=thread_id,
        run_id=run_id,
        user_message_text=user_message_text,
        state={},
        messages=(),
        actions=(),
        meta_events=(),
        node_name=None,
        forwarded_props={},
        metadata={},
    )
