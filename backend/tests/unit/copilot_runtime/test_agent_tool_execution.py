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
from app.tooling.host_capabilities.interfaces import ToolHostCapabilities


def _create_noop_host_capabilities() -> ToolHostCapabilities:
    """Create a host capabilities instance with all capabilities as no-ops."""
    from unittest.mock import MagicMock
    noop = MagicMock()
    noop.resolve_path.return_value = "/mock"
    noop.save.return_value = "mock-artifact-id"
    noop.get.return_value = "mock-value"
    return ToolHostCapabilities(
        workspace_resolver=noop,
        database_resolver=noop,
        artifact_store=noop,
        state_store=noop,
        secret_provider=noop,
        event_sink=noop,
        browser_controller=noop,
    )


def _make_noop_host_capabilities_factory() -> Any:
    """Create a host capabilities factory for build_default_tool_registry."""
    return lambda _contract, _invoke_ctx, _runtime_ctx: _create_noop_host_capabilities()


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
    from pathlib import Path
    captured: dict[str, object] = {}

    def fake_sync(
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        captured.update({"args": args, "kwargs": kwargs})
        return SimpleNamespace(
            db_path=Path("mock/path.db"),
            log_summary={"total": 1},
            logs=[],
            integrity_ok=True,
            first_sync_stats={},
            second_sync_stats=None,
            table_counts={},
            expected_active_counts={},
            snapshot=SimpleNamespace(scraped_counts=lambda: {}, logs=[]),
            payloads=SimpleNamespace(),
            second_sync_has_no_new_records=lambda: False,
            second_sync_has_no_deleted_records=lambda: False,
        )

    monkeypatch.setattr(blackboard_facade_tools, "run_blackboard_snapshot_sync", fake_sync)

    registry = build_default_tool_registry(host_capabilities_factory=_make_noop_host_capabilities_factory())
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = _build_tool_run_context(
        tool_call_id="blackboard.snapshot.sync:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.snapshot.sync"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
            debug_enabled=False,
            host_capabilities_factory=_make_noop_host_capabilities_factory(),
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="blackboard.snapshot.sync",
            arguments={
                "username": "alice",
                "password": "secret",
            },
        )
    )

    assert result["status"] == "success"
    assert result["metadata"]["toolId"] == "blackboard.snapshot.sync"
    assert [event.phase for event in emitted_tool_events] == ["started", "completed"]
    assert all(event.tool_id == "blackboard.snapshot.sync" for event in emitted_tool_events)
    assert emitted_tool_events[-1].result_summary is not None



def test_execute_bound_tool_returns_recoverable_contract_failure_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_sync(
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        _ = (args, kwargs)
        raise ValueError("maxConcurrency must be a positive integer.")

    monkeypatch.setattr(blackboard_facade_tools, "run_blackboard_snapshot_sync", fake_sync)

    registry = build_default_tool_registry(host_capabilities_factory=_make_noop_host_capabilities_factory())
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = _build_tool_run_context(
        tool_call_id="blackboard.snapshot.sync:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.snapshot.sync"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="blackboard.snapshot.sync",
            arguments={
                "username": "alice",
                "password": "secret",
            },
        )
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_input"
    assert result["error"]["message"] == "maxConcurrency must be a positive integer."
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert emitted_tool_events[-1].tool_id == "blackboard.snapshot.sync"
    assert emitted_tool_events[-1].error_summary == "maxConcurrency must be a positive integer."



def test_execute_bound_tool_returns_contract_execution_failure_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_sync(
        *args: Any,
        **kwargs: Any,
    ) -> Any:
        _ = (args, kwargs)
        raise RuntimeError("blackboard sync exploded")

    monkeypatch.setattr(blackboard_facade_tools, "run_blackboard_snapshot_sync", fake_sync)

    registry = build_default_tool_registry(host_capabilities_factory=_make_noop_host_capabilities_factory())
    executor = PydanticAIAgentExecutor(model="test-model", tool_registry=registry)
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    ctx = _build_tool_run_context(
        tool_call_id="blackboard.snapshot.sync:call-1",
        deps=SimpleNamespace(
            tool_registry=registry,
            enabled_tool_ids=frozenset({"blackboard.snapshot.sync"}),
            emit_tool_event=emitted_tool_events.append,
            run_id="run-contract-tool",
            tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
            debug_enabled=False,
        ),
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            ctx,
            tool_id="blackboard.snapshot.sync",
            arguments={
                "username": "alice",
                "password": "secret",
            },
        )
    )

    assert result["status"] == "error"
    assert result["error"]["code"] == "execution_failed"
    assert result["error"]["message"] == "blackboard sync exploded"
    assert result["metadata"]["toolId"] == "blackboard.snapshot.sync"
    assert result["error"]["details"]["exceptionType"] == "RuntimeError"
    assert "Traceback (most recent call last):" in result["error"]["details"]["traceback"]
    assert result["error"]["details"]["diagnosticContext"]["integration"] == "blackboard"
    assert result["error"]["details"]["diagnosticContext"]["toolId"] == "blackboard.snapshot.sync"
    assert [event.phase for event in emitted_tool_events] == ["started", "failed"]
    assert emitted_tool_events[-1].error_summary == "blackboard sync exploded"


def test_execute_bound_tool_raises_awaiting_user_input_for_inline_form_tool() -> None:
    registry = build_default_tool_registry(host_capabilities_factory=_make_noop_host_capabilities_factory())
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



def test_execute_bound_tool_read_image_requires_vision_context(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "pixel.png").write_bytes(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk2QAAAAASUVORK5CYII="
        )
    )
    registry = build_default_tool_registry(workspace_root=workspace_root)
    executor = PydanticAIAgentExecutor(
        model="test-model",
        tool_registry=registry,
        workspace_root=workspace_root,
        default_root=workspace_root,
    )
    emitted_tool_events: list[RuntimeToolLifecycleEvent] = []
    deps_without_vision = executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=emitted_tool_events.append,
        tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
        run_id="run-read-no-vision",
    )

    no_vision_result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(
                tool_call_id="tool.fs.read:call-1",
                deps=deps_without_vision,
            ),
            tool_id="tool.fs.read",
            arguments={"path": "pixel.png"},
        )
    )

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
        capability_hints={"vision": True},
    )
    deps_with_vision = executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=emitted_tool_events.append,
        tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
        resolved_model_route=resolved_model_route,
        run_id="run-read-with-vision",
    )

    vision_result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(
                tool_call_id="tool.fs.read:call-2",
                deps=deps_with_vision,
            ),
            tool_id="tool.fs.read",
            arguments={"path": "pixel.png"},
        )
    )

    assert no_vision_result["status"] == "error"
    assert no_vision_result["error"]["code"] == "execution_failed"
    assert no_vision_result["output"]["error"]["code"] == "vision_required"
    assert no_vision_result["output"]["error"]["details"]["visionEnabled"] is False
    assert vision_result["status"] == "success"
    assert vision_result["output"]["data"]["kind"] == "image"



@pytest.mark.parametrize(
    ("resolved_route_capability_hints", "expected_status", "expected_vision_enabled"),
    [
        (None, "error", False),
        ({"vision": True, "tools": True}, "success", True),
    ],
)
def test_execute_bound_tool_read_image_traces_vision_from_host_bridge_payload(
    tmp_path: Path,
    resolved_route_capability_hints: dict[str, bool] | None,
    expected_status: str,
    expected_vision_enabled: bool,
) -> None:
    provider_profile_id = "provider-openrouter"
    provider_id = "openrouter"
    model_id = "qwen-vl-max"
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    (workspace_root / "pixel.png").write_bytes(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk2QAAAAASUVORK5CYII="
        )
    )
    registry = build_default_tool_registry(workspace_root=workspace_root)
    executor = PydanticAIAgentExecutor(
        model="test-model",
        tool_registry=registry,
        workspace_root=workspace_root,
        default_root=workspace_root,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        resolved_route: dict[str, Any] = {
            "routeRef": {
                "routeKind": "provider-model",
                "profileId": provider_profile_id,
                "modelId": model_id,
            },
            "providerProfileId": provider_profile_id,
            "provider": provider_id,
            "providerId": provider_id,
            "adapterId": provider_id,
            "runtimeStatus": "enabled",
            "catalogRevision": "2026-04-06-provider-catalog-v1",
            "endpointFamily": "openai",
            "endpointType": "openai-compatible",
            "baseUrl": "https://api.example.com/v1",
            "modelId": model_id,
            "authKind": "api-key",
        }
        if resolved_route_capability_hints is not None:
            resolved_route["capabilityHints"] = dict(resolved_route_capability_hints)
        return httpx.Response(
            200,
            json={
                "ok": True,
                "resolvedRoute": resolved_route,
                "privateAuth": {
                    "authKind": "api-key",
                    "authPayload": {"apiKey": "resolved-secret"},
                    "apiKey": "resolved-secret",
                },
            },
            request=request,
        )

    resolved_model_route = asyncio.run(
        HostModelRouteBridgeClient(
            bridge_url="http://127.0.0.1:45678/host/private/provider-routes/resolve",
            bridge_token="bridge-token-123",
            transport=httpx.MockTransport(handler),
        ).resolve(
            RuntimeModelRoute(
                provider_profile_id=provider_profile_id,
                route_ref=RuntimeModelRouteRef(
                    route_kind="provider-model",
                    profile_id=provider_profile_id,
                    model_id=model_id,
                ),
                catalog_revision="2026-04-06-provider-catalog-v1",
            )
        )
    )

    assert resolved_model_route.capability_hints == (
        {} if resolved_route_capability_hints is None else resolved_route_capability_hints
    )

    deps = executor._build_runtime_deps(
        enabled_tools=("tool.fs.read",),
        emit_tool_event=lambda _event: None,
        tool_permission_resolver=RuntimeToolPermissionResolver(default_mode="allow"),
        resolved_model_route=resolved_model_route,
        run_id="run-host-bridge-vision",
    )
    execution_context = executor._build_bound_tool_execution_context(
        _build_tool_run_context(tool_call_id="tool.fs.read:call-bridge", deps=deps),
        tool_id="tool.fs.read",
        tool_call_id="tool.fs.read:call-bridge",
        display_name="Read File",
        enabled_tool_ids=("tool.fs.read",),
    )
    execution_route = execution_context.metadata["resolvedModelRoute"]

    assert ("capabilityHints" in execution_route) is (
        resolved_route_capability_hints is not None
    )

    result = asyncio.run(
        executor._execute_bound_tool(
            _build_tool_run_context(
                tool_call_id="tool.fs.read:call-bridge",
                deps=deps,
            ),
            tool_id="tool.fs.read",
            arguments={"path": "pixel.png"},
        )
    )

    assert result["status"] == expected_status
    if expected_status == "success":
        assert execution_route["capabilityHints"] == resolved_route_capability_hints
        assert result["output"]["data"]["kind"] == "image"
    else:
        assert execution_route.get("capabilityHints") is None
        assert result["error"]["code"] == "execution_failed"
        assert result["output"]["error"]["code"] == "vision_required"
        assert result["output"]["error"]["details"]["visionEnabled"] is expected_vision_enabled



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
        capability_hints={"vision": True},
    )

