"""Tool metadata registry for the Copilot runtime."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

DEFAULT_TOOLSET_NAME = "default"
DEFAULT_TOOLSET_LABEL = "Default"
DEFAULT_TOOLSET_DESCRIPTION = (
    "Builtin Copilot runtime tools exposed as the default toolset directory."
)
DEFAULT_TOOL_DIRECTORY_VERSION = "tools-v1"
DEFAULT_TOOL_KIND = "builtin"
DEFAULT_TOOL_AVAILABILITY = "available"
FILE_CONVERT_TOOL_ID = "tool.file-convert"
FILE_CONVERT_TOOL_DISPLAY_NAME = "File Convert"
FILE_CONVERT_TOOL_DESCRIPTION = "Convert DOCX, PDF, and PPTX files into text."


@dataclass(frozen=True, slots=True)
class ToolDescriptor:
    """Stable tool contract fields are centered on `tool_id`; display fields are hints only."""

    tool_id: str
    kind: str = DEFAULT_TOOL_KIND
    display_name: str | None = None
    description: str | None = None
    availability: str = DEFAULT_TOOL_AVAILABILITY

    def build_catalog_entry(self) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "toolId": self.tool_id,
            "kind": self.kind,
            "availability": self.availability,
        }
        if self.display_name is not None:
            entry["displayName"] = self.display_name
        if self.description is not None:
            entry["description"] = self.description
        return entry

    def build_summary(self) -> dict[str, Any]:
        return {
            "toolId": self.tool_id,
            "kind": self.kind,
            "availability": self.availability,
            "displayName": self.display_name,
            "description": self.description,
        }


@dataclass(frozen=True, slots=True)
class ToolsetDescriptor:
    name: str
    label: str
    description: str
    default: bool = False
    tools: tuple[ToolDescriptor, ...] = ()

    def build_view(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "toolCount": len(self.tools),
        }

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "toolCount": len(self.tools),
            "tools": [tool.build_summary() for tool in self.tools],
        }


class ToolRegistry:
    def __init__(self, descriptors: Iterable[ToolsetDescriptor] = ()) -> None:
        self._descriptors_by_name: dict[str, ToolsetDescriptor] = {}
        self._default_toolset_name: str | None = None
        for descriptor in descriptors:
            self.register(descriptor)

    @property
    def directory_version(self) -> str:
        return DEFAULT_TOOL_DIRECTORY_VERSION

    def register(self, descriptor: ToolsetDescriptor) -> ToolsetDescriptor:
        if descriptor.name.strip() == "":
            raise ValueError("Toolset name must be a non-empty string.")
        if descriptor.name in self._descriptors_by_name:
            raise ValueError(f"Toolset '{descriptor.name}' is already registered.")
        self._validate_tools(descriptor)
        if descriptor.default:
            if self._default_toolset_name is not None:
                raise ValueError(
                    f"Default toolset is already registered as '{self._default_toolset_name}'."
                )
            self._default_toolset_name = descriptor.name

        self._descriptors_by_name[descriptor.name] = descriptor
        return descriptor

    def get(self, name: str) -> ToolsetDescriptor | None:
        return self._descriptors_by_name.get(name)

    def get_default(self) -> ToolsetDescriptor:
        if self._default_toolset_name is None:
            raise LookupError("No default toolset is registered.")
        return self._descriptors_by_name[self._default_toolset_name]

    def supports(self, name: str) -> bool:
        return name in self._descriptors_by_name

    def build_view(self) -> dict[str, dict[str, Any]]:
        return {
            name: descriptor.build_view()
            for name, descriptor in self._descriptors_by_name.items()
        }

    def build_tool_catalog(self, toolset_name: str | None = None) -> tuple[dict[str, Any], ...]:
        descriptor = self.get_default() if toolset_name is None else self.get(toolset_name)
        if descriptor is None:
            raise LookupError(f"Unknown toolset '{toolset_name}'.")
        return tuple(tool.build_catalog_entry() for tool in descriptor.tools)

    def list_tool_ids(self, toolset_name: str | None = None) -> tuple[str, ...]:
        descriptor = self.get_default() if toolset_name is None else self.get(toolset_name)
        if descriptor is None:
            raise LookupError(f"Unknown toolset '{toolset_name}'.")
        return tuple(tool.tool_id for tool in descriptor.tools)

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "available_toolsets": [
                descriptor.name for descriptor in self._descriptors_by_name.values()
            ],
            "default_toolset": self._default_toolset_name,
            "tool_directory_version": self.directory_version,
            "toolset_summaries": [
                descriptor.build_diagnostics_summary()
                for descriptor in self._descriptors_by_name.values()
            ],
        }

    def _validate_tools(self, descriptor: ToolsetDescriptor) -> None:
        tool_ids: set[str] = set()
        for tool in descriptor.tools:
            if tool.tool_id.strip() == "":
                raise ValueError(
                    f"Toolset '{descriptor.name}' contains a tool with an empty tool_id."
                )
            if tool.tool_id in tool_ids:
                raise ValueError(
                    f"Toolset '{descriptor.name}' contains duplicate tool id '{tool.tool_id}'."
                )
            tool_ids.add(tool.tool_id)


def build_default_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolsetDescriptor(
            name=DEFAULT_TOOLSET_NAME,
            label=DEFAULT_TOOLSET_LABEL,
            description=DEFAULT_TOOLSET_DESCRIPTION,
            default=True,
            tools=(
                ToolDescriptor(
                    tool_id=FILE_CONVERT_TOOL_ID,
                    kind=DEFAULT_TOOL_KIND,
                    display_name=FILE_CONVERT_TOOL_DISPLAY_NAME,
                    description=FILE_CONVERT_TOOL_DESCRIPTION,
                    availability=DEFAULT_TOOL_AVAILABILITY,
                ),
            ),
        )
    )
    return registry
