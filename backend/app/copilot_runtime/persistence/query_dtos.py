"""DTOs for persisted chat history queries."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, TypeAlias

from pydantic import ConfigDict, Field

from app.copilot_runtime.contracts import RuntimeContract
from app.copilot_runtime.pydantic_contracts import RuntimeContractModel

HISTORY_QUERY_DTO_VERSION = "chat-history-v1"

JsonObject: TypeAlias = dict[str, Any]


class PersistedHistoryReadModel(RuntimeContractModel, RuntimeContract):
    """Shared strict Pydantic base for persisted history read models."""

    model_config = ConfigDict(
        arbitrary_types_allowed=True,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and key in self.to_dict()

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]


class PersistedThreadSummaryDTO(PersistedHistoryReadModel):
    threadId: str
    boundAgentId: str
    title: str | None
    titleSource: str | None
    summary: str | None
    summarySource: str | None
    createdAt: datetime
    updatedAt: datetime
    lastActivityAt: datetime | None = None
    lastRunId: str | None = None
    lastRunStatus: str | None = None
    lastUserMessagePreview: str | None = None
    lastAssistantMessagePreview: str | None = None
    driftSummary: JsonObject | None = None


class PersistedThreadListResponse(PersistedHistoryReadModel):
    ok: bool
    threads: tuple[PersistedThreadSummaryDTO, ...] = ()
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedRunSummaryDTO(PersistedHistoryReadModel):
    runId: str
    threadId: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    startedAt: datetime | None = None
    terminalAt: datetime | None = None
    resolvedModelId: str | None = None
    requestedMessageText: str | None = None
    assistantText: str | None = None


class PersistedTimelineMessageItemDTO(PersistedHistoryReadModel):
    kind: Literal["user_message", "assistant_message", "reasoning_block"]
    runId: str
    threadId: str
    sequenceStart: int
    sequenceEnd: int
    createdAt: str
    endedAt: str | None = None
    text: str
    role: str | None = None
    structuredPayload: JsonObject | None = None


class PersistedToolCallPhaseDTO(PersistedHistoryReadModel):
    phase: str
    sequence: int
    createdAt: str
    title: str | None = None
    summary: str | None = None
    inputSummary: str | None = None
    resultSummary: str | None = None
    errorSummary: str | None = None
    formRequest: JsonObject | None = None


class PersistedToolCallBlockDTO(PersistedHistoryReadModel):
    kind: Literal["tool_call_block"] = "tool_call_block"
    runId: str
    threadId: str
    toolCallId: str
    toolId: str | None = None
    sequenceStart: int
    sequenceEnd: int
    createdAt: str
    title: str | None = None
    summary: str | None = None
    inputSummary: str | None = None
    resultSummary: str | None = None
    errorSummary: str | None = None
    formRequest: JsonObject | None = None
    phases: tuple[PersistedToolCallPhaseDTO, ...] = ()


class PersistedDiagnosticBlockDTO(PersistedHistoryReadModel):
    kind: Literal["diagnostic_block"] = "diagnostic_block"
    runId: str
    threadId: str
    sequenceStart: int
    sequenceEnd: int
    createdAt: str
    code: str | None = None
    message: str | None = None
    stage: str | None = None
    details: JsonObject | None = None


class PersistedTerminalStateDTO(PersistedHistoryReadModel):
    status: str
    eventType: str | None = None
    assistantText: str | None = None
    payload: JsonObject = Field(default_factory=dict)
    endedAt: str | None = None
    failureCode: str | None = None
    failureMessage: str | None = None
    cancelReason: str | None = None


class PersistedTerminalBlockDTO(PersistedTerminalStateDTO):
    kind: Literal["terminal_block"] = "terminal_block"
    runId: str
    threadId: str
    sequenceStart: int
    sequenceEnd: int
    createdAt: str


PersistedTimelineItemDTO: TypeAlias = Annotated[
    PersistedTimelineMessageItemDTO
    | PersistedToolCallBlockDTO
    | PersistedDiagnosticBlockDTO
    | PersistedTerminalBlockDTO,
    Field(discriminator="kind"),
]


class PersistedThreadModelSnapshotDTO(PersistedHistoryReadModel):
    selectedModelRoute: JsonObject
    resolvedModelRoute: JsonObject
    resolvedModelId: str | None = None
    requestedThinkingSelection: JsonObject | None = None
    appliedThinkingSelection: JsonObject | None = None
    thinkingCapabilityOverride: JsonObject | None = None
    thinkingLevelIntent: str | None = None
    debugModeEnabled: bool | None = None


class PersistedThreadToolsSnapshotDTO(PersistedHistoryReadModel):
    enabledToolIds: tuple[str, ...] = ()
    resolvedToolIds: tuple[str, ...] = ()


class PersistedThreadConfigurationSnapshotDTO(PersistedHistoryReadModel):
    runId: str | None = None
    modelSnapshot: PersistedThreadModelSnapshotDTO | None = None
    toolsSnapshot: PersistedThreadToolsSnapshotDTO | None = None


class PersistedThreadDetailResponse(PersistedHistoryReadModel):
    ok: bool
    thread: PersistedThreadSummaryDTO
    timelineItems: tuple[PersistedTimelineItemDTO, ...] = ()
    runSummaries: tuple[PersistedRunSummaryDTO, ...] = ()
    latestConfigurationSnapshot: PersistedThreadConfigurationSnapshotDTO | None = None
    availabilityDrift: JsonObject | None = None
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedRunEventDTO(PersistedHistoryReadModel):
    sequence: int
    eventType: str
    createdAt: datetime
    payload: JsonObject = Field(default_factory=dict)
    toolCallId: str | None = None
    toolId: str | None = None
    phase: str | None = None
    isRedacted: bool = False
    redactionVersion: int = 1


class PersistedRequestMessageSnapshotDTO(PersistedHistoryReadModel):
    role: str
    content: str
    structuredPayload: JsonObject | None = None


class PersistedRunHistoricalSnapshotDTO(PersistedHistoryReadModel):
    requestMessage: PersistedRequestMessageSnapshotDTO
    selectedModelRoute: JsonObject
    resolvedModelRoute: JsonObject
    resolvedModelId: str | None = None
    requestedThinkingSelection: JsonObject | None = None
    appliedThinkingSelection: JsonObject | None = None
    thinkingCapabilitySnapshot: JsonObject | None = None
    thinkingSeriesDecision: JsonObject | None = None
    reasoningSuppressionBasis: JsonObject | None = None
    enabledToolIds: tuple[str, ...] = ()
    resolvedToolIds: tuple[str, ...] = ()
    requestOptions: JsonObject = Field(default_factory=dict)
    debugModeEnabled: bool | None = None


class PersistedRunReplayResponse(PersistedHistoryReadModel):
    ok: bool
    run: PersistedRunSummaryDTO
    historicalSnapshot: PersistedRunHistoricalSnapshotDTO | None = None
    orderedEvents: tuple[PersistedRunEventDTO, ...] = ()
    toolCallBlocks: tuple[PersistedToolCallBlockDTO, ...] = ()
    diagnosticBlocks: tuple[PersistedDiagnosticBlockDTO, ...] = ()
    terminalState: PersistedTerminalStateDTO | None = None
    availabilityInterpretation: JsonObject | None = None
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedThreadDeleteResponse(PersistedHistoryReadModel):
    ok: bool
    threadId: str
    deletedAt: datetime
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedThreadRenameResponse(PersistedHistoryReadModel):
    ok: bool
    thread: PersistedThreadSummaryDTO
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedThreadDuplicateResponse(PersistedHistoryReadModel):
    ok: bool
    thread: PersistedThreadSummaryDTO
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedDatabaseBackupResponse(PersistedHistoryReadModel):
    ok: bool
    databasePath: str
    backupPath: str
    createdAt: datetime
    version: str = HISTORY_QUERY_DTO_VERSION


class PersistedDatabaseRestoreResponse(PersistedHistoryReadModel):
    ok: bool
    databasePath: str
    sourcePath: str
    restoredAt: datetime
    version: str = HISTORY_QUERY_DTO_VERSION


__all__ = [
    "HISTORY_QUERY_DTO_VERSION",
    "PersistedDatabaseBackupResponse",
    "PersistedDatabaseRestoreResponse",
    "PersistedDiagnosticBlockDTO",
    "PersistedHistoryReadModel",
    "PersistedRequestMessageSnapshotDTO",
    "PersistedRunEventDTO",
    "PersistedRunHistoricalSnapshotDTO",
    "PersistedRunReplayResponse",
    "PersistedRunSummaryDTO",
    "PersistedTerminalBlockDTO",
    "PersistedTerminalStateDTO",
    "PersistedThreadConfigurationSnapshotDTO",
    "PersistedThreadDeleteResponse",
    "PersistedThreadDetailResponse",
    "PersistedThreadDuplicateResponse",
    "PersistedThreadListResponse",
    "PersistedThreadModelSnapshotDTO",
    "PersistedThreadRenameResponse",
    "PersistedThreadSummaryDTO",
    "PersistedThreadToolsSnapshotDTO",
    "PersistedTimelineItemDTO",
    "PersistedTimelineMessageItemDTO",
    "PersistedToolCallBlockDTO",
    "PersistedToolCallPhaseDTO",
]
