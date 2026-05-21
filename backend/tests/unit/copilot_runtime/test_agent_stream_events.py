from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, TypedDict, cast

import httpx
import pytest
from pydantic_ai._run_context import RunContext
from pydantic_ai.messages import (
    ModelRequest,
    PartDeltaEvent,
    PartStartEvent,
    RetryPromptPart,
    ThinkingPart,
    ThinkingPartDelta,
    TextPart,
    ToolCallPart,
    ToolCallPartDelta,
)
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from pydantic_ai.models.test import TestModel

import app.integrations.sustech.blackboard.facade.tools as blackboard_facade_tools
from app.integrations.sustech.blackboard.api.dto import CourseCatalogResultDTO
from app.integrations.sustech.blackboard.provider.results import CourseCatalogSearchResult
from app.copilot_runtime.agent import (
    AgentExecutionError,
    AwaitingUserInputError,
    DEFAULT_AGENT_SYSTEM_PROMPT,
    ModelNotConfiguredError,
    PydanticAIAgentExecutor,
    RuntimeToolLifecycleEvent,
)
from app.copilot_runtime.skill_snapshot_provider import create_skill_snapshot_provider
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
)
from app.copilot_runtime.tool_approval_coordinator import (
    RuntimeToolApprovalCoordinator,
    ToolApprovalNotFoundError,
)
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver
from app.copilot_runtime.mcp_snapshot_provider import McpCapabilitySnapshot
from app.copilot_runtime.mcp_tool_executor import build_mcp_executable_tools
from app.copilot_runtime.mcp_snapshot_provider import McpSnapshotProvider
from app.copilot_runtime.tool_registry import (
    REQUEST_USER_FORM_TOOL_ID,
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
    WEATHER_CURRENT_TOOL_ID,
    build_default_tool_registry,
)
from app.desktop_runtime.host_model_route_bridge import HostModelRouteBridgeClient
from app.tooling.file_tools import FILE_TOOL_SWITCH_ROOT_ID
from app.tooling.runtime_adapter.copilot_runtime import CONTRACT_RUNTIME_TOOL_KIND


class CollectedEventStreamResult(TypedDict):
    events: list[RuntimeExecutionEvent]
    output: str | None
    error: Exception | None


def _require_payload_mapping(payload: dict[str, Any] | None) -> dict[str, Any]:
    assert payload is not None
    return payload


def _build_tool_run_context(
    *,
    tool_call_id: str,
    deps: Any,
) -> RunContext[Any]:
    return cast(
        RunContext[Any],
        SimpleNamespace(tool_call_id=tool_call_id, deps=deps),
    )


def test_open_event_stream_uses_route_scoped_stream_model_without_global_executor_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor()
    resolved_model_ids: list[str] = []

    def fake_build_stream_model(model_route: ResolvedRuntimeModelRoute) -> TestModel:
        resolved_model_ids.append(model_route.model_id)
        return TestModel(custom_output_text="route-scoped model", seed=0)

    monkeypatch.setattr(executor, "_build_stream_model", fake_build_stream_model)

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-request-model-only",
                agent_name="default",
                user_prompt="Use the resolved route model.",
                message_history=[],
                model_route=_build_resolved_route(model_id="provider-route-model"),
                request_options={},
            )
        )
    )

    assert resolved_model_ids == ["provider-route-model"]
    assert result["error"] is None
    assert result["output"] == "route-scoped model"


def test_open_event_stream_projects_reasoning_parts_into_reasoning_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    async def fake_run(user_prompt: str, **kwargs) -> SimpleNamespace:
        _ = user_prompt
        event_stream_handler = kwargs["event_stream_handler"]

        async def runtime_events() -> AsyncIterator[object]:
            yield PartStartEvent(index=0, part=ThinkingPart(content="先分析。"))
            yield PartDeltaEvent(index=0, delta=ThinkingPartDelta(content_delta="再补充。"))
            yield PartStartEvent(index=1, part=TextPart(content="最终答复。"))

        await event_stream_handler(SimpleNamespace(), runtime_events())
        return SimpleNamespace(output="最终答复。")

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
    monkeypatch.setattr(executor._agent, "run", fake_run)

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-reasoning-visible",
                agent_name="default",
                user_prompt="请先思考再作答。",
                message_history=[],
                model_route=_build_resolved_route(),
                request_options={},
            )
        )
    )

    assert result["error"] is None
    assert result["output"] == "最终答复。"
    assert [event.type for event in result["events"]] == [
        "reasoning_segment_started",
        "reasoning_segment_delta",
        "reasoning_segment_delta",
        "reasoning_segment_completed",
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
    ]
    assert result["events"][1].payload == {
        "segmentId": "run-reasoning-visible:reasoning-segment-1",
        "delta": "先分析。",
    }
    assert result["events"][2].payload == {
        "segmentId": "run-reasoning-visible:reasoning-segment-1",
        "delta": "再补充。",
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
                tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
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
    assert not any(event.type == "tool_waiting_approval" for event in result["events"])

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



def test_open_event_stream_executes_mcp_tool_and_records_started_completed_events() -> None:
    fixture_path = (
        Path(__file__).resolve().parents[4]
        / "frontend-copilot"
        / "electron"
        / "mcp-registry"
        / "test-fixtures"
        / "snapshot.sample.json"
    )
    snapshot = McpCapabilitySnapshot.model_validate(
        json.loads(fixture_path.read_text(encoding="utf-8"))
    )

    class _RecordingMcpBridgeClient:
        def __init__(self) -> None:
            self.calls: list[dict[str, object]] = []

        async def call_mcp_tool(
            self,
            *,
            context,
            server_id: str,
            remote_tool_name: str,
            arguments: dict[str, object] | None = None,
            snapshot_revision: int | None = None,
        ) -> dict[str, object]:
            self.calls.append(
                {
                    "toolId": context.tool_id,
                    "serverId": server_id,
                    "remoteToolName": remote_tool_name,
                    "arguments": dict(arguments or {}),
                    "snapshotRevision": snapshot_revision,
                    "runId": context.run_id,
                }
            )
            return {
                "ok": True,
                "toolId": context.tool_id,
                "serverId": server_id,
                "remoteToolName": remote_tool_name,
                "content": [{"type": "text", "text": "search completed"}],
                "structuredContent": {"count": 1},
                "snapshotRevision": snapshot_revision,
                "isError": False,
            }

    bridge_client = _RecordingMcpBridgeClient()
    class _SnapshotProvider:
        def load_snapshot(self) -> McpCapabilitySnapshot:
            return snapshot

    registry = build_default_tool_registry(
        dynamic_tool_loader=lambda _language: build_mcp_executable_tools(
            snapshot=snapshot,
            bridge_client=cast(Any, bridge_client),
            snapshot_provider=cast(McpSnapshotProvider, _SnapshotProvider()),
        )
    )
    tool_id = "mcp.mcp-stdio-stub.search-campus.00004d8d"
    resolved_tool = registry.resolve_tool(tool_id)
    if resolved_tool.function_name is None:
        raise AssertionError("Expected MCP executable tool to expose a function_name.")

    executor = PydanticAIAgentExecutor(
        model=TestModel(
            call_tools=[resolved_tool.function_name],
            custom_output_text="MCP reply",
            seed=0,
        ),
        tool_registry=registry,
    )

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-mcp-success",
                agent_name="default",
                user_prompt="Search the campus knowledge base.",
                message_history=[],
                model_route=_build_resolved_route(),
                enabled_tools=(tool_id,),
                tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
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
    assert result["output"] == "MCP reply"
    assert [payload["phase"] for payload in tool_events] == ["started", "completed"]
    assert all(payload["toolId"] == tool_id for payload in tool_events)
    completed_payload = tool_events[1]
    parsed_summary = json.loads(completed_payload["summary"])
    assert parsed_summary["status"] == "success"
    assert parsed_summary["output"] == {
        "ok": True,
        "content": [{"type": "text", "text": "search completed"}],
        "structuredContent": {"count": 1},
    }
    assert parsed_summary["metadata"] == {
        "toolId": tool_id,
        "sourceKind": "mcp",
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "snapshotRevision": 8,
    }
    assert bridge_client.calls == [
        {
            "toolId": tool_id,
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "arguments": {"keyword": "a"},
            "snapshotRevision": 8,
            "runId": "run-mcp-success",
        }
    ]



def test_open_event_stream_exposes_skill_control_tools_and_records_sanitized_events(
    tmp_path: Path,
) -> None:
    state_dir, config_dir, runtime_root_dir = _write_skill_runtime_fixture(tmp_path)
    skill_runtime_index = create_skill_snapshot_provider(
        state_dir=state_dir,
        config_dir=config_dir,
        runtime_root_dir=runtime_root_dir,
    ).load_runtime_index()

    class _SkillToolCallingTestModel(TestModel):
        def gen_tool_args(self, tool_def) -> Any:
            if tool_def.name == "skill_activate":
                return {"skill_id": "writing-clear-docs"}
            if tool_def.name == "skill_read_resource":
                return {
                    "skill_id": "writing-clear-docs",
                    "path": "resources/checklist.md",
                }
            return super().gen_tool_args(tool_def)

    executor = PydanticAIAgentExecutor(
        model=_SkillToolCallingTestModel(
            call_tools=["skill_activate", "skill_read_resource"],
            custom_output_text="Skill reply",
            seed=0,
        )
    )

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-skill-tools",
                agent_name="default",
                user_prompt="Write docs.",
                message_history=[],
                model_route=_build_resolved_route(),
                tool_permission_resolver=RuntimeToolPermissionResolver(
                    default_mode="allow"
                ),
                request_options={},
                enabled_tools=(SKILL_ACTIVATE_TOOL_ID, SKILL_READ_RESOURCE_TOOL_ID),
                skill_runtime_index=skill_runtime_index,
                skill_system_prompt="## Available Skills\n- writing-clear-docs: docs",
            )
        )
    )

    tool_events = [event.payload for event in result["events"] if event.type in {"tool_started", "tool_completed", "tool_failed"}]
    completed_events = [payload for payload in tool_events if payload["phase"] == "completed"]

    assert result["error"] is None
    assert result["output"] == "Skill reply"
    assert [payload["toolId"] for payload in completed_events] == [
        SKILL_ACTIVATE_TOOL_ID,
        SKILL_READ_RESOURCE_TOOL_ID,
    ]
    assert all("entryContent\":" not in payload["summary"] for payload in completed_events)
    assert all("Prefer structure" not in payload["summary"] for payload in completed_events)
    assert '"resourceCount"' in completed_events[0]["summary"]
    assert '"contentLength"' in completed_events[1]["summary"]
    assert '"path": "resources/checklist.md"' in completed_events[1]["summary"]
    assert completed_events[0]["resultSummary"] is not None
    assert completed_events[1]["resultSummary"] is not None


def test_open_event_stream_does_not_advertise_weather_tool_when_it_is_not_enabled() -> None:
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

    assert isinstance(result["error"], KeyError)
    assert result["error"].args == ("weather_current",)
    assert result["output"] is None
    assert tool_events == []



def test_open_event_stream_builds_scoped_agent_when_no_tools_are_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")
    scoped_agent = object()
    build_calls: list[tuple[str, ...] | None] = []

    def fake_build_runtime_agent(
        *,
        enabled_tools: tuple[str, ...] | None,
        resolved_model: Any,
        skill_system_prompt: str | None = None,
    ) -> object:
        _ = resolved_model
        _ = skill_system_prompt
        build_calls.append(enabled_tools)
        return scoped_agent

    monkeypatch.setattr(executor, "_build_runtime_agent", fake_build_runtime_agent)

    stream = executor.open_event_stream(
        run_id="run-no-tools",
        agent_name="default",
        user_prompt="What tools do you have?",
        message_history=[],
        model_route=_build_resolved_route(),
        enabled_tools=(),
        request_options={},
    )

    assert build_calls == [()]
    assert stream._agent is scoped_agent
    assert stream._agent is not executor._agent



def test_open_event_stream_recovers_from_unknown_tool_name_via_model_retry() -> None:
    requests: list[list[ModelRequest]] = []

    async def stream_function(messages: list[Any], _agent_info: Any) -> AsyncIterator[Any]:
        requests.append([message for message in messages if isinstance(message, ModelRequest)])
        latest_request = next(
            (message for message in reversed(messages) if isinstance(message, ModelRequest)),
            None,
        )
        assert latest_request is not None
        if any(isinstance(part, RetryPromptPart) for part in latest_request.parts):
            yield "工具名无效，我改为直接回答。"
            return
        yield {
            0: DeltaToolCall(
                name="weather_currennt",
                json_args='{"location":"Shenzhen"}',
                tool_call_id="bad-call-1",
            )
        }

    executor = PydanticAIAgentExecutor(
        model=FunctionModel(
            stream_function=stream_function,
            model_name="function:unknown-tool",
        )
    )

    result = asyncio.run(
        _collect_event_stream(
            executor.open_event_stream(
                run_id="run-unknown-tool-name",
                agent_name="default",
                user_prompt="请查询天气。",
                message_history=[],
                model_route=_build_resolved_route(model_id="function:unknown-tool"),
                enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
                request_options={},
            )
        )
    )

    assert result["error"] is None
    assert result["output"] == "工具名无效，我改为直接回答。"
    assert len(requests) == 2
    assert any(
        isinstance(part, RetryPromptPart)
        and "Unknown tool name: 'weather_currennt'" in str(part.content)
        for part in requests[1][-1].parts
    )
    assert [event.type for event in result["events"]] == [
        "diagnostic",
        "assistant_segment_started",
        "assistant_segment_delta",
        "assistant_segment_completed",
        "diagnostic",
        "tool_failed",
    ]
    assert result["events"][-2].payload["code"] == "raw_tool_call_unexecuted"
    assert result["events"][-1].payload == {
        "toolCallId": "bad-call-1",
        "toolId": "weather_currennt",
        "phase": "failed",
        "title": "工具调用失败",
        "summary": "模型产生了工具调用，但运行时未真正执行该调用。",
        "inputSummary": '{"location": "Shenzhen"}',
        "errorSummary": "Provider tool call arguments became complete, but no actual tool execution followed.",
    }



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

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
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

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
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



def test_open_event_stream_propagates_cancelled_error_from_agent_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    async def fake_run(user_prompt: str, **kwargs) -> SimpleNamespace:
        _ = (user_prompt, kwargs)
        raise asyncio.CancelledError()

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
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


def _write_skill_runtime_fixture(tmp_path: Path) -> tuple[Path, Path, Path]:
    state_dir = tmp_path / "state"
    config_dir = tmp_path / "config"
    runtime_root_dir = tmp_path / "desktop-runtime"
    skill_root = runtime_root_dir / "skills" / "writing-clear-docs"
    resources_dir = skill_root / "resources"
    state_dir.mkdir(parents=True)
    (config_dir / "skill-registry").mkdir(parents=True)
    resources_dir.mkdir(parents=True)
    (skill_root / "SKILL.md").write_text(
        "# Clear Docs\nUse this skill to write concise docs.\n",
        encoding="utf-8",
    )
    (resources_dir / "checklist.md").write_text(
        "- Prefer structure over verbosity.\n",
        encoding="utf-8",
    )
    resource_summaries = [{"path": "resources/checklist.md"}]
    (state_dir / "skill-capability-snapshot.json").write_text(
        json.dumps(
            {
                "version": 1,
                "registryRevision": 12,
                "snapshotRevision": 8,
                "generatedAt": "2026-04-24T00:00:00.000Z",
                "skills": [
                    {
                        "skillId": "writing-clear-docs",
                        "displayName": "Clear Docs",
                        "description": "Write clear developer documentation.",
                        "tags": ["documentation"],
                        "entrySummary": "Use when drafting concise technical documents.",
                        "resourceSummaries": resource_summaries,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (config_dir / "skill-registry" / "registry.json").write_text(
        json.dumps(
            {
                "version": 1,
                "kind": "skill-registry",
                "registryRevision": 12,
                "snapshotRevision": 8,
                "skills": [
                    {
                        "skillId": "writing-clear-docs",
                        "displayName": "Clear Docs",
                        "description": "Write clear developer documentation.",
                        "enabled": True,
                        "trusted": True,
                        "managedDirectoryName": "writing-clear-docs",
                        "entryPath": "SKILL.md",
                        "tags": ["documentation"],
                        "validation": {"status": "valid", "errors": [], "warnings": []},
                        "entrySummary": "Use when drafting concise technical documents.",
                        "resourceSummaries": resource_summaries,
                        "importedAt": "2026-04-24T00:00:00.000Z",
                        "updatedAt": "2026-04-24T00:00:00.000Z",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return state_dir, config_dir, runtime_root_dir


async def _collect_event_stream(stream) -> CollectedEventStreamResult:
    events: list[RuntimeExecutionEvent] = []
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


def _build_resolved_route(*, model_id: str = "gpt-4.1") -> ResolvedRuntimeModelRoute:
    return ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        endpoint_type="openai-compatible",
        base_url="https://example.com/v1",
        model_id=model_id,
        api_key="test-api-key",
        capability_hints={"vision": True},
    )

