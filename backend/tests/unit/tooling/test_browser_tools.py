from __future__ import annotations

import asyncio
from typing import Any

from app.tooling import (
    HostArtifact,
    HostBrowserPage,
    HostBrowserScreenshot,
    ToolHostCapabilities,
    ToolInvocationContext,
)
from app.tooling.browser_tools import (
    BrowserCloseTabTool,
    BrowserExecuteTool,
    BrowserListTabsTool,
    BrowserOpenTool,
    BrowserResetTool,
    BrowserScreenshotTool,
    BrowserSnapshotTool,
    BrowserSwitchTabTool,
    get_browser_tool_contracts,
)


class _StubBrowserController:
    def __init__(self) -> None:
        self.open_calls: list[tuple[str, bool, bool, str | None, str | None]] = []
        self.screenshot_calls: list[str | None] = []
        self.list_tabs_calls: list[tuple[()]] = []
        self.close_tab_calls: list[str | None] = []
        self.switch_tab_calls: list[str] = []
        self.execute_calls: list[tuple[str, str | None]] = []
        self.reset_calls: list[tuple[()]] = []
        self.snapshot_calls: list[tuple[str | None, str | None]] = []

    async def open_page(self, *, url: str, show_window: bool = False, new_tab: bool = False, selector: str | None = None, format: str | None = None) -> HostBrowserPage:
        self.open_calls.append((url, show_window, new_tab, selector, format))
        return HostBrowserPage(
            tab_id="tab-1",
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
            tab_id="tab-1",
            current_url="https://example.com",
            title="Example Domain",
            window_visible=True,
        )
        artifact = HostArtifact(
            artifact_id="artifact-ss",
            uri="artifact://desktop/ss.png",
            name=name or "browser-screenshot.png",
            content_type="image/png",
            metadata={"source": "browser.screenshot"},
        )
        return HostBrowserScreenshot(page=page, artifact=artifact)

    async def list_tabs(self) -> list[HostBrowserPage]:
        self.list_tabs_calls.append(())
        return [
            HostBrowserPage(
                tab_id="tab-1",
                current_url="https://example.com",
                title="Example",
                window_visible=True,
            ),
            HostBrowserPage(
                tab_id="tab-2",
                current_url="https://other.com",
                title="Other",
                window_visible=False,
            ),
        ]

    async def close_tab(self, *, tab_id: str | None = None) -> HostBrowserPage:
        self.close_tab_calls.append(tab_id)
        return HostBrowserPage(
            tab_id=tab_id or "tab-1",
            current_url="https://example.com",
            title="Example Domain",
            window_visible=False,
        )

    async def switch_tab(self, *, tab_id: str) -> HostBrowserPage:
        self.switch_tab_calls.append(tab_id)
        return HostBrowserPage(
            tab_id=tab_id,
            current_url="https://example.com",
            title="Example Domain",
            window_visible=True,
        )

    async def execute_script(
        self,
        *,
        script: str,
        tab_id: str | None = None,
    ) -> dict[str, Any]:
        self.execute_calls.append((script, tab_id))
        return {"result": "executed", "tabId": tab_id or "tab-1"}

    async def reset(self) -> dict[str, Any]:
        self.reset_calls.append(())
        return {"closedCount": 3}

    async def capture_snapshot(
        self,
        *,
        tab_id: str | None = None,
        selector: str | None = None,
    ) -> dict[str, Any]:
        self.snapshot_calls.append((tab_id, selector))
        return {
            "snapshot": "- [heading] Page Title\n- [link] Click me [ref=@1]",
            "tabId": tab_id or "tab-1",
            "elementCount": 10,
            "interactiveCount": 3,
        }


def _run(awaitable):
    return asyncio.run(awaitable)


def _make_context(tool_id: str, run_id: str = "run-1") -> ToolInvocationContext:
    return ToolInvocationContext(
        invocation_id=f"{tool_id}:call-1",
        tool_id=tool_id,
        run_id=run_id,
        actor="agent",
    )


# ---------------------------------------------------------------------------
# Contract enumeration
# ---------------------------------------------------------------------------

def test_browser_tool_contracts_expose_all_eight_tools() -> None:
    contracts = get_browser_tool_contracts()

    assert tuple(contract.metadata.tool_id for contract in contracts) == (
        "browser.open",
        "browser.screenshot",
        "browser.list_tabs",
        "browser.close_tab",
        "browser.switch_tab",
        "browser.execute",
        "browser.reset",
        "browser.snapshot",
    )
    for contract in contracts:
        assert contract.metadata.capability_requirements[0].capability == "browser_controller"


# ---------------------------------------------------------------------------
# browser.open
# ---------------------------------------------------------------------------

def test_browser_open_tool_defaults() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "https://example.com"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output == {
        "tabId": "tab-1",
        "currentUrl": "https://example.com",
        "title": "Example Domain",
        "windowVisible": False,
    }
    assert controller.open_calls == [("https://example.com", False, False, None, None)]


def test_browser_open_tool_with_show_window() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "https://example.com", "showWindow": True},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output["windowVisible"] is True
    assert controller.open_calls == [("https://example.com", True, False, None, None)]


def test_browser_open_tool_with_new_tab() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "https://example.com", "newTab": True},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert controller.open_calls == [("https://example.com", False, True, None, None)]


def test_browser_open_tool_with_selector_and_format() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={
                "url": "https://example.com",
                "selector": ".main-content",
                "format": "text",
            },
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert controller.open_calls == [("https://example.com", False, False, ".main-content", "text")]


def test_browser_open_tool_rejects_invalid_format() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={
                "url": "https://example.com",
                "format": "pdf",
            },
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "invalid_input"


def test_browser_open_tool_rejects_empty_url() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "  "},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "invalid_input"


def test_browser_open_tool_rejects_invalid_show_window() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "https://example.com", "showWindow": "yes"},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "invalid_input"


# ---------------------------------------------------------------------------
# browser.screenshot
# ---------------------------------------------------------------------------

def test_browser_screenshot_tool_returns_artifact_reference() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.screenshot")

    result = _run(
        BrowserScreenshotTool().invoke(
            arguments={"name": "browser-capture"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output["tabId"] == "tab-1"
    assert result.output["currentUrl"] == "https://example.com"
    assert result.output["name"] == "browser-capture"
    assert result.output["contentType"] == "image/png"
    assert [a.artifact_id for a in result.artifacts] == ["artifact-ss"]
    assert controller.screenshot_calls == ["browser-capture"]


def test_browser_screenshot_tool_default_name() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.screenshot")

    result = _run(
        BrowserScreenshotTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert controller.screenshot_calls == [None]


# ---------------------------------------------------------------------------
# browser.list_tabs
# ---------------------------------------------------------------------------

def test_browser_list_tabs_tool_returns_tab_list() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.list_tabs")

    result = _run(
        BrowserListTabsTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert len(result.output["tabs"]) == 2
    assert result.output["count"] == 2
    assert result.output["tabs"][0]["tabId"] == "tab-1"
    assert result.output["tabs"][1]["tabId"] == "tab-2"
    assert controller.list_tabs_calls == [()]


# ---------------------------------------------------------------------------
# browser.close_tab
# ---------------------------------------------------------------------------

def test_browser_close_tab_tool_with_explicit_id() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.close_tab")

    result = _run(
        BrowserCloseTabTool().invoke(
            arguments={"tabId": "tab-2"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output["tabId"] == "tab-2"
    assert controller.close_tab_calls == ["tab-2"]


def test_browser_close_tab_tool_defaults_to_active() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.close_tab")

    result = _run(
        BrowserCloseTabTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert controller.close_tab_calls == [None]


# ---------------------------------------------------------------------------
# browser.switch_tab
# ---------------------------------------------------------------------------

def test_browser_switch_tab_tool_switches_to_tab() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.switch_tab")

    result = _run(
        BrowserSwitchTabTool().invoke(
            arguments={"tabId": "tab-2"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output["tabId"] == "tab-2"
    assert result.output["windowVisible"] is True
    assert controller.switch_tab_calls == ["tab-2"]


def test_browser_switch_tab_tool_rejects_empty_tab_id() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.switch_tab")

    result = _run(
        BrowserSwitchTabTool().invoke(
            arguments={"tabId": "  "},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "invalid_input"


# ---------------------------------------------------------------------------
# browser.execute
# ---------------------------------------------------------------------------

def test_browser_execute_tool_invokes_script() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.execute")

    result = _run(
        BrowserExecuteTool().invoke(
            arguments={"script": "document.title"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output["result"] == "executed"
    assert result.output["tabId"] == "tab-1"
    assert controller.execute_calls == [("document.title", None)]


def test_browser_execute_tool_with_tab_id() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.execute")

    result = _run(
        BrowserExecuteTool().invoke(
            arguments={"script": "document.querySelector('button').click()", "tabId": "tab-2"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert controller.execute_calls == [("document.querySelector('button').click()", "tab-2")]


def test_browser_execute_tool_rejects_empty_script() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.execute")

    result = _run(
        BrowserExecuteTool().invoke(
            arguments={"script": ""},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "invalid_input"


# ---------------------------------------------------------------------------
# browser.reset
# ---------------------------------------------------------------------------

def test_browser_reset_tool_closes_all_windows() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.reset")

    result = _run(
        BrowserResetTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert result.output["closedCount"] == 3
    assert controller.reset_calls == [()]


# ---------------------------------------------------------------------------
# browser.snapshot
# ---------------------------------------------------------------------------

def test_browser_snapshot_tool_returns_accessibility_snapshot() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.snapshot")

    result = _run(
        BrowserSnapshotTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert "Click me" in result.output["snapshot"]
    assert "[ref=@1]" in result.output["snapshot"]
    assert result.output["tabId"] == "tab-1"
    assert result.output["elementCount"] == 10
    assert result.output["interactiveCount"] == 3
    assert controller.snapshot_calls == [(None, None)]


def test_browser_snapshot_tool_with_selector() -> None:
    controller = _StubBrowserController()
    host = ToolHostCapabilities(browser_controller=controller)
    context = _make_context("browser.snapshot")

    result = _run(
        BrowserSnapshotTool().invoke(
            arguments={"selector": ".main-content", "tabId": "tab-2"},
            context=context,
            host=host,
        )
    )

    assert result.status == "success"
    assert controller.snapshot_calls == [("tab-2", ".main-content")]


# ---------------------------------------------------------------------------
# Missing host capability
# ---------------------------------------------------------------------------

def test_browser_open_tool_fails_when_browser_capability_missing() -> None:
    host = ToolHostCapabilities()
    context = _make_context("browser.open")

    result = _run(
        BrowserOpenTool().invoke(
            arguments={"url": "https://example.com"},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "host_capability_missing"


def test_browser_list_tabs_tool_fails_when_browser_capability_missing() -> None:
    host = ToolHostCapabilities()
    context = _make_context("browser.list_tabs")

    result = _run(
        BrowserListTabsTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "host_capability_missing"


def test_browser_execute_tool_fails_when_browser_capability_missing() -> None:
    host = ToolHostCapabilities()
    context = _make_context("browser.execute")

    result = _run(
        BrowserExecuteTool().invoke(
            arguments={"script": "1 + 1"},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "host_capability_missing"


def test_browser_reset_tool_fails_when_browser_capability_missing() -> None:
    host = ToolHostCapabilities()
    context = _make_context("browser.reset")

    result = _run(
        BrowserResetTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "host_capability_missing"


def test_browser_snapshot_tool_fails_when_browser_capability_missing() -> None:
    host = ToolHostCapabilities()
    context = _make_context("browser.snapshot")

    result = _run(
        BrowserSnapshotTool().invoke(
            arguments={},
            context=context,
            host=host,
        )
    )

    assert result.status == "error"
    assert result.error.code == "host_capability_missing"
