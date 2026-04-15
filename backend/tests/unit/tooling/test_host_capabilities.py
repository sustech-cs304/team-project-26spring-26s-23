from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.tooling.contract import HostCapabilityRequirement
from app.tooling.host_capabilities import (
    HostArtifact,
    HostEvent,
    MissingHostCapabilityError,
    ToolHostCapabilities,
)


class StubWorkspaceResolver:
    def __init__(self, root: Path) -> None:
        self.root = root

    def resolve_workspace_path(self, *, relative_path: str | None = None) -> Path:
        if relative_path is None:
            return self.root
        return self.root / relative_path


class StubDatabaseResolver:
    def __init__(self, root: Path) -> None:
        self.root = root

    def resolve_database_path(self, *, relative_path: str | None = None) -> Path:
        if relative_path is None:
            return self.root
        return self.root / relative_path


class StubArtifactStore:
    async def save_text(
        self,
        *,
        name: str,
        text: str,
        content_type: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> HostArtifact:
        _ = (text, content_type, metadata)
        return HostArtifact(artifact_id="artifact-text", name=name)

    async def save_bytes(
        self,
        *,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: dict[str, object] | None = None,
    ) -> HostArtifact:
        _ = (content, content_type, metadata)
        return HostArtifact(artifact_id="artifact-bytes", name=name)


class StubStateStore:
    def __init__(self) -> None:
        self.values: dict[tuple[str, str], dict[str, object]] = {}

    async def get(self, *, namespace: str, key: str) -> dict[str, object] | None:
        return self.values.get((namespace, key))

    async def put(self, *, namespace: str, key: str, value: dict[str, object]) -> None:
        self.values[(namespace, key)] = dict(value)

    async def delete(self, *, namespace: str, key: str) -> None:
        self.values.pop((namespace, key), None)


class StubSecretProvider:
    async def get_secret(self, *, name: str) -> str | None:
        return f"secret:{name}"


class StubEventSink:
    def __init__(self) -> None:
        self.events: list[HostEvent] = []

    def emit(self, event: HostEvent) -> None:
        self.events.append(event)



def test_host_capability_models_serialize_to_stable_shape() -> None:
    occurred_at = datetime(2026, 4, 13, 12, 0, tzinfo=UTC)
    artifact = HostArtifact(
        artifact_id="artifact-1",
        uri="artifact://workspace/report.txt",
        name="report.txt",
        content_type="text/plain",
        metadata={"size": 12},
    )
    event = HostEvent(
        event_type="tool.progress",
        message="Tool reported progress.",
        invocation_id="invoke-1",
        occurred_at=occurred_at,
        data={"progress": 50},
    )

    assert artifact.to_dict() == {
        "artifactId": "artifact-1",
        "uri": "artifact://workspace/report.txt",
        "name": "report.txt",
        "contentType": "text/plain",
        "metadata": {"size": 12},
    }
    assert event.to_dict() == {
        "eventType": "tool.progress",
        "message": "Tool reported progress.",
        "invocationId": "invoke-1",
        "occurredAt": occurred_at.isoformat(),
        "data": {"progress": 50},
    }

    with pytest.raises(ValueError, match="timezone-aware"):
        HostEvent(event_type="tool.progress", occurred_at=datetime(2026, 4, 13, 12, 0))



def test_tool_host_capabilities_reports_available_handles_and_satisfies_requirements() -> None:
    capabilities = ToolHostCapabilities(
        workspace_resolver=StubWorkspaceResolver(Path("workspace")),
        database_resolver=StubDatabaseResolver(Path("database")),
        artifact_store=StubArtifactStore(),
        state_store=StubStateStore(),
        secret_provider=StubSecretProvider(),
        event_sink=StubEventSink(),
    )

    assert capabilities.available_capability_names() == (
        "workspace_resolver",
        "database_resolver",
        "artifact_store",
        "state_store",
        "secret_provider",
        "event_sink",
    )
    assert capabilities.require_capability("workspace_resolver") is capabilities.workspace_resolver
    assert capabilities.require_capability("database_resolver") is capabilities.database_resolver
    capabilities.assert_satisfies(
        (
            HostCapabilityRequirement(capability="workspace_resolver"),
            HostCapabilityRequirement(capability="database_resolver"),
            HostCapabilityRequirement(capability="event_sink"),
            HostCapabilityRequirement(capability="secret_provider", required=False),
        )
    )



def test_tool_host_capabilities_raise_for_missing_required_binding() -> None:
    capabilities = ToolHostCapabilities(event_sink=StubEventSink())

    with pytest.raises(MissingHostCapabilityError, match="workspace_resolver"):
        capabilities.require_capability("workspace_resolver")

    with pytest.raises(MissingHostCapabilityError, match="database_resolver"):
        capabilities.require_capability("database_resolver")

    with pytest.raises(MissingHostCapabilityError, match="artifact_store"):
        capabilities.assert_satisfies(
            (HostCapabilityRequirement(capability="artifact_store"),)
        )

    with pytest.raises(ValueError, match="Unknown host capability"):
        capabilities.require_capability("unknown_capability")
