"""Runtime-agnostic browser tool contracts backed by a host browser capability."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast

from .contract import (
    HostCapabilityRequirement,
    NormalizedToolError,
    NormalizedToolErrorCode,
    ToolArtifactReference,
    ToolContract,
    ToolInvocationContext,
    ToolMetadata,
    ToolResultEnvelope,
    ToolSchema,
)
from .host_capabilities import (
    BrowserController,
    HostArtifact,
    HostCapabilityOperationError,
    MissingHostCapabilityError,
    ToolHostCapabilities,
)

_BROWSER_OPEN_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["url"],
        "properties": {
            "url": {"type": "string", "minLength": 1},
            "showWindow": {"type": "boolean"},
            "newTab": {"type": "boolean"},
            "selector": {"type": "string", "minLength": 1},
            "format": {"enum": ["text", "html", "markdown"]},
        },
    }
)

_BROWSER_SCREENSHOT_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "name": {"type": "string", "minLength": 1},
        },
    }
)

_BROWSER_OPEN_METADATA = ToolMetadata(
    tool_id="browser.open",
    display_name="Browser Open",
    description="Open a URL in the desktop runtime browser window.",
    input_schema=_BROWSER_OPEN_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Open pages in the host browser window.",
        ),
    ),
    tags=("browser", "navigation"),
    idempotent=False,
)

_BROWSER_SCREENSHOT_METADATA = ToolMetadata(
    tool_id="browser.screenshot",
    display_name="Browser Screenshot",
    description="Capture a PNG screenshot of the current desktop runtime browser page.",
    input_schema=_BROWSER_SCREENSHOT_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Capture screenshots from the host browser window.",
        ),
    ),
    tags=("browser", "screenshot", "artifact"),
)

_BROWSER_LIST_TABS_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    }
)

_BROWSER_LIST_TABS_METADATA = ToolMetadata(
    tool_id="browser.list_tabs",
    display_name="Browser List Tabs",
    description="List all open browser tabs with their IDs, URLs, and titles.",
    input_schema=_BROWSER_LIST_TABS_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="List open browser tabs.",
        ),
    ),
    tags=("browser", "tab_management"),
)

_BROWSER_CLOSE_TAB_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "tabId": {"type": "string", "minLength": 1},
        },
    }
)

_BROWSER_CLOSE_TAB_METADATA = ToolMetadata(
    tool_id="browser.close_tab",
    display_name="Browser Close Tab",
    description="Close a browser tab by its ID. If no tabId is provided, closes the active tab.",
    input_schema=_BROWSER_CLOSE_TAB_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Close browser tabs.",
        ),
    ),
    tags=("browser", "tab_management"),
)

_BROWSER_SWITCH_TAB_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["tabId"],
        "properties": {
            "tabId": {"type": "string", "minLength": 1},
        },
    }
)

_BROWSER_SWITCH_TAB_METADATA = ToolMetadata(
    tool_id="browser.switch_tab",
    display_name="Browser Switch Tab",
    description="Switch to a specific browser tab by its ID, making it the active tab.",
    input_schema=_BROWSER_SWITCH_TAB_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Switch active browser tab.",
        ),
    ),
    tags=("browser", "tab_management"),
)

_BROWSER_EXECUTE_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "required": ["script"],
        "properties": {
            "script": {"type": "string", "minLength": 1},
            "tabId": {"type": "string", "minLength": 1},
        },
    }
)

_BROWSER_EXECUTE_METADATA = ToolMetadata(
    tool_id="browser.execute",
    display_name="Browser Execute",
    description="Execute arbitrary JavaScript in the current browser page. The result is serialized and returned. Use for clicking elements, filling forms, extracting data, or performing DOM interactions.",
    input_schema=_BROWSER_EXECUTE_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Execute JavaScript in browser pages.",
        ),
    ),
    tags=("browser", "scripting"),
)

_BROWSER_RESET_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {},
    }
)

_BROWSER_RESET_METADATA = ToolMetadata(
    tool_id="browser.reset",
    display_name="Browser Reset",
    description="Close all open browser windows and clear the browser state.",
    input_schema=_BROWSER_RESET_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Reset browser state.",
        ),
    ),
    tags=("browser", "cleanup"),
)

_BROWSER_SNAPSHOT_INPUT_SCHEMA = ToolSchema(
    schema={
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "selector": {"type": "string", "minLength": 1},
            "tabId": {"type": "string", "minLength": 1},
        },
    }
)

_BROWSER_SNAPSHOT_METADATA = ToolMetadata(
    tool_id="browser.snapshot",
    display_name="Browser Snapshot",
    description="Capture an accessibility snapshot of the current browser page. Returns a compact text representation with interactive elements annotated by reference IDs (e.g. [ref=@1]). Use this to understand page structure before interacting with elements via browser.execute.",
    input_schema=_BROWSER_SNAPSHOT_INPUT_SCHEMA,
    capability_requirements=(
        HostCapabilityRequirement(
            capability="browser_controller",
            purpose="Capture page accessibility snapshots.",
        ),
    ),
    tags=("browser", "snapshot", "accessibility"),
)

_HOST_ERROR_CODE_MAP: dict[str, str] = {
    "invalid_request": "invalid_input",
    "permission_denied": "permission_denied",
    "not_found": "not_found",
    "conflict": "conflict",
    "temporarily_unavailable": "temporarily_unavailable",
    "timeout": "timeout",
}


@dataclass(frozen=True, slots=True)
class BrowserOpenTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_OPEN_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            url = _require_non_empty_text_argument(arguments, field_name="url")
            show_window = _read_bool_argument(
                arguments,
                field_name="showWindow",
                default=False,
            )
            page = await controller.open_page(url=url, show_window=show_window)
        except ValueError as exc:
            return _invalid_input_result(tool_id=self.metadata.tool_id, message=str(exc))
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output=page.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserScreenshotTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_SCREENSHOT_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        _ = context
        try:
            controller = _require_browser_controller(host)
            name = _read_optional_text_argument(arguments, field_name="name")
            screenshot = await controller.capture_screenshot(name=name)
        except ValueError as exc:
            return _invalid_input_result(tool_id=self.metadata.tool_id, message=str(exc))
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        artifact_reference = _artifact_to_reference(screenshot.artifact)
        output = screenshot.page.to_dict()
        output.update(screenshot.artifact.to_dict())
        return ToolResultEnvelope.success(
            output=output,
            artifacts=(artifact_reference,),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserListTabsTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_LIST_TABS_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            tabs = await controller.list_tabs()
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output={
                "tabs": [tab.to_dict() for tab in tabs],
                "count": len(tabs),
            },
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserCloseTabTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_CLOSE_TAB_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            tab_id = _read_optional_text_argument(arguments, field_name="tabId")
            page = await controller.close_tab(tab_id=tab_id)
        except ValueError as exc:
            return _invalid_input_result(tool_id=self.metadata.tool_id, message=str(exc))
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output=page.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserSwitchTabTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_SWITCH_TAB_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            tab_id = _require_non_empty_text_argument(arguments, field_name="tabId")
            page = await controller.switch_tab(tab_id=tab_id)
        except ValueError as exc:
            return _invalid_input_result(tool_id=self.metadata.tool_id, message=str(exc))
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output=page.to_dict(),
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserExecuteTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_EXECUTE_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            script = _require_non_empty_text_argument(arguments, field_name="script")
            tab_id = _read_optional_text_argument(arguments, field_name="tabId")
            result = await controller.execute_script(script=script, tab_id=tab_id)
        except ValueError as exc:
            return _invalid_input_result(tool_id=self.metadata.tool_id, message=str(exc))
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output=result,
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserResetTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_RESET_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            result = await controller.reset()
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output=result,
            metadata={"toolId": self.metadata.tool_id},
        )


@dataclass(frozen=True, slots=True)
class BrowserSnapshotTool(ToolContract):
    @property
    def metadata(self) -> ToolMetadata:
        return _BROWSER_SNAPSHOT_METADATA

    async def invoke(
        self,
        *,
        arguments: Mapping[str, Any] | None,
        context: ToolInvocationContext,
        host: ToolHostCapabilities,
    ) -> ToolResultEnvelope:
        try:
            controller = _require_browser_controller(host)
            tab_id = _read_optional_text_argument(arguments, field_name="tabId")
            selector = _read_optional_text_argument(arguments, field_name="selector")
            result = await controller.capture_snapshot(tab_id=tab_id, selector=selector)
        except ValueError as exc:
            return _invalid_input_result(tool_id=self.metadata.tool_id, message=str(exc))
        except MissingHostCapabilityError as exc:
            return _missing_host_capability_result(
                tool_id=self.metadata.tool_id,
                capability=exc.capability,
            )
        except HostCapabilityOperationError as exc:
            return _host_operation_error_result(
                tool_id=self.metadata.tool_id,
                error=exc,
            )

        return ToolResultEnvelope.success(
            output=result,
            metadata={"toolId": self.metadata.tool_id},
        )


BROWSER_TOOL_CONTRACTS: tuple[ToolContract, ...] = (
    BrowserOpenTool(),
    BrowserScreenshotTool(),
    BrowserListTabsTool(),
    BrowserCloseTabTool(),
    BrowserSwitchTabTool(),
    BrowserExecuteTool(),
    BrowserResetTool(),
    BrowserSnapshotTool(),
)


def get_browser_tool_contracts() -> tuple[ToolContract, ...]:
    """Return stable browser tool contracts for runtime adapters."""

    return BROWSER_TOOL_CONTRACTS


def _require_browser_controller(host: ToolHostCapabilities) -> BrowserController:
    return cast(BrowserController, host.require_capability("browser_controller"))


def _require_non_empty_text_argument(
    arguments: Mapping[str, Any] | None,
    *,
    field_name: str,
) -> str:
    value = (arguments or {}).get(field_name)
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{field_name} must be a non-empty string")
    return value.strip()


def _read_optional_text_argument(
    arguments: Mapping[str, Any] | None,
    *,
    field_name: str,
) -> str | None:
    value = (arguments or {}).get(field_name)
    if value is None:
        return None
    if not isinstance(value, str) or value.strip() == "":
        raise ValueError(f"{field_name} must be a non-empty string when provided")
    return value.strip()


def _read_bool_argument(
    arguments: Mapping[str, Any] | None,
    *,
    field_name: str,
    default: bool,
) -> bool:
    value = (arguments or {}).get(field_name)
    if value is None:
        return default
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean when provided")
    return value


def _artifact_to_reference(artifact: HostArtifact) -> ToolArtifactReference:
    return ToolArtifactReference(
        artifact_id=artifact.artifact_id,
        name=artifact.name,
        content_type=artifact.content_type,
        uri=artifact.uri,
        metadata=artifact.metadata,
    )


def _invalid_input_result(*, tool_id: str, message: str) -> ToolResultEnvelope:
    return ToolResultEnvelope.failure(
        error=NormalizedToolError(code="invalid_input", message=message),
        metadata={"toolId": tool_id},
    )


def _missing_host_capability_result(
    *,
    tool_id: str,
    capability: str,
) -> ToolResultEnvelope:
    return ToolResultEnvelope.failure(
        error=NormalizedToolError(
            code="host_capability_missing",
            message=f"Required host capability '{capability}' is not available.",
            details={"capability": capability},
        ),
        metadata={"toolId": tool_id},
    )


def _host_operation_error_result(
    *,
    tool_id: str,
    error: HostCapabilityOperationError,
) -> ToolResultEnvelope:
    normalized_code = cast(
        NormalizedToolErrorCode,
        _HOST_ERROR_CODE_MAP.get(error.code, "execution_failed"),
    )
    details = dict(error.details)
    details.setdefault("hostCapability", error.capability)
    return ToolResultEnvelope.failure(
        error=NormalizedToolError(
            code=normalized_code,
            message=error.message,
            retryable=error.retryable,
            details=details,
        ),
        metadata={"toolId": tool_id},
    )


__all__ = [
    "BROWSER_TOOL_CONTRACTS",
    "BrowserCloseTabTool",
    "BrowserExecuteTool",
    "BrowserListTabsTool",
    "BrowserOpenTool",
    "BrowserResetTool",
    "BrowserScreenshotTool",
    "BrowserSnapshotTool",
    "BrowserSwitchTabTool",
    "get_browser_tool_contracts",
]
