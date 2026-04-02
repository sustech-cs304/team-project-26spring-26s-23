from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from pydantic_ai.messages import ModelRequest
from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
    ToolInvocationError,
)
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID


def test_run_raises_model_not_configured_when_no_model_is_available() -> None:
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(
        ModelNotConfiguredError,
        match="Provide an explicit executor model or set COPILOT_RUNTIME_MODEL or COPILOT_MODEL",
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
        **kwargs,
    ) -> SimpleNamespace:
        _ = (user_prompt, kwargs)
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
        **kwargs,
    ) -> SimpleNamespace:
        _ = (user_prompt, kwargs)
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
        **kwargs,
    ) -> SimpleNamespace:
        captured["user_prompt"] = user_prompt
        captured["message_history"] = list(kwargs["message_history"])
        captured["model"] = kwargs["model"]
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



def test_open_text_stream_executes_weather_tool_and_records_started_completed_events() -> None:
    executor = PydanticAIAgentExecutor(
        model=TestModel(
            call_tools=["weather_current"],
            custom_output_text="Weather reply",
            seed=0,
        )
    )

    result = asyncio.run(
        _collect_stream(
            executor.open_text_stream(
                agent_name="default",
                user_prompt="Tell me the weather.",
                message_history=[],
                model_route=_build_resolved_route(),
                enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                request_options={},
            )
        )
    )

    assert result["error"] is None
    assert result["output"] == "Weather reply"
    assert [event.phase for event in result["tool_events"]] == ["started", "completed"]
    assert all(event.tool_id == WEATHER_CURRENT_TOOL_ID for event in result["tool_events"])
    assert result["tool_events"][1].result_summary is not None



def test_open_text_stream_fails_when_weather_tool_is_not_enabled() -> None:
    executor = PydanticAIAgentExecutor(
        model=TestModel(
            call_tools=["weather_current"],
            custom_output_text="unused",
            seed=0,
        )
    )

    result = asyncio.run(
        _collect_stream(
            executor.open_text_stream(
                agent_name="default",
                user_prompt="Tell me the weather.",
                message_history=[],
                model_route=_build_resolved_route(),
                enabled_tools=(),
                request_options={},
            )
        )
    )

    assert isinstance(result["error"], ToolInvocationError)
    assert result["error"].code == "tool_not_enabled"
    assert [event.phase for event in result["tool_events"]] == ["started", "failed"]
    assert result["tool_events"][-1].error_summary is not None


async def _collect_stream(stream) -> dict[str, object]:
    deltas: list[str] = []
    tool_events = []
    output: str | None = None
    error: Exception | None = None

    try:
        async with stream:
            async for delta in stream.iter_deltas():
                deltas.append(delta)
                tool_events.extend(stream.drain_tool_events())
            tool_events.extend(stream.drain_tool_events())
            output = await stream.get_output()
            tool_events.extend(stream.drain_tool_events())
    except Exception as exc:  # pragma: no cover - exercised by assertions
        tool_events.extend(stream.drain_tool_events())
        error = exc

    return {
        "deltas": deltas,
        "tool_events": tool_events,
        "output": output,
        "error": error,
    }



def _build_resolved_route() -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id="gpt-4.1",
        api_key="test-api-key",
    )
