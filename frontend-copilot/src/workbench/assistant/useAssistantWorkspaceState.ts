import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'

import {
  createRuntimeThread,
  getRuntimeCapabilities,
  listRuntimeAgents,
  type RuntimeModelRoute,
  type RuntimeThinkingSelection,
} from '../../features/copilot/chat-contract'
import {
  deleteCopilotHistoryThread,
  duplicateCopilotHistoryThread,
  getCopilotHistoryRunReplay,
  getCopilotHistoryThreadDetail,
  listCopilotHistoryThreads,
  renameCopilotHistoryThread,
} from '../../features/copilot/history'
import { appendCopilotDebugLog, isCopilotDebugModeEnabled } from '../../features/copilot/debug-mode-log'
import {
  buildPersistedConversationFromHistory,
  getPersistedInlineFormRebuildability,
} from '../../features/copilot/persisted-history-view-model'
import { createComposerDraftFromPersistedHistoryRun } from '../../features/copilot/copilot-chat-helpers'
import {
  isCopilotThreadRuntimeControllerLruCandidate,
  syncCopilotThreadRuntimeControllerStateRecord,
  updateCopilotThreadRuntimeControllerStateRecord,
  type CopilotThreadRuntimeControllerState,
} from '../../features/copilot/thread-runtime-controller'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AgentType, AssistantSessionShell } from '../types'
import type { RuntimeCapabilitiesGetResponse } from '../../features/copilot/chat-contract'
import type {
  AssistantSessionContextMenuState,
  AssistantSessionDragState,
} from './assistant-session-list-helpers'
import {
  emptyAssistantAgentDirectoryState,
  formatAssistantWorkspaceError,
  isCopilotConnectableState,
  type AssistantAgentDirectoryState,
  type AssistantSessionListState,
} from './assistant-workspace-controller'
import {
  createAssistantSessionShellFromHistorySummary,
  applyAssistantSessionCapabilities,
  applyAssistantSessionHistoryDetail,
  applyAssistantSessionHistoryReplay,
  createAssistantSessionHistoryState,
  createAssistantSessionHistoryStateFromSessionShell,
  hasAssistantSessionHistoryReplayForRun,
  resolveAssistantSessionHistoryPersistableSelectedRunId,
  retryAssistantSessionCapabilitiesHydration,
  retryAssistantSessionHistoryDetail,
  retryAssistantSessionHistoryReplay,
  selectAssistantSessionHistoryRun,
  setAssistantSessionCapabilitiesHydrationError,
  setAssistantSessionCapabilitiesHydrationLoading,
  setAssistantSessionCapabilitiesHydrationReady,
  setAssistantSessionHistoryDetailError,
  setAssistantSessionHistoryDetailLoading,
  setAssistantSessionHistoryReplayError,
  setAssistantSessionHistoryReplayLoading,
  syncAssistantSessionHistorySummary,
  syncAssistantSessionShellBoundAgent,
  type AssistantSessionHistoryState,
} from './assistant-history-state'
import {
  loadAssistantWorkspaceShellState,
  persistAssistantWorkspaceShellState,
} from './assistant-workspace-shell-state'
import { createWindowMcpRegistryClient } from '../capabilities/mcp-registry-client'
import {
  type AssistantWorkspaceSessionStatus,
} from './assistant-workspace-session-controller'
import { useAssistantDirectoryState } from './useAssistantDirectoryState'
import { useAssistantSessionCreation } from './useAssistantSessionCreation'
import { useAssistantSessionInteractionState } from './useAssistantSessionInteractionState'
import { useAssistantSessionManagementState } from './state/useAssistantSessionManagementState'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

interface UseAssistantWorkspaceStateInput {
  bootstrap: CopilotBootstrapController
  language?: string
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeThread
  getCapabilities?: typeof getRuntimeCapabilities
  listHistoryThreads?: typeof listCopilotHistoryThreads
  getHistoryThreadDetail?: typeof getCopilotHistoryThreadDetail
  getHistoryRunReplay?: typeof getCopilotHistoryRunReplay
  renameHistoryThread?: typeof renameCopilotHistoryThread
  duplicateHistoryThread?: typeof duplicateCopilotHistoryThread
  deleteHistoryThread?: typeof deleteCopilotHistoryThread
  loadShellState?: typeof loadAssistantWorkspaceShellState
  persistShellState?: typeof persistAssistantWorkspaceShellState
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

interface UseAssistantWorkspaceStateResult {
  directoryState: AssistantAgentDirectoryState
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  activeSessionHistory: AssistantSessionHistoryState | null
  sessionHistoryById: Record<string, AssistantSessionHistoryState>
  runtimeControllerBySessionId: Record<string, CopilotThreadRuntimeControllerState>
  setRuntimeControllerBySessionId: Dispatch<SetStateAction<Record<string, CopilotThreadRuntimeControllerState>>>
  sessionListState: AssistantSessionListState
  sessionStatus: AssistantWorkspaceSessionStatus
  sessionError: string | null
  historyRestoreError: string | null
  createSessionLabel: string
  createSessionButtonDisabled: boolean
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
  sessionContextMenu: AssistantSessionContextMenuState | null
  renamingSessionId: string | null
  renamingValue: string
  deleteConfirmationSessionId: string | null
  sessionDragState: AssistantSessionDragState | null
  sessionListRef: MutableRefObject<HTMLUListElement | null>
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
  selectAgent: (agentId: string | null) => void
  handleCreateSession: () => Promise<void>
  retryActiveSessionHistoryLoad: () => void
  retrySessionHistoryLoadById: (sessionId: string) => void
  selectActiveSessionHistoryRun: (runId: string | null) => void
  selectSessionHistoryRunById: (sessionId: string, runId: string | null) => void
  handleActiveSessionRunSettled: (runId: string | null, sessionId: string | null) => void
  handleSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  handleSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  dismissSessionContextMenu: () => void
  selectSessionContextSubmenu: (sessionId: string, submenu: 'copy' | 'export' | null) => void
  requestSessionRename: (sessionId: string) => void
  updateSessionRenameValue: (value: string) => void
  commitSessionRename: () => void
  cancelSessionRename: () => void
  duplicateSession: (sessionId: string) => void
  requestSessionDelete: (sessionId: string) => void
  confirmSessionDelete: (sessionId: string) => void
  cancelSessionDelete: () => void
}

// ---------------------------------------------------------------------------
// Pure helpers (unchanged from original)
// ---------------------------------------------------------------------------

function summarizeAssistantHistoryStateForLog(
  historyState: AssistantSessionHistoryState | null | undefined,
): Record<string, unknown> {
  return {
    isPersistedThread: historyState?.isPersistedThread ?? null,
    detailStatus: historyState?.detailStatus ?? null,
    capabilitiesStatus: historyState?.capabilitiesStatus ?? null,
    replayStatus: historyState?.replayStatus ?? null,
    selectedRunId: historyState?.selectedRunId ?? null,
    runSummaryCount: historyState?.runSummaries.length ?? 0,
    timelineItemCount: historyState?.timelineItems.length ?? 0,
    replayRunId: historyState?.replay?.run.runId ?? null,
  }
}

function buildComposerDraftFromHistoryState(
  historyState: AssistantSessionHistoryState | undefined,
): ReturnType<typeof createComposerDraftFromPersistedHistoryRun> | null {
  if (historyState === undefined) {
    return null
  }

  const latestConfigurationSnapshot = historyState.latestConfigurationSnapshot
  const latestDraft = buildComposerDraftFromPersistedHistorySnapshot(latestConfigurationSnapshot)
  if (latestDraft === null) {
    return null
  }

  return latestDraft
}

function buildComposerDraftFromPersistedHistorySnapshot(
  latestConfigurationSnapshot: Record<string, unknown> | null,
): ReturnType<typeof createComposerDraftFromPersistedHistoryRun> | null {
  const modelSnapshot = isRecord(latestConfigurationSnapshot?.modelSnapshot)
    ? latestConfigurationSnapshot.modelSnapshot
    : null
  const toolsSnapshot = isRecord(latestConfigurationSnapshot?.toolsSnapshot)
    ? latestConfigurationSnapshot.toolsSnapshot
    : null

  if (modelSnapshot === null && toolsSnapshot === null) {
    return null
  }

  return createComposerDraftFromPersistedHistoryRun({
    selectedModelId: readOptionalString(modelSnapshot?.selectedModelId)
      ?? readOptionalString(modelSnapshot?.resolvedModelId),
    selectedModelRoute: asRuntimeModelRoute(modelSnapshot?.selectedModelRoute),
    appliedThinkingSelection: asRuntimeThinkingSelection(modelSnapshot?.appliedThinkingSelection)
      ?? asRuntimeThinkingSelection(modelSnapshot?.requestedThinkingSelection),
    enabledTools: readStringArray(toolsSnapshot?.enabledToolIds ?? toolsSnapshot?.resolvedToolIds),
    requestOptions: null,
  })
}

function isDefaultComposerDraft(draft: {
  messageText: string
  selectedModelId: string
  selectedModelRoute: RuntimeModelRoute | null
  thinkingSelection: RuntimeThinkingSelection | null
  enabledTools: readonly string[]
  requestOptionsText: string
}): boolean {
  return draft.messageText.trim() === ''
    && draft.selectedModelRoute === null
    && draft.thinkingSelection === null
    && draft.enabledTools.length === 0
    && draft.requestOptionsText.trim() === '{}'
}

function asRuntimeModelRoute(value: unknown): RuntimeModelRoute | null {
  return isRecord(value) ? ({ ...(value as Record<string, unknown>) } as unknown as RuntimeModelRoute) : null
}

function asRuntimeThinkingSelection(value: unknown): RuntimeThinkingSelection | null {
  return isRecord(value) ? ({ ...(value as Record<string, unknown>) } as unknown as RuntimeThinkingSelection) : null
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item !== 'string') {
      return []
    }

    const normalized = item.trim()
    return normalized === '' ? [] : [normalized]
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY = 10

function shouldApplyLiveCapabilitiesUpdate(input: {
  previousCapabilitiesVersion: string | null
  response: RuntimeCapabilitiesGetResponse
  previousSession: AssistantSessionShell | null
}): boolean {
  if (input.previousCapabilitiesVersion !== input.response.capabilitiesVersion) {
    return true
  }

  if (input.previousSession === null) {
    return true
  }

  const previousCapabilities = input.previousSession.capabilities
  if (previousCapabilities.toolSelectionMode !== input.response.toolSelectionMode) {
    return true
  }

  if (!haveSameOrderedStrings(previousCapabilities.recommendedToolsForAgent, input.response.recommendedTools)) {
    return true
  }

  return !haveSameToolDirectoryEntries(previousCapabilities.allAvailableTools, input.response.tools)
}

function haveSameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function haveSameToolDirectoryEntries(
  left: RuntimeCapabilitiesGetResponse['tools'],
  right: RuntimeCapabilitiesGetResponse['tools'],
): boolean {
  return left.length === right.length && left.every((tool, index) => haveSameToolDirectoryEntry(tool, right[index]))
}

function haveSameToolDirectoryEntry(
  left: RuntimeCapabilitiesGetResponse['tools'][number],
  right: RuntimeCapabilitiesGetResponse['tools'][number] | undefined,
): boolean {
  if (right === undefined) {
    return false
  }

  return left.toolId === right.toolId
    && left.kind === right.kind
    && left.availability === right.availability
    && left.displayName === right.displayName
    && left.description === right.description
    && left.prompt === right.prompt
    && left.displayNameZh === right.displayNameZh
    && left.displayNameEn === right.displayNameEn
    && left.descriptionZh === right.descriptionZh
    && left.descriptionEn === right.descriptionEn
    && haveSameToolGroup(left.group, right.group)
}

function haveSameToolGroup(
  left: RuntimeCapabilitiesGetResponse['tools'][number]['group'],
  right: RuntimeCapabilitiesGetResponse['tools'][number]['group'],
): boolean {
  if (left === right) {
    return true
  }

  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right
  }

  return left.id === right.id
    && left.label === right.label
    && left.labelZh === right.labelZh
    && left.labelEn === right.labelEn
    && left.order === right.order
    && left.sourceKind === right.sourceKind
}

function hasRebuildablePersistedConversation(
  historyState: AssistantSessionHistoryState | undefined,
  controllerState?: CopilotThreadRuntimeControllerState,
): boolean {
  if (
    historyState === undefined
    || historyState.isPersistedThread !== true
    || historyState.detailStatus !== 'ready'
  ) {
    return false
  }

  if (controllerState?.runState.phase === 'awaiting_input') {
    const hasPendingInlineForm = controllerState.runState.segments.some(
      (segment) => segment.kind === 'inline-form' && segment.formState === 'pending',
    )
    if (hasPendingInlineForm) {
      return getPersistedInlineFormRebuildability(historyState, {
        runId: controllerState.pendingHistorySyncRunId ?? controllerState.runState.runId,
      }).hasPendingInlineForm
    }
  }

  return buildPersistedConversationFromHistory(historyState).conversation.length > 0
}

function isAwaitingInputInlineFormLruCandidate(
  controllerState: CopilotThreadRuntimeControllerState,
  historyState: AssistantSessionHistoryState | undefined,
): boolean {
  if (
    controllerState.activeAbortController !== null
    || controllerState.runState.phase !== 'awaiting_input'
  ) {
    return false
  }

  const hasPendingInlineForm = controllerState.runState.segments.some(
    (segment) => segment.kind === 'inline-form' && segment.formState === 'pending',
  )
  if (!hasPendingInlineForm) {
    return false
  }

  return hasRebuildablePersistedConversation(historyState, controllerState)
}

function pruneCopilotThreadRuntimeControllers(input: {
  controllers: Record<string, CopilotThreadRuntimeControllerState>
  sessionHistoryById: Record<string, AssistantSessionHistoryState>
  activeSessionId: string | null
  maxControllerCount: number
}): {
  nextControllers: Record<string, CopilotThreadRuntimeControllerState>
  evictedSessionIds: string[]
} {
  const controllerEntries = Object.entries(input.controllers)
  if (controllerEntries.length <= input.maxControllerCount) {
    return {
      nextControllers: input.controllers,
      evictedSessionIds: [],
    }
  }

  const evictableSessionIds = controllerEntries
    .filter(([sessionId, controllerState]) => (
      sessionId !== input.activeSessionId
      && (
        (
          isCopilotThreadRuntimeControllerLruCandidate(controllerState)
          && hasRebuildablePersistedConversation(input.sessionHistoryById[sessionId], controllerState)
        )
        || isAwaitingInputInlineFormLruCandidate(controllerState, input.sessionHistoryById[sessionId])
      )
    ))
    .sort(([leftSessionId, leftControllerState], [rightSessionId, rightControllerState]) => {
      if (leftControllerState.lastAccessedAt !== rightControllerState.lastAccessedAt) {
        return leftControllerState.lastAccessedAt - rightControllerState.lastAccessedAt
      }
      return leftSessionId.localeCompare(rightSessionId)
    })
    .map(([sessionId]) => sessionId)
  const evictionCount = Math.min(
    controllerEntries.length - input.maxControllerCount,
    evictableSessionIds.length,
  )
  if (evictionCount <= 0) {
    return {
      nextControllers: input.controllers,
      evictedSessionIds: [],
    }
  }

  const evictedSessionIds = evictableSessionIds.slice(0, evictionCount)
  const nextControllers = { ...input.controllers }
  for (const sessionId of evictedSessionIds) {
    delete nextControllers[sessionId]
  }

  return {
    nextControllers,
    evictedSessionIds,
  }
}

// ---------------------------------------------------------------------------
// Shared constant (eliminates 11× duplicate string literal)
// ---------------------------------------------------------------------------

const HISTORY_SHELL_VERSION = 'history-shell'

// ---------------------------------------------------------------------------
// Types used by extracted history-restore helpers
// ---------------------------------------------------------------------------

interface HistoryRestoreContext {
  runtimeUrl: string
  restoreKey: string
  requestVersion: number
  liveSessionSelectionVersionAtRequest: number
  historyRestoreRetryKey: number
  cancelledRef: { current: boolean }
  isMountedRef: MutableRefObject<boolean>
  historyListRequestVersionRef: MutableRefObject<number>
  liveSessionSelectionVersionRef: MutableRefObject<number>
  restoredRuntimeUrlRef: MutableRefObject<string | null>
  provisionalEmptyRestoreKeyRef: MutableRefObject<string | null>
  persistedShellStateRef: MutableRefObject<ReturnType<typeof loadAssistantWorkspaceShellState>>
  sessionListStateRef: MutableRefObject<AssistantSessionListState>
  directoryAgentsRef: MutableRefObject<AssistantAgentDirectoryState['agents']>
  runtimeControllerBySessionIdRef: MutableRefObject<Record<string, CopilotThreadRuntimeControllerState>>
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
  listHistoryThreadsImpl: typeof listCopilotHistoryThreads
  setHistoryRestoreError: Dispatch<SetStateAction<string | null>>
  scheduleHistoryRestoreRetry: () => number | null
  clearHistoryRestoreRetry: () => void
  resetHistoryRestoreRetryBackoff: () => void
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  setSessionHistoryById: Dispatch<SetStateAction<Record<string, AssistantSessionHistoryState>>>
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
}

// ---------------------------------------------------------------------------
// Extracted history-restore helpers
// ---------------------------------------------------------------------------

function buildRestoredSessions(
  effectiveThreadSummaries: Array<{ threadId: string; title: string; updatedAt: string; boundAgentId: string }>,
  agentsAtRestoreApply: AssistantAgentDirectoryState['agents'],
  currentSessionsById: Map<string, AssistantSessionShell>,
): AssistantSessionShell[] {
  return effectiveThreadSummaries.map((summary) => {
    const restoredSession = createAssistantSessionShellFromHistorySummary({
      summary: summary as Parameters<typeof createAssistantSessionShellFromHistorySummary>[0]['summary'],
      agents: agentsAtRestoreApply,
    })
    const currentSession = currentSessionsById.get(summary.threadId)

    return currentSession !== undefined && currentSession.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION
      ? { ...restoredSession, capabilities: currentSession.capabilities }
      : restoredSession
  })
}

function resolveRestoreActiveSessionId(input: {
  persistedShellState: ReturnType<typeof loadAssistantWorkspaceShellState>
  restoredSessions: AssistantSessionShell[]
  restoredSessionIds: Set<string>
  shouldProtectUserLiveSelection: boolean
  currentSessionListState: AssistantSessionListState
  liveOnlySessions: AssistantSessionShell[]
}): { restoredActiveSessionId: string | null; preserveCurrentActiveLiveSession: boolean; currentActiveSessionIsLiveOnly: boolean } {
  const { persistedShellState, restoredSessions, restoredSessionIds, shouldProtectUserLiveSelection, currentSessionListState, liveOnlySessions } = input

  const preferredActiveSessionId = persistedShellState.selectedThreadId !== null
    && restoredSessions.some((se) => se.sessionId === persistedShellState.selectedThreadId)
    ? persistedShellState.selectedThreadId
    : restoredSessions[0]?.sessionId ?? null

  const mergedSessions = [...restoredSessions, ...liveOnlySessions]
  const currentActiveSession = currentSessionListState.activeSessionId === null
    ? null
    : currentSessionListState.sessions.find((se) => se.sessionId === currentSessionListState.activeSessionId) ?? null
  const currentActiveSessionIsLiveOnly = currentActiveSession !== null
    && currentActiveSession.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION
    && !restoredSessionIds.has(currentActiveSession.sessionId)
  const preserveCurrentActiveLiveSession = currentActiveSessionIsLiveOnly
    || (shouldProtectUserLiveSelection && currentActiveSession !== null && currentActiveSession.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION)

  const restoredActiveSessionId = preserveCurrentActiveLiveSession
    ? currentSessionListState.activeSessionId
    : preferredActiveSessionId
      ?? (currentSessionListState.activeSessionId !== null && mergedSessions.some((se) => se.sessionId === currentSessionListState.activeSessionId)
        ? currentSessionListState.activeSessionId
        : mergedSessions[0]?.sessionId ?? null)

  return { restoredActiveSessionId, preserveCurrentActiveLiveSession, currentActiveSessionIsLiveOnly }
}

/** Resolves a single history entry during restore – extracted to reduce cognitive complexity. */
function resolveRestoredHistoryEntry(params: {
  summary: { threadId: string; title: string; updatedAt: string; boundAgentId: string }
  current: Record<string, AssistantSessionHistoryState>
  restoredSessionsById: Map<string, AssistantSessionShell>
  restoredActiveSessionId: string | null
  runtimeControllerBySessionIdRef: MutableRefObject<Record<string, CopilotThreadRuntimeControllerState>>
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
}): AssistantSessionHistoryState {
  const { summary, current, restoredSessionsById, restoredActiveSessionId, runtimeControllerBySessionIdRef, appendWorkspaceDebugLog } = params
  const currentHistoryState = current[summary.threadId]
  const syncedHistoryState = currentHistoryState === undefined
    ? createAssistantSessionHistoryState(summary as Parameters<typeof createAssistantSessionHistoryState>[0], null)
    : syncAssistantSessionHistorySummary(currentHistoryState, summary as Parameters<typeof syncAssistantSessionHistorySummary>[1], null)
  const restoredSession = restoredSessionsById.get(summary.threadId)
  const shouldDefaultView = restoredActiveSessionId === summary.threadId
    && restoredSession?.capabilities.capabilitiesVersion === HISTORY_SHELL_VERSION
  const defaultedState = shouldDefaultView && syncedHistoryState.selectedRunId !== null
    ? selectAssistantSessionHistoryRun(syncedHistoryState, null)
    : syncedHistoryState
  const shouldRestartCaps = currentHistoryState !== undefined
    && currentHistoryState.isPersistedThread !== true
    && restoredSession?.capabilities.capabilitiesVersion === HISTORY_SHELL_VERSION

  if (defaultedState !== syncedHistoryState) {
    const pendingHistorySyncRunId = shouldDefaultView
      ? runtimeControllerBySessionIdRef.current[summary.threadId]?.pendingHistorySyncRunId ?? null
      : null
    appendWorkspaceDebugLog('history-restore-defaulted-active-thread-view', {
      sessionId: summary.threadId,
      previousSelectedRunId: syncedHistoryState.selectedRunId,
      pendingHistorySyncRunId,
      reason: 'restore-active-thread-default-thread-view',
    })
  }

  return shouldRestartCaps
    ? { ...defaultedState, capabilitiesStatus: 'idle' as const, capabilitiesError: null }
    : defaultedState
}

function buildRestoreHistoryStateMap(params: {
  effectiveThreadSummaries: Array<{ threadId: string; title: string; updatedAt: string; boundAgentId: string }>
  current: Record<string, AssistantSessionHistoryState>
  restoredSessionsById: Map<string, AssistantSessionShell>
  restoredActiveSessionId: string | null
  runtimeControllerBySessionIdRef: MutableRefObject<Record<string, CopilotThreadRuntimeControllerState>>
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
}): Record<string, AssistantSessionHistoryState> {
  const { effectiveThreadSummaries, current } = params
  const nextState: Record<string, AssistantSessionHistoryState> = {}

  for (const summary of effectiveThreadSummaries) {
    nextState[summary.threadId] = resolveRestoredHistoryEntry({ summary, ...params })
  }

  for (const [sessionId, historyState] of Object.entries(current)) {
    if (nextState[sessionId] === undefined) {
      nextState[sessionId] = historyState
    }
  }

  return nextState
}

interface HistoryRestoreSuccessInput {
  ctx: HistoryRestoreContext
  historyResult: { ok: true; threads: Array<{ threadId: string; title: string | null; updatedAt: string; boundAgentId: string }> }
  persistedShellState: ReturnType<typeof loadAssistantWorkspaceShellState>
}

function applyHistoryRestoreSuccess(input: HistoryRestoreSuccessInput) {
  const { ctx, historyResult, persistedShellState } = input

  const isProvisionalEmptyRestore = historyResult.threads.length === 0
  const cachedThreadSummaries = isProvisionalEmptyRestore ? persistedShellState.threadSummaries : []
  const usingCache = isProvisionalEmptyRestore && cachedThreadSummaries.length > 0
  const effectiveThreadSummaries = usingCache ? cachedThreadSummaries : historyResult.threads
  const currentSessionsById = new Map(
    ctx.sessionListStateRef.current.sessions.map((se) => [se.sessionId, se] as const),
  )
  const agentsAtRestoreApply = ctx.directoryAgentsRef.current
  const restoredSessions = buildRestoredSessions(effectiveThreadSummaries as Parameters<typeof buildRestoredSessions>[0], agentsAtRestoreApply, currentSessionsById)
  const restoredSessionsById = new Map(restoredSessions.map((se) => [se.sessionId, se] as const))
  const restoredSessionIds = new Set(restoredSessions.map((se) => se.sessionId))
  const currentSessionListState = ctx.sessionListStateRef.current
  const liveOnlySessions = currentSessionListState.sessions.filter((se) => !restoredSessionIds.has(se.sessionId))
  const shouldProtectUserLiveSelection = ctx.liveSessionSelectionVersionRef.current !== ctx.liveSessionSelectionVersionAtRequest

  const { restoredActiveSessionId, preserveCurrentActiveLiveSession, currentActiveSessionIsLiveOnly } = resolveRestoreActiveSessionId({
    persistedShellState, restoredSessions, restoredSessionIds, shouldProtectUserLiveSelection, currentSessionListState, liveOnlySessions,
  })

  const mergedSessions = [...restoredSessions, ...liveOnlySessions]
  const restoreSelectionSummary: Record<string, unknown> = {
    previousActiveSessionId: currentSessionListState.activeSessionId,
    nextActiveSessionId: restoredActiveSessionId,
    activeSessionChanged: currentSessionListState.activeSessionId !== restoredActiveSessionId,
    liveOnlySessionCount: liveOnlySessions.length,
    mergedSessionCount: mergedSessions.length,
    currentActiveSessionIsLiveOnly,
    preserveCurrentActiveLiveSession,
    usingPersistedThreadSummaryCache: usingCache,
  }

  ctx.setSessionListState({ sessions: mergedSessions, activeSessionId: restoredActiveSessionId })
  ctx.setSessionHistoryById((current) => buildRestoreHistoryStateMap({
    effectiveThreadSummaries: effectiveThreadSummaries as Parameters<typeof buildRestoreHistoryStateMap>[0]['effectiveThreadSummaries'],
    current, restoredSessionsById, restoredActiveSessionId,
    runtimeControllerBySessionIdRef: ctx.runtimeControllerBySessionIdRef,
    appendWorkspaceDebugLog: ctx.appendWorkspaceDebugLog,
  }))

  const restoredActiveSession = restoredActiveSessionId === null
    ? null
    : restoredSessionsById.get(restoredActiveSessionId) ?? currentSessionsById.get(restoredActiveSessionId) ?? null
  const selectedAgentSyncApplied = !shouldProtectUserLiveSelection && restoredActiveSession !== null
  if (selectedAgentSyncApplied) {
    ctx.setSelectedAgentId(restoredActiveSession.boundAgent.id)
  }

  const logPayload = {
    runtimeUrl: ctx.runtimeUrl, restoreKey: ctx.restoreKey, requestVersion: ctx.requestVersion,
    agentCountAtApply: agentsAtRestoreApply.length, sessionCountBeforeRestore: currentSessionsById.size,
    restoredSessionCount: restoredSessions.length,
    shouldProtectUserLiveSelection, selectedAgentSyncApplied,
    selectedAgentSyncSessionId: restoredActiveSession?.sessionId ?? null,
    selectedAgentSyncAgentId: restoredActiveSession?.boundAgent.id ?? null,
    ...(restoreSelectionSummary ?? {}),
  }

  if (isProvisionalEmptyRestore) {
    ctx.restoredRuntimeUrlRef.current = null
    ctx.provisionalEmptyRestoreKeyRef.current = ctx.restoreKey
    ctx.setHistoryRestoreError(null)
    const retryDelayMs = ctx.scheduleHistoryRestoreRetry()
    ctx.appendWorkspaceDebugLog('history-restore-request-empty-provisional', {
      ...logPayload, threadCount: 0, cachedThreadSummaryCount: cachedThreadSummaries.length,
      usingPersistedThreadSummaryCache: usingCache, retryDelayMs,
    })
    return
  }

  ctx.provisionalEmptyRestoreKeyRef.current = null
  ctx.appendWorkspaceDebugLog('history-restore-request-succeeded', {
    ...logPayload, threadCount: historyResult.threads.length, isEmpty: false,
    usingPersistedThreadSummaryCache: usingCache, effectiveThreadSummaryCount: effectiveThreadSummaries.length,
  })

  ctx.clearHistoryRestoreRetry()
  ctx.resetHistoryRestoreRetryBackoff()
  ctx.setHistoryRestoreError(null)
  ctx.restoredRuntimeUrlRef.current = ctx.restoreKey
}

async function performHistoryRestore(ctx: HistoryRestoreContext) {
  const persistedShellState = ctx.persistedShellStateRef.current

  ctx.appendWorkspaceDebugLog('history-restore-request-started', {
    runtimeUrl: ctx.runtimeUrl,
    restoreKey: ctx.restoreKey,
    requestVersion: ctx.requestVersion,
    retryKey: ctx.historyRestoreRetryKey,
    liveSessionSelectionVersionAtRequest: ctx.liveSessionSelectionVersionAtRequest,
    persistedSelectedThreadId: persistedShellState.selectedThreadId,
    persistedSelectedRunCount: Object.keys(persistedShellState.selectedRunIdByThreadId).length,
    currentActiveSessionId: ctx.sessionListStateRef.current.activeSessionId,
  })

  try {
    const historyResult = await ctx.listHistoryThreadsImpl()

    if (ctx.cancelledRef.current || !ctx.isMountedRef.current || ctx.historyListRequestVersionRef.current !== ctx.requestVersion) {
      ctx.appendWorkspaceDebugLog('history-restore-request-discarded', {
        runtimeUrl: ctx.runtimeUrl, restoreKey: ctx.restoreKey, requestVersion: ctx.requestVersion,
        latestRequestVersion: ctx.historyListRequestVersionRef.current,
        discardReason: ctx.cancelledRef.current ? 'effect-cleanup' : !ctx.isMountedRef.current ? 'unmounted' : 'stale-request-version',
        ok: historyResult.ok, threadCount: historyResult.ok ? historyResult.threads.length : null,
        error: historyResult.ok ? null : historyResult.error,
      })
      return
    }

    if (!historyResult.ok) {
      ctx.restoredRuntimeUrlRef.current = null
      ctx.provisionalEmptyRestoreKeyRef.current = null
      ctx.setHistoryRestoreError(historyResult.error)
      const retryDelayMs = ctx.scheduleHistoryRestoreRetry()
      ctx.appendWorkspaceDebugLog('history-restore-request-failed', {
        runtimeUrl: ctx.runtimeUrl, restoreKey: ctx.restoreKey, requestVersion: ctx.requestVersion,
        failureSource: 'result', error: historyResult.error, retryDelayMs,
      })
      return
    }

    applyHistoryRestoreSuccess({ ctx, historyResult, persistedShellState })
  } catch (error) {
    if (ctx.cancelledRef.current || !ctx.isMountedRef.current || ctx.historyListRequestVersionRef.current !== ctx.requestVersion) {
      return
    }

    const formattedError = formatAssistantWorkspaceError(error)
    ctx.restoredRuntimeUrlRef.current = null
    ctx.provisionalEmptyRestoreKeyRef.current = null
    ctx.setHistoryRestoreError(formattedError)
    const retryDelayMs = ctx.scheduleHistoryRestoreRetry()
    ctx.appendWorkspaceDebugLog('history-restore-request-failed', {
      runtimeUrl: ctx.runtimeUrl, restoreKey: ctx.restoreKey, requestVersion: ctx.requestVersion,
      failureSource: 'exception', error: formattedError, retryDelayMs,
    })
  }
}

// ---------------------------------------------------------------------------
// Replay request params – extracted to reduce complexity in replay effect
// ---------------------------------------------------------------------------

interface ReplayRequestParams {
  replayRequestRunId: string | null
  tracksSelectedRunReplay: boolean
}

function resolveReplayRequestParams(input: {
  historyState: AssistantSessionHistoryState | undefined
  selectedRunId: string | null
  pendingHandoffRunId: string | null
}): ReplayRequestParams {
  const { historyState, selectedRunId, pendingHandoffRunId } = input

  if (historyState === undefined || historyState.detailStatus !== 'ready') {
    return { replayRequestRunId: null, tracksSelectedRunReplay: false }
  }

  const shouldRequestSelectedRunReplay =
    selectedRunId !== null
    && historyState.replayStatus === 'idle'
    && !hasAssistantSessionHistoryReplayForRun(historyState, selectedRunId)

  const shouldRequestPendingHandoffReplay =
    pendingHandoffRunId !== null
    && pendingHandoffRunId !== selectedRunId
    && !hasAssistantSessionHistoryReplayForRun(historyState, pendingHandoffRunId)

  const replayRequestRunId = shouldRequestSelectedRunReplay
    ? selectedRunId
    : shouldRequestPendingHandoffReplay
      ? pendingHandoffRunId
      : null

  return {
    replayRequestRunId,
    tracksSelectedRunReplay: replayRequestRunId !== null && replayRequestRunId === selectedRunId,
  }
}

// ---------------------------------------------------------------------------
// Sub-hook: History restore + retry scheduling
// ---------------------------------------------------------------------------

interface UseAssistantHistoryRestoreInput {
  bootstrap: CopilotBootstrapController
  isMountedRef: MutableRefObject<boolean>
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
  listHistoryThreadsImpl: typeof listCopilotHistoryThreads
  sessionListStateRef: MutableRefObject<AssistantSessionListState>
  directoryAgentsRef: MutableRefObject<AssistantAgentDirectoryState['agents']>
  runtimeControllerBySessionIdRef: MutableRefObject<Record<string, CopilotThreadRuntimeControllerState>>
  persistedShellStateRef: MutableRefObject<ReturnType<typeof loadAssistantWorkspaceShellState>>
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  setSessionHistoryById: Dispatch<SetStateAction<Record<string, AssistantSessionHistoryState>>>
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
}

function useAssistantHistoryRestore({
  bootstrap,
  isMountedRef,
  appendWorkspaceDebugLog,
  listHistoryThreadsImpl,
  sessionListStateRef,
  directoryAgentsRef,
  runtimeControllerBySessionIdRef,
  persistedShellStateRef,
  setSessionListState,
  setSessionHistoryById,
  setSelectedAgentId,
}: UseAssistantHistoryRestoreInput) {
  const restoredRuntimeUrlRef = useRef<string | null>(null)
  const provisionalEmptyRestoreKeyRef = useRef<string | null>(null)
  const historyListRequestVersionRef = useRef(0)
  const historyRestoreRetryTimerRef = useRef<number | null>(null)
  const [historyRestoreRetryKey, setHistoryRestoreRetryKey] = useState(0)
  const [historyRestoreError, setHistoryRestoreError] = useState<string | null>(null)
  const historyRestoreRetryAttemptRef = useRef(0)
  const liveSessionSelectionVersionRef = useRef(0)

  const clearHistoryRestoreRetry = useCallback(() => {
    if (historyRestoreRetryTimerRef.current !== null) {
      window.clearTimeout(historyRestoreRetryTimerRef.current)
      historyRestoreRetryTimerRef.current = null
    }
  }, [])

  const resetHistoryRestoreRetryBackoff = useCallback(() => {
    historyRestoreRetryAttemptRef.current = 0
  }, [])

  const scheduleHistoryRestoreRetry = useCallback(() => {
    if (historyRestoreRetryTimerRef.current !== null) { return null }
    const retryDelayMs = Math.min(1_000 * 2 ** historyRestoreRetryAttemptRef.current, 15_000)
    historyRestoreRetryAttemptRef.current += 1
    appendWorkspaceDebugLog('history-restore-retry-scheduled', {
      retryAttempt: historyRestoreRetryAttemptRef.current, retryDelayMs,
    })
    historyRestoreRetryTimerRef.current = window.setTimeout(() => {
      historyRestoreRetryTimerRef.current = null
      if (!isMountedRef.current) { return }
      setHistoryRestoreRetryKey((c) => c + 1)
    }, retryDelayMs)
    return retryDelayMs
  }, [appendWorkspaceDebugLog, isMountedRef])

  const markUserLiveSessionSelection = useCallback(() => {
    liveSessionSelectionVersionRef.current += 1
    appendWorkspaceDebugLog('live-session-selection-marked', {
      liveSessionSelectionVersion: liveSessionSelectionVersionRef.current,
      activeSessionId: sessionListStateRef.current.activeSessionId,
    })
  }, [appendWorkspaceDebugLog, sessionListStateRef])

  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state)) { return }
    const runtimeUrl = bootstrap.state.runtimeUrl
    const restoreKey = `${runtimeUrl}:${historyRestoreRetryKey}`
    if (restoredRuntimeUrlRef.current === restoreKey || provisionalEmptyRestoreKeyRef.current === restoreKey) { return }

    const requestVersion = historyListRequestVersionRef.current + 1
    historyListRequestVersionRef.current = requestVersion
    const liveSessionSelectionVersionAtRequest = liveSessionSelectionVersionRef.current
    const cancelledRef = { current: false }

    const ctx: HistoryRestoreContext = {
      runtimeUrl, restoreKey, requestVersion, liveSessionSelectionVersionAtRequest,
      historyRestoreRetryKey, cancelledRef, isMountedRef,
      historyListRequestVersionRef, liveSessionSelectionVersionRef,
      restoredRuntimeUrlRef, provisionalEmptyRestoreKeyRef,
      persistedShellStateRef, sessionListStateRef, directoryAgentsRef,
      runtimeControllerBySessionIdRef, appendWorkspaceDebugLog,
      listHistoryThreadsImpl, setHistoryRestoreError,
      scheduleHistoryRestoreRetry, clearHistoryRestoreRetry, resetHistoryRestoreRetryBackoff,
      setSessionListState, setSessionHistoryById, setSelectedAgentId,
    }

    void performHistoryRestore(ctx)

    return () => { cancelledRef.current = true }
  }, [
    appendWorkspaceDebugLog, bootstrap.state, clearHistoryRestoreRetry, historyRestoreRetryKey,
    isMountedRef, listHistoryThreadsImpl, resetHistoryRestoreRetryBackoff,
    scheduleHistoryRestoreRetry, setSelectedAgentId, setSessionHistoryById, setSessionListState,
    persistedShellStateRef, sessionListStateRef, directoryAgentsRef, runtimeControllerBySessionIdRef,
  ])

  return {
    historyRestoreError,
    historyRestoreRetryKey,
    setHistoryRestoreRetryKey,
    markUserLiveSessionSelection,
  }
}

// ---------------------------------------------------------------------------
// Sub-hook: History hydration effects (capabilities + live sync + detail + replay)
// ---------------------------------------------------------------------------

interface UseAssistantHistoryHydrationInput {
  bootstrap: CopilotBootstrapController
  isMountedRef: MutableRefObject<boolean>
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
  getCapabilitiesImpl: typeof getRuntimeCapabilities
  getHistoryThreadDetailImpl: typeof getCopilotHistoryThreadDetail
  getHistoryRunReplayImpl: typeof getCopilotHistoryRunReplay
  sessionShell: AssistantSessionShell | null
  sessionHistoryById: Record<string, AssistantSessionHistoryState>
  runtimeControllerBySessionId: Record<string, CopilotThreadRuntimeControllerState>
  setSessionHistoryById: Dispatch<SetStateAction<Record<string, AssistantSessionHistoryState>>>
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  setRuntimeControllerBySessionId: Dispatch<SetStateAction<Record<string, CopilotThreadRuntimeControllerState>>>
  sessionListStateRef: MutableRefObject<AssistantSessionListState>
  liveCapabilitiesVersionBySessionIdRef: MutableRefObject<Map<string, string>>
}

// This hook bundles four tightly-related effects (capabilities hydration,
// live capabilities sync, history detail, and history replay) that share
// the same state dependencies. Splitting further would scatter the shared
// input interface and parameter lists across multiple small hooks without
// reducing actual cognitive complexity.
// eslint-disable-next-line max-lines-per-function
function useAssistantHistoryHydration({
  bootstrap,
  isMountedRef,
  appendWorkspaceDebugLog,
  getCapabilitiesImpl,
  getHistoryThreadDetailImpl,
  getHistoryRunReplayImpl,
  sessionShell,
  sessionHistoryById,
  runtimeControllerBySessionId,
  setSessionHistoryById,
  setSessionListState,
  setRuntimeControllerBySessionId,
  sessionListStateRef,
  liveCapabilitiesVersionBySessionIdRef,
}: UseAssistantHistoryHydrationInput) {
  const historyCapabilitiesRequestVersionRef = useRef<Record<string, number>>({})
  const historyDetailRequestVersionRef = useRef<Record<string, number>>({})
  const historyReplayRequestVersionRef = useRef<Record<string, number>>({})

  // --- Capabilities hydration ---
  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state) || sessionShell === null) { return }
    if (sessionShell.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION) { return }

    const sessionId = sessionShell.sessionId
    const historyState = sessionHistoryById[sessionId]
    if (historyState === undefined || historyState.isPersistedThread !== true || historyState.capabilitiesStatus !== 'idle') { return }

    const requestVersion = (historyCapabilitiesRequestVersionRef.current[sessionId] ?? 0) + 1
    historyCapabilitiesRequestVersionRef.current[sessionId] = requestVersion

    setSessionHistoryById((current) => ({
      ...current,
      [sessionId]: setAssistantSessionCapabilitiesHydrationLoading(current[sessionId] ?? historyState),
    }))
    appendWorkspaceDebugLog('history-capabilities-hydration-started', { sessionId, requestVersion, ...summarizeAssistantHistoryStateForLog(historyState) })

    void getCapabilitiesImpl({ runtimeUrl: bootstrap.state.runtimeUrl, sessionId })
      .then((response) => {
        if (!isMountedRef.current || historyCapabilitiesRequestVersionRef.current[sessionId] !== requestVersion) { return }
        appendWorkspaceDebugLog('history-capabilities-hydration-succeeded', { sessionId, requestVersion, capabilitiesVersion: response.capabilitiesVersion })
        setSessionListState((current) => ({
          ...current,
          sessions: current.sessions.map((se) => se.sessionId === sessionId ? applyAssistantSessionCapabilities(se, response) : se),
        }))
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionCapabilitiesHydrationReady(current[sessionId] ?? historyState),
        }))
      })
      .catch((error) => {
        if (!isMountedRef.current || historyCapabilitiesRequestVersionRef.current[sessionId] !== requestVersion) { return }
        const formattedError = formatAssistantWorkspaceError(error)
        appendWorkspaceDebugLog('history-capabilities-hydration-failed', { sessionId, requestVersion, error: formattedError })
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionCapabilitiesHydrationError(current[sessionId] ?? historyState, formattedError),
        }))
      })
  }, [appendWorkspaceDebugLog, bootstrap.state, getCapabilitiesImpl, isMountedRef, sessionHistoryById, sessionShell, setSessionHistoryById, setSessionListState])

  // --- Live capabilities sync via MCP ---
  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state)) { return }
    const runtimeUrl = bootstrap.state.runtimeUrl
    const registryClient = createWindowMcpRegistryClient()
    const requestVersionBySessionId = new Map<string, number>()

    return registryClient.subscribe((event) => {
      if (event.kind !== 'snapshot') { return }
      const liveSessions = sessionListStateRef.current.sessions.filter((se) => se.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION)

      for (const liveSession of liveSessions) {
        const nextRequestVersion = (requestVersionBySessionId.get(liveSession.sessionId) ?? 0) + 1
        requestVersionBySessionId.set(liveSession.sessionId, nextRequestVersion)

        void getCapabilitiesImpl({ runtimeUrl, sessionId: liveSession.sessionId }).then((response) => {
          if (requestVersionBySessionId.get(liveSession.sessionId) !== nextRequestVersion) { return }
          const previousSession = sessionListStateRef.current.sessions.find((se) => se.sessionId === liveSession.sessionId) ?? null
          if (previousSession === null || previousSession.capabilities.capabilitiesVersion === HISTORY_SHELL_VERSION) { return }
          const previousCapsVersion = liveCapabilitiesVersionBySessionIdRef.current.get(liveSession.sessionId) ?? previousSession.capabilities.capabilitiesVersion
          if (!shouldApplyLiveCapabilitiesUpdate({ previousCapabilitiesVersion: previousCapsVersion, response, previousSession })) { return }
          liveCapabilitiesVersionBySessionIdRef.current.set(liveSession.sessionId, response.capabilitiesVersion)
          setSessionListState((current) => ({
            ...current,
            sessions: current.sessions.map((se) => se.sessionId === liveSession.sessionId ? applyAssistantSessionCapabilities(se, response) : se),
          }))
        }).catch(() => { /* Keep previous live capabilities until later MCP snapshot refresh. */ })
      }
    })
  }, [bootstrap.state, getCapabilitiesImpl, setSessionListState, sessionListStateRef, liveCapabilitiesVersionBySessionIdRef])

  // --- History detail ---
  useEffect(() => {
    if (sessionShell === null) { return }
    const sessionId = sessionShell.sessionId
    const historyState = sessionHistoryById[sessionId]
    if (historyState === undefined || historyState.isPersistedThread !== true || historyState.detailStatus !== 'idle') { return }

    const requestVersion = (historyDetailRequestVersionRef.current[sessionId] ?? 0) + 1
    historyDetailRequestVersionRef.current[sessionId] = requestVersion

    setSessionHistoryById((current) => ({ ...current, [sessionId]: setAssistantSessionHistoryDetailLoading(current[sessionId] ?? historyState) }))
    appendWorkspaceDebugLog('history-detail-request-started', { sessionId, requestVersion, ...summarizeAssistantHistoryStateForLog(historyState) })

    void (async () => {
      const detailResult = await getHistoryThreadDetailImpl(sessionId)
      if (!isMountedRef.current || historyDetailRequestVersionRef.current[sessionId] !== requestVersion) { return }
      if (!detailResult.ok) {
        appendWorkspaceDebugLog('history-detail-request-failed', { sessionId, requestVersion, error: detailResult.error })
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionHistoryDetailError(current[sessionId] ?? historyState, detailResult.error),
        }))
        return
      }
      appendWorkspaceDebugLog('history-detail-request-succeeded', {
        sessionId, requestVersion, selectedRunId: historyState.selectedRunId,
        runSummaryCount: detailResult.runSummaries.length, timelineItemCount: detailResult.timelineItems.length,
      })
      setSessionHistoryById((current) => {
        const nextHistoryState = applyAssistantSessionHistoryDetail(current[sessionId] ?? historyState, detailResult)
        setRuntimeControllerBySessionId((rc) => {
          const cs = rc[sessionId]
          if (cs === undefined || !isDefaultComposerDraft(cs.composerDraft)) { return rc }
          const draft = buildComposerDraftFromHistoryState(nextHistoryState)
          return draft === null ? rc : { ...rc, [sessionId]: { ...cs, composerDraft: draft } }
        })
        return { ...current, [sessionId]: nextHistoryState }
      })
      setSessionListState((current) => ({
        ...current,
        sessions: current.sessions.map((se) => se.sessionId === sessionId
          ? { ...se, title: detailResult.thread.title ?? se.title, updatedAt: detailResult.thread.updatedAt }
          : se),
      }))
    })()
  }, [appendWorkspaceDebugLog, getHistoryThreadDetailImpl, isMountedRef, sessionHistoryById, sessionShell, setSessionHistoryById, setSessionListState, setRuntimeControllerBySessionId])

  // --- History replay ---
  useEffect(() => {
    if (sessionShell === null) { return }
    const sessionId = sessionShell.sessionId
    const historyState = sessionHistoryById[sessionId]
    const selectedRunId = historyState?.selectedRunId ?? null
    const pendingHandoffRunId = runtimeControllerBySessionId[sessionId]?.pendingHistorySyncRunId ?? null

    const { replayRequestRunId, tracksSelectedRunReplay } = resolveReplayRequestParams({ historyState, selectedRunId, pendingHandoffRunId })
    if (historyState === undefined || historyState.detailStatus !== 'ready' || replayRequestRunId === null) { return }

    const requestVersion = (historyReplayRequestVersionRef.current[sessionId] ?? 0) + 1
    historyReplayRequestVersionRef.current[sessionId] = requestVersion

    if (tracksSelectedRunReplay) {
      setSessionHistoryById((current) => ({
        ...current,
        [sessionId]: setAssistantSessionHistoryReplayLoading(current[sessionId] ?? historyState, replayRequestRunId),
      }))
    }
    appendWorkspaceDebugLog('history-replay-request-started', {
      sessionId, requestVersion, selectedRunId, replayRequestRunId, pendingHandoffRunId,
      tracksSelectedRunReplay, ...summarizeAssistantHistoryStateForLog(historyState),
    })

    void (async () => {
      const replayResult = await getHistoryRunReplayImpl(replayRequestRunId)
      if (!isMountedRef.current || historyReplayRequestVersionRef.current[sessionId] !== requestVersion) { return }
      if (!replayResult.ok) {
        appendWorkspaceDebugLog('history-replay-request-failed', {
          sessionId, requestVersion, selectedRunId, replayRequestRunId, pendingHandoffRunId,
          tracksSelectedRunReplay, error: replayResult.error,
        })
        if (tracksSelectedRunReplay) {
          setSessionHistoryById((current) => ({
            ...current,
            [sessionId]: setAssistantSessionHistoryReplayError(current[sessionId] ?? historyState, replayResult.error, replayRequestRunId),
          }))
        }
        return
      }
      appendWorkspaceDebugLog('history-replay-request-succeeded', {
        sessionId, requestVersion, selectedRunId, replayRequestRunId, pendingHandoffRunId,
        tracksSelectedRunReplay, replayRunId: replayResult.run.runId,
        orderedEventCount: replayResult.orderedEvents.length,
        toolCallBlockCount: replayResult.toolCallBlocks.length,
        diagnosticBlockCount: replayResult.diagnosticBlocks.length,
      })
      setSessionHistoryById((current) => ({
        ...current,
        [sessionId]: applyAssistantSessionHistoryReplay(current[sessionId] ?? historyState, replayResult),
      }))
    })()
  }, [appendWorkspaceDebugLog, getHistoryRunReplayImpl, isMountedRef, runtimeControllerBySessionId, sessionHistoryById, sessionShell, setSessionHistoryById])
}

// ---------------------------------------------------------------------------
// Sub-hook: Runtime controller state management
// ---------------------------------------------------------------------------

interface UseAssistantWorkspaceRuntimeStateInput {
  sessionListState: AssistantSessionListState
  sessionHistoryById: Record<string, AssistantSessionHistoryState>
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
}

function useAssistantWorkspaceRuntimeState({
  sessionListState,
  sessionHistoryById,
  appendWorkspaceDebugLog,
}: UseAssistantWorkspaceRuntimeStateInput) {
  const [runtimeControllerBySessionId, setRuntimeControllerBySessionId] = useState<Record<string, CopilotThreadRuntimeControllerState>>({})
  const runtimeControllerBySessionIdRef = useRef<Record<string, CopilotThreadRuntimeControllerState>>({})

  useEffect(() => { runtimeControllerBySessionIdRef.current = runtimeControllerBySessionId }, [runtimeControllerBySessionId])

  const runtimeControllerRegistrySessionKey = sessionListState.sessions.map((se) => se.sessionId).join('::')

  useEffect(() => {
    setRuntimeControllerBySessionId((c) => syncCopilotThreadRuntimeControllerStateRecord(c, sessionListState.sessions))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session membership changes are intentionally keyed by the joined session id list.
  }, [runtimeControllerRegistrySessionKey])

  useEffect(() => {
    setRuntimeControllerBySessionId((current) => {
      const { nextControllers, evictedSessionIds } = pruneCopilotThreadRuntimeControllers({
        controllers: current, sessionHistoryById,
        activeSessionId: sessionListState.activeSessionId,
        maxControllerCount: COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY,
      })
      if (evictedSessionIds.length === 0) { return current }
      appendWorkspaceDebugLog('runtime-controller-lru-evicted', {
        activeSessionId: sessionListState.activeSessionId,
        maxControllerCount: COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY,
        controllerCountBefore: Object.keys(current).length,
        controllerCountAfter: Object.keys(nextControllers).length,
        evictedSessionIds,
      })
      return nextControllers
    })
  }, [appendWorkspaceDebugLog, sessionHistoryById, sessionListState.activeSessionId])

  const touchRuntimeController = useCallback((sessionId: string | null | undefined) => {
    const id = sessionId?.trim() ?? ''
    if (id === '') { return }
    setRuntimeControllerBySessionId((c) => updateCopilotThreadRuntimeControllerStateRecord(c, id, (cs) => cs))
  }, [])

  return { runtimeControllerBySessionId, setRuntimeControllerBySessionId, touchRuntimeController }
}

// ---------------------------------------------------------------------------
// Sub-hook: Session persistence callbacks (rename / duplicate / delete)
// ---------------------------------------------------------------------------

interface UseAssistantSessionPersistenceInput {
  appendWorkspaceDebugLog: (event: string, context: Record<string, unknown>) => void
  renameHistoryThreadImpl: typeof renameCopilotHistoryThread
  duplicateHistoryThreadImpl: typeof duplicateCopilotHistoryThread
  deleteHistoryThreadImpl: typeof deleteCopilotHistoryThread
  persistShellStateImpl: typeof persistAssistantWorkspaceShellState
  directoryAgentsRef: MutableRefObject<AssistantAgentDirectoryState['agents']>
  persistedShellStateRef: MutableRefObject<ReturnType<typeof loadAssistantWorkspaceShellState>>
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  setSessionHistoryById: Dispatch<SetStateAction<Record<string, AssistantSessionHistoryState>>>
  setRuntimeControllerBySessionId: Dispatch<SetStateAction<Record<string, CopilotThreadRuntimeControllerState>>>
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
}

function useAssistantSessionPersistence({
  appendWorkspaceDebugLog,
  renameHistoryThreadImpl,
  duplicateHistoryThreadImpl,
  deleteHistoryThreadImpl,
  persistShellStateImpl,
  directoryAgentsRef,
  persistedShellStateRef,
  setSessionListState,
  setSessionHistoryById,
  setRuntimeControllerBySessionId,
  setSelectedAgentId,
}: UseAssistantSessionPersistenceInput) {
  const renameSessionPersistence = useCallback(async (
    sessionId: string, nextTitle: string, sessionEntry: AssistantSessionShell,
  ) => {
    const result = await renameHistoryThreadImpl(sessionId, { title: nextTitle })
    if (!result.ok) {
      appendWorkspaceDebugLog('session-rename-failed', { sessionId, error: result.error })
      throw new Error(result.error)
    }
    const renamed = {
      ...createAssistantSessionShellFromHistorySummary({ summary: result.thread, agents: directoryAgentsRef.current }),
      capabilities: sessionEntry.capabilities,
    }
    appendWorkspaceDebugLog('session-rename-succeeded', { sessionId, nextTitle: result.thread.title, updatedAt: result.thread.updatedAt })
    setSessionListState((c) => ({
      ...c,
      sessions: c.sessions.map((s) => s.sessionId === sessionId ? renamed : s),
    }))
    setSessionHistoryById((c) => {
      const hs = c[sessionId]
      return hs === undefined ? c : { ...c, [sessionId]: { ...hs, summary: { ...result.thread } } }
    })
  }, [appendWorkspaceDebugLog, renameHistoryThreadImpl, setSessionHistoryById, setSessionListState, directoryAgentsRef])

  const duplicateSessionPersistence = useCallback(async (
    sessionId: string, sessionEntry: AssistantSessionShell,
  ) => {
    const result = await duplicateHistoryThreadImpl(sessionId)
    if (!result.ok) {
      appendWorkspaceDebugLog('session-duplicate-failed', { sessionId, sourceCapabilitiesVersion: sessionEntry.capabilities.capabilitiesVersion, error: result.error })
      throw new Error(result.error)
    }
    const dup = createAssistantSessionShellFromHistorySummary({ summary: result.thread, agents: directoryAgentsRef.current })
    appendWorkspaceDebugLog('session-duplicate-succeeded', { sessionId, duplicatedSessionId: dup.sessionId, duplicatedTitle: result.thread.title })
    setSessionListState((c) => ({
      sessions: [dup, ...c.sessions.filter((s) => s.sessionId !== dup.sessionId)],
      activeSessionId: dup.sessionId,
    }))
    setSessionHistoryById((c) => ({ ...c, [dup.sessionId]: createAssistantSessionHistoryState(result.thread, null) }))
    setSelectedAgentId(dup.boundAgent.id)
  }, [appendWorkspaceDebugLog, duplicateHistoryThreadImpl, setSelectedAgentId, setSessionHistoryById, setSessionListState, directoryAgentsRef])

  const deleteSessionPersistence = useCallback(async (
    sessionId: string, sessionEntry: AssistantSessionShell,
  ) => {
    const result = await deleteHistoryThreadImpl(sessionId)
    if (!result.ok) {
      appendWorkspaceDebugLog('session-delete-failed', { sessionId, sourceCapabilitiesVersion: sessionEntry.capabilities.capabilitiesVersion, error: result.error })
      throw new Error(result.error)
    }
    appendWorkspaceDebugLog('session-delete-succeeded', { sessionId, deletedAt: result.deletedAt })
    setSessionListState((c) => ({
      sessions: c.sessions.filter((s) => s.sessionId !== sessionId),
      activeSessionId: c.activeSessionId === sessionId ? null : c.activeSessionId,
    }))
    setSessionHistoryById((c) => {
      if (c[sessionId] === undefined) { return c }
      const ns = { ...c }; delete ns[sessionId]; return ns
    })
    setRuntimeControllerBySessionId((c) => {
      if (c[sessionId] === undefined) { return c }
      const ns = { ...c }; delete ns[sessionId]; return ns
    })
    const prev = persistedShellStateRef.current
    const nextRunIds = Object.fromEntries(Object.entries(prev.selectedRunIdByThreadId).filter(([tid]) => tid !== sessionId))
    const nextShell = {
      selectedThreadId: prev.selectedThreadId === sessionId ? null : prev.selectedThreadId,
      selectedRunIdByThreadId: nextRunIds,
      threadSummaries: prev.threadSummaries.filter((ts) => ts.threadId !== sessionId),
    }
    persistedShellStateRef.current = nextShell
    persistShellStateImpl(nextShell)
  }, [appendWorkspaceDebugLog, deleteHistoryThreadImpl, persistShellStateImpl, setSessionHistoryById, setSessionListState, setRuntimeControllerBySessionId, persistedShellStateRef])

  return { renameSessionPersistence, duplicateSessionPersistence, deleteSessionPersistence }
}

// ---------------------------------------------------------------------------
// Main hook
// ---------------------------------------------------------------------------

// This hook orchestrates multiple sub-hooks (directory, session creation, history
// restore/hydration, runtime controllers, persistence, interaction, management)
// and wires their outputs together.  Splitting the wiring further would scatter
// tightly-coupled state setters across many small hooks with long parameter
// lists, reducing readability without materially lowering complexity.
// eslint-disable-next-line max-lines-per-function
export function useAssistantWorkspaceState({
  bootstrap,
  language = 'zh-CN',
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeThread,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  listHistoryThreads: listHistoryThreadsImpl = listCopilotHistoryThreads,
  getHistoryThreadDetail: getHistoryThreadDetailImpl = getCopilotHistoryThreadDetail,
  getHistoryRunReplay: getHistoryRunReplayImpl = getCopilotHistoryRunReplay,
  renameHistoryThread: renameHistoryThreadImpl = renameCopilotHistoryThread,
  duplicateHistoryThread: duplicateHistoryThreadImpl = duplicateCopilotHistoryThread,
  deleteHistoryThread: deleteHistoryThreadImpl = deleteCopilotHistoryThread,
  loadShellState: loadShellStateImpl = loadAssistantWorkspaceShellState,
  persistShellState: persistShellStateImpl = persistAssistantWorkspaceShellState,
  initialDirectoryState = emptyAssistantAgentDirectoryState,
  initialSessionShell = null,
}: UseAssistantWorkspaceStateInput): UseAssistantWorkspaceStateResult {
  const persistedShellStateRef = useRef(loadShellStateImpl())
  const [sessionHistoryById, setSessionHistoryById] = useState<Record<string, AssistantSessionHistoryState>>({})
  const isMountedRef = useRef(true)
  const debugModeEnabled = isCopilotDebugModeEnabled(bootstrap.state)
  const debugModeEnabledRef = useRef(debugModeEnabled)
  const appendWorkspaceDebugLog = useCallback((event: string, context: Record<string, unknown> = {}) => {
    appendCopilotDebugLog(debugModeEnabledRef.current, 'assistant-workspace', event, context)
  }, [])

  useEffect(() => { debugModeEnabledRef.current = debugModeEnabled }, [debugModeEnabled])

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  // Directory
  const { directoryState, selectedAgent, selectAgent, setSelectedAgentId } = useAssistantDirectoryState({
    bootstrap, language, listAgents: listAgentsImpl, initialDirectoryState,
  })
  const directoryAgentsRef = useRef(initialDirectoryState.agents)
  useEffect(() => { directoryAgentsRef.current = directoryState.agents }, [directoryState.agents])

  // Session creation
  const {
    sessionListState, setSessionListState, sessionShell, sessionStatus, sessionError,
    createSessionLabel, createSessionButtonDisabled, activateSession, handleCreateSession: createSessionForSelectedAgent,
  } = useAssistantSessionCreation({
    bootstrap, language, selectedAgent, setSelectedAgentId,
    createSession: createSessionImpl, getCapabilities: getCapabilitiesImpl, initialSessionShell,
  })
  const sessionListStateRef = useRef(sessionListState)
  useEffect(() => { sessionListStateRef.current = sessionListState }, [sessionListState])

  const liveCapabilitiesVersionBySessionIdRef = useRef(new Map<string, string>())
  useEffect(() => {
    const next = new Map<string, string>()
    for (const se of sessionListState.sessions) {
      if (se.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION) {
        next.set(se.sessionId, se.capabilities.capabilitiesVersion)
      }
    }
    liveCapabilitiesVersionBySessionIdRef.current = next
  }, [sessionListState.sessions])

  // Runtime controllers
  const { runtimeControllerBySessionId, setRuntimeControllerBySessionId, touchRuntimeController } = useAssistantWorkspaceRuntimeState({
    sessionListState, sessionHistoryById, appendWorkspaceDebugLog,
  })
  const runtimeControllerBySessionIdRef = useRef<Record<string, CopilotThreadRuntimeControllerState>>({})
  useEffect(() => { runtimeControllerBySessionIdRef.current = runtimeControllerBySessionId }, [runtimeControllerBySessionId])

  // History restore
  const { historyRestoreError, historyRestoreRetryKey: _, setHistoryRestoreRetryKey, markUserLiveSessionSelection } = useAssistantHistoryRestore({
    bootstrap, isMountedRef, appendWorkspaceDebugLog, listHistoryThreadsImpl,
    sessionListStateRef, directoryAgentsRef, runtimeControllerBySessionIdRef, persistedShellStateRef,
    setSessionListState, setSessionHistoryById, setSelectedAgentId,
  })

  // History hydration
  useAssistantHistoryHydration({
    bootstrap, isMountedRef, appendWorkspaceDebugLog, getCapabilitiesImpl,
    getHistoryThreadDetailImpl, getHistoryRunReplayImpl, sessionShell,
    sessionHistoryById, runtimeControllerBySessionId,
    setSessionHistoryById, setSessionListState, setRuntimeControllerBySessionId,
    sessionListStateRef, liveCapabilitiesVersionBySessionIdRef,
  })

  // Session persistence
  const { renameSessionPersistence, duplicateSessionPersistence, deleteSessionPersistence } = useAssistantSessionPersistence({
    appendWorkspaceDebugLog, renameHistoryThreadImpl, duplicateHistoryThreadImpl, deleteHistoryThreadImpl,
    persistShellStateImpl, directoryAgentsRef, persistedShellStateRef,
    setSessionListState, setSessionHistoryById, setRuntimeControllerBySessionId, setSelectedAgentId,
  })

  // History callbacks
  const retrySessionHistoryLoad = useCallback((sessionId: string) => {
    setSessionHistoryById((current) => {
      const hs = current[sessionId]
      if (hs === undefined) { return current }
      const retryTarget = hs.detailStatus === 'error' ? 'detail'
        : hs.replayStatus === 'error' ? 'replay'
        : hs.capabilitiesStatus === 'error' ? 'capabilities'
        : 'none'
      const next = hs.detailStatus === 'error' ? retryAssistantSessionHistoryDetail(hs)
        : hs.replayStatus === 'error' ? retryAssistantSessionHistoryReplay(hs)
        : hs.capabilitiesStatus === 'error' ? retryAssistantSessionCapabilitiesHydration(hs)
        : hs
      appendWorkspaceDebugLog('session-history-retry-requested', { sessionId, retryTarget, ...summarizeAssistantHistoryStateForLog(hs) })
      return next === hs ? current : { ...current, [sessionId]: next }
    })
  }, [appendWorkspaceDebugLog])

  const activateSessionWithHistoryRetry = useCallback((sessionEntry: AssistantSessionShell) => {
    const hs = sessionHistoryById[sessionEntry.sessionId]
    appendWorkspaceDebugLog('session-activate-requested', {
      currentActiveSessionId: sessionListState.activeSessionId,
      nextSessionId: sessionEntry.sessionId,
      capabilitiesVersion: sessionEntry.capabilities.capabilitiesVersion,
      ...summarizeAssistantHistoryStateForLog(hs),
    })
    if (sessionEntry.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION) {
      markUserLiveSessionSelection()
    } else if (hs?.selectedRunId !== null) {
      appendWorkspaceDebugLog('session-activate-cleared-run-selection', {
        sessionId: sessionEntry.sessionId, previousSelectedRunId: hs.selectedRunId, reason: 'default-thread-view',
      })
      setSessionHistoryById((current) => {
        const chs = current[sessionEntry.sessionId]
        if (chs === undefined || chs.selectedRunId === null) { return current }
        const next = selectAssistantSessionHistoryRun(chs, null)
        return next === chs ? current : { ...current, [sessionEntry.sessionId]: next }
      })
    }
    touchRuntimeController(sessionEntry.sessionId)
    retrySessionHistoryLoad(sessionEntry.sessionId)
    activateSession(sessionEntry)
  }, [activateSession, appendWorkspaceDebugLog, markUserLiveSessionSelection, retrySessionHistoryLoad, sessionHistoryById, sessionListState.activeSessionId, touchRuntimeController])

  const retryActiveSessionHistoryLoad = useCallback(() => {
    if (sessionShell === null) { return }
    retrySessionHistoryLoad(sessionShell.sessionId)
  }, [retrySessionHistoryLoad, sessionShell])

  const retrySessionHistoryLoadById = useCallback((sessionId: string) => {
    retrySessionHistoryLoad(sessionId)
  }, [retrySessionHistoryLoad])

  const selectActiveSessionHistoryRun = useCallback((runId: string | null) => {
    if (sessionShell === null) { return }
    setSessionHistoryById((current) => {
      const hs = current[sessionShell.sessionId]
      if (hs === undefined) { return current }
      const next = selectAssistantSessionHistoryRun(hs, runId)
      appendWorkspaceDebugLog('active-session-run-selected', {
        sessionId: sessionShell.sessionId, previousSelectedRunId: hs.selectedRunId,
        nextSelectedRunId: runId, replayStatus: hs.replayStatus, cachedReplayRunId: hs.replay?.run.runId ?? null,
      })
      return next === hs ? current : { ...current, [sessionShell.sessionId]: next }
    })
  }, [appendWorkspaceDebugLog, sessionShell])

  const selectSessionHistoryRunById = useCallback((sessionId: string, runId: string | null) => {
    setSessionHistoryById((current) => {
      const hs = current[sessionId]
      if (hs === undefined) { return current }
      const next = selectAssistantSessionHistoryRun(hs, runId)
      appendWorkspaceDebugLog('session-run-selected-by-id', {
        sessionId, previousSelectedRunId: hs.selectedRunId, nextSelectedRunId: runId,
        replayStatus: hs.replayStatus, cachedReplayRunId: hs.replay?.run.runId ?? null,
      })
      return next === hs ? current : { ...current, [sessionId]: next }
    })
  }, [appendWorkspaceDebugLog])

  const handleActiveSessionRunSettled = useCallback((runId: string | null, sessionId: string | null) => {
    const sid = sessionId?.trim() ?? ''
    if (sid === '') { return }
    const rid = runId?.trim() ?? ''
    const settledShell = sessionListStateRef.current.sessions.find((se) => se.sessionId === sid) ?? null
    appendWorkspaceDebugLog('session-run-settled', {
      sessionId: sid, activeSessionId: sessionShell?.sessionId ?? null, runId,
      previousSelectedRunId: sessionHistoryById[sid]?.selectedRunId ?? null,
      hasSessionShell: settledShell !== null,
    })
    if (rid !== '') {
      setRuntimeControllerBySessionId((c) => updateCopilotThreadRuntimeControllerStateRecord(c, sid, (cs) => ({
        ...cs, pendingHistorySyncRunId: rid, pendingHistorySyncLogKey: null,
      })))
    }
    setSessionHistoryById((current) => {
      const hs = current[sid] ?? (settledShell === null ? undefined : createAssistantSessionHistoryStateFromSessionShell(settledShell, null))
      if (hs === undefined) { return current }
      const next = retryAssistantSessionHistoryDetail(hs)
      return next === hs ? current : { ...current, [sid]: next }
    })
    setHistoryRestoreRetryKey((c) => c + 1)
  }, [appendWorkspaceDebugLog, sessionHistoryById, sessionShell, setHistoryRestoreRetryKey, setRuntimeControllerBySessionId])

  // Interaction & management sub-hooks
  const {
    renderedSessions, dragPreviewIndex, draggingSessionShell,
    sessionContextMenu, sessionDragState,
    sessionListRef, sessionDragGhostRef,
    handleSessionPointerDown, handleSessionClick,
    handleSessionContextMenu: showSessionContextMenu,
    dismissSessionContextMenu, selectSessionContextSubmenu,
  } = useAssistantSessionInteractionState({
    sessionListState, setSessionListState, activateSession: activateSessionWithHistoryRetry,
  })
  const {
    renamingSessionId, renamingValue, deleteConfirmationSessionId,
    handleSessionContextMenu,
    dismissSessionContextMenu: dismissManagedSessionContextMenu,
    requestSessionRename, updateSessionRenameValue,
    commitSessionRename, cancelSessionRename,
    duplicateSession, requestSessionDelete, confirmSessionDelete, cancelSessionDelete,
  } = useAssistantSessionManagementState({
    sessionListState, setSelectedAgentId,
    dismissSessionContextMenu, showSessionContextMenu,
    onRenameSession: renameSessionPersistence,
    onDeleteSession: deleteSessionPersistence,
    onDuplicateSession: duplicateSessionPersistence,
  })

  const handleCreateSession = useCallback(async () => {
    dismissManagedSessionContextMenu()
    markUserLiveSessionSelection()
    await createSessionForSelectedAgent()
  }, [createSessionForSelectedAgent, dismissManagedSessionContextMenu, markUserLiveSessionSelection])

  // Derived
  const activeSessionHistory = sessionShell === null ? null : sessionHistoryById[sessionShell.sessionId] ?? null

  // Sync sessionHistoryById entries with session list
  useEffect(() => {
    setSessionHistoryById((current) => {
      let changed = false
      const next = { ...current }
      const ids = new Set(sessionListState.sessions.map((se) => se.sessionId))
      for (const se of sessionListState.sessions) {
        if (next[se.sessionId] !== undefined) { continue }
        next[se.sessionId] = createAssistantSessionHistoryStateFromSessionShell(se, null)
        changed = true
      }
      for (const id of Object.keys(next)) {
        if (ids.has(id)) { continue }
        delete next[id]
        changed = true
      }
      return changed ? next : current
    })
  }, [sessionListState.sessions])

  // Sync agent bindings
  useEffect(() => {
    if (directoryState.agents.length === 0) { return }
    setSessionListState((current) => {
      let changed = false
      const next = current.sessions.map((se) => {
        const nse = syncAssistantSessionShellBoundAgent(se, directoryState.agents)
        if (nse !== se) { changed = true }
        return nse
      })
      return changed ? { ...current, sessions: next } : current
    })
  }, [directoryState.agents, setSessionListState])

  // Persist shell state
  useEffect(() => {
    const prev = persistedShellStateRef.current
    const runIds = Object.fromEntries(
      sessionListState.sessions.flatMap((se) => {
        const hs = sessionHistoryById[se.sessionId]
        const nextId = hs === undefined ? null : resolveAssistantSessionHistoryPersistableSelectedRunId(hs)
        return nextId === null ? [] : [[se.sessionId, nextId] as const]
      }),
    )
    const summaries = sessionListState.sessions.length > 0
      ? sessionListState.sessions.flatMap((se) => {
          const hs = sessionHistoryById[se.sessionId]
          if (hs?.isPersistedThread === true) { return [{ ...hs.summary }] }
          if (se.capabilities.capabilitiesVersion !== HISTORY_SHELL_VERSION) { return [] }
          return [createAssistantSessionHistoryStateFromSessionShell(se, null).summary]
        })
      : prev.threadSummaries

    const nextShell = {
      selectedThreadId: sessionListState.activeSessionId ?? (sessionListState.sessions.length === 0 ? prev.selectedThreadId : null),
      selectedRunIdByThreadId: runIds,
      threadSummaries: summaries,
    }
    appendWorkspaceDebugLog('workspace-shell-state-persisted', {
      selectedThreadId: nextShell.selectedThreadId,
      selectedRunIdCount: Object.keys(nextShell.selectedRunIdByThreadId).length,
      selectedRunIdByThreadId: nextShell.selectedRunIdByThreadId,
      sessionCount: sessionListState.sessions.length,
      threadSummaryCount: nextShell.threadSummaries.length,
      threadSummarySource: sessionListState.sessions.length > 0 ? 'session-list' : 'previous-shell-cache',
      skippedSelectedRunCount: Object.keys(sessionHistoryById).length - Object.keys(nextShell.selectedRunIdByThreadId).length,
    })
    persistedShellStateRef.current = nextShell
    persistShellStateImpl(nextShell)
  }, [appendWorkspaceDebugLog, persistShellStateImpl, sessionHistoryById, sessionListState.activeSessionId, sessionListState.sessions])

  return {
    directoryState, selectedAgent, sessionShell, activeSessionHistory,
    sessionHistoryById, runtimeControllerBySessionId, setRuntimeControllerBySessionId,
    sessionListState, sessionStatus, sessionError,
    historyRestoreError, createSessionLabel, createSessionButtonDisabled,
    renderedSessions, dragPreviewIndex, draggingSessionShell,
    sessionContextMenu, renamingSessionId, renamingValue, deleteConfirmationSessionId,
    sessionDragState, sessionListRef, sessionDragGhostRef,
    selectAgent, handleCreateSession,
    retryActiveSessionHistoryLoad, retrySessionHistoryLoadById,
    selectActiveSessionHistoryRun, selectSessionHistoryRunById,
    handleActiveSessionRunSettled,
    handleSessionPointerDown, handleSessionClick,
    handleSessionContextMenu, dismissSessionContextMenu: dismissManagedSessionContextMenu,
    selectSessionContextSubmenu,
    requestSessionRename, updateSessionRenameValue,
    commitSessionRename, cancelSessionRename,
    duplicateSession, requestSessionDelete, confirmSessionDelete, cancelSessionDelete,
  }
}
