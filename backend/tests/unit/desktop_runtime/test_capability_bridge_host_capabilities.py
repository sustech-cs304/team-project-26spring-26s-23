from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Mapping
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any, TypeVar, cast

import app.integrations.sustech.blackboard.facade.tools as blackboard_facade_tools
from app.desktop_runtime.routes import blackboard_ui
from pydantic_ai.models.test import TestModel

from app.integrations.sustech.blackboard.api.dto import CourseCatalogResultDTO
from app.integrations.sustech.blackboard.provider.results import CourseCatalogSearchResult
from app.copilot_runtime import PydanticAIAgentExecutor
from app.copilot_runtime.composition import build_default_runtime_dependencies
from app.desktop_runtime.capability_bridge_host_capabilities import (
    build_desktop_bridge_host_capabilities_factory,
)
from app.desktop_runtime.capability_bridge_protocol import (
    DesktopCapabilityArtifactDescriptor,
)
from app.tooling.contract.metadata import ToolMetadata
from app.tooling.contract.results import ToolResultEnvelope
from app.tooling import (
    HostArtifact,
    HostBrowserPage,
    HostBrowserScreenshot,
    HostEvent,
    ToolInvocationContext,
)
from app.tooling.runtime_adapter.copilot_runtime import (
    RuntimeToolExecutionContext,
    runtime_tool_execution_scope,
)

_T = TypeVar("_T")


async def _await_value(awaitable: Awaitable[_T]) -> _T:
    return await awaitable


def _run_awaitable(awaitable: Awaitable[_T]) -> _T:
    return asyncio.run(_await_value(awaitable))


class _RecordingBridgeClient:
    def __init__(self) -> None:
        self.secrets = {
            "bb.username": "alice",
            "bb.password": "secret",
            "cas.password": "bridge-secret",
        }
        self.secret_requests: list[tuple[str, str, str | None, str]] = []
        self.secret_presence_requests: list[tuple[str, str]] = []
        self.workspace_resolve_requests: list[tuple[str, str | None]] = []
        self.database_resolve_requests: list[tuple[str, str | None]] = []
        self.workspace_ensure_requests: list[tuple[str, str]] = []
        self.saved_artifacts: list[dict[str, Any]] = []
        self.state_values: dict[tuple[str, str], dict[str, Any]] = {}
        self.state_reads: list[tuple[str, str]] = []
        self.state_writes: list[tuple[str, str, dict[str, Any]]] = []
        self.state_deletes: list[tuple[str, str]] = []
        self.events: list[dict[str, Any]] = []
        self.browser_open_requests: list[tuple[str, str, bool, bool, str | None, str | None]] = []
        self.browser_screenshot_requests: list[tuple[str, str, str | None]] = []
        self.browser_cookie_requests: list[tuple[str, str | None, str | None]] = []

    async def get_secret(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
    ) -> str | None:
        self.secret_requests.append(
            (context.invocation_id, context.tool_id, context.run_id, name)
        )
        return self.secrets.get(name)

    async def has_secret(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
    ) -> bool:
        self.secret_presence_requests.append((context.invocation_id, name))
        return name in self.secrets

    def resolve_workspace_path(
        self,
        *,
        context: ToolInvocationContext,
        relative_path: str | None = None,
    ) -> Path:
        self.workspace_resolve_requests.append((context.invocation_id, relative_path))
        root = Path("workspace-root")
        return root if relative_path is None else root / relative_path

    def resolve_database_path(
        self,
        *,
        context: ToolInvocationContext,
        relative_path: str | None = None,
    ) -> Path:
        self.database_resolve_requests.append((context.invocation_id, relative_path))
        root = Path("database-root")
        return root if relative_path is None else root / relative_path

    def ensure_workspace_directory(
        self,
        *,
        context: ToolInvocationContext,
        relative_path: str,
    ) -> Path:
        self.workspace_ensure_requests.append((context.invocation_id, relative_path))
        return Path("workspace-root") / relative_path

    async def save_text(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DesktopCapabilityArtifactDescriptor:
        self.saved_artifacts.append(
            {
                "invocationId": context.invocation_id,
                "name": name,
                "text": text,
                "contentType": content_type,
                "metadata": {} if metadata is None else dict(metadata),
            }
        )
        return DesktopCapabilityArtifactDescriptor(
            artifact_id="artifact-1",
            uri="artifact://desktop/artifact-1",
            name=name,
            content_type=content_type,
            metadata={} if metadata is None else dict(metadata),
        )

    async def save_bytes(
        self,
        *,
        context: ToolInvocationContext,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> DesktopCapabilityArtifactDescriptor:
        self.saved_artifacts.append(
            {
                "invocationId": context.invocation_id,
                "name": name,
                "content": content,
                "contentType": content_type,
                "metadata": {} if metadata is None else dict(metadata),
            }
        )
        return DesktopCapabilityArtifactDescriptor(
            artifact_id="artifact-2",
            uri="artifact://desktop/artifact-2",
            name=name,
            content_type=content_type,
            metadata={} if metadata is None else dict(metadata),
        )

    async def describe_artifact(
        self,
        *,
        context: ToolInvocationContext,
        artifact_id: str,
    ) -> DesktopCapabilityArtifactDescriptor:
        return DesktopCapabilityArtifactDescriptor(
            artifact_id=artifact_id,
            uri="artifact://desktop/described",
            name="described.json",
            content_type="application/json",
            metadata={"described": True, "invocationId": context.invocation_id},
        )

    async def get_state_value(
        self,
        *,
        context: ToolInvocationContext,
        scope: str,
        key: str,
    ) -> dict[str, Any] | None:
        _ = context
        self.state_reads.append((scope, key))
        return self.state_values.get((scope, key))

    async def put_state_value(
        self,
        *,
        context: ToolInvocationContext,
        scope: str,
        key: str,
        value: dict[str, Any],
    ) -> None:
        _ = context
        normalized_value = dict(value)
        self.state_writes.append((scope, key, normalized_value))
        self.state_values[(scope, key)] = normalized_value

    async def delete_state_value(
        self,
        *,
        context: ToolInvocationContext,
        scope: str,
        key: str,
    ) -> None:
        _ = context
        self.state_deletes.append((scope, key))
        self.state_values.pop((scope, key), None)

    def emit_event(
        self,
        *,
        context: ToolInvocationContext,
        event_type: str,
        message: str | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        self.events.append(
            {
                "invocationId": context.invocation_id,
                "toolId": context.tool_id,
                "runId": context.run_id,
                "eventType": event_type,
                "message": message,
                "data": {} if data is None else dict(data),
            }
        )

    async def open_browser_page(
        self,
        *,
        context: ToolInvocationContext,
        url: str,
        show_window: bool = False,
        new_tab: bool = False,
        selector: str | None = None,
        format: str | None = None,
    ) -> HostBrowserPage:
        self.browser_open_requests.append((context.invocation_id, url, show_window, new_tab, selector, format))
        return HostBrowserPage(
            tab_id="main-window",
            current_url=url,
            title="Example Domain",
            window_visible=show_window,
        )

    async def capture_browser_screenshot(
        self,
        *,
        context: ToolInvocationContext,
        name: str | None = None,
    ) -> HostBrowserScreenshot:
        self.browser_screenshot_requests.append((context.invocation_id, context.tool_id, name))
        page = HostBrowserPage(
            tab_id="main-window",
            current_url="https://example.com/",
            title="Example Domain",
            window_visible=True,
        )
        artifact = HostArtifact(
            artifact_id="artifact-browser-screenshot",
            uri="artifact://desktop/browser-screenshot.png",
            name=name or "browser-screenshot.png",
            content_type="image/png",
            metadata={"source": "browser.screenshot"},
        )
        return HostBrowserScreenshot(page=page, artifact=artifact)

    async def get_browser_cookies(
        self,
        *,
        context: ToolInvocationContext,
        tab_id: str | None = None,
        url: str | None = None,
    ) -> list[dict[str, Any]]:
        self.browser_cookie_requests.append((context.invocation_id, tab_id, url))
        return [
            {
                "name": "JSESSIONID",
                "value": "session-value",
                "domain": ".bb.sustech.edu.cn",
                "path": "/",
                "httpOnly": True,
            }
        ]

    async def aclose(self) -> None:
        return None


class _StubContractTool:
    metadata = ToolMetadata(tool_id="blackboard.snapshot.sync")

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: Any,
    ) -> ToolResultEnvelope:
        _ = (arguments, context, host)
        raise NotImplementedError



def test_bridge_host_capabilities_factory_assembles_invocation_scoped_handles() -> None:
    bridge_client = _RecordingBridgeClient()
    factory = build_desktop_bridge_host_capabilities_factory(
        bridge_client=cast(Any, bridge_client),
    )
    invocation_context = ToolInvocationContext(
        invocation_id="blackboard.snapshot.sync:call-1",
        tool_id="blackboard.snapshot.sync",
        run_id="run-1",
        actor="agent",
        requested_at=datetime(2026, 4, 14, 3, 0, tzinfo=UTC),
    )
    runtime_context = RuntimeToolExecutionContext(
        tool_call_id=invocation_context.invocation_id,
        run_id="run-1",
        actor="agent",
        requested_at=datetime(2026, 4, 14, 3, 0, tzinfo=UTC),
    )

    host = factory(_StubContractTool(), invocation_context, runtime_context)

    assert host.available_capability_names() == (
        "workspace_resolver",
        "database_resolver",
        "artifact_store",
        "state_store",
        "secret_provider",
        "event_sink",
        "browser_controller",
    )

    assert host.secret_provider is not None
    assert host.workspace_resolver is not None
    assert host.database_resolver is not None
    assert host.artifact_store is not None
    assert host.state_store is not None
    assert host.event_sink is not None
    assert host.browser_controller is not None

    secret_value = _run_awaitable(host.secret_provider.get_secret(name="cas.password"))
    has_secret = _run_awaitable(cast(Any, host.secret_provider).has_secret(name="cas.password"))
    workspace_path = host.workspace_resolver.resolve_workspace_path(
        relative_path="backend/data/calendar.db"
    )
    database_path = cast(Any, host.database_resolver).resolve_database_path(
        relative_path="blackboard/calendar.db"
    )
    ensured_path = cast(Any, host.workspace_resolver).ensure_workspace_directory(
        relative_path="artifacts/reports"
    )
    artifact = _run_awaitable(
        host.artifact_store.save_text(
            name="snapshot.json",
            text="{}",
            content_type="application/json",
            metadata={"toolId": invocation_context.tool_id},
        )
    )
    described_artifact = _run_awaitable(
        cast(Any, host.artifact_store).describe_artifact(artifact_id="artifact-1")
    )
    _run_awaitable(
        host.state_store.put(
            namespace="blackboard.snapshot_sync",
            key="latest",
            value={"ok": True},
        )
    )
    _run_awaitable(
        host.state_store.put(
            namespace="run:progress",
            key="step-1",
            value={"done": False},
        )
    )
    tool_state = _run_awaitable(
        host.state_store.get(
            namespace="blackboard.snapshot_sync",
            key="latest",
        )
    )
    run_state = _run_awaitable(
        host.state_store.get(
            namespace="run:progress",
            key="step-1",
        )
    )
    _run_awaitable(
        host.state_store.delete(
            namespace="blackboard.snapshot_sync",
            key="latest",
        )
    )
    host.event_sink.emit(
        HostEvent(
            event_type="blackboard.snapshot.sync.completed",
            message="completed",
            invocation_id=invocation_context.invocation_id,
            data={"artifactCount": 1},
        )
    )
    browser_cookies = _run_awaitable(
        host.browser_controller.get_cookies(
            tab_id="manual-login-tab",
            url="https://bb.sustech.edu.cn/",
        )
    )

    assert secret_value == "bridge-secret"
    assert has_secret is True
    assert workspace_path.as_posix() == "workspace-root/backend/data/calendar.db"
    assert database_path.as_posix() == "database-root/blackboard/calendar.db"
    assert ensured_path.as_posix() == "workspace-root/artifacts/reports"
    assert artifact.artifact_id == "artifact-1"
    assert described_artifact.metadata["described"] is True
    assert tool_state == {"ok": True}
    assert run_state == {"done": False}
    assert browser_cookies == [
        {
            "name": "JSESSIONID",
            "value": "session-value",
            "domain": ".bb.sustech.edu.cn",
            "path": "/",
            "httpOnly": True,
        }
    ]
    assert bridge_client.browser_cookie_requests == [
        (
            invocation_context.invocation_id,
            "manual-login-tab",
            "https://bb.sustech.edu.cn/",
        )
    ]
    assert bridge_client.secret_requests == [
        (
            invocation_context.invocation_id,
            invocation_context.tool_id,
            invocation_context.run_id,
            "cas.password",
        )
    ]
    assert bridge_client.secret_presence_requests == [
        (invocation_context.invocation_id, "cas.password")
    ]
    assert bridge_client.workspace_resolve_requests == [
        (invocation_context.invocation_id, "backend/data/calendar.db")
    ]
    assert bridge_client.database_resolve_requests == [
        (invocation_context.invocation_id, "blackboard/calendar.db")
    ]
    assert bridge_client.workspace_ensure_requests == [
        (invocation_context.invocation_id, "artifacts/reports")
    ]
    assert bridge_client.state_writes == [
        (
            "tool",
            "blackboard.snapshot.sync:blackboard.snapshot_sync:latest",
            {"ok": True},
        ),
        (
            "run",
            "blackboard.snapshot.sync:progress:step-1",
            {"done": False},
        ),
    ]
    assert bridge_client.state_reads == [
        ("tool", "blackboard.snapshot.sync:blackboard.snapshot_sync:latest"),
        ("run", "blackboard.snapshot.sync:progress:step-1"),
    ]
    assert bridge_client.state_deletes == [
        ("tool", "blackboard.snapshot.sync:blackboard.snapshot_sync:latest")
    ]
    assert bridge_client.events == [
        {
            "invocationId": invocation_context.invocation_id,
            "toolId": invocation_context.tool_id,
            "runId": invocation_context.run_id,
            "eventType": "blackboard.snapshot.sync.completed",
            "message": "completed",
            "data": {"artifactCount": 1},
        }
    ]



def test_build_default_runtime_dependencies_executes_contract_tool_with_bridge_backed_capabilities(
    monkeypatch,
) -> None:
    bridge_client = _RecordingBridgeClient()
    factory = build_desktop_bridge_host_capabilities_factory(
        bridge_client=cast(Any, bridge_client),
    )
    dependencies = build_default_runtime_dependencies(
        agent_executor=PydanticAIAgentExecutor(
            model=TestModel(custom_output_text="unused")
        ),
        host_capabilities_factory=factory,
    )

    captured: dict[str, Any] = {}

    from pathlib import Path
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

    monkeypatch.setattr(
        blackboard_ui,
        "run_blackboard_snapshot_sync",
        fake_sync,
    )

    tool = dependencies.tool_registry.resolve_tool("blackboard.snapshot.sync")
    runtime_context = RuntimeToolExecutionContext(
        tool_call_id="blackboard.snapshot.sync:call-1",
        run_id="run-1",
        actor="agent",
        requested_at=datetime(2026, 4, 14, 3, 10, tzinfo=UTC),
        metadata={"requestId": "req-1"},
    )

    with runtime_tool_execution_scope(runtime_context):
        result = _run_awaitable(
            tool.execute(
                {
                    "usernameSecretName": "bb.username",
                    "passwordSecretName": "bb.password",
                }
            )
        )

    assert dependencies.host_capabilities_factory is factory
    assert result["status"] == "success"
    assert result["metadata"]["toolId"] == "blackboard.snapshot.sync"
    assert result["metadata"]["credentialSource"] == "host_secrets"
    assert bridge_client.secret_requests == [
        (
            "blackboard.snapshot.sync:call-1",
            "blackboard.snapshot.sync",
            "run-1",
            "bb.username",
        ),
        (
            "blackboard.snapshot.sync:call-1",
            "blackboard.snapshot.sync",
            "run-1",
            "bb.password",
        ),
    ]
    assert [event["eventType"] for event in bridge_client.events] == [
        "blackboard.snapshot.sync.started",
        "blackboard.snapshot.sync.completed",
    ]
    assert all(
        event["invocationId"] == "blackboard.snapshot.sync:call-1"
        for event in bridge_client.events
    )
