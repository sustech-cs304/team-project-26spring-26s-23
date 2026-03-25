from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from pydantic_ai.messages import ModelRequest

from app.copilot_runtime.agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
)


def test_run_raises_model_not_configured_when_no_model_is_available() -> None:
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(
        ModelNotConfiguredError,
        match="Pass --model or set COPILOT_RUNTIME_MODEL or COPILOT_MODEL",
    ):
        asyncio.run(
            executor.run(
                agent_name="default",
                user_prompt="hello",
                message_history=[],
            )
        )



def test_resolve_model_prefers_explicit_model_over_environment_keys() -> None:
    executor = PydanticAIAgentExecutor(
        model=" explicit-model ",
        env={
            "COPILOT_RUNTIME_MODEL": "runtime-env-model",
            "COPILOT_MODEL": "legacy-env-model",
        },
    )

    assert executor.resolve_model() == "explicit-model"
    assert executor.model_configured is True



def test_resolve_model_falls_back_to_environment_keys_in_priority_order() -> None:
    runtime_env_executor = PydanticAIAgentExecutor(
        env={
            "COPILOT_RUNTIME_MODEL": "runtime-env-model",
            "COPILOT_MODEL": "legacy-env-model",
        }
    )
    legacy_env_executor = PydanticAIAgentExecutor(
        env={"COPILOT_MODEL": "legacy-env-model"}
    )

    assert runtime_env_executor.resolve_model() == "runtime-env-model"
    assert legacy_env_executor.resolve_model() == "legacy-env-model"
    assert runtime_env_executor.model_configured is True
    assert legacy_env_executor.model_configured is True


def test_run_raises_agent_execution_error_when_agent_returns_empty_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    async def fake_run(
        user_prompt: str,
        *,
        message_history: list[object],
        model: object,
    ) -> SimpleNamespace:
        return SimpleNamespace(output="   ")

    monkeypatch.setattr(executor._agent, "run", fake_run)

    with pytest.raises(AgentExecutionError, match="empty text response"):
        asyncio.run(
            executor.run(
                agent_name="default",
                user_prompt="hello",
                message_history=[],
            )
        )


def test_run_raises_agent_execution_error_when_agent_returns_non_text_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    async def fake_run(
        user_prompt: str,
        *,
        message_history: list[object],
        model: object,
    ) -> SimpleNamespace:
        return SimpleNamespace(output={"unexpected": True})

    monkeypatch.setattr(executor._agent, "run", fake_run)

    with pytest.raises(AgentExecutionError, match="non-text output"):
        asyncio.run(
            executor.run(
                agent_name="default",
                user_prompt="hello",
                message_history=[],
            )
        )


def test_run_returns_stable_text_from_controlled_agent_stub(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")
    history = [ModelRequest.user_text_prompt("earlier question")]
    captured: dict[str, object] = {}

    async def fake_run(
        user_prompt: str,
        *,
        message_history: list[object],
        model: object,
    ) -> SimpleNamespace:
        captured["user_prompt"] = user_prompt
        captured["message_history"] = list(message_history)
        captured["model"] = model
        return SimpleNamespace(output="Controlled reply")

    monkeypatch.setattr(executor._agent, "run", fake_run)

    result = asyncio.run(
        executor.run(
            agent_name="default",
            user_prompt="latest question",
            message_history=history,
        )
    )

    assert result == "Controlled reply"
    assert captured == {
        "user_prompt": "latest question",
        "message_history": history,
        "model": "test-model",
    }
