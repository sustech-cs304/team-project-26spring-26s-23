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
    HostBrowserPage,
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


BROWSER_TOOL_CONTRACTS: tuple[ToolContract, ...] = (
    BrowserOpenTool(),
    BrowserScreenshotTool(),
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
    "BrowserOpenTool",
    "BrowserScreenshotTool",
    "get_browser_tool_contracts",
]
