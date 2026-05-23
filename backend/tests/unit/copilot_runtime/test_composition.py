from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable
from pathlib import Path
from typing import cast
from typing import TypeVar, cast

from pydantic_ai.models.test import TestModel

from app.copilot_runtime.agent import DEFAULT_AGENT_NAME, PydanticAIAgentExecutor
from app.copilot_runtime.composition import (
    RuntimeDependencies,
    build_default_runtime_dependencies,
)
from app.copilot_runtime.contracts import (
    THINKING_CAPABILITY_GET_METHOD,
    RuntimeMessageExecutionPolicy,
    RuntimeMessagePayload,
    RuntimeRunStartRequest,
    TOOL_APPROVAL_RESOLVE_METHOD,
    RuntimeToolApprovalResolveRequest,
    RuntimeToolPermissionPolicy,
    build_runtime_scaffold,
)
from app.copilot_runtime.mcp_catalog_provider import create_mcp_catalog_provider
from app.copilot_runtime.mcp_snapshot_provider import create_mcp_snapshot_provider
from app.copilot_runtime.mcp_snapshot_provider import MCP_CAPABILITY_SNAPSHOT_FILE_NAME
from app.copilot_runtime.skill_snapshot_provider import (
    SKILL_CAPABILITY_SNAPSHOT_FILE_NAME,
)
from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.copilot_runtime.tool_permissions import RuntimeToolPermissionResolver
from app.copilot_runtime.execution_event_graph import RuntimeExecutionEvent
from app.copilot_runtime.model_routes import (
    ResolvedRuntimeModelRoute,
    RuntimeModelRoute,
    RuntimeModelRouteRef,
)
from app.copilot_runtime.provider_adapter_registry import (
    build_default_provider_adapter_registry,
)
from app.tooling import ToolInvocationContext
from app.copilot_runtime.session_store import InMemorySessionStore
from app.copilot_runtime.tool_registry import (
    SKILL_ACTIVATE_TOOL_ID,
    SKILL_READ_RESOURCE_TOOL_ID,
    WEATHER_CURRENT_TOOL_ID,
    build_default_tool_registry,
)
from app.desktop_runtime.config import DesktopRuntimeConfig, DesktopRuntimePaths


TEST_MODEL_REPLY = "Hello from the composition test model."

_T = TypeVar("_T")


async def _await_value(awaitable: Awaitable[_T]) -> _T:
    return await awaitable


def _run_awaitable(awaitable: Awaitable[_T]) -> _T:
    return asyncio.run(_await_value(awaitable))


class _ImmediateEventStream:
    def __init__(
        self,
        *,
        output: str,
        resolved_model_id: str,
        events: list[RuntimeExecutionEvent],
    ) -> None:
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
        self.last_open_kwargs: dict[str, object] = {}

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
        skill_runtime_index: object | None = None,
        skill_system_prompt: str | None = None,
    ) -> _ImmediateEventStream:
        self.last_open_kwargs = {
            "agent_name": agent_name,
            "user_prompt": user_prompt,
            "message_history": message_history,
            "enabled_tools": enabled_tools,
            "debug_enabled": debug_enabled,
            "request_options": request_options,
            "model_settings": model_settings,
            "skill_runtime_index": skill_runtime_index,
            "skill_system_prompt": skill_system_prompt,
        }
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
    async def resolve(
        self, model_route: RuntimeModelRoute
    ) -> ResolvedRuntimeModelRoute:
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
    dependencies = build_default_runtime_dependencies(
        agent_executor=_build_test_agent_executor()
    )

    assert isinstance(dependencies, RuntimeDependencies)
    assert dependencies.session_store.storage_type == "in-memory"
    assert dependencies.agent_registry.get_default().name == DEFAULT_AGENT_NAME
    assert dependencies.tool_registry.get_default().name == "default"

    default_agent = dependencies.agent_registry.get_default()
    assert default_agent.toolset_name == dependencies.tool_registry.get_default().name
    executor_factory = default_agent.executor_factory
    assert executor_factory is not None
    assert executor_factory() is dependencies.agent_executor
    assert (
        dependencies.runtime_bridge._approval_coordinator
        is dependencies.agent_executor._approval_coordinator
    )

    assert dependencies.scaffold.default_agent == default_agent.name
    assert dependencies.scaffold.tool_registry is dependencies.tool_registry
    assert dependencies.scaffold.supported_methods == (
        "agents/list",
        "thread/create",
        "thread/get",
        "run/start",
        "run/stream",
        "run/cancel",
        "capabilities/get",
        "tools/catalog/get",
        THINKING_CAPABILITY_GET_METHOD,
        TOOL_APPROVAL_RESOLVE_METHOD,
    )
    global_tool_catalog = (
        dependencies.scaffold.build_global_tool_catalog_response().to_dict()
    )
    assert global_tool_catalog["ok"] is True
    assert global_tool_catalog["directoryVersion"] == "tools-v1"
    assert global_tool_catalog["defaultToolset"] == "default"
    assert isinstance(global_tool_catalog["tools"], list)
    assert len(global_tool_catalog["tools"]) >= 4
    assert [tool["toolId"] for tool in global_tool_catalog["tools"][:6]] == [
        "tool.fs.read",
        "tool.fs.write",
        "tool.fs.edit",
        "tool.fs.glob",
        "tool.fs.grep",
        "tool.fs.notebook_edit",
    ]
    assert global_tool_catalog["tools"][0]["kind"] == "builtin"
    assert global_tool_catalog["tools"][0]["availability"] == "available"
    assert global_tool_catalog["tools"][0]["displayNameZh"] == "文件读取"
    assert global_tool_catalog["tools"][0]["displayNameEn"] == "File Read"
    assert global_tool_catalog["tools"][0]["group"] == {
        "id": "builtin-core",
        "label": "内置基础工具",
        "labelZh": "内置基础工具",
        "labelEn": "Built-in Core Tools",
        "order": 0,
        "sourceKind": "builtin",
    }
    assert global_tool_catalog["tools"][1]["displayNameZh"] == "文件写入"
    assert global_tool_catalog["tools"][1]["group"] == {
        "id": "builtin-core",
        "label": "内置基础工具",
        "labelZh": "内置基础工具",
        "labelEn": "Built-in Core Tools",
        "order": 0,
        "sourceKind": "builtin",
    }
    assert global_tool_catalog["tools"][2]["displayNameZh"] == "文件编辑"
    assert global_tool_catalog["tools"][2]["group"] == {
        "id": "builtin-core",
        "label": "内置基础工具",
        "labelZh": "内置基础工具",
        "labelEn": "Built-in Core Tools",
        "order": 0,
        "sourceKind": "builtin",
    }
    assert global_tool_catalog["tools"][3]["displayNameZh"] == "文件发现"
    assert global_tool_catalog["tools"][3]["group"] == {
        "id": "builtin-core",
        "label": "内置基础工具",
        "labelZh": "内置基础工具",
        "labelEn": "Built-in Core Tools",
        "order": 0,
        "sourceKind": "builtin",
    }
    assert global_tool_catalog["tools"][4]["displayNameZh"] == "文件搜索"
    assert global_tool_catalog["tools"][4]["group"] == {
        "id": "builtin-core",
        "label": "内置基础工具",
        "labelZh": "内置基础工具",
        "labelEn": "Built-in Core Tools",
        "order": 0,
        "sourceKind": "builtin",
    }
    assert dependencies.scaffold.diagnostics_summary()["available_agents"] == [
        DEFAULT_AGENT_NAME
    ]
    assert dependencies.scaffold.diagnostics_summary()["available_toolsets"] == [
        "default"
    ]


def test_build_default_runtime_dependencies_streams_run_through_orchestrator() -> None:
    streaming_executor = cast(
        PydanticAIAgentExecutor,
        _StreamingExecutor(output=TEST_MODEL_REPLY),
    )
    dependencies = build_default_runtime_dependencies(
        agent_executor=streaming_executor,
        model_route_resolver=_ResolvedRouteResolver(),
    )
    dependencies.session_store.create_thread(
        bound_agent_id=DEFAULT_AGENT_NAME, thread_id="thread-1"
    )
    run = dependencies.runtime_bridge.start_run(
        request=_build_run_request(thread_id="thread-1")
    )

    events = asyncio.run(
        _collect_events(dependencies.runtime_bridge.stream_run(run_id=run.run_id))
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


def test_build_default_runtime_dependencies_reuses_explicit_store_and_executor() -> (
    None
):
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
    assert (
        dependencies.runtime_bridge._approval_coordinator
        is agent_executor._approval_coordinator
    )


def test_build_default_runtime_dependencies_resolves_waiting_tool_approval_against_shared_context() -> (
    None
):
    dependencies = build_default_runtime_dependencies(
        agent_executor=PydanticAIAgentExecutor(
            model=TestModel(
                call_tools=["weather_current"],
                custom_output_text=TEST_MODEL_REPLY,
                seed=0,
            )
        ),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    dependencies.session_store.create_thread(
        bound_agent_id=DEFAULT_AGENT_NAME, thread_id="thread-1"
    )
    run = dependencies.runtime_bridge.start_run(
        request=_build_run_request(
            thread_id="thread-1",
            enabled_tools=(WEATHER_CURRENT_TOOL_ID,),
            tool_permission_policy=RuntimeToolPermissionPolicy(
                schemaVersion=1, defaultMode="ask"
            ),
        )
    )
    resolution_payloads: list[dict[str, object]] = []

    async def collect_and_resolve():
        events = []
        async for event in dependencies.runtime_bridge.stream_run(run_id=run.run_id):
            events.append(event)
            if (
                event.type != "tool_event"
                or event.payload.get("phase") != "waiting_approval"
            ):
                continue
            resolution_payloads.append(
                dependencies.runtime_bridge.resolve_tool_approval(
                    request=RuntimeToolApprovalResolveRequest(
                        run_id=run.run_id,
                        tool_call_id=str(event.payload["toolCallId"]),
                        decision="approved",
                    )
                ).to_dict()
            )
        return events

    events = asyncio.run(collect_and_resolve())

    assert len(resolution_payloads) == 1
    assert resolution_payloads[0]["runId"] == run.run_id
    assert resolution_payloads[0]["decision"] == "approved"
    assert resolution_payloads[0]["status"] == "approved"
    assert any(
        event.type == "tool_event" and event.payload.get("phase") == "waiting_approval"
        for event in events
    )
    assert events[-1].type == "run_completed"
    assert events[-1].payload["assistantText"] == TEST_MODEL_REPLY


def test_build_default_runtime_dependencies_capabilities_use_bridge_policy_as_single_visibility_source() -> (
    None
):
    dependencies = build_default_runtime_dependencies(
        agent_executor=_build_test_agent_executor()
    )
    thread = dependencies.session_store.create_thread(
        bound_agent_id=DEFAULT_AGENT_NAME,
        thread_id="thread-capabilities-policy",
    )

    payload = dependencies.runtime_bridge.get_capabilities(
        session_id=thread.session_id,
        tool_permission_policy=RuntimeToolPermissionPolicy(
            schemaVersion=1,
            defaultMode="allow",
            toolModes={"tool.fs.read": "deny"},
        ),
    ).to_dict()

    tool_ids = [tool["toolId"] for tool in payload["tools"]]
    assert "tool.fs.read" not in tool_ids
    assert "tool.weather-current" in tool_ids
    assert payload["recommendedTools"] == []


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


def test_build_default_runtime_dependencies_uses_runtime_root_for_file_tools(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)

    dependencies = build_default_runtime_dependencies(runtime_config=runtime_config)
    deps = dependencies.agent_executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=lambda _event: None,
        run_id="run-runtime-root",
    )

    expected_workspace_root = runtime_config.runtime_root_dir.resolve(
        strict=False
    ).as_posix()
    assert dependencies.tool_registry.workspace_root == runtime_config.runtime_root_dir
    assert deps.workspace_root == expected_workspace_root
    assert deps.default_root == expected_workspace_root


def test_build_default_runtime_dependencies_passes_user_data_dir_to_agent_tools(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)

    dependencies = build_default_runtime_dependencies(runtime_config=runtime_config)
    deps = dependencies.agent_executor._build_runtime_deps(
        enabled_tools=("calendar.sql.query",),
        emit_tool_event=lambda _event: None,
        run_id="run-calendar-user-data",
    )

    assert deps.user_data_dir == runtime_config.user_data_dir.resolve(
        strict=False
    ).as_posix()


def test_build_default_runtime_dependencies_merges_mcp_snapshot_into_global_tool_catalog(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )
    bridge_client = _RecordingMcpBridgeClient()

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        host_capability_bridge_client=cast(
            DesktopCapabilityBridgeClient, bridge_client
        ),
    )
    response = dependencies.scaffold.build_global_tool_catalog_response(
        language="en-US"
    ).to_dict()

    tool_ids = [tool["toolId"] for tool in response["tools"]]
    assert "tool.fs.read" in tool_ids
    assert "mcp.mcp-stdio-stub.search-campus.00004d8d" in tool_ids
    mcp_entry = next(
        tool
        for tool in response["tools"]
        if tool["toolId"] == "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )
    assert mcp_entry["kind"] == "mcp"
    assert mcp_entry["availability"] == "available"
    assert mcp_entry["group"] == {
        "id": "mcp-search",
        "label": "Search",
        "labelZh": "Search",
        "labelEn": "Search",
        "order": 1000,
        "sourceKind": "mcp",
    }


def test_build_default_runtime_dependencies_hides_mcp_catalog_entries_without_bridge_client(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )

    dependencies = build_default_runtime_dependencies(runtime_config=runtime_config)
    response = dependencies.scaffold.build_global_tool_catalog_response(
        language="en-US"
    ).to_dict()

    tool_ids = [tool["toolId"] for tool in response["tools"]]
    assert "tool.fs.read" in tool_ids
    assert all(not tool_id.startswith("mcp.") for tool_id in tool_ids)


def test_build_default_runtime_dependencies_ignores_mcp_executor_when_snapshot_is_missing(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    bridge_client = _RecordingMcpBridgeClient()

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        host_capability_bridge_client=cast(
            DesktopCapabilityBridgeClient, bridge_client
        ),
    )

    tool_ids = [tool.tool_id for tool in dependencies.tool_registry.get_default().tools]
    catalog_tool_ids = [
        tool["toolId"]
        for tool in dependencies.scaffold.build_global_tool_catalog_response().to_dict()[
            "tools"
        ]
    ]
    assert "tool.fs.read" in tool_ids
    assert "tool.fs.read" in catalog_tool_ids
    assert all(not tool_id.startswith("mcp.") for tool_id in tool_ids)
    assert all(not tool_id.startswith("mcp.") for tool_id in catalog_tool_ids)
    assert bridge_client.calls == []


def test_build_default_runtime_dependencies_hides_mcp_catalog_entries_when_explicit_provider_lacks_execution_bridge(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        mcp_catalog_provider=create_mcp_catalog_provider(
            create_mcp_snapshot_provider(state_dir=runtime_config.state_dir)
        ),
    )

    catalog_tool_ids = [
        tool["toolId"]
        for tool in dependencies.scaffold.build_global_tool_catalog_response().to_dict()[
            "tools"
        ]
    ]

    assert "tool.fs.read" in catalog_tool_ids
    assert all(not tool_id.startswith("mcp.") for tool_id in catalog_tool_ids)


def test_build_runtime_scaffold_hides_non_executable_mcp_catalog_entries_from_manual_scaffold(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )

    scaffold = build_runtime_scaffold(
        tool_registry=build_default_tool_registry(
            workspace_root=runtime_config.runtime_root_dir
        ),
        mcp_catalog_provider=create_mcp_catalog_provider(
            create_mcp_snapshot_provider(state_dir=runtime_config.state_dir)
        ),
    )

    catalog_tool_ids = [
        tool["toolId"]
        for tool in scaffold.build_global_tool_catalog_response(
            language="en-US"
        ).to_dict()["tools"]
    ]

    assert "tool.fs.read" in catalog_tool_ids
    assert all(not tool_id.startswith("mcp.") for tool_id in catalog_tool_ids)


def test_build_runtime_scaffold_keeps_executable_mcp_catalog_entries_when_tool_registry_can_resolve_them(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )
    bridge_client = _RecordingMcpBridgeClient()
    snapshot_provider = create_mcp_snapshot_provider(state_dir=runtime_config.state_dir)

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        host_capability_bridge_client=cast(
            DesktopCapabilityBridgeClient, bridge_client
        ),
    )
    scaffold = build_runtime_scaffold(
        tool_registry=dependencies.tool_registry,
        mcp_catalog_provider=create_mcp_catalog_provider(snapshot_provider),
    )

    catalog_tool_ids = [
        tool["toolId"]
        for tool in scaffold.build_global_tool_catalog_response(
            language="en-US"
        ).to_dict()["tools"]
    ]

    assert "tool.fs.read" in catalog_tool_ids
    assert "mcp.mcp-stdio-stub.search-campus.00004d8d" in catalog_tool_ids


def test_build_default_runtime_dependencies_registers_executable_mcp_tools_with_bridge_client(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )
    bridge_client = _RecordingMcpBridgeClient()

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        host_capability_bridge_client=cast(
            DesktopCapabilityBridgeClient, bridge_client
        ),
    )
    tool = dependencies.tool_registry.resolve_tool(
        "mcp.mcp-stdio-stub.search-campus.00004d8d"
    )

    result = _run_awaitable(tool.execute({"keyword": "library"}))

    assert tool.descriptor.kind == "mcp"
    assert tool.function_name == "mcp_mcp_stdio_stub_search_campus_00004d8d"
    assert tool.parameters_json_schema == {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "keyword": {"type": "string"},
        },
        "required": ["keyword"],
    }
    assert result["status"] == "success"
    assert result["output"] == {
        "ok": True,
        "content": [{"type": "text", "text": "search completed"}],
        "structuredContent": {"count": 1},
    }
    assert result["metadata"] == {
        "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
        "sourceKind": "mcp",
        "serverId": "mcp-stdio-stub",
        "remoteToolName": "search-campus",
        "snapshotRevision": 8,
    }
    assert bridge_client.calls == [
        {
            "toolId": "mcp.mcp-stdio-stub.search-campus.00004d8d",
            "serverId": "mcp-stdio-stub",
            "remoteToolName": "search-campus",
            "arguments": {"keyword": "library"},
            "snapshotRevision": 8,
            "runId": None,
            "toolCallId": "mcp.mcp-stdio-stub.search-campus.00004d8d:direct",
        }
    ]


def test_default_runtime_dependencies_wires_skill_snapshot_provider_for_runs(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    _write_skill_runtime_fixture(runtime_config)
    executor = _StreamingExecutor(output="Skill-aware reply")

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        agent_executor=cast(PydanticAIAgentExecutor, executor),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    thread = dependencies.session_store.create_thread(
        bound_agent_id="default",
        thread_id="thread-skill",
    )

    events = _run_awaitable(
        _collect_events(
            dependencies.message_run_orchestrator.stream_events(
                request=_build_run_request(thread_id=thread.thread_id),
                run_id="run-skill-index",
            )
        )
    )

    assert executor.last_open_kwargs["skill_runtime_index"] is not None
    skill_system_prompt = cast(str, executor.last_open_kwargs["skill_system_prompt"])
    assert skill_system_prompt is not None
    assert "Available Skills" in skill_system_prompt
    assert "writing-clear-docs" in skill_system_prompt
    assert "Resources indexed: 1" in skill_system_prompt
    assert "Use this skill to write concise docs." not in skill_system_prompt
    assert "Prefer structure over verbosity." not in skill_system_prompt

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]


def test_default_runtime_dependencies_emits_skill_index_unavailable_without_snapshot(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    executor = _StreamingExecutor(output="Reply without skills")

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        agent_executor=cast(PydanticAIAgentExecutor, executor),
        model_route_resolver=_ResolvedRouteResolver(),
    )
    thread = dependencies.session_store.create_thread(
        bound_agent_id="default",
        thread_id="thread-skill-missing",
    )

    events = _run_awaitable(
        _collect_events(
            dependencies.message_run_orchestrator.stream_events(
                request=_build_run_request(thread_id=thread.thread_id),
                run_id="run-skill-index-missing",
            )
        )
    )

    assert executor.last_open_kwargs["skill_runtime_index"] is not None
    skill_system_prompt = cast(str, executor.last_open_kwargs["skill_system_prompt"])
    assert skill_system_prompt is not None
    assert "No enabled Skills" in skill_system_prompt

    assert [event.type for event in events] == [
        "run_started",
        "run_metadata",
        "text_delta",
        "run_completed",
    ]


def test_default_runtime_dependencies_streams_sanitized_skill_activity_events(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    _write_skill_runtime_fixture(runtime_config)

    class _SkillAwareStreamingModel(TestModel):
        def gen_tool_args(self, tool_def) -> object:
            if tool_def.name == "skill_activate":
                return {"skill_id": "writing-clear-docs"}
            if tool_def.name == "skill_read_resource":
                return {
                    "skill_id": "writing-clear-docs",
                    "path": "resources/checklist.md",
                }
            return super().gen_tool_args(tool_def)

    executor = PydanticAIAgentExecutor(
        model=_SkillAwareStreamingModel(
            call_tools=["skill_activate", "skill_read_resource"],
            custom_output_text="Skill-aware reply",
            seed=0,
        )
    )

    dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        agent_executor=executor,
        model_route_resolver=_ResolvedRouteResolver(),
    )
    thread = dependencies.session_store.create_thread(
        bound_agent_id="default",
        thread_id="thread-skill-events",
    )

    events = _run_awaitable(
        _collect_events(
            dependencies.message_run_orchestrator.stream_events(
                request=_build_run_request(thread_id=thread.thread_id),
                run_id="run-skill-events",
            )
        )
    )

    tool_events = [event for event in events if event.type == "tool_event"]
    completed_events = [
        event.payload for event in tool_events if event.payload["phase"] == "completed"
    ]

    assert not any(
        event.type == "run_diagnostic"
        and event.payload.get("code")
        in {"skill_index_loaded", "skill_index_unavailable"}
        for event in events
    )
    assert [payload["toolId"] for payload in completed_events] == [
        SKILL_ACTIVATE_TOOL_ID,
        SKILL_READ_RESOURCE_TOOL_ID,
    ]
    assert all(
        "Prefer structure" not in payload["summary"] for payload in completed_events
    )
    assert all(
        "Checklist item A" not in payload["summary"] for payload in completed_events
    )
    assert '"displayName": "Clear Docs"' in completed_events[0]["summary"]
    assert '"entryContentLength"' in completed_events[0]["summary"]
    assert '"displayName": "Clear Docs"' in completed_events[1]["summary"]
    assert '"contentLength"' in completed_events[1]["summary"]
    assert all(event.type != "skill_activity" for event in events)


def test_runtime_scaffold_filters_mcp_global_catalog_entries_with_permission_policy(
    tmp_path: Path,
) -> None:
    runtime_config = _build_runtime_config(tmp_path)
    runtime_config.state_dir.mkdir(parents=True, exist_ok=True)
    snapshot_payload = _load_mcp_snapshot_fixture()
    (runtime_config.state_dir / MCP_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )
    dependencies = build_default_runtime_dependencies(runtime_config=runtime_config)

    filtered_catalog = dependencies.scaffold.get_global_tool_catalog(
        tool_permission_resolver=RuntimeToolPermissionResolver(
            default_mode="allow",
            tool_modes={"mcp.mcp-stdio-stub.search-campus.00004d8d": "deny"},
        )
    )

    tool_ids = [tool.toolId for tool in filtered_catalog]
    assert "tool.fs.read" in tool_ids
    assert "mcp.mcp-stdio-stub.search-campus.00004d8d" not in tool_ids
    assert all(not tool_id.startswith("mcp.") for tool_id in tool_ids)


class _RecordingMcpBridgeClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    async def call_mcp_tool(
        self,
        *,
        context: ToolInvocationContext,
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
                "toolCallId": context.invocation_id,
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


async def _collect_events(events):
    return [event async for event in events]


def _build_test_agent_executor() -> PydanticAIAgentExecutor:
    return PydanticAIAgentExecutor(model=TestModel(custom_output_text=TEST_MODEL_REPLY))


def _build_run_request(
    *,
    thread_id: str,
    enabled_tools: tuple[str, ...] = (),
    tool_permission_policy: RuntimeToolPermissionPolicy | None = None,
) -> RuntimeRunStartRequest:
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
            enabledTools=enabled_tools,
            toolPermissionPolicy=tool_permission_policy
            or RuntimeToolPermissionPolicy(schemaVersion=1, defaultMode="allow"),
            requestOptions={},
        ),
        agent_id=DEFAULT_AGENT_NAME,
    )


def _write_skill_runtime_fixture(runtime_config: DesktopRuntimeConfig) -> None:
    state_dir = runtime_config.state_dir
    config_dir = runtime_config.config_dir
    runtime_root_dir = runtime_config.runtime_root_dir
    skill_root = runtime_root_dir / "skills" / "writing-clear-docs"
    resources_dir = skill_root / "resources"
    state_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "skill-registry").mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)
    (skill_root / "SKILL.md").write_text("# Clear Docs\n", encoding="utf-8")
    (resources_dir / "checklist.md").write_text(
        "- Keep it concise.\n", encoding="utf-8"
    )
    snapshot_payload = {
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
                "resourceSummaries": [{"path": "resources/checklist.md"}],
            }
        ],
    }
    registry_payload = {
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
                "resourceSummaries": snapshot_payload["skills"][0]["resourceSummaries"],
                "importedAt": "2026-04-24T00:00:00.000Z",
                "updatedAt": "2026-04-24T00:00:00.000Z",
            }
        ],
    }
    (state_dir / SKILL_CAPABILITY_SNAPSHOT_FILE_NAME).write_text(
        json.dumps(snapshot_payload),
        encoding="utf-8",
    )
    (config_dir / "skill-registry" / "registry.json").write_text(
        json.dumps(registry_payload),
        encoding="utf-8",
    )


def _load_mcp_snapshot_fixture() -> dict[str, object]:
    fixture_path = (
        Path(__file__).resolve().parents[4]
        / "frontend-copilot"
        / "electron"
        / "mcp-registry"
        / "test-fixtures"
        / "snapshot.sample.json"
    )
    return json.loads(fixture_path.read_text(encoding="utf-8"))


def _build_runtime_config(tmp_path: Path) -> DesktopRuntimeConfig:
    user_data_dir = tmp_path / "user-data"
    runtime_root_dir = user_data_dir / "desktop-runtime"
    config_dir = runtime_root_dir / "config"
    logs_dir = runtime_root_dir / "logs"
    database_dir = runtime_root_dir / "database"
    state_dir = runtime_root_dir / "state"
    user_data_dir.mkdir()
    runtime_root_dir.mkdir()
    return DesktopRuntimeConfig(
        host="127.0.0.1",
        port=8765,
        local_token=None,
        paths=DesktopRuntimePaths(
            user_data_dir=user_data_dir,
            runtime_root_dir=runtime_root_dir,
            config_dir=config_dir,
            logs_dir=logs_dir,
            database_dir=database_dir,
            state_dir=state_dir,
            debug_log_database_file=database_dir / "copilot-debug-log.db",
            copilot_settings_file=config_dir / "copilot-settings.json",
            host_log_file=logs_dir / "electron-host.log",
            backend_stdout_log_file=logs_dir / "backend.stdout.log",
            backend_stderr_log_file=logs_dir / "backend.stderr.log",
            runtime_snapshot_file=state_dir / "runtime-snapshot.json",
            last_failure_file=state_dir / "last-failure.json",
        ),
        app_mode="desktop",
        environment="development",
    )
