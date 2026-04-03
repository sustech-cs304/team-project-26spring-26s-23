from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from types import SimpleNamespace

import pytest
from pydantic_ai.messages import (
    ModelRequest,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
    RuntimeToolLifecycleEvent,
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



def test_open_event_stream_observes_raw_tool_call_before_tool_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")
    tool_call_id = "tool.weather-current:call-1"

    def fake_run_stream(user_prompt: str, **kwargs) -> _FakeRawStreamContext:
        _ = user_prompt
        deps = kwargs["deps"]

        def emit_tool_events() -> None:
            deps.emit_tool_event(
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=WEATHER_CURRENT_TOOL_ID,
                    phase="started",
                    title="调用天气工具",
                    summary="正在获取 Shenzhen 的天气。",
                    input_summary='{"location": "Shenzhen"}',
                )
            )
            deps.emit_tool_event(
                RuntimeToolLifecycleEvent(
                    tool_call_id=tool_call_id,
                    tool_id=WEATHER_CURRENT_TOOL_ID,
                    phase="completed",
                    title="天气工具已返回结果",
                    summary="Shenzhen：晴 / 24°C / 湿度 60%",
                    input_summary='{"location": "Shenzhen"}',
                    result_summary="Shenzhen：晴 / 24°C / 湿度 60%",
                )
            )

        return _FakeRawStreamContext(
            _FakeRawStreamResult(
                raw_events=[
                    PartStartEvent(index=0, part=TextPart(content="我先查一下。")),
                    PartStartEvent(
                        index=1,
                        part=ToolCallPart(
                            "weather_current",
                            '{"location":"Shen',
                            tool_call_id,
                        ),
                    ),
                    PartDeltaEvent(
                        index=1,
                        delta=ToolCallPartDelta(args_delta='zhen"}'),
                    ),
                    PartStartEvent(index=2, part=TextPart(content="查到了。")),
                ],
                output="我先查一下。查到了。",
                on_output=emit_tool_events,
            )
        )

    monkeypatch.setattr(executor._agent, "run_stream", fake_run_stream)

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-1",
                agent_name="default",
                user_prompt="请先查一下天气。",
                message_history=[],
                model_route=_build_resolved_route(),
                enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                request_options={},
            )
        )
    )

    assert result["error"] is None
    assert result["output"] == "我先查一下。查到了。"
    assert [event.type for event in result["events"]] == [
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
        "diagnostic",
        "diagnostic",
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
        "tool_started",
        "tool_completed",
    ]
    assert result["events"][3].payload == {
        "code": "raw_tool_call_observed",
        "message": "Observed provider tool call in raw collector.",
        "details": {
            "source": "pydantic_raw_stream",
            "providerEndpointType": "openai-compatible",
            "observationKind": "observed",
            "partIndex": 1,
            "toolCallId": tool_call_id,
            "toolName": "weather_current",
            "argumentsComplete": False,
            "toolArgumentsJson": '{"location":"Shen',
        },
        "stage": "collect_raw_stream",
    }
    assert result["events"][4].payload == {
        "code": "raw_tool_call_arguments_completed",
        "message": "Provider tool call arguments became complete in raw collector.",
        "details": {
            "source": "pydantic_raw_stream",
            "providerEndpointType": "openai-compatible",
            "observationKind": "arguments_completed",
            "partIndex": 1,
            "toolCallId": tool_call_id,
            "toolName": "weather_current",
            "argumentsComplete": True,
            "toolArguments": {"location": "Shenzhen"},
        },
        "stage": "collect_raw_stream",
    }
    assert result["events"][8].payload["phase"] == "started"
    assert result["events"][9].payload["phase"] == "completed"
    assert result["events"][9].payload["toolId"] == WEATHER_CURRENT_TOOL_ID


class _FakeRawStreamContext:
    def __init__(self, result: _FakeRawStreamResult) -> None:
        self._result = result

    async def __aenter__(self) -> _FakeRawStreamResult:
        return self._result

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class _FakeRawStreamResult:
    def __init__(
        self,
        *,
        raw_events: list[object],
        output: str,
        on_output: Callable[[], None] | None = None,
    ) -> None:
        self._stream_response = self
        self._raw_events = tuple(raw_events)
        self._output = output
        self._on_output = on_output
        self._output_emitted = False

    def __aiter__(self) -> AsyncIterator[object]:
        return self._iter_events()

    async def _iter_events(self) -> AsyncIterator[object]:
        for event in self._raw_events:
            yield event

    async def get_output(self) -> str:
        if not self._output_emitted and self._on_output is not None:
            self._on_output()
            self._output_emitted = True
        return self._output


async def _collect_event_stream(stream) -> dict[str, object]:
    events = []
    output: str | None = None
    error: Exception | None = None

    try:
        async with stream:
            async for event in stream.iter_events():
                events.append(event)
            output = await stream.get_output()
    except Exception as exc:  # pragma: no cover - exercised by assertions
        error = exc

    return {
        "events": events,
        "output": output,
        "error": error,
    }


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
