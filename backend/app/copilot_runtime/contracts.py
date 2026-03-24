"""Contracts for the phase-1 Copilot runtime scaffold."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, cast

INFO_METHOD = "info"
DEFAULT_RUNTIME_PROTOCOL = "single-endpoint"
DEFAULT_RUNTIME_STAGE = "phase1-info-only"
DEFAULT_TRANSPORT = {
    "root_path": "/",
    "method": "POST",
}


class RuntimeContract:
    def to_dict(self) -> dict[str, Any]:
        return cast(dict[str, Any], _jsonable(asdict(cast(Any, self))))


@dataclass(frozen=True, slots=True)
class RuntimeAgentDescriptor(RuntimeContract):
    name: str
    description: str


@dataclass(frozen=True, slots=True)
class RuntimeInfoResponse(RuntimeContract):
    actions: tuple[dict[str, Any], ...]
    agents: tuple[RuntimeAgentDescriptor, ...]
    defaultAgent: str
    protocol: str
    stage: str
    supportedMethods: tuple[str, ...]
    transport: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeScaffold(RuntimeContract):
    protocol: str
    stage: str
    supported_methods: tuple[str, ...]
    default_agent: str
    available_agents: tuple[RuntimeAgentDescriptor, ...]
    transport: dict[str, Any] = field(default_factory=dict)

    def build_info_response(self) -> RuntimeInfoResponse:
        return RuntimeInfoResponse(
            actions=(),
            agents=self.available_agents,
            defaultAgent=self.default_agent,
            protocol=self.protocol,
            stage=self.stage,
            supportedMethods=self.supported_methods,
            transport=dict(self.transport),
        )

    def diagnostics_summary(self) -> dict[str, Any]:
        return {
            "chat_runtime_registered": True,
            "chat_protocol": self.protocol,
            "chat_runtime_path": self.transport.get("root_path", "/"),
            "available_agents": [agent.name for agent in self.available_agents],
            "default_agent": self.default_agent,
            "supported_methods": list(self.supported_methods),
            "chat_runtime_stage": self.stage,
            "current_stage_supports_info_only": self.supported_methods == (INFO_METHOD,),
        }


def build_runtime_scaffold() -> RuntimeScaffold:
    default_agent = RuntimeAgentDescriptor(
        name="default",
        description="Placeholder default agent exposed by the phase-1 Copilot runtime scaffold.",
    )
    return RuntimeScaffold(
        protocol=DEFAULT_RUNTIME_PROTOCOL,
        stage=DEFAULT_RUNTIME_STAGE,
        supported_methods=(INFO_METHOD,),
        default_agent=default_agent.name,
        available_agents=(default_agent,),
        transport=dict(DEFAULT_TRANSPORT),
    )


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value
