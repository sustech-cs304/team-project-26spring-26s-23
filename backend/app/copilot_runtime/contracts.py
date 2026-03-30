"""Contracts for the Copilot runtime scaffold."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, cast

from .agent_registry import AgentRegistry, build_default_agent_registry
from .session_store import RuntimeSessionRecord
from .tool_registry import ToolRegistry, build_default_tool_registry

INFO_METHOD = "info"
AGENTS_LIST_METHOD = "agents/list"
SESSION_CREATE_METHOD = "session/create"
CAPABILITIES_GET_METHOD = "capabilities/get"
MESSAGE_SEND_METHOD = "message/send"
AGENT_CONNECT_METHOD = "agent/connect"
AGENT_RUN_METHOD = "agent/run"
DEFAULT_RUNTIME_PROTOCOL = "single-endpoint"
DEFAULT_RUNTIME_STAGE = "phase3-run-bridge"
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
class RuntimeAgentDirectoryEntry(RuntimeContract):
    agentId: str
    status: str
    recommendedTools: tuple[str, ...] = ()
    defaultModelPreference: str | None = None
    displayName: str | None = None
    description: str | None = None
    iconKey: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeBoundAgent(RuntimeContract):
    agentId: str
    status: str
    displayName: str | None = None
    description: str | None = None
    iconKey: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeInfoResponse(RuntimeContract):
    actions: tuple[dict[str, Any], ...]
    agents: dict[str, RuntimeAgentDescriptor]
    defaultAgent: str
    protocol: str
    stage: str
    supportedMethods: tuple[str, ...]
    transport: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeAgentsListResponse(RuntimeContract):
    ok: bool
    directoryVersion: str
    defaultAgentId: str
    agents: tuple[RuntimeAgentDirectoryEntry, ...]


@dataclass(frozen=True, slots=True)
class RuntimeSessionCreateRequest(RuntimeContract):
    agent_id: str


@dataclass(frozen=True, slots=True)
class RuntimeSessionCreateResponse(RuntimeContract):
    ok: bool
    sessionId: str
    boundAgent: RuntimeBoundAgent
    createdAt: datetime
    updatedAt: datetime
    recommendedTools: tuple[str, ...] = ()
    defaultModelPreference: str | None = None
    capabilities: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeCapabilitiesGetRequest(RuntimeContract):
    session_id: str


@dataclass(frozen=True, slots=True)
class RuntimeToolDirectoryEntry(RuntimeContract):
    toolId: str
    kind: str
    availability: str
    displayName: str | None = None
    description: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeCapabilitiesResponse(RuntimeContract):
    ok: bool
    sessionId: str
    boundAgent: RuntimeBoundAgent
    capabilitiesVersion: str
    tools: tuple[RuntimeToolDirectoryEntry, ...]
    recommendedTools: tuple[str, ...] = ()
    toolSelectionMode: str = "recommendation-only"
    defaultModelPreference: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeMessagePayload(RuntimeContract):
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class RuntimeMessageExecutionPolicy(RuntimeContract):
    model: str
    enabledTools: tuple[str, ...] = ()
    requestOptions: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeMessageSendRequest(RuntimeContract):
    session_id: str
    message: RuntimeMessagePayload
    policy: RuntimeMessageExecutionPolicy
    agent_id: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeMessageSendResponse(RuntimeContract):
    ok: bool
    sessionId: str
    boundAgent: RuntimeBoundAgent
    assistantMessage: RuntimeMessagePayload
    resolvedModelId: str
    resolvedToolIds: tuple[str, ...] = ()
    requestOptions: dict[str, Any] = field(default_factory=dict)


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
class RuntimeRunRequest(RuntimeContract):
    agent_name: str
    thread_id: str
    run_id: str
    user_message_text: str
    state: Any
    messages: tuple[dict[str, Any], ...]
    actions: tuple[dict[str, Any], ...] = ()
    meta_events: tuple[dict[str, Any], ...] = ()
    node_name: str | None = None
    forwarded_props: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def build_run_input(self) -> dict[str, Any]:
        return {
            "threadId": self.thread_id,
            "runId": self.run_id,
            "state": _jsonable(self.state),
            "messages": _jsonable(self.messages),
            "actions": _jsonable(self.actions),
            "metaEvents": _jsonable(self.meta_events),
            "nodeName": self.node_name,
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
class RuntimeRunResult(RuntimeContract):
    ok: bool
    threadId: str
    runId: str
    agentName: str
    output: str
    session: RuntimeSessionDescriptor


@dataclass(frozen=True, slots=True)
class RuntimeScaffold(RuntimeContract):
    protocol: str
    stage: str
    supported_methods: tuple[str, ...]
    default_agent: str
    remote_agent_registry: dict[str, RuntimeAgentDescriptor]
    agent_directory_version: str
    agent_directory: tuple[RuntimeAgentDirectoryEntry, ...]
    bound_agent_views: dict[str, RuntimeBoundAgent]
    default_toolset: str
    agent_toolsets: dict[str, str]
    tool_directory_version: str
    tool_catalog_by_toolset: dict[str, tuple[RuntimeToolDirectoryEntry, ...]]
    agent_diagnostics_summary: dict[str, Any]
    tool_diagnostics_summary: dict[str, Any]
    session_store_type: str
    model_configured: bool
    model_environment_keys: tuple[str, ...] = ()
    transport: dict[str, Any] = field(default_factory=dict)

    def build_remote_agent_registry(self) -> dict[str, RuntimeAgentDescriptor]:
        """Return the runtime info agent registry keyed by agent id."""
        return dict(self.remote_agent_registry)

    def build_info_response(self) -> RuntimeInfoResponse:
        return RuntimeInfoResponse(
            actions=(),
            agents=self.build_remote_agent_registry(),
            defaultAgent=self.default_agent,
            protocol=self.protocol,
            stage=self.stage,
            supportedMethods=self.supported_methods,
            transport=dict(self.transport),
        )

    def build_agents_list_response(self) -> RuntimeAgentsListResponse:
        return RuntimeAgentsListResponse(
            ok=True,
            directoryVersion=self.agent_directory_version,
            defaultAgentId=self.default_agent,
            agents=self.agent_directory,
        )

    def build_session_create_response(
        self,
        *,
        session: RuntimeSessionRecord,
    ) -> RuntimeSessionCreateResponse:
        entry = self._get_agent_directory_entry(session.bound_agent_id)
        return RuntimeSessionCreateResponse(
            ok=True,
            sessionId=session.session_id,
            boundAgent=self._get_bound_agent_view(session.bound_agent_id),
            createdAt=session.created_at,
            updatedAt=session.updated_at,
            recommendedTools=entry.recommendedTools,
            defaultModelPreference=entry.defaultModelPreference,
            capabilities={
                "tools": {
                    "selectionMode": "recommendation-only",
                    "recommendedTools": list(entry.recommendedTools),
                }
            },
        )

    def build_capabilities_version(self) -> str:
        return f"capabilities:{self.agent_directory_version}:{self.tool_directory_version}"

    def build_capabilities_response(
        self,
        *,
        session: RuntimeSessionRecord,
    ) -> RuntimeCapabilitiesResponse:
        entry = self._get_agent_directory_entry(session.bound_agent_id)
        toolset_name = self._get_agent_toolset_name(session.bound_agent_id)
        return RuntimeCapabilitiesResponse(
            ok=True,
            sessionId=session.session_id,
            boundAgent=self._get_bound_agent_view(session.bound_agent_id),
            capabilitiesVersion=self.build_capabilities_version(),
            tools=self._get_tool_catalog(toolset_name),
            recommendedTools=entry.recommendedTools,
            toolSelectionMode="recommendation-only",
            defaultModelPreference=entry.defaultModelPreference,
        )

    def supports_agent(self, agent_name: str) -> bool:
        return agent_name in self.bound_agent_views

    def build_message_send_response(
        self,
        *,
        session: RuntimeSessionRecord,
        assistant_text: str,
        resolved_model_id: str,
        resolved_tool_ids: tuple[str, ...],
        request_options: dict[str, Any] | None = None,
    ) -> RuntimeMessageSendResponse:
        return RuntimeMessageSendResponse(
            ok=True,
            sessionId=session.session_id,
            boundAgent=self._get_bound_agent_view(session.bound_agent_id),
            assistantMessage=RuntimeMessagePayload(role="assistant", content=assistant_text),
            resolvedModelId=resolved_model_id,
            resolvedToolIds=resolved_tool_ids,
            requestOptions=dict(request_options or {}),
        )

    def resolve_enabled_tool_ids(
        self,
        *,
        agent_id: str,
        enabled_tools: tuple[str, ...],
    ) -> tuple[str, ...]:
        tool_catalog = self._get_tool_catalog(self._get_agent_toolset_name(agent_id))
        tools_by_id = {entry.toolId: entry for entry in tool_catalog}

        normalized_requested: list[str] = []
        seen: set[str] = set()
        for tool_id in enabled_tools:
            if tool_id in seen:
                continue
            seen.add(tool_id)
            if tool_id not in tools_by_id:
                raise LookupError(f"Unknown tool '{tool_id}'.")
            normalized_requested.append(tool_id)

        return tuple(
            tool_id
            for tool_id in normalized_requested
            if tools_by_id[tool_id].availability == "available"
        )

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

    def build_run_result(
        self,
        *,
        request: RuntimeRunRequest,
        assistant_text: str,
        session: RuntimeSessionDescriptor,
    ) -> RuntimeRunResult:
        return RuntimeRunResult(
            ok=True,
            threadId=request.thread_id,
            runId=request.run_id,
            agentName=request.agent_name,
            output=assistant_text,
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

    def build_run_events(
        self,
        *,
        request: RuntimeRunRequest,
        result: RuntimeRunResult,
        assistant_message_id: str,
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
                "type": "TEXT_MESSAGE_START",
                "messageId": assistant_message_id,
                "role": "assistant",
            },
            {
                "type": "TEXT_MESSAGE_CONTENT",
                "messageId": assistant_message_id,
                "delta": result.output,
            },
            {
                "type": "TEXT_MESSAGE_END",
                "messageId": assistant_message_id,
            },
            {
                "type": "RUN_FINISHED",
                "threadId": request.thread_id,
                "runId": request.run_id,
                "result": result.to_dict(),
            },
        )

    def diagnostics_summary(self) -> dict[str, Any]:
        summary = {
            "chat_runtime_registered": True,
            "chat_protocol": self.protocol,
            "chat_runtime_path": self.transport.get("root_path", "/"),
            "supported_methods": list(self.supported_methods),
            "chat_runtime_stage": self.stage,
            "session_store_type": self.session_store_type,
            "current_stage_supports_info_only": self.supported_methods == (INFO_METHOD,),
            "current_stage_supports_agents_list": AGENTS_LIST_METHOD in self.supported_methods,
            "current_stage_supports_session_create": SESSION_CREATE_METHOD in self.supported_methods,
            "current_stage_supports_capabilities_get": CAPABILITIES_GET_METHOD in self.supported_methods,
            "current_stage_supports_message_send": MESSAGE_SEND_METHOD in self.supported_methods,
            "current_stage_supports_connect": AGENT_CONNECT_METHOD in self.supported_methods,
            "current_stage_supports_run": AGENT_RUN_METHOD in self.supported_methods,
            "model_configured": self.model_configured,
            "model_environment_keys": list(self.model_environment_keys),
        }
        summary.update(self.agent_diagnostics_summary)
        summary.update(self.tool_diagnostics_summary)
        return summary

    def _get_agent_directory_entry(self, agent_id: str) -> RuntimeAgentDirectoryEntry:
        for entry in self.agent_directory:
            if entry.agentId == agent_id:
                return entry
        raise LookupError(f"Unknown agent '{agent_id}'.")

    def _get_bound_agent_view(self, agent_id: str) -> RuntimeBoundAgent:
        try:
            return self.bound_agent_views[agent_id]
        except KeyError as exc:  # pragma: no cover - defensive guard
            raise LookupError(f"Unknown agent '{agent_id}'.") from exc

    def _get_agent_toolset_name(self, agent_id: str) -> str:
        return self.agent_toolsets.get(agent_id, self.default_toolset)

    def _get_tool_catalog(self, toolset_name: str) -> tuple[RuntimeToolDirectoryEntry, ...]:
        try:
            return self.tool_catalog_by_toolset[toolset_name]
        except KeyError as exc:  # pragma: no cover - defensive guard
            raise LookupError(f"Unknown toolset '{toolset_name}'.") from exc



def build_runtime_scaffold(
    *,
    session_store_type: str = "in-memory",
    model_configured: bool = False,
    model_environment_keys: tuple[str, ...] = (),
    agent_registry: AgentRegistry | None = None,
    tool_registry: ToolRegistry | None = None,
) -> RuntimeScaffold:
    resolved_tool_registry = tool_registry or build_default_tool_registry()
    resolved_agent_registry = agent_registry or build_default_agent_registry(
        toolset_name=resolved_tool_registry.get_default().name
    )
    agent_directory = _build_runtime_agent_directory(resolved_agent_registry)
    return RuntimeScaffold(
        protocol=DEFAULT_RUNTIME_PROTOCOL,
        stage=DEFAULT_RUNTIME_STAGE,
        supported_methods=(
            INFO_METHOD,
            AGENTS_LIST_METHOD,
            SESSION_CREATE_METHOD,
            CAPABILITIES_GET_METHOD,
            MESSAGE_SEND_METHOD,
            AGENT_CONNECT_METHOD,
            AGENT_RUN_METHOD,
        ),
        default_agent=resolved_agent_registry.get_default().name,
        remote_agent_registry=_build_runtime_agent_registry(resolved_agent_registry),
        agent_directory_version=resolved_agent_registry.directory_version,
        agent_directory=agent_directory,
        bound_agent_views=_build_runtime_bound_agent_views(agent_directory),
        default_toolset=resolved_tool_registry.get_default().name,
        agent_toolsets=_build_runtime_agent_toolsets(resolved_agent_registry, resolved_tool_registry),
        tool_directory_version=resolved_tool_registry.directory_version,
        tool_catalog_by_toolset=_build_runtime_tool_catalogs(resolved_tool_registry),
        agent_diagnostics_summary=resolved_agent_registry.build_diagnostics_summary(),
        tool_diagnostics_summary=resolved_tool_registry.build_diagnostics_summary(),
        session_store_type=session_store_type,
        model_configured=model_configured,
        model_environment_keys=model_environment_keys,
        transport=dict(DEFAULT_TRANSPORT),
    )



def _build_runtime_agent_registry(
    agent_registry: AgentRegistry,
) -> dict[str, RuntimeAgentDescriptor]:
    return {
        name: RuntimeAgentDescriptor(**agent_view)
        for name, agent_view in agent_registry.build_info_view().items()
    }



def _build_runtime_agent_directory(
    agent_registry: AgentRegistry,
) -> tuple[RuntimeAgentDirectoryEntry, ...]:
    entries: list[RuntimeAgentDirectoryEntry] = []
    for agent_view in agent_registry.build_directory_view():
        normalized_view = dict(agent_view)
        normalized_view["recommendedTools"] = tuple(agent_view.get("recommendedTools", ()))
        entries.append(RuntimeAgentDirectoryEntry(**normalized_view))
    return tuple(entries)



def _build_runtime_bound_agent_views(
    agent_directory: tuple[RuntimeAgentDirectoryEntry, ...],
) -> dict[str, RuntimeBoundAgent]:
    return {
        entry.agentId: RuntimeBoundAgent(
            agentId=entry.agentId,
            status=entry.status,
            displayName=entry.displayName,
            description=entry.description,
            iconKey=entry.iconKey,
        )
        for entry in agent_directory
    }



def _build_runtime_agent_toolsets(
    agent_registry: AgentRegistry,
    tool_registry: ToolRegistry,
) -> dict[str, str]:
    default_toolset = tool_registry.get_default().name
    return {
        agent_id: toolset_name or default_toolset
        for agent_id, toolset_name in agent_registry.build_agent_toolset_map().items()
    }



def _build_runtime_tool_catalogs(
    tool_registry: ToolRegistry,
) -> dict[str, tuple[RuntimeToolDirectoryEntry, ...]]:
    return {
        toolset_name: tuple(
            RuntimeToolDirectoryEntry(**tool_view)
            for tool_view in tool_registry.build_tool_catalog(toolset_name)
        )
        for toolset_name in tool_registry.build_view()
    }



def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value
