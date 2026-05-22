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

    assert DEFAULT_AGENT_SYSTEM_PROMPT in prompt
    assert "prefer the request_user_form tool" in prompt
    assert "including for a single well-defined field" in prompt
    assert "wait for the user's next message to continue" in prompt
    assert "Do not use forms to request file uploads" in prompt
    assert "secrets, passwords, or tokens" in prompt


def test_system_prompt_includes_tool_selection_guides() -> None:
    executor = PydanticAIAgentExecutor()

    prompt = executor._compose_system_prompt(None)

    assert "Tool Selection Guide" in prompt
    assert "File Operation Tool Selection" in prompt
    assert "Blackboard Data Tools" in prompt
    assert "TIS" in prompt
    assert "General Rules" in prompt


def test_system_prompt_includes_shared_conventions() -> None:
    executor = PydanticAIAgentExecutor()

    prompt = executor._compose_system_prompt(None)

    assert "Read before modify" in prompt
    assert "Shell command avoidance" in prompt
    assert "Parallel execution" in prompt
    assert "Sync-first" in prompt
    assert "Credentials" in prompt


def test_system_prompt_includes_parallel_execution_guidance() -> None:
    executor = PydanticAIAgentExecutor()

    prompt = executor._compose_system_prompt(None)

    assert "parallel tool calls" in prompt.lower()
    assert "independent" in prompt.lower()
    assert "three tool.fs.read calls in ONE message" in prompt
    assert "tool.fs.glob + tool.fs.grep in ONE message" in prompt


def test_system_prompt_injects_current_month_year() -> None:
    executor = PydanticAIAgentExecutor()

    prompt = executor._compose_system_prompt(None)

    assert "年" in prompt
    assert "月" in prompt


def test_system_prompt_with_skill_appends_after_guides() -> None:
    executor = PydanticAIAgentExecutor()
    skill_prompt = "## Available Skills\n- test-skill: does things"

    prompt = executor._compose_system_prompt(skill_prompt)

    assert "Tool Selection Guide" in prompt
    assert "Shared File Operation Conventions" in prompt
    assert "Available Skills" in prompt
    assert "test-skill" in prompt
    # Guides must come before skill prompt
    tool_guide_pos = prompt.index("Tool Selection Guide")
    skill_pos = prompt.index("Available Skills")
    assert tool_guide_pos < skill_pos



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



def test_build_contract_agent_tools_limits_registered_tools_to_enabled_set() -> None:
    executor = PydanticAIAgentExecutor(model="test-model")

    filtered_tools = executor._build_contract_agent_tools(enabled_tools=("tool.fs.glob",))
    filtered_tool_names = tuple(tool.name for tool in filtered_tools)

    assert filtered_tool_names == ("tool_fs_glob",)


def test_contract_agent_tool_descriptions_use_structured_prompts_not_short_constants() -> None:
    """Regression: _build_contract_agent_tools MUST use ToolPrompt.render()
    (get_tool_description) so that detailed usage_guide, parameter_guide, and
    constraints reach the LLM, not just the 70-character registry constants."""
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)

    built = executor._build_contract_agent_tools(
        enabled_tools=("tool.fs.read", "tool.fs.edit", "tool.fs.glob", "tool.fs.grep",
                       "tool.fs.notebook_edit", "tool.fs.switch_root")
    )
    tools_by_name = {tool.name: tool for tool in built}

    # Every file tool MUST carry a structured prompt longer than a one-liner
    for tool_name, tool_id, min_sections in [
        ("tool_fs_read", "tool.fs.read", ("Usage", "Parameters", "Constraints")),
        ("tool_fs_edit", "tool.fs.edit", ("Usage", "Parameters", "Constraints")),
        ("tool_fs_glob", "tool.fs.glob", ("Usage", "Parameters", "Constraints")),
        ("tool_fs_grep", "tool.fs.grep", ("Usage", "Parameters", "Constraints")),
        ("tool_fs_notebook_edit", "tool.fs.notebook_edit", ("Usage", "Parameters", "Constraints")),
        ("tool_fs_switch_root", "tool.fs.switch_root", ("Usage", "Parameters", "Constraints")),
    ]:
        desc = tools_by_name[tool_name].description or ""
        assert len(desc) > 300, (
            f"{tool_id} description too short ({len(desc)} chars) — "
            f"structured prompt not flowing"
        )
        for section in min_sections:
            assert section in desc, (
                f"{tool_id} missing section {section!r}"
            )


def test_contract_agent_tool_falls_back_to_descriptor_for_unprompted_tools() -> None:
    """Tools without a prompt registry entry still get their descriptor.description."""
    executor = PydanticAIAgentExecutor(model="test-model")
    # weather tool, request-user-form, skill-activate, skill-read-resource
    # are NOT in the prompt registry — they must fallback gracefully.
    built = executor._build_contract_agent_tools(
        enabled_tools=(
            "tool.request-user-form",
            "tool.skill-activate",
            "tool.skill-read-resource",
        )
    )
    tools_by_name = {tool.name: tool for tool in built}
    for tool_name, expected_min_len in [
        ("request_user_form", 100),
        ("skill_activate", 50),
        ("skill_read_resource", 50),
    ]:
        desc = tools_by_name[tool_name].description or ""
        assert len(desc) >= expected_min_len, (
            f"{tool_name} description too short: {len(desc)}"
        )


def test_contract_agent_tool_descriptions_vary_across_tools() -> None:
    """Sanity check: every tool gets its OWN structured prompt, not a shared copy."""
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    built = executor._build_contract_agent_tools(
        enabled_tools=("tool.fs.read", "tool.fs.edit", "tool.fs.glob", "tool.fs.grep")
    )
    descriptions = {tool.name: tool.description for tool in built if tool.description}
    # Each tool should have distinct content
    unique_prefixes = {desc[:80] for desc in descriptions.values()}
    assert len(unique_prefixes) == len(descriptions), (
        f"Expected {len(descriptions)} distinct descriptions, "
        f"got {len(unique_prefixes)} unique prefixes"
    )


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



def test_build_bound_tool_execution_context_preserves_model_route_capability_hints() -> None:
    registry = build_default_tool_registry()
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    resolved_model_route = ResolvedRuntimeModelRoute(
        provider_profile_id="provider-1",
        provider="openai",
        provider_id="openai",
        adapter_id="openai",
        runtime_status="enabled",
        catalog_revision="2026-04-06-provider-catalog-v1",
        endpoint_family="openai",
        endpoint_type="openai-compatible",
        base_url="https://api.example.com/v1",
        model_id="gpt-4.1",
        auth_kind="api-key",
        api_key="resolved-secret",
        capability_hints={"vision": True, "tools": True},
    )
    deps = executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=lambda _event: None,
        tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
        resolved_model_route=resolved_model_route,
        run_id="run-vision-context",
    )

    execution_context = executor._build_bound_tool_execution_context(
        _build_tool_run_context(tool_call_id="tool.fs.read:call-1", deps=deps),
        tool_id="tool.fs.read",
        tool_call_id="tool.fs.read:call-1",
        display_name="Read File",
        enabled_tool_ids=("tool.fs.read",),
    )

    assert execution_context.metadata["resolvedModelRoute"] == {
        "routeRef": {
            "routeKind": "provider-model",
            "profileId": "provider-1",
            "modelId": "gpt-4.1",
        },
        "providerProfileId": "provider-1",
        "provider": "openai",
        "providerId": "openai",
        "adapterId": "openai",
        "runtimeStatus": "enabled",
        "catalogRevision": "2026-04-06-provider-catalog-v1",
        "endpointFamily": "openai",
        "endpointType": "openai-compatible",
        "baseUrl": "https://api.example.com/v1",
        "modelId": "gpt-4.1",
        "authKind": "api-key",
        "capabilityHints": {"vision": True, "tools": True},
    }



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

