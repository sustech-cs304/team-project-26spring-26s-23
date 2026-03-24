"""Contracts for the minimal Copilot runtime scaffold."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, cast

from .session_store import RuntimeSessionRecord

INFO_METHOD = "info"
AGENT_CONNECT_METHOD = "agent/connect"
DEFAULT_RUNTIME_PROTOCOL = "single-endpoint"
DEFAULT_RUNTIME_STAGE = "phase2-connect-scaffold"
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
class RuntimeConnectRequest(RuntimeContract):
    agent_name: str
    thread_id: str
    run_id: str
    state: Any
    messages: tuple[dict[str, Any], ...]
    tools: tuple[dict[str, Any], ...] = ()
    context: tuple[dict[str, Any], ...] = ()
    forwarded_props: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def build_run_input(self) -> dict[str, Any]:
        return {
            "threadId": self.thread_id,
            "runId": self.run_id,
            "state": _jsonable(self.state),
            "messages": _jsonable(self.messages),
            "tools": _jsonable(self.tools),
            "context": _jsonable(self.context),
            "forwardedProps": _jsonable(self.forwarded_props),
        }


@dataclass(frozen=True, slots=True)
class RuntimeSessionDescriptor(RuntimeContract):
    threadId: str
    agentName: str
    createdAt: datetime
    updatedAt: datetime
    newlyCreated: bool
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeConnectResult(RuntimeContract):
    ok: bool
    threadId: str
    runId: str
    agentName: str
    session: RuntimeSessionDescriptor


@dataclass(frozen=True, slots=True)
class RuntimeScaffold(RuntimeContract):
    protocol: str
    stage: str
    supported_methods: tuple[str, ...]
    default_agent: str
    available_agents: tuple[RuntimeAgentDescriptor, ...]
    session_store_type: str
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

    def supports_agent(self, agent_name: str) -> bool:
        return any(agent.name == agent_name for agent in self.available_agents)

    def build_session_descriptor(
        self,
        *,
        session: RuntimeSessionRecord,
        newly_created: bool,
    ) -> RuntimeSessionDescriptor:
        return RuntimeSessionDescriptor(
            threadId=session.thread_id,
            agentName=session.agent_name,
            createdAt=session.created_at,
            updatedAt=session.updated_at,
            newlyCreated=newly_created,
            metadata=dict(session.metadata),
        )

    def build_connect_result(
        self,
        *,
        request: RuntimeConnectRequest,
        session: RuntimeSessionDescriptor,
    ) -> RuntimeConnectResult:
        return RuntimeConnectResult(
            ok=True,
            threadId=request.thread_id,
            runId=request.run_id,
            agentName=request.agent_name,
            session=session,
        )

    def build_connect_events(
        self,
        *,
        request: RuntimeConnectRequest,
        result: RuntimeConnectResult,
    ) -> tuple[dict[str, Any], ...]:
        return (
            {
                "type": "RUN_STARTED",
                "threadId": request.thread_id,
                "runId": request.run_id,
            },
            {
                "type": "STATE_SNAPSHOT",
                "snapshot": _jsonable(request.state),
            },
            {
                "type": "MESSAGES_SNAPSHOT",
                "messages": [],
            },
            {
                "type": "RUN_FINISHED",
                "threadId": request.thread_id,
                "runId": request.run_id,
                "result": result.to_dict(),
            },
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
            "session_store_type": self.session_store_type,
            "current_stage_supports_info_only": self.supported_methods == (INFO_METHOD,),
            "current_stage_supports_connect": AGENT_CONNECT_METHOD in self.supported_methods,
        }


def build_runtime_scaffold(*, session_store_type: str = "in-memory") -> RuntimeScaffold:
    default_agent = RuntimeAgentDescriptor(
        name="default",
        description="Minimal default agent exposed by the Copilot runtime connect scaffold.",
    )
    return RuntimeScaffold(
        protocol=DEFAULT_RUNTIME_PROTOCOL,
        stage=DEFAULT_RUNTIME_STAGE,
        supported_methods=(INFO_METHOD, AGENT_CONNECT_METHOD),
        default_agent=default_agent.name,
        available_agents=(default_agent,),
        session_store_type=session_store_type,
        transport=dict(DEFAULT_TRANSPORT),
    )


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value
