"""Tool metadata registry for the Copilot runtime."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

DEFAULT_TOOLSET_NAME = "default"
DEFAULT_TOOLSET_LABEL = "Default"
DEFAULT_TOOLSET_DESCRIPTION = "Placeholder empty toolset metadata reserved for the default Copilot agent."


@dataclass(frozen=True, slots=True)
class ToolDescriptor:
    name: str
    description: str

    def build_summary(self) -> dict[str, str]:
        return {
            "name": self.name,
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

    def register(self, descriptor: ToolsetDescriptor) -> ToolsetDescriptor:
        if descriptor.name.strip() == "":
            raise ValueError("Toolset name must be a non-empty string.")
        if descriptor.name in self._descriptors_by_name:
            raise ValueError(f"Toolset '{descriptor.name}' is already registered.")
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

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "available_toolsets": [
                descriptor.name for descriptor in self._descriptors_by_name.values()
            ],
            "default_toolset": self._default_toolset_name,
            "toolset_summaries": [
                descriptor.build_diagnostics_summary()
                for descriptor in self._descriptors_by_name.values()
            ],
        }


def build_default_tool_registry() -> ToolRegistry:
    registry = ToolRegistry()
    registry.register(
        ToolsetDescriptor(
            name=DEFAULT_TOOLSET_NAME,
            label=DEFAULT_TOOLSET_LABEL,
            description=DEFAULT_TOOLSET_DESCRIPTION,
            default=True,
            tools=(),
        )
    )
    return registry
