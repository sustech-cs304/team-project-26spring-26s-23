"""Contracts for the Copilot runtime scaffold."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Literal, cast

from .agent_registry import AgentRegistry, build_default_agent_registry
from .model_routes import RuntimeModelRoute
from .session_store import RuntimeRunRecord, RuntimeThreadRecord
from .tool_registry import ToolRegistry, build_default_tool_registry

AGENTS_LIST_METHOD = "agents/list"
THREAD_CREATE_METHOD = "thread/create"
THREAD_GET_METHOD = "thread/get"
RUN_START_METHOD = "run/start"
RUN_STREAM_METHOD = "run/stream"
RUN_CANCEL_METHOD = "run/cancel"
CAPABILITIES_GET_METHOD = "capabilities/get"
THINKING_CAPABILITY_GET_METHOD = "thinking/capability/get"
DEFAULT_RUNTIME_PROTOCOL = "single-endpoint"
DEFAULT_RUNTIME_STAGE = "phase3-run-bridge"
DEFAULT_TRANSPORT = {
    "root_path": "/",
    "method": "POST",
}


ThinkingLevelIntent = Literal["off", "auto", "low", "medium", "high", "xhigh"]
_THINKING_LEVEL_INTENTS = frozenset({"off", "auto", "low", "medium", "high", "xhigh"})


def normalize_thinking_level_intent(value: Any) -> ThinkingLevelIntent | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized not in _THINKING_LEVEL_INTENTS:
        return None
    return cast(ThinkingLevelIntent, normalized)


class RuntimeContract:
    def to_dict(self) -> dict[str, Any]:
        return cast(dict[str, Any], _jsonable(asdict(cast(Any, self))))


@dataclass(frozen=True, slots=True)
class RuntimeAgentDirectoryEntry(RuntimeContract):
    agentId: str
    status: str
    recommendedTools: tuple[str, ...] = ()
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
class RuntimeAgentsListResponse(RuntimeContract):
    ok: bool
    directoryVersion: str
    defaultAgentId: str
    agents: tuple[RuntimeAgentDirectoryEntry, ...]


@dataclass(frozen=True, slots=True)
class RuntimeThreadCreateRequest(RuntimeContract):
    agent_id: str


@dataclass(frozen=True, slots=True)
class RuntimeThreadGetRequest(RuntimeContract):
    thread_id: str


@dataclass(frozen=True, slots=True)
class RuntimeCapabilitiesGetRequest(RuntimeContract):
    session_id: str


@dataclass(frozen=True, slots=True)
class RuntimeThinkingCapabilityGetRequest(RuntimeContract):
    session_id: str
    model_route: RuntimeModelRoute
    thinking_capability_override: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class RuntimeToolDirectoryEntry(RuntimeContract):
    toolId: str
    kind: str
    availability: str
    displayName: str | None = None
    description: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeThreadCreateResponse(RuntimeContract):
    ok: bool
    threadId: str
    boundAgent: RuntimeBoundAgent
    createdAt: datetime
    updatedAt: datetime
    recommendedTools: tuple[str, ...] = ()
    capabilities: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeThreadGetResponse(RuntimeContract):
    ok: bool
    threadId: str
    boundAgent: RuntimeBoundAgent
    createdAt: datetime
    updatedAt: datetime
    capabilitiesVersion: str
    tools: tuple[RuntimeToolDirectoryEntry, ...]
    recommendedTools: tuple[str, ...] = ()
    toolSelectionMode: str = "recommendation-only"
    latestRunId: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeCapabilitiesResponse(RuntimeContract):
    ok: bool
    sessionId: str
    boundAgent: RuntimeBoundAgent
    capabilitiesVersion: str
    tools: tuple[RuntimeToolDirectoryEntry, ...]
    recommendedTools: tuple[str, ...] = ()
    toolSelectionMode: str = "recommendation-only"


@dataclass(frozen=True, slots=True)
class RuntimeThinkingCapabilityResponse(RuntimeContract):
    ok: bool
    sessionId: str
    capability: dict[str, Any]


@dataclass(frozen=True, slots=True)
class RuntimeMessagePayload(RuntimeContract):
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class RuntimeMessageExecutionPolicy(RuntimeContract):
    modelRoute: RuntimeModelRoute
    thinkingLevelIntent: ThinkingLevelIntent | None = None
    thinkingCapabilityOverride: dict[str, Any] | None = None
    enabledTools: tuple[str, ...] = ()
    debugModeEnabled: bool | None = None
    requestOptions: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeRunStartRequest(RuntimeContract):
    thread_id: str
    message: RuntimeMessagePayload
    policy: RuntimeMessageExecutionPolicy
    agent_id: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeRunStreamRequest(RuntimeContract):
    run_id: str


@dataclass(frozen=True, slots=True)
class RuntimeRunCancelRequest(RuntimeContract):
    run_id: str


@dataclass(frozen=True, slots=True)
class RuntimeRunView(RuntimeContract):
    runId: str
    threadId: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    startedAt: datetime | None = None
    terminalAt: datetime | None = None
    cancelRequested: bool = False
    requestedThinkingLevel: ThinkingLevelIntent | None = None
    appliedThinkingLevel: ThinkingLevelIntent | None = None
    thinkingCapabilitySnapshot: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class RuntimeRunStartResponse(RuntimeContract):
    ok: bool
    run: RuntimeRunView
    assistantMessageId: str
    stream: dict[str, Any] = field(default_factory=dict)
    cancel: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeRunCancelResponse(RuntimeContract):
    ok: bool
    run: RuntimeRunView
    cancelAccepted: bool


@dataclass(frozen=True, slots=True)
class RuntimeScaffold(RuntimeContract):
    protocol: str
    stage: str
    supported_methods: tuple[str, ...]
    default_agent: str
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

    def build_agents_list_response(self) -> RuntimeAgentsListResponse:
        return RuntimeAgentsListResponse(
            ok=True,
            directoryVersion=self.agent_directory_version,
            defaultAgentId=self.default_agent,
            agents=self.agent_directory,
        )

    def build_thread_create_response(
        self,
        *,
        thread: RuntimeThreadRecord,
    ) -> RuntimeThreadCreateResponse:
        entry = self._get_agent_directory_entry(thread.bound_agent_id)
        return RuntimeThreadCreateResponse(
            ok=True,
            threadId=thread.thread_id,
            boundAgent=self._get_bound_agent_view(thread.bound_agent_id),
            createdAt=thread.created_at,
            updatedAt=thread.updated_at,
            recommendedTools=entry.recommendedTools,
            capabilities={
                "tools": {
                    "selectionMode": "recommendation-only",
                    "recommendedTools": list(entry.recommendedTools),
                }
            },
        )

    def build_capabilities_version(self) -> str:
        return f"capabilities:{self.agent_directory_version}:{self.tool_directory_version}"

    def build_thread_get_response(
        self,
        *,
        thread: RuntimeThreadRecord,
    ) -> RuntimeThreadGetResponse:
        entry = self._get_agent_directory_entry(thread.bound_agent_id)
        toolset_name = self._get_agent_toolset_name(thread.bound_agent_id)
        return RuntimeThreadGetResponse(
            ok=True,
            threadId=thread.thread_id,
            boundAgent=self._get_bound_agent_view(thread.bound_agent_id),
            createdAt=thread.created_at,
            updatedAt=thread.updated_at,
            capabilitiesVersion=self.build_capabilities_version(),
            tools=self._get_tool_catalog(toolset_name),
            recommendedTools=entry.recommendedTools,
            toolSelectionMode="recommendation-only",
            latestRunId=thread.last_run_id,
        )

    def build_capabilities_response(
        self,
        *,
        thread: RuntimeThreadRecord,
    ) -> RuntimeCapabilitiesResponse:
        thread_response = self.build_thread_get_response(thread=thread)
        return RuntimeCapabilitiesResponse(
            ok=thread_response.ok,
            sessionId=thread_response.threadId,
            boundAgent=thread_response.boundAgent,
            capabilitiesVersion=thread_response.capabilitiesVersion,
            tools=thread_response.tools,
            recommendedTools=thread_response.recommendedTools,
            toolSelectionMode=thread_response.toolSelectionMode,
        )

    def build_thinking_capability_response(
        self,
        *,
        session_id: str,
        capability: dict[str, Any],
    ) -> RuntimeThinkingCapabilityResponse:
        return RuntimeThinkingCapabilityResponse(
            ok=True,
            sessionId=session_id,
            capability=dict(capability),
        )

    def build_run_view(self, *, run: RuntimeRunRecord) -> RuntimeRunView:
        requested_thinking_level = run.metadata.get("requestedThinkingLevel")
        applied_thinking_level = run.metadata.get("appliedThinkingLevel")
        thinking_capability_snapshot = run.metadata.get("thinkingCapabilitySnapshot")
        return RuntimeRunView(
            runId=run.run_id,
            threadId=run.thread_id,
            status=run.status,
            createdAt=run.created_at,
            updatedAt=run.updated_at,
            startedAt=run.started_at,
            terminalAt=run.terminal_at,
            cancelRequested=run.cancel_requested,
            requestedThinkingLevel=normalize_thinking_level_intent(requested_thinking_level),
            appliedThinkingLevel=normalize_thinking_level_intent(applied_thinking_level),
            thinkingCapabilitySnapshot=(
                dict(thinking_capability_snapshot)
                if isinstance(thinking_capability_snapshot, dict)
                else None
            ),
        )

    def build_run_start_response(self, *, run: RuntimeRunRecord) -> RuntimeRunStartResponse:
        return RuntimeRunStartResponse(
            ok=True,
            run=self.build_run_view(run=run),
            assistantMessageId=f"{run.run_id}:assistant",
            stream={
                "method": RUN_STREAM_METHOD,
                "body": {"runId": run.run_id},
            },
            cancel={
                "method": RUN_CANCEL_METHOD,
                "body": {"runId": run.run_id},
            },
        )

    def build_run_cancel_response(
        self,
        *,
        run: RuntimeRunRecord,
        cancel_accepted: bool,
    ) -> RuntimeRunCancelResponse:
        return RuntimeRunCancelResponse(
            ok=True,
            run=self.build_run_view(run=run),
            cancelAccepted=cancel_accepted,
        )

    def supports_agent(self, agent_name: str) -> bool:
        return agent_name in self.bound_agent_views

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

    def diagnostics_summary(self) -> dict[str, Any]:
        summary = {
            "chat_runtime_registered": True,
            "chat_protocol": self.protocol,
            "chat_runtime_path": self.transport.get("root_path", "/"),
            "supported_methods": list(self.supported_methods),
            "chat_runtime_stage": self.stage,
            "session_store_type": self.session_store_type,
            "current_stage_supports_agents_list": AGENTS_LIST_METHOD in self.supported_methods,
            "current_stage_supports_thread_create": THREAD_CREATE_METHOD in self.supported_methods,
            "current_stage_supports_thread_get": THREAD_GET_METHOD in self.supported_methods,
            "current_stage_supports_run_start": RUN_START_METHOD in self.supported_methods,
            "current_stage_supports_run_stream": RUN_STREAM_METHOD in self.supported_methods,
            "current_stage_supports_run_cancel": RUN_CANCEL_METHOD in self.supported_methods,
            "current_stage_supports_capabilities_get": CAPABILITIES_GET_METHOD in self.supported_methods,
            "current_stage_supports_thinking_capability_get": THINKING_CAPABILITY_GET_METHOD in self.supported_methods,
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
            AGENTS_LIST_METHOD,
            THREAD_CREATE_METHOD,
            THREAD_GET_METHOD,
            RUN_START_METHOD,
            RUN_STREAM_METHOD,
            RUN_CANCEL_METHOD,
            CAPABILITIES_GET_METHOD,
            THINKING_CAPABILITY_GET_METHOD,
        ),
        default_agent=resolved_agent_registry.get_default().name,
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
