"""DTOs for persisted chat history queries."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.copilot_runtime.contracts import RuntimeContract

HISTORY_QUERY_DTO_VERSION = "chat-history-v1"


@dataclass(frozen=True, slots=True)
class PersistedThreadSummaryDTO(RuntimeContract):
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
    driftSummary: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class PersistedThreadListResponse(RuntimeContract):
    ok: bool
    threads: tuple[PersistedThreadSummaryDTO, ...] = ()
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedRunSummaryDTO(RuntimeContract):
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


@dataclass(frozen=True, slots=True)
class PersistedThreadDetailResponse(RuntimeContract):
    ok: bool
    thread: PersistedThreadSummaryDTO
    timelineItems: tuple[dict[str, Any], ...] = ()
    runSummaries: tuple[PersistedRunSummaryDTO, ...] = ()
    latestConfigurationSnapshot: dict[str, Any] | None = None
    availabilityDrift: dict[str, Any] | None = None
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedRunEventDTO(RuntimeContract):
    sequence: int
    eventType: str
    createdAt: datetime
    payload: dict[str, Any] = field(default_factory=dict)
    toolCallId: str | None = None
    toolId: str | None = None
    phase: str | None = None
    isRedacted: bool = False
    redactionVersion: int = 1


@dataclass(frozen=True, slots=True)
class PersistedRunReplayResponse(RuntimeContract):
    ok: bool
    run: PersistedRunSummaryDTO
    historicalSnapshot: dict[str, Any] | None = None
    orderedEvents: tuple[PersistedRunEventDTO, ...] = ()
    toolCallBlocks: tuple[dict[str, Any], ...] = ()
    diagnosticBlocks: tuple[dict[str, Any], ...] = ()
    terminalState: dict[str, Any] | None = None
    availabilityInterpretation: dict[str, Any] | None = None
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedThreadDeleteResponse(RuntimeContract):
    ok: bool
    threadId: str
    deletedAt: datetime
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedThreadRenameResponse(RuntimeContract):
    ok: bool
    thread: PersistedThreadSummaryDTO
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedThreadDuplicateResponse(RuntimeContract):
    ok: bool
    thread: PersistedThreadSummaryDTO
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedThreadPurgeResponse(RuntimeContract):
    ok: bool
    threadId: str
    purgedAt: datetime
    deletedAt: datetime | None = None
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedDatabaseBackupResponse(RuntimeContract):
    ok: bool
    databasePath: str
    backupPath: str
    createdAt: datetime
    version: str = HISTORY_QUERY_DTO_VERSION


@dataclass(frozen=True, slots=True)
class PersistedDatabaseRestoreResponse(RuntimeContract):
    ok: bool
    databasePath: str
    sourcePath: str
    restoredAt: datetime
    version: str = HISTORY_QUERY_DTO_VERSION


__all__ = [
    "HISTORY_QUERY_DTO_VERSION",
    "PersistedDatabaseBackupResponse",
    "PersistedDatabaseRestoreResponse",
    "PersistedRunEventDTO",
    "PersistedRunReplayResponse",
    "PersistedRunSummaryDTO",
    "PersistedThreadDeleteResponse",
    "PersistedThreadDetailResponse",
    "PersistedThreadDuplicateResponse",
    "PersistedThreadListResponse",
    "PersistedThreadPurgeResponse",
    "PersistedThreadRenameResponse",
    "PersistedThreadSummaryDTO",
]
