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
TOOL_APPROVAL_SUBMIT_METHOD = "tool/approval/submit"
CAPABILITIES_GET_METHOD = "capabilities/get"
THINKING_CAPABILITY_GET_METHOD = "thinking/capability/get"
THINKING_CAPABILITY_SCHEMA_VERSION = "canonical-thinking-capability-v2"
DEFAULT_RUNTIME_PROTOCOL = "single-endpoint"
DEFAULT_RUNTIME_STAGE = "phase3-run-bridge"
DEFAULT_TRANSPORT = {
    "root_path": "/",
    "method": "POST",
}


ThinkingLevelIntent = Literal["off", "auto", "low", "medium", "high", "xhigh"]
ThinkingSeriesValueType = Literal["code", "budget", "fixed"]
COMPAT_THINKING_SELECTION_SERIES = "compat-discrete-selection-v1"
_THINKING_LEVEL_VALUES = frozenset({"off", "auto", "low", "medium", "high", "xhigh"})
_BUDGET_VALUE_MODES = frozenset({"off", "dynamic", "budget"})
THINKING_LEVEL_INTENTS = _THINKING_LEVEL_VALUES


def normalize_thinking_level_intent(value: Any) -> ThinkingLevelIntent | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized not in THINKING_LEVEL_INTENTS:
        return None
    return cast(ThinkingLevelIntent, normalized)


class RuntimeContract:
    def to_dict(self) -> dict[str, Any]:
        return cast(dict[str, Any], _jsonable(asdict(cast(Any, self))))


@dataclass(frozen=True, slots=True)
class RuntimeThinkingValue(RuntimeContract):
    valueType: ThinkingSeriesValueType
    code: str | None = None
    mode: str | None = None
    budgetTokens: int | None = None
    labelZh: str | None = None

    def to_legacy_level_intent(self) -> ThinkingLevelIntent | None:
        if self.valueType != "code" or self.code not in _THINKING_LEVEL_VALUES:
            return None
        return cast(ThinkingLevelIntent, self.code)

    def suppression_marker(self) -> str | None:
        if self.valueType == "code":
            return self.code
        if self.valueType == "budget":
            return self.mode
        if self.valueType == "fixed":
            return self.code or "fixed"
        return None


@dataclass(frozen=True, slots=True, init=False)
class RuntimeThinkingSelection(RuntimeContract):
    series: str
    value: RuntimeThinkingValue

    def __init__(
        self,
        *,
        series: str,
        value: RuntimeThinkingValue | None = None,
        mode: str | None = None,
        level: ThinkingLevelIntent | None = None,
        budgetTokens: int | None = None,
        labelZh: str | None = None,
    ) -> None:
        normalized_series = series.strip()
        if normalized_series == "":
            raise ValueError("RuntimeThinkingSelection.series must be non-empty.")
        normalized_value = value or _build_runtime_thinking_value_from_legacy(
            mode=mode,
            level=level,
            budget_tokens=budgetTokens,
            label_zh=labelZh,
        )
        if normalized_value is None:
            raise ValueError("RuntimeThinkingSelection requires a valid series value.")
        object.__setattr__(self, "series", normalized_series)
        object.__setattr__(self, "value", normalized_value)

    @classmethod
    def from_legacy_level_intent(
        cls,
        value: ThinkingLevelIntent | None,
        *,
        series: str = COMPAT_THINKING_SELECTION_SERIES,
    ) -> RuntimeThinkingSelection | None:
        if value is None:
            return None
        return cls(series=series, level=value, labelZh=value)

    def to_legacy_level_intent(self) -> ThinkingLevelIntent | None:
        return self.value.to_legacy_level_intent()

    @property
    def mode(self) -> str | None:
        if self.value.valueType == "budget":
            return "budget"
        if self.value.valueType in {"code", "fixed"}:
            return "preset"
        return None

    @property
    def level(self) -> ThinkingLevelIntent | None:
        return self.to_legacy_level_intent()

    @property
    def budgetTokens(self) -> int | None:
        return self.value.budgetTokens if self.value.valueType == "budget" else None


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
    capabilitySchemaVersion: str = THINKING_CAPABILITY_SCHEMA_VERSION
    capability: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RuntimeMessagePayload(RuntimeContract):
    role: str
    content: str


@dataclass(frozen=True, slots=True)
class RuntimeMessageExecutionPolicy(RuntimeContract):
    modelRoute: RuntimeModelRoute
    thinkingSelection: RuntimeThinkingSelection | None = None
    thinkingCapabilityOverride: dict[str, Any] | None = None
    enabledTools: tuple[str, ...] = ()
    debugModeEnabled: bool | None = None
    requestOptions: dict[str, Any] = field(default_factory=dict)

    def resolve_thinking_selection(self) -> RuntimeThinkingSelection | None:
        return self.thinkingSelection

    def resolve_thinking_level_intent(self) -> ThinkingLevelIntent | None:
        selection = self.resolve_thinking_selection()
        return None if selection is None else selection.to_legacy_level_intent()


@dataclass(frozen=True, slots=True)
class RuntimeToolApprovalSubmitRequest(RuntimeContract):
    run_id: str
    tool_call_id: str
    decision: str
    user_feedback: str | None = None


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
    requestedThinkingSelection: RuntimeThinkingSelection | None = None
    appliedThinkingSelection: RuntimeThinkingSelection | None = None
    thinkingCapabilitySnapshot: dict[str, Any] | None = None
    thinkingSeriesDecision: dict[str, Any] | None = None
    reasoningSuppressionBasis: dict[str, Any] | None = None

    @property
    def requestedThinkingLevel(self) -> ThinkingLevelIntent | None:
        if self.requestedThinkingSelection is None:
            return None
        return self.requestedThinkingSelection.to_legacy_level_intent()

    @property
    def appliedThinkingLevel(self) -> ThinkingLevelIntent | None:
        if self.appliedThinkingSelection is None:
            return None
        return self.appliedThinkingSelection.to_legacy_level_intent()


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
            capabilitySchemaVersion=THINKING_CAPABILITY_SCHEMA_VERSION,
            capability=dict(capability),
        )

    def build_run_view(self, *, run: RuntimeRunRecord) -> RuntimeRunView:
        request_policy = run.request.policy
        request_policy_selection = _resolve_policy_thinking_selection(request_policy)

        requested_thinking_selection = _coerce_runtime_thinking_selection(
            run.metadata.get("requestedThinkingSelection")
        ) or request_policy_selection

        applied_thinking_selection = _coerce_runtime_thinking_selection(
            run.metadata.get("appliedThinkingSelection")
        )

        resolved_thinking_capability_snapshot = _coerce_mapping_dict(
            run.metadata.get("thinkingCapabilitySnapshot")
        )
        thinking_series_decision = _coerce_mapping_dict(
            run.metadata.get("thinkingSeriesDecision")
        ) or _coerce_mapping_dict(run.metadata.get("thinkingSelectionResult"))
        reasoning_suppression_basis = _coerce_mapping_dict(run.metadata.get("reasoningSuppressionBasis"))
        return RuntimeRunView(
            runId=run.run_id,
            threadId=run.thread_id,
            status=run.status,
            createdAt=run.created_at,
            updatedAt=run.updated_at,
            startedAt=run.started_at,
            terminalAt=run.terminal_at,
            cancelRequested=run.cancel_requested,
            requestedThinkingSelection=requested_thinking_selection,
            appliedThinkingSelection=applied_thinking_selection,
            thinkingCapabilitySnapshot=resolved_thinking_capability_snapshot,
            thinkingSeriesDecision=thinking_series_decision,
            reasoningSuppressionBasis=(
                reasoning_suppression_basis
                if reasoning_suppression_basis is not None
                else _build_reasoning_suppression_basis(
                    capability=resolved_thinking_capability_snapshot,
                    applied_selection=applied_thinking_selection,
                )
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
            "current_stage_supports_tool_approval_submit": TOOL_APPROVAL_SUBMIT_METHOD in self.supported_methods,
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
            TOOL_APPROVAL_SUBMIT_METHOD,
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



def _resolve_policy_thinking_selection(policy: Any) -> RuntimeThinkingSelection | None:
    resolver = getattr(policy, "resolve_thinking_selection", None)
    if callable(resolver):
        return _coerce_runtime_thinking_selection(resolver())
    return _coerce_runtime_thinking_selection(
        getattr(policy, "thinkingSelection", None)
    ) or _coerce_runtime_thinking_selection(getattr(policy, "thinking_selection", None))



def _resolve_policy_thinking_level_intent(policy: Any) -> ThinkingLevelIntent | None:
    selection = _resolve_policy_thinking_selection(policy)
    return None if selection is None else selection.to_legacy_level_intent()



def _coerce_runtime_thinking_selection(value: Any) -> RuntimeThinkingSelection | None:
    if isinstance(value, RuntimeThinkingSelection):
        return value
    if value is None:
        return None

    if isinstance(value, dict):
        series = value.get("series")
        raw_selection_value = value.get("value")
    else:
        series = getattr(value, "series", None)
        raw_selection_value = getattr(value, "value", None)

    if not isinstance(series, str) or series.strip() == "":
        return None

    selection_value = _coerce_runtime_thinking_value(raw_selection_value)
    if selection_value is not None:
        return RuntimeThinkingSelection(series=series.strip(), value=selection_value)

    if isinstance(value, dict):
        mode = value.get("mode")
        level = value.get("level")
        budget_tokens = value.get("budgetTokens")
    else:
        mode = getattr(value, "mode", None)
        level = getattr(value, "level", None)
        budget_tokens = getattr(value, "budgetTokens", getattr(value, "budget_tokens", None))

    normalized_mode = mode.strip() if isinstance(mode, str) and mode.strip() != "" else None
    normalized_level = (
        cast(ThinkingLevelIntent, level)
        if isinstance(level, str) and level in _THINKING_LEVEL_VALUES
        else None
    )
    normalized_budget_tokens = (
        budget_tokens
        if isinstance(budget_tokens, int) and not isinstance(budget_tokens, bool) and budget_tokens >= 0
        else None
    )
    if normalized_mode == "budget" and normalized_budget_tokens is not None:
        return RuntimeThinkingSelection(
            series=series.strip(),
            value=RuntimeThinkingValue(
                valueType="budget",
                mode="budget",
                budgetTokens=normalized_budget_tokens,
            ),
        )
    if normalized_level is not None:
        return RuntimeThinkingSelection(
            series=series.strip(),
            value=RuntimeThinkingValue(
                valueType="code",
                code=normalized_level,
                labelZh=normalized_level,
            ),
        )
    return None



def _coerce_runtime_thinking_value(value: Any) -> RuntimeThinkingValue | None:
    if isinstance(value, RuntimeThinkingValue):
        return value
    if isinstance(value, dict):
        value_type = value.get("valueType")
        code = value.get("code")
        mode = value.get("mode")
        budget_tokens = value.get("budgetTokens")
        label_zh = value.get("labelZh")
    else:
        value_type = getattr(value, "valueType", getattr(value, "value_type", None))
        code = getattr(value, "code", None)
        mode = getattr(value, "mode", None)
        budget_tokens = getattr(value, "budgetTokens", getattr(value, "budget_tokens", None))
        label_zh = getattr(value, "labelZh", getattr(value, "label_zh", None))

    normalized_label = label_zh.strip() if isinstance(label_zh, str) and label_zh.strip() != "" else None
    if value_type == "code":
        if not isinstance(code, str) or code.strip() == "":
            return None
        return RuntimeThinkingValue(
            valueType="code",
            code=code.strip(),
            labelZh=normalized_label,
        )
    if value_type == "budget":
        normalized_mode = mode.strip() if isinstance(mode, str) and mode.strip() in _BUDGET_VALUE_MODES else None
        normalized_budget_tokens = (
            budget_tokens
            if isinstance(budget_tokens, int) and not isinstance(budget_tokens, bool) and budget_tokens >= 0
            else None
        )
        if normalized_mode is None:
            return None
        if normalized_mode == "budget" and normalized_budget_tokens is None:
            return None
        return RuntimeThinkingValue(
            valueType="budget",
            mode=normalized_mode,
            budgetTokens=normalized_budget_tokens,
            labelZh=normalized_label,
        )
    if value_type == "fixed":
        normalized_code = code.strip() if isinstance(code, str) and code.strip() != "" else "fixed"
        if normalized_code != "fixed":
            return None
        return RuntimeThinkingValue(
            valueType="fixed",
            code="fixed",
            labelZh=normalized_label,
        )
    return None



def _build_runtime_thinking_value_from_legacy(
    *,
    mode: str | None,
    level: ThinkingLevelIntent | None,
    budget_tokens: int | None,
    label_zh: str | None,
) -> RuntimeThinkingValue | None:
    normalized_label = label_zh.strip() if isinstance(label_zh, str) and label_zh.strip() != "" else None
    normalized_mode = mode.strip() if isinstance(mode, str) and mode.strip() != "" else None
    if normalized_mode == "budget":
        if budget_tokens is None or budget_tokens < 0:
            return None
        return RuntimeThinkingValue(
            valueType="budget",
            mode="budget",
            budgetTokens=budget_tokens,
            labelZh=normalized_label or str(budget_tokens),
        )
    if level is not None:
        return RuntimeThinkingValue(
            valueType="code",
            code=level,
            labelZh=normalized_label or level,
        )
    return None



def _coerce_mapping_dict(value: Any) -> dict[str, Any] | None:
    return dict(value) if isinstance(value, dict) else None



def _build_reasoning_suppression_basis(
    *,
    capability: dict[str, Any] | None,
    applied_selection: RuntimeThinkingSelection | None = None,
    applied_thinking_level: ThinkingLevelIntent | None = None,
) -> dict[str, Any] | None:
    if capability is None and applied_selection is None and applied_thinking_level is None:
        return None

    capability_visibility = capability.get("visibility") if isinstance(capability, dict) else None
    reasoning_visibility = (
        capability_visibility.get("reasoning")
        if isinstance(capability_visibility, dict) and isinstance(capability_visibility.get("reasoning"), str)
        else "visible"
    )
    supports_suppression = (
        capability_visibility.get("supportsSuppression")
        if isinstance(capability_visibility, dict)
        and isinstance(capability_visibility.get("supportsSuppression"), bool)
        else True
    )
    resolved_applied_selection = applied_selection
    if resolved_applied_selection is None and applied_thinking_level is not None:
        resolved_applied_selection = RuntimeThinkingSelection.from_legacy_level_intent(applied_thinking_level)
    suppression_marker = (
        None
        if resolved_applied_selection is None
        else resolved_applied_selection.value.suppression_marker()
    )
    should_suppress = False
    source = "none"
    reason_code: str | None = None
    visibility_reason_codes = {
        "suppressed": "capability_visibility_suppressed",
        "hidden": "capability_visibility_hidden",
        "fixed-no-visible-trace": "capability_visibility_fixed_no_visible_trace",
    }
    if reasoning_visibility in visibility_reason_codes:
        should_suppress = True
        source = "capability-visibility"
        reason_code = visibility_reason_codes[reasoning_visibility]
    elif suppression_marker in {"off", "none", "disabled", "false"}:
        should_suppress = True
        source = "applied-selection"
        reason_code = "applied_selection_suppressed"

    return {
        "shouldSuppress": should_suppress,
        "source": source,
        "reasonCode": reason_code,
        "appliedThinkingSelection": (
            None if resolved_applied_selection is None else resolved_applied_selection.to_dict()
        ),
        "reasoningVisibility": reasoning_visibility,
        "supportsSuppression": supports_suppression,
        "capabilitySource": capability.get("source") if isinstance(capability, dict) else None,
        "capabilitySeries": capability.get("series") if isinstance(capability, dict) else None,
    }



def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value
