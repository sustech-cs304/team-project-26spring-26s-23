from __future__ import annotations

import asyncio
import json
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

import app.integrations.sustech.blackboard.facade.tools as blackboard_facade_tools
from app.integrations.sustech.blackboard.api.dto import CourseCatalogResultDTO
from app.integrations.sustech.blackboard.provider.results import CourseCatalogSearchResult
from app.copilot_runtime.agent import (
    AgentExecutionError,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
    RuntimeToolLifecycleEvent,
)
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
from app.copilot_runtime.tool_registry import WEATHER_CURRENT_TOOL_ID, build_default_tool_registry
from app.tooling.runtime_adapter.copilot_runtime import CONTRACT_RUNTIME_TOOL_KIND


def test_run_raises_model_not_configured_when_no_model_is_available() -> None:
    executor = PydanticAIAgentExecutor(env={})

    with pytest.raises(
        ModelNotConfiguredError,
        match="Provide an explicit executor model",
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



def test_resolve_model_no_longer_falls_back_to_environment_keys() -> None:
    runtime_env_executor = PydanticAIAgentExecutor(
        env={
            "COPILOT_RUNTIME_MODEL": "runtime-env-model",
            "COPILOT_MODEL": "legacy-env-model",
        }
    )

    with pytest.raises(ModelNotConfiguredError, match="Provide an explicit executor model"):
        runtime_env_executor.resolve_model()

    assert runtime_env_executor.model_configured is False



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



def test_runtime_tool_lifecycle_event_to_payload_preserves_canonical_summary_and_result_summary() -> None:
    canonical_summary = '{\n  "ok": true\n}'

    payload = RuntimeToolLifecycleEvent(
        tool_call_id="tool.weather-current:call-1",
        tool_id=WEATHER_CURRENT_TOOL_ID,
        phase="completed",
        title="天气工具已返回结果",
        summary=canonical_summary,
        input_summary='{"location": "Shenzhen"}',
        result_summary="Shenzhen：晴 / 24°C / 湿度 60%",
    ).to_payload()

    assert payload == {
        "toolCallId": "tool.weather-current:call-1",
        "toolId": WEATHER_CURRENT_TOOL_ID,
        "phase": "completed",
        "title": "天气工具已返回结果",
        "summary": canonical_summary,
        "inputSummary": '{"location": "Shenzhen"}',
        "resultSummary": "Shenzhen：晴 / 24°C / 湿度 60%",
    }



def test_open_event_stream_executes_weather_tool_and_records_started_completed_events() -> None:
    executor = PydanticAIAgentExecutor(
        model=TestModel(
            call_tools=["weather_current"],
            custom_output_text="Weather reply",
            seed=0,
        )
    )

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-weather-success",
                agent_name="default",
                user_prompt="Tell me the weather.",
                message_history=[],
                model_route=_build_resolved_route(),
                enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                request_options={},
            )
        )
    )

    tool_events = [
        event.payload
        for event in result["events"]
        if event.type in {"tool_started", "tool_completed", "tool_failed"}
    ]

    assert result["error"] is None
    assert result["output"] == "Weather reply"
    assert [payload["phase"] for payload in tool_events] == ["started", "completed"]
    assert all(payload["toolId"] == WEATHER_CURRENT_TOOL_ID for payload in tool_events)

    completed_payload = tool_events[1]
    parsed_summary = json.loads(completed_payload["summary"])
    assert set(parsed_summary) == {"condition", "humidity", "location", "summary", "temperatureC"}
    assert isinstance(parsed_summary["location"], str)
    assert parsed_summary["location"].strip() != ""
    assert completed_payload["summary"] == json.dumps(
        parsed_summary,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    assert completed_payload["resultSummary"] is not None
    assert completed_payload["summary"] != completed_payload["resultSummary"]



def test_open_event_stream_keeps_running_when_weather_tool_is_not_enabled() -> None:
    executor = PydanticAIAgentExecutor(
        model=TestModel(
            call_tools=["weather_current"],
            custom_output_text="unused",
            seed=0,
        )
    )

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-weather-disabled",
                agent_name="default",
                user_prompt="Tell me the weather.",
                message_history=[],
                model_route=_build_resolved_route(),
                enabled_tools=(),
                request_options={},
            )
        )
    )

    tool_events = [
        event.payload
        for event in result["events"]
        if event.type in {"tool_started", "tool_completed", "tool_failed"}
    ]

    assert result["error"] is None
    assert result["output"] == "unused"
    assert [payload["phase"] for payload in tool_events] == ["started", "failed"]
    assert tool_events[-1]["errorSummary"] == (
        "Tool 'tool.weather-current' is not enabled for this run."
    )



def test_open_event_stream_observes_raw_tool_call_before_tool_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")
    tool_call_id = "tool.weather-current:call-1"

    async def fake_run(user_prompt: str, **kwargs) -> SimpleNamespace:
        _ = user_prompt
        deps = kwargs["deps"]
        event_stream_handler = kwargs["event_stream_handler"]

        async def runtime_events() -> AsyncIterator[object]:
            yield PartStartEvent(index=0, part=TextPart(content="我先查一下。"))
            yield PartStartEvent(
                index=1,
                part=ToolCallPart(
                    "weather_current",
                    '{"location":"Shen',
                    tool_call_id,
                ),
            )
            yield PartDeltaEvent(
                index=1,
                delta=ToolCallPartDelta(args_delta='zhen"}'),
            )
            yield PartStartEvent(index=2, part=TextPart(content="查到了。"))

        await event_stream_handler(SimpleNamespace(), runtime_events())
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
        return SimpleNamespace(output="我先查一下。查到了。")

    monkeypatch.setattr(executor._agent, "run", fake_run)

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


def test_open_event_stream_emits_failed_tool_event_when_completed_raw_tool_call_never_executes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")
    tool_call_id = "tool.weather-current:call-2"

    async def fake_run(user_prompt: str, **kwargs) -> SimpleNamespace:
        _ = user_prompt
        event_stream_handler = kwargs["event_stream_handler"]

        async def runtime_events() -> AsyncIterator[object]:
            yield PartStartEvent(index=0, part=TextPart(content="我先查一下。"))
            yield PartStartEvent(
                index=1,
                part=ToolCallPart(
                    "weather_current",
                    '{"location":"Shen',
                    tool_call_id,
                ),
            )
            yield PartDeltaEvent(
                index=1,
                delta=ToolCallPartDelta(args_delta='zhen"}'),
            )

        await event_stream_handler(SimpleNamespace(), runtime_events())
        return SimpleNamespace(output="我先查一下。")

    monkeypatch.setattr(executor._agent, "run", fake_run)

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-2",
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
    assert result["output"] == "我先查一下。"
    assert [event.type for event in result["events"]] == [
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
        "diagnostic",
        "diagnostic",
        "diagnostic",
        "tool_failed",
    ]
    assert result["events"][-2].payload == {
        "code": "raw_tool_call_unexecuted",
        "message": "Provider tool call arguments became complete, but no actual tool execution followed.",
        "details": {
            "source": "pydantic_raw_stream",
            "providerEndpointType": "openai-compatible",
            "observationKind": "execution_missing",
            "partIndex": 1,
            "toolCallId": tool_call_id,
            "toolName": "weather_current",
            "argumentsComplete": True,
            "toolArguments": {"location": "Shenzhen"},
        },
        "stage": "drive_raw_tool_call",
    }
    assert result["events"][-1].payload == {
        "toolCallId": tool_call_id,
        "toolId": WEATHER_CURRENT_TOOL_ID,
        "phase": "failed",
        "title": "工具调用失败",
        "summary": "模型产生了工具调用，但运行时未真正执行该调用。",
        "inputSummary": '{"location": "Shenzhen"}',
        "errorSummary": "Provider tool call arguments became complete, but no actual tool execution followed.",
    }



def test_execute_bound_tool_returns_tool_not_found_failure_without_raising() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = SimpleNamespace(
        tool_call_id="tool.missing:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"tool.missing"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-missing-tool",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="tool.missing",
            arguments={"location": "Shenzhen"},
        )
    )

    assert result == {
        "status": "error",
        "error": {
            "code": "tool_not_found",
            "message": "Unknown tool 'tool.missing'.",
            "retryable": False,
        },
        "artifacts": [],
        "metadata": {
            "toolId": "tool.missing",
            "toolCallId": "tool.missing:call-1",
        },
    }
    assert [event.phase for event in emitted_tool_events] == ["failed"]
    assert emitted_tool_events[-1].error_summary == "Unknown tool 'tool.missing'."



def test_execute_bound_tool_returns_tool_not_enabled_failure_without_raising() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = SimpleNamespace(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset(),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-disabled",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id=WEATHER_CURRENT_TOOL_ID,
            arguments={"location": "Shenzhen"},
        )
    )

    assert result == {
        "status": "error",
        "error": {
            "code": "tool_not_enabled",
            "message": "Tool 'tool.weather-current' is not enabled for this run.",
            "retryable": False,
        },
        "artifacts": [],
        "metadata": {
            "toolId": WEATHER_CURRENT_TOOL_ID,
            "toolCallId": f"{WEATHER_CURRENT_TOOL_ID}:call-1",
        },
    }
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert emitted_tool_events[-1].error_summary == (
        "Tool 'tool.weather-current' is not enabled for this run."
    )



def test_execute_bound_tool_executes_contract_tool_via_runtime_registry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        captured.update(
            {
                "username": username,
                "password": password,
                "keyword": keyword,
                "field": field,
                "operator": operator,
                "limit": limit,
                "fetch_mode": fetch_mode,
                "max_pages": max_pages,
            }
        )
        return CourseCatalogSearchResult(
            keyword=keyword,
            field=field,
            operator=operator,
            limit=limit,
            results=[
                CourseCatalogResultDTO(
                    course_id="_course_1",
                    course_identifier="CS305",
                    course_name="数据库系统",
                    instructor="张老师",
                )
            ],
            logs=[],
        )

    monkeypatch.setattr(blackboard_facade_tools, "search_course_catalog_with_credentials", fake_search)

    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = SimpleNamespace(
        tool_call_id="blackboard.course_catalog.search:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.course_catalog.search"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="blackboard.course_catalog.search",
            arguments={
                "username": "alice",
                "password": "secret",
                "keyword": "数据库系统",
            },
        )
    )

    assert captured == {
        "username": "alice",
        "password": "secret",
        "keyword": "数据库系统",
        "field": "CourseName",
        "operator": "Contains",
        "limit": None,
        "fetch_mode": "full",
        "max_pages": 30,
    }
    assert result["status"] == "error"
    assert result["error"]["code"] == "execution_failed"
    assert result["error"]["message"] == "CourseCatalogSearchResult.__init__() missing 2 required positional arguments: 'fetch_mode' and 'max_pages'"
    assert result["metadata"]["toolId"] == "blackboard.course_catalog.search"
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert all(event.tool_id == "blackboard.course_catalog.search" for event in emitted_tool_events)
    assert emitted_tool_events[-1].error_summary == "CourseCatalogSearchResult.__init__() missing 2 required positional arguments: 'fetch_mode' and 'max_pages'"



def test_execute_bound_tool_returns_recoverable_contract_failure_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        _ = (username, password, keyword, field, operator, limit, fetch_mode, max_pages)
        raise ValueError("keyword must be a non-empty string.")

    monkeypatch.setattr(blackboard_facade_tools, "search_course_catalog_with_credentials", fake_search)

    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = SimpleNamespace(
        tool_call_id="blackboard.course_catalog.search:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.course_catalog.search"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="blackboard.course_catalog.search",
            arguments={
                "username": "alice",
                "password": "secret",
                "keyword": "",
            },
        )
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_input"
    assert result["error"]["message"] == "keyword must be a non-empty string."
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert emitted_tool_events[-1].tool_id == "blackboard.course_catalog.search"
    assert emitted_tool_events[-1].error_summary == "keyword must be a non-empty string."



def test_execute_bound_tool_returns_contract_execution_failure_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str = "CourseName",
        operator: str = "Contains",
        limit: int | None = None,
        fetch_mode: str = "full",
        max_pages: int = 30,
    ) -> CourseCatalogSearchResult:
        _ = (username, password, keyword, field, operator, limit, fetch_mode, max_pages)
        raise RuntimeError("blackboard search exploded")

    monkeypatch.setattr(blackboard_facade_tools, "search_course_catalog_with_credentials", fake_search)

    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = SimpleNamespace(
        tool_call_id="blackboard.course_catalog.search:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.course_catalog.search"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="blackboard.course_catalog.search",
            arguments={
                "username": "alice",
                "password": "secret",
                "keyword": "数据库系统",
            },
        )
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "execution_failed"
    assert result["error"]["message"] == "blackboard search exploded"
    assert result["metadata"] == {
        "toolId": "blackboard.course_catalog.search",
    }
    assert result["error"]["details"]["exceptionType"] == "RuntimeError"
    assert "Traceback (most recent call last):" in result["error"]["details"]["traceback"]
    assert (
        result["error"]["details"]["diagnosticContext"]
        == {
            "integration": "blackboard",
            "toolId": "blackboard.course_catalog.search",
            "invocationId": "blackboard.course_catalog.search:call-1",
            "argumentKeys": ["keyword", "password", "username"],
        }
    )
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert emitted_tool_events[-1].error_summary == "blackboard search exploded"



def test_execute_bound_tool_returns_contract_integrity_failure_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []

    async def execute_malformed_tool(_arguments):
        return {
            "status": "error",
            "error": {"message": "missing code"},
            "artifacts": [],
            "metadata": {"toolId": "contract.invalid"},
        }

    malformed_tool = SimpleNamespace(
        descriptor=SimpleNamespace(
            kind=CONTRACT_RUNTIME_TOOL_KIND,
            display_name="Malformed Contract Tool",
        ),
        execute=execute_malformed_tool,
    )
    original_resolve_tool = registry.resolve_tool

    def resolve_tool(tool_id: str):
        if tool_id == "contract.invalid":
            return malformed_tool
        return original_resolve_tool(tool_id)

    monkeypatch.setattr(registry, "resolve_tool", resolve_tool)

    ctx = SimpleNamespace(
        tool_call_id="contract.invalid:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"contract.invalid"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-integrity",
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="contract.invalid",
            arguments={"query": "hello"},
        )
    )

    assert result == {
        "status": "error",
        "error": {
            "code": "tool_execution_failed",
            "message": "Contract tool returned an error result without a valid error code.",
            "retryable": False,
            "details": {"integrity": "invalid_error_code"},
        },
        "artifacts": [],
        "metadata": {
            "toolId": "contract.invalid",
            "toolCallId": "contract.invalid:call-1",
        },
    }
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert emitted_tool_events[-1].tool_id == "contract.invalid"
    assert emitted_tool_events[-1].error_summary == (
        "Contract tool returned an error result without a valid error code."
    )



def test_open_event_stream_propagates_cancelled_error_from_agent_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    async def fake_run(user_prompt: str, **kwargs) -> SimpleNamespace:
        _ = (user_prompt, kwargs)
        raise asyncio.CancelledError()

    monkeypatch.setattr(executor._agent, "run", fake_run)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            _collect_event_stream(
                executor.open_event_stream(
                    run_id="run-cancelled",
                    agent_name="default",
                    user_prompt="请取消这次运行。",
                    message_history=[],
                    model_route=_build_resolved_route(),
                    enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                    request_options={},
                )
            )
        )


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


def _build_resolved_route() -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id="gpt-4.1",
        api_key="test-api-key",
    )
