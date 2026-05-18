from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, TypedDict, cast

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
from app.copilot_runtime.tool_approval_coordinator import (
    RuntimeToolApprovalCoordinator,
    ToolApprovalNotFoundError,
)
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver
from app.copilot_runtime.model_routes import ResolvedRuntimeModelRoute
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



def test_default_agent_system_prompt_prefers_structured_forms_and_blocks_uploads_and_secrets() -> None:
    executor = PydanticAIAgentExecutor()

    prompt = executor._compose_system_prompt(None)

    assert prompt == DEFAULT_AGENT_SYSTEM_PROMPT
    assert "prefer the request_user_form tool" in prompt
    assert "including for a single well-defined field" in prompt
    assert "wait for the user's next message to continue" in prompt
    assert "Do not use forms to request file uploads" in prompt
    assert "secrets, passwords, or tokens" in prompt



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

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
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

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
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

    monkeypatch.setattr(
        executor,
        "_build_runtime_agent",
        lambda *, enabled_tools, resolved_model, skill_system_prompt=None: executor._agent,
    )
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


def test_runtime_tool_lifecycle_event_to_payload_includes_form_request_when_present() -> None:
    payload = RuntimeToolLifecycleEvent(
        tool_call_id="tool.request-user-form:call-1",
        tool_id=REQUEST_USER_FORM_TOOL_ID,
        phase="completed",
        title="请求课程表单",
        summary="请填写课程编码。",
        form_request={
            "formId": "course-form",
            "title": "请求课程表单",
            "fields": [{
                "name": "courseCode",
                "label": "课程编码",
                "type": "text",
            }],
        },
    ).to_payload()

    assert payload["formRequest"] == {
        "formId": "course-form",
        "title": "请求课程表单",
        "fields": [{
            "name": "courseCode",
            "label": "课程编码",
            "type": "text",
        }],
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



def test_execute_bound_tool_returns_tool_not_found_failure_without_raising() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = _build_tool_run_context(
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
    ctx = _build_tool_run_context(
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



def test_execute_bound_tool_allow_mode_skips_waiting_approval() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    ctx = _build_tool_run_context(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-allow",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-allow",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
            approval_coordinator=approval_coordinator,
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

    assert result["location"] == "Shenzhen"
    assert [event.phase for event in emitted_tool_events] == ["started", "completed"]
    assert approval_coordinator.snapshot() == ()



def test_execute_bound_tool_ask_mode_waits_for_manual_approval_then_executes() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    ctx = _build_tool_run_context(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-approved",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-approved",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="ask"),
            approval_coordinator=approval_coordinator,
            debug_enabled=False,
        ),
    )

    async def run_and_resolve() -> dict[str, Any]:
        task = asyncio.create_task(
            executor._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments={"location": "Shenzhen"},
            )
        )
        await asyncio.sleep(0)
        phases_before_resolution = [event.phase for event in emitted_tool_events]
        pending_request = approval_coordinator.get_request(
            run_id="run-weather-approved",
            tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-approved",
        )
        assert pending_request is not None
        approval_coordinator.resolve(
            run_id="run-weather-approved",
            tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-approved",
            decision="approved",
        )
        result = await task
        return {
            "result": result,
            "phases_before_resolution": phases_before_resolution,
        }

    outcome = asyncio.run(run_and_resolve())

    assert outcome["result"]["location"] == "Shenzhen"
    assert outcome["phases_before_resolution"] == ["started", "waiting_approval"]
    assert [event.phase for event in emitted_tool_events] == ["started", "waiting_approval", "completed"]
    waiting_event = emitted_tool_events[1]
    approval = _require_payload_mapping(waiting_event.approval)
    assert approval == {
        "mode": "ask",
        "timeoutSeconds": None,
        "timeoutAction": None,
    }
    assert "timeoutAt" not in approval
    assert approval_coordinator.snapshot() == ()



def test_execute_bound_tool_ask_mode_returns_failure_when_rejected() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    ctx = _build_tool_run_context(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-rejected",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-rejected",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="ask"),
            approval_coordinator=approval_coordinator,
            debug_enabled=False,
        ),
    )

    async def run_and_reject() -> dict[str, Any]:
        task = asyncio.create_task(
            executor._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments={"location": "Shenzhen"},
            )
        )
        await asyncio.sleep(0)
        phases_before_resolution = [event.phase for event in emitted_tool_events]
        approval_coordinator.resolve(
            run_id="run-weather-rejected",
            tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-rejected",
            decision="rejected",
        )
        result = await task
        return {
            "result": result,
            "phases_before_resolution": phases_before_resolution,
        }

    outcome = asyncio.run(run_and_reject())

    assert outcome["phases_before_resolution"] == ["started", "waiting_approval"]
    assert outcome["result"] == {
        "status": "error",
        "error": {
            "code": "tool_approval_rejected",
            "message": "Tool call was rejected by the user.",
            "retryable": False,
            "details": {
                "decision": "rejected",
                "source": "manual",
                "mode": "ask",
            },
        },
        "artifacts": [],
        "metadata": {
            "toolId": WEATHER_CURRENT_TOOL_ID,
            "toolCallId": f"{WEATHER_CURRENT_TOOL_ID}:call-rejected",
        },
    }
    assert [event.phase for event in emitted_tool_events] == ["started", "waiting_approval", "failed"]
    assert emitted_tool_events[-1].error_summary == "Tool call was rejected by the user."
    assert approval_coordinator.snapshot() == ()



def test_execute_bound_tool_delay_mode_auto_approves_after_timeout() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    ctx = _build_tool_run_context(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-delay-approve",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-delay-approve",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(
                default_mode="delay",
                tool_timeout_seconds={WEATHER_CURRENT_TOOL_ID: 1},
                tool_timeout_actions={WEATHER_CURRENT_TOOL_ID: "approve"},
            ),
            approval_coordinator=approval_coordinator,
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        asyncio.wait_for(
            executor._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments={"location": "Shenzhen"},
            ),
            timeout=1.5,
        )
    )

    assert result["location"] == "Shenzhen"
    assert [event.phase for event in emitted_tool_events] == ["started", "waiting_approval", "completed"]
    waiting_event = emitted_tool_events[1]
    approval = _require_payload_mapping(waiting_event.approval)
    timeout_at = approval.get("timeoutAt")
    assert isinstance(timeout_at, str)
    assert approval == {
        "mode": "delay",
        "timeoutAt": timeout_at,
        "timeoutSeconds": 1,
        "timeoutAction": "approve",
    }
    assert timeout_at
    assert approval_coordinator.snapshot() == ()



def test_execute_bound_tool_delay_mode_auto_rejects_after_timeout_without_crashing_run() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    ctx = _build_tool_run_context(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-delay-deny",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-delay-deny",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(
                default_mode="delay",
                tool_timeout_seconds={WEATHER_CURRENT_TOOL_ID: 1},
                tool_timeout_actions={WEATHER_CURRENT_TOOL_ID: "deny"},
            ),
            approval_coordinator=approval_coordinator,
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        asyncio.wait_for(
            executor._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments={"location": "Shenzhen"},
            ),
            timeout=1.5,
        )
    )

    assert result == {
        "status": "error",
        "error": {
            "code": "tool_approval_rejected",
            "message": "Tool approval timed out and was automatically rejected.",
            "retryable": False,
            "details": {
                "decision": "rejected",
                "source": "timeout",
                "mode": "delay",
            },
        },
        "artifacts": [],
        "metadata": {
            "toolId": WEATHER_CURRENT_TOOL_ID,
            "toolCallId": f"{WEATHER_CURRENT_TOOL_ID}:call-delay-deny",
        },
    }
    assert [event.phase for event in emitted_tool_events] == ["started", "waiting_approval", "failed"]
    assert emitted_tool_events[-1].error_summary == "Tool approval timed out and was automatically rejected."
    assert approval_coordinator.snapshot() == ()



def test_execute_bound_tool_delay_mode_manual_resolution_wins_before_timeout() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    ctx = _build_tool_run_context(
        tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-delay-manual",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-weather-delay-manual",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(
                default_mode="delay",
                tool_timeout_seconds={WEATHER_CURRENT_TOOL_ID: 30},
                tool_timeout_actions={WEATHER_CURRENT_TOOL_ID: "deny"},
            ),
            approval_coordinator=approval_coordinator,
            debug_enabled=False,
        ),
    )

    async def run_and_resolve() -> dict[str, Any]:
        task = asyncio.create_task(
            executor._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments={"location": "Shenzhen"},
            )
        )
        await asyncio.sleep(0)
        pending_request = approval_coordinator.get_request(
            run_id="run-weather-delay-manual",
            tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-delay-manual",
        )
        assert pending_request is not None
        approval_coordinator.resolve(
            run_id="run-weather-delay-manual",
            tool_call_id=f"{WEATHER_CURRENT_TOOL_ID}:call-delay-manual",
            decision="approved",
        )
        result = await task
        return {
            "result": result,
            "pending_request": pending_request,
        }

    outcome = asyncio.run(run_and_resolve())

    assert outcome["result"]["location"] == "Shenzhen"
    assert outcome["pending_request"].timeout_seconds == 30
    assert outcome["pending_request"].timeout_action == "deny"
    assert [event.phase for event in emitted_tool_events] == ["started", "waiting_approval", "completed"]
    assert approval_coordinator.snapshot() == ()



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
            fetch_mode=fetch_mode,
            max_pages=max_pages,
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
    ctx = _build_tool_run_context(
        tool_call_id="blackboard.course_catalog.search:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.course_catalog.search"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
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
    assert result["status"] == "success"
    assert result["output"]["fetchMode"] == "full"
    assert result["output"]["maxPages"] == 30
    assert result["metadata"]["toolId"] == "blackboard.course_catalog.search"
    assert [event.phase for event in emitted_tool_events] == ["started", "completed"]
    assert all(event.tool_id == "blackboard.course_catalog.search" for event in emitted_tool_events)
    assert emitted_tool_events[-1].result_summary is not None



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
    ctx = _build_tool_run_context(
        tool_call_id="blackboard.course_catalog.search:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.course_catalog.search"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
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
    ctx = _build_tool_run_context(
        tool_call_id="blackboard.course_catalog.search:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.course_catalog.search"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
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


def test_execute_bound_tool_raises_awaiting_user_input_for_inline_form_tool() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    workspace_root = str(Path.cwd().resolve(strict=False).as_posix())
    ctx = _build_tool_run_context(
        tool_call_id=f"{REQUEST_USER_FORM_TOOL_ID}:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({REQUEST_USER_FORM_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-inline-form",
            workspace_root=workspace_root,
            default_root=workspace_root,
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
            approval_coordinator=RuntimeToolApprovalCoordinator(),
            debug_enabled=False,
        ),
    )

    with pytest.raises(AwaitingUserInputError) as captured:
        asyncio.run(
            executor._execute_bound_tool(
                ctx,
                tool_id=REQUEST_USER_FORM_TOOL_ID,
                arguments={
                    "form_id": "course-form",
                    "title": "请求课程表单",
                    "description": "请填写课程编码。",
                    "fields": [{
                        "name": "courseCode",
                        "label": "课程编码",
                        "type": "text",
                        "required": True,
                    }],
                },
            )
        )

    assert captured.value.code == "awaiting_user_input"
    assert captured.value.details["toolId"] == REQUEST_USER_FORM_TOOL_ID
    assert captured.value.details["toolCallId"] == f"{REQUEST_USER_FORM_TOOL_ID}:call-1"
    assert [event.phase for event in emitted_tool_events] == ["started", "completed"]
    assert emitted_tool_events[-1].summary == "请填写课程编码。"
    assert emitted_tool_events[-1].form_request == {
        "formId": "course-form",
        "title": "请求课程表单",
        "description": "请填写课程编码。",
        "fields": [{
            "name": "courseCode",
            "label": "课程编码",
            "type": "text",
            "required": True,
        }],
    }



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

    ctx = _build_tool_run_context(
        tool_call_id="contract.invalid:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"contract.invalid"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-integrity",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
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



def test_build_contract_agent_tools_limits_registered_tools_to_enabled_set() -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    filtered_tools = executor._build_contract_agent_tools(enabled_tools=("tool.fs.glob",))
    filtered_tool_names = tuple(tool.name for tool in filtered_tools)

    assert filtered_tool_names == ("tool_fs_glob",)



def test_execute_bound_tool_file_tool_no_longer_requires_model_route_summary() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = _build_tool_run_context(
        tool_call_id="tool.fs.glob:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"tool.fs.glob"}),
            emit_tool_event=emitted_tool_events.append,
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            run_id="run-file-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="tool.fs.glob",
            arguments={"basePath": ".", "pattern": "*.py"},
        )
    )

    assert result["status"] == "success"
    assert result["output"]["ok"] is True
    assert [event.phase for event in emitted_tool_events] == ["started", "completed"]



def test_build_runtime_deps_initializes_file_roots_to_workspace_root() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)

    deps = executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=lambda _event: None,
        run_id="run-init",
    )

    expected_workspace_root = Path.cwd().resolve(strict=False).as_posix()
    assert deps.workspace_root == expected_workspace_root
    assert deps.default_root == expected_workspace_root



def test_executor_inherits_default_workspace_root_from_tool_registry(tmp_path: Path) -> None:
    workspace_root = tmp_path / "runtime-workspace"
    registry = build_default_tool_registry(workspace_root=workspace_root)
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)

    deps = executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=lambda _event: None,
        run_id="run-tool-registry-root",
    )

    expected_workspace_root = workspace_root.resolve(strict=False).as_posix()
    assert deps.workspace_root == expected_workspace_root
    assert deps.default_root == expected_workspace_root



def test_execute_bound_tool_persists_switched_default_root_within_same_run(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    switched_root = tmp_path / "switched-root"
    workspace_root.mkdir()
    switched_root.mkdir()
    (switched_root / "sample.txt").write_text("alpha\n", encoding="utf-8")

    registry = build_default_tool_registry(workspace_root=workspace_root)
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    deps = SimpleNamespace(
        tool_registry=registry,
        enabled_tool_ids=frozenset({"tool.fs.switch_root", "tool.fs.glob", "tool.fs.read"}),
        emit_tool_event=emitted_tool_events.append,
        workspace_root=workspace_root.resolve(strict=False).as_posix(),
        default_root=workspace_root.resolve(strict=False).as_posix(),
        run_id="run-switch-root",
        tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
        debug_enabled=False,
    )

    switch_result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(tool_call_id=f"{FILE_TOOL_SWITCH_ROOT_ID}:call-1", deps=deps),
            tool_id=FILE_TOOL_SWITCH_ROOT_ID,
            arguments={"path": str(switched_root)},
        )
    )
    glob_result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(tool_call_id="tool.fs.glob:call-2", deps=deps),
            tool_id="tool.fs.glob",
            arguments={"basePath": ".", "pattern": "*.txt"},
        )
    )
    read_result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(tool_call_id="tool.fs.read:call-3", deps=deps),
            tool_id="tool.fs.read",
            arguments={"path": "sample.txt"},
        )
    )
    absolute_result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(tool_call_id="tool.fs.read:call-4", deps=deps),
            tool_id="tool.fs.read",
            arguments={"path": str(workspace_root / "missing.txt")},
        )
    )

    assert switch_result["status"] == "success"
    assert deps.default_root == switched_root.resolve(strict=False).as_posix()
    assert glob_result["status"] == "success"
    assert glob_result["output"]["data"]["matches"][0]["path"] == "sample.txt"
    assert glob_result["output"]["data"]["matches"][0]["effectiveRoot"] == switched_root.resolve(strict=False).as_posix()
    assert read_result["status"] == "success"
    assert read_result["output"]["data"]["effectiveRoot"] == switched_root.resolve(strict=False).as_posix()
    assert absolute_result["status"] == "error"
    assert absolute_result["output"]["error"]["code"] == "file_not_found"



def test_build_runtime_deps_does_not_inherit_switched_root_between_runs(tmp_path: Path) -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)

    first_run_deps = executor._build_runtime_deps(
        enabled_tools=("tool.fs.switch_root",),
        emit_tool_event=lambda _event: None,
        run_id="run-1",
    )
    second_run_deps = executor._build_runtime_deps(
        enabled_tools=("tool.fs.switch_root",),
        emit_tool_event=lambda _event: None,
        run_id="run-2",
    )

    first_run_deps.default_root = (tmp_path / "other-root").resolve(strict=False).as_posix()

    expected_workspace_root = Path.cwd().resolve(strict=False).as_posix()
    assert second_run_deps.default_root == second_run_deps.workspace_root
    assert second_run_deps.workspace_root == expected_workspace_root



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


def test_execute_bound_tool_cancellation_discards_pending_approval_request() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    approval_coordinator = RuntimeToolApprovalCoordinator()
    tool_call_id = f"{WEATHER_CURRENT_TOOL_ID}:call-cancelled"
    ctx = _build_tool_run_context(
        tool_call_id=tool_call_id,
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({WEATHER_CURRENT_TOOL_ID}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-approval-cancelled",
            workspace_root=str(Path.cwd().resolve(strict=False).as_posix()),
            default_root=str(Path.cwd().resolve(strict=False).as_posix()),
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="ask"),
            approval_coordinator=approval_coordinator,
            debug_enabled=False,
        ),
    )

    async def run_and_cancel() -> None:
        task = asyncio.create_task(
            executor._execute_bound_tool(
                ctx,
                tool_id=WEATHER_CURRENT_TOOL_ID,
                arguments={"location": "Shenzhen"},
            )
        )
        await asyncio.sleep(0)
        pending_request = approval_coordinator.get_request(
            run_id="run-approval-cancelled",
            tool_call_id=tool_call_id,
        )
        assert pending_request is not None
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run_and_cancel())

    assert approval_coordinator.snapshot() == ()
    with pytest.raises(ToolApprovalNotFoundError, match="No pending approval exists"):
        approval_coordinator.resolve(
            run_id="run-approval-cancelled",
            tool_call_id=tool_call_id,
            decision="approved",
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
    )
