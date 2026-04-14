from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import app.integrations.sustech.blackboard.facade.tools as blackboard_facade_tools
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
from app.tooling import HostEvent, ToolInvocationContext
from app.tooling.runtime_adapter.copilot_runtime import (
    RuntimeToolExecutionContext,
    runtime_tool_execution_scope,
)


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
        self.workspace_ensure_requests: list[tuple[str, str]] = []
        self.saved_artifacts: list[dict[str, Any]] = []
        self.state_values: dict[tuple[str, str], dict[str, Any]] = {}
        self.state_reads: list[tuple[str, str]] = []
        self.state_writes: list[tuple[str, str, dict[str, Any]]] = []
        self.state_deletes: list[tuple[str, str]] = []
        self.events: list[dict[str, Any]] = []

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

    async def aclose(self) -> None:
        return None


class _StubContractTool:
    metadata = None



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
        "artifact_store",
        "state_store",
        "secret_provider",
        "event_sink",
    )

    assert host.secret_provider is not None
    assert host.workspace_resolver is not None
    assert host.artifact_store is not None
    assert host.state_store is not None
    assert host.event_sink is not None

    secret_value = asyncio.run(host.secret_provider.get_secret(name="cas.password"))
    has_secret = asyncio.run(cast(Any, host.secret_provider).has_secret(name="cas.password"))
    workspace_path = host.workspace_resolver.resolve_workspace_path(
        relative_path="backend/data/calendar.db"
    )
    ensured_path = cast(Any, host.workspace_resolver).ensure_workspace_directory(
        relative_path="artifacts/reports"
    )
    artifact = asyncio.run(
        host.artifact_store.save_text(
            name="snapshot.json",
            text="{}",
            content_type="application/json",
            metadata={"toolId": invocation_context.tool_id},
        )
    )
    described_artifact = asyncio.run(
        cast(Any, host.artifact_store).describe_artifact(artifact_id="artifact-1")
    )
    asyncio.run(
        host.state_store.put(
            namespace="blackboard.snapshot_sync",
            key="latest",
            value={"ok": True},
        )
    )
    asyncio.run(
        host.state_store.put(
            namespace="run:progress",
            key="step-1",
            value={"done": False},
        )
    )
    tool_state = asyncio.run(
        host.state_store.get(
            namespace="blackboard.snapshot_sync",
            key="latest",
        )
    )
    run_state = asyncio.run(
        host.state_store.get(
            namespace="run:progress",
            key="step-1",
        )
    )
    asyncio.run(
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

    assert secret_value == "bridge-secret"
    assert has_secret is True
    assert workspace_path.as_posix() == "workspace-root/backend/data/calendar.db"
    assert ensured_path.as_posix() == "workspace-root/artifacts/reports"
    assert artifact.artifact_id == "artifact-1"
    assert described_artifact.metadata["described"] is True
    assert tool_state == {"ok": True}
    assert run_state == {"done": False}
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

    captured_search: dict[str, Any] = {}

    def fake_search(
        username: str,
        password: str,
        *,
        keyword: str,
        field: str,
        operator: str,
        limit: int | None,
    ) -> CourseCatalogSearchResult:
        captured_search.update(
            {
                "username": username,
                "password": password,
                "keyword": keyword,
                "field": field,
                "operator": operator,
                "limit": limit,
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

    monkeypatch.setattr(
        blackboard_facade_tools,
        "search_course_catalog_with_credentials",
        fake_search,
    )

    tool = dependencies.tool_registry.resolve_tool("blackboard.course_catalog.search")
    runtime_context = RuntimeToolExecutionContext(
        tool_call_id="blackboard.course_catalog.search:call-1",
        run_id="run-1",
        actor="agent",
        requested_at=datetime(2026, 4, 14, 3, 10, tzinfo=UTC),
        metadata={"requestId": "req-1"},
    )

    with runtime_tool_execution_scope(runtime_context):
        result = asyncio.run(
            tool.execute(
                {
                    "keyword": "数据库",
                    "usernameSecretName": "bb.username",
                    "passwordSecretName": "bb.password",
                }
            )
        )

    assert dependencies.host_capabilities_factory is factory
    assert captured_search == {
        "username": "alice",
        "password": "secret",
        "keyword": "数据库",
        "field": "CourseName",
        "operator": "Contains",
        "limit": None,
    }
    assert result["status"] == "success"
    assert result["metadata"] == {
        "toolId": "blackboard.course_catalog.search",
        "credentialSource": "host_secrets",
    }
    assert result["output"]["total"] == 1
    assert bridge_client.secret_requests == [
        (
            "blackboard.course_catalog.search:call-1",
            "blackboard.course_catalog.search",
            "run-1",
            "bb.username",
        ),
        (
            "blackboard.course_catalog.search:call-1",
            "blackboard.course_catalog.search",
            "run-1",
            "bb.password",
        ),
    ]
    assert [event["eventType"] for event in bridge_client.events] == [
        "blackboard.course_catalog.search.started",
        "blackboard.course_catalog.search.completed",
    ]
    assert all(
        event["invocationId"] == "blackboard.course_catalog.search:call-1"
        for event in bridge_client.events
    )
