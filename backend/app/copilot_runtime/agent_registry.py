"""Agent metadata registry for the Copilot runtime."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from .agent import AgentExecutorFactory, DEFAULT_AGENT_NAME
from .tool_registry import DEFAULT_TOOLSET_NAME

DEFAULT_AGENT_LABEL = "Default"
DEFAULT_AGENT_DESCRIPTION = "Minimal default agent exposed by the Copilot runtime run bridge."


@dataclass(frozen=True, slots=True)
class AgentDescriptor:
    name: str
    label: str
    description: str
    default: bool = False
    toolset_name: str | None = None
    executor_factory: AgentExecutorFactory | None = None

    def build_info_view(self) -> dict[str, str]:
        return {
            "name": self.name,
            "description": self.description,
        }

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "label": self.label,
            "description": self.description,
            "default": self.default,
            "toolsetName": self.toolset_name,
            "hasExecutorFactory": self.executor_factory is not None,
        }


class AgentRegistry:
    def __init__(self, descriptors: Iterable[AgentDescriptor] = ()) -> None:
        self._descriptors_by_name: dict[str, AgentDescriptor] = {}
        self._default_agent_name: str | None = None
        for descriptor in descriptors:
            self.register(descriptor)

    def register(self, descriptor: AgentDescriptor) -> AgentDescriptor:
        if descriptor.name.strip() == "":
            raise ValueError("Agent name must be a non-empty string.")
        if descriptor.name in self._descriptors_by_name:
            raise ValueError(f"Agent '{descriptor.name}' is already registered.")
        if descriptor.default:
            if self._default_agent_name is not None:
                raise ValueError(
                    f"Default agent is already registered as '{self._default_agent_name}'."
                )
            self._default_agent_name = descriptor.name

        self._descriptors_by_name[descriptor.name] = descriptor
        return descriptor

    def get(self, name: str) -> AgentDescriptor | None:
        return self._descriptors_by_name.get(name)

    def get_default(self) -> AgentDescriptor:
        if self._default_agent_name is None:
            raise LookupError("No default agent is registered.")
        return self._descriptors_by_name[self._default_agent_name]

    def supports(self, name: str) -> bool:
        return name in self._descriptors_by_name

    def build_info_view(self) -> dict[str, dict[str, str]]:
        return {
            name: descriptor.build_info_view()
            for name, descriptor in self._descriptors_by_name.items()
        }

    def build_diagnostics_summary(self) -> dict[str, Any]:
        return {
            "available_agents": [
                descriptor.name for descriptor in self._descriptors_by_name.values()
            ],
            "default_agent": self._default_agent_name,
            "agent_summaries": [
                descriptor.build_diagnostics_summary()
                for descriptor in self._descriptors_by_name.values()
            ],
        }


def build_default_agent_registry(
    *,
    executor_factory: AgentExecutorFactory | None = None,
    toolset_name: str | None = DEFAULT_TOOLSET_NAME,
) -> AgentRegistry:
    registry = AgentRegistry()
    registry.register(
        AgentDescriptor(
            name=DEFAULT_AGENT_NAME,
            label=DEFAULT_AGENT_LABEL,
            description=DEFAULT_AGENT_DESCRIPTION,
            default=True,
            toolset_name=toolset_name,
            executor_factory=executor_factory,
        )
    )
    return registry
