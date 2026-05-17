from __future__ import annotations

import asyncio
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.tooling.contract import HostCapabilityRequirement
from app.tooling.host_capabilities import (
    HostArtifact,
    HostBrowserPage,
    HostBrowserScreenshot,
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

    def ensure_workspace_directory(self, *, relative_path: str) -> Path:
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
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact:
        _ = (text, content_type, metadata)
        return HostArtifact(artifact_id="artifact-text", name=name)

    async def save_bytes(
        self,
        *,
        name: str,
        content: bytes,
        content_type: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> HostArtifact:
        _ = (content, content_type, metadata)
        return HostArtifact(artifact_id="artifact-bytes", name=name)

    async def describe_artifact(self, *, artifact_id: str) -> HostArtifact:
        return HostArtifact(artifact_id=artifact_id, name="described-artifact")


class StubStateStore:
    def __init__(self) -> None:
        self.values: dict[tuple[str, str], dict[str, Any]] = {}

    async def get(self, *, namespace: str, key: str) -> dict[str, Any] | None:
        return self.values.get((namespace, key))

    async def put(self, *, namespace: str, key: str, value: Mapping[str, Any]) -> None:
        self.values[(namespace, key)] = dict(value)

    async def delete(self, *, namespace: str, key: str) -> None:
        self.values.pop((namespace, key), None)


class StubSecretProvider:
    async def get_secret(self, *, name: str) -> str | None:
        return f"secret:{name}"

    async def has_secret(self, *, name: str) -> bool:
        return bool(name)


class StubBrowserController:
    async def open_page(self, *, url: str, show_window: bool = False) -> Any:
        _ = (url, show_window)
        return object()

    async def capture_screenshot(self, *, name: str | None = None) -> Any:
        _ = name
        return object()

    async def list_tabs(self) -> list[Any]:
        return [object()]

    async def close_tab(self, *, tab_id: str | None = None) -> Any:
        _ = tab_id
        return object()

    async def switch_tab(self, *, tab_id: str) -> Any:
        _ = tab_id
        return object()

    async def execute_script(self, *, script: str, tab_id: str | None = None) -> dict[str, Any]:
        _ = (script, tab_id)
        return {"result": "ok"}

    async def reset(self) -> dict[str, Any]:
        return {"closedCount": 0}

    async def capture_snapshot(self, *, tab_id: str | None = None, selector: str | None = None) -> dict[str, Any]:
        _ = (tab_id, selector)
        return {"snapshot": "", "tabId": "tab-1", "elementCount": 0, "interactiveCount": 0}


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
    browser_page = HostBrowserPage(
        tab_id="browser-tab-1",
        current_url="https://example.com/",
        title="Example Domain",
        window_visible=False,
    )
    browser_screenshot = HostBrowserScreenshot(
        page=browser_page,
        artifact=HostArtifact(
            artifact_id="artifact-browser-screenshot",
            uri="artifact://desktop/browser-screenshot.png",
            name="browser-screenshot.png",
            content_type="image/png",
            metadata={"source": "browser.screenshot"},
        ),
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
    assert browser_screenshot.to_dict() == {
        "tabId": "browser-tab-1",
        "currentUrl": "https://example.com/",
        "title": "Example Domain",
        "windowVisible": False,
        "artifactId": "artifact-browser-screenshot",
        "uri": "artifact://desktop/browser-screenshot.png",
        "name": "browser-screenshot.png",
        "contentType": "image/png",
        "metadata": {"source": "browser.screenshot"},
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
        browser_controller=StubBrowserController(),
    )

    assert capabilities.available_capability_names() == (
        "workspace_resolver",
        "database_resolver",
        "artifact_store",
        "state_store",
        "secret_provider",
        "event_sink",
        "browser_controller",
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


def test_browser_controller_protocol_methods() -> None:
    """Verify all BrowserController protocol methods are callable through ToolHostCapabilities."""
    controller = StubBrowserController()
    capabilities = ToolHostCapabilities(browser_controller=controller)

    browser = capabilities.require_capability("browser_controller")

    loop = asyncio.new_event_loop()
    try:
        assert loop.run_until_complete(
            browser.open_page(url="https://example.com", show_window=True)
        ) is not None

        assert loop.run_until_complete(
            browser.capture_screenshot(name="test.png")
        ) is not None

        tabs = loop.run_until_complete(browser.list_tabs())
        assert len(tabs) == 1

        closed = loop.run_until_complete(browser.close_tab(tab_id="tab-1"))
        assert closed is not None

        switched = loop.run_until_complete(browser.switch_tab(tab_id="tab-2"))
        assert switched is not None

        exec_result = loop.run_until_complete(
            browser.execute_script(script="document.title", tab_id="tab-1")
        )
        assert exec_result["result"] == "ok"

        reset_result = loop.run_until_complete(browser.reset())
        assert reset_result["closedCount"] == 0

        snap_result = loop.run_until_complete(
            browser.capture_snapshot(tab_id="tab-1", selector=".main")
        )
        assert snap_result["tabId"] == "tab-1"
        assert snap_result["elementCount"] == 0
    finally:
        loop.close()
