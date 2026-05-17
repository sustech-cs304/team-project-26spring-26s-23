from __future__ import annotations

import asyncio

from app.tooling import (
    HostArtifact,
    HostBrowserPage,
    HostBrowserScreenshot,
    HostBrowserSnapshot,
    ToolHostCapabilities,
    ToolInvocationContext,
)
from app.tooling.browser_tools import (
    BrowserOpenTool,
    BrowserScreenshotTool,
    BrowserSnapshotTool,
    get_browser_tool_contracts,
)


class _StubBrowserController:
    def __init__(self) -> None:
        self.open_calls: list[tuple[str, bool]] = []
        self.screenshot_calls: list[str | None] = []
        self.snapshot_calls: list[tuple[str | None, str | None]] = []

    async def open_page(self, *, url: str, show_window: bool = False) -> HostBrowserPage:
        self.open_calls.append((url, show_window))
        return HostBrowserPage(
            tab_id="main-window",
            current_url=url,
            title="Example Domain",
            window_visible=show_window,
        )

    async def capture_screenshot(
        self,
        *,
        name: str | None = None,
    ) -> HostBrowserScreenshot:
        self.screenshot_calls.append(name)
        page = HostBrowserPage(
            tab_id="main-window",
            current_url="https://example.com",
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

    async def capture_snapshot(
        self,
        *,
        tab_id: str | None = None,
        selector: str | None = None,
    ) -> HostBrowserSnapshot:
        self.snapshot_calls.append((tab_id, selector))
        page = HostBrowserPage(
            tab_id=tab_id or "main-window",
            current_url="https://example.com",
            title="Example Domain",
            window_visible=True,
        )
        return HostBrowserSnapshot(
            page=page,
            content=(
                "Text:\n"
                "Example Domain\n\n"
                "Interactive elements:\n"
                "[1] link \"More information\" (href=https://www.iana.org/domains/example)"
            ),
        )


def _run(awaitable):
    return asyncio.run(awaitable)


def test_browser_tool_contracts_expose_open_screenshot_and_snapshot() -> None:
    contracts = get_browser_tool_contracts()

    assert tuple(contract.metadata.tool_id for contract in contracts) == (
        "browser.open",
        "browser.screenshot",
        "browser.snapshot",
    )
    assert all(
        contract.metadata.capability_requirements[0].capability == "browser_controller"
        for contract in contracts
    )


def test_browser_open_tool_invokes_host_browser_controller() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = ToolInvocationContext(
        invocation_id="browser.open:call-1",
        tool_id="browser.open",
        run_id="run-1",
        actor="agent",
    )

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "https://example.com", "showWindow": True},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output == {
        "tabId": "main-window",
        "currentUrl": "https://example.com",
        "title": "Example Domain",
        "windowVisible": True,
    }
    assert controller.open_calls == [("https://example.com", True)]


def test_browser_screenshot_tool_returns_artifact_reference() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = ToolInvocationContext(
        invocation_id="browser.screenshot:call-1",
        tool_id="browser.screenshot",
        run_id="run-1",
        actor="agent",
    )

    result = _run(
        BrowserScreenshotTool().invoke(
            arguments={"name": "browser-capture"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output == {
        "tabId": "main-window",
        "currentUrl": "https://example.com",
        "title": "Example Domain",
        "windowVisible": True,
        "artifactId": "artifact-browser-screenshot",
        "uri": "artifact://desktop/browser-screenshot.png",
        "name": "browser-capture",
        "contentType": "image/png",
        "metadata": {"source": "browser.screenshot"},
    }
    assert [artifact.artifact_id for artifact in result.artifacts] == ["artifact-browser-screenshot"]
    assert controller.screenshot_calls == ["browser-capture"]



def test_browser_snapshot_tool_returns_page_snapshot() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = ToolInvocationContext(
        invocation_id="browser.snapshot:call-1",
        tool_id="browser.snapshot",
        run_id="run-1",
        actor="agent",
    )

    result = _run(
        BrowserSnapshotTool().invoke(
            arguments={"tabId": "browser-tab-2", "selector": "main article"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output == {
        "tabId": "browser-tab-2",
        "currentUrl": "https://example.com",
        "title": "Example Domain",
        "windowVisible": True,
        "content": (
            "Text:\n"
            "Example Domain\n\n"
            "Interactive elements:\n"
            "[1] link \"More information\" (href=https://www.iana.org/domains/example)"
        ),
    }
    assert controller.snapshot_calls == [("browser-tab-2", "main article")]
