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
import { buildPersistedConversationFromHistory } from '../../features/copilot/persisted-history-view-model'
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
  selectActiveSessionHistoryRun: (runId: string | null) => void
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

export const COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY = 8

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
): boolean {
  if (
    historyState === undefined
    || historyState.isPersistedThread !== true
    || historyState.detailStatus !== 'ready'
  ) {
    return false
  }

  return buildPersistedConversationFromHistory(historyState).conversation.length > 0
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
      && isCopilotThreadRuntimeControllerLruCandidate(controllerState)
      && hasRebuildablePersistedConversation(input.sessionHistoryById[sessionId])
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
  const restoredRuntimeUrlRef = useRef<string | null>(null)
  const provisionalEmptyRestoreKeyRef = useRef<string | null>(null)
  const persistedShellStateRef = useRef(loadShellStateImpl())
  const [sessionHistoryById, setSessionHistoryById] = useState<Record<string, AssistantSessionHistoryState>>({})
  const [runtimeControllerBySessionId, setRuntimeControllerBySessionId] = useState<Record<string, CopilotThreadRuntimeControllerState>>({})
  const runtimeControllerBySessionIdRef = useRef<Record<string, CopilotThreadRuntimeControllerState>>({})
  const historyListRequestVersionRef = useRef(0)
  const historyCapabilitiesRequestVersionRef = useRef<Record<string, number>>({})
  const historyDetailRequestVersionRef = useRef<Record<string, number>>({})
  const historyReplayRequestVersionRef = useRef<Record<string, number>>({})
  const historyRestoreRetryTimerRef = useRef<number | null>(null)
  const [historyRestoreRetryKey, setHistoryRestoreRetryKey] = useState(0)
  const isMountedRef = useRef(true)
  const [historyRestoreError, setHistoryRestoreError] = useState<string | null>(null)
  const directoryAgentsRef = useRef(initialDirectoryState.agents)
  const debugModeEnabled = isCopilotDebugModeEnabled(bootstrap.state)
  const debugModeEnabledRef = useRef(debugModeEnabled)
  const appendWorkspaceDebugLog = useCallback((event: string, context: Record<string, unknown> = {}) => {
    appendCopilotDebugLog(debugModeEnabledRef.current, 'assistant-workspace', event, context)
  }, [])

  useEffect(() => {
    debugModeEnabledRef.current = debugModeEnabled
  }, [debugModeEnabled])

  useEffect(() => {
    runtimeControllerBySessionIdRef.current = runtimeControllerBySessionId
  }, [runtimeControllerBySessionId])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      if (historyRestoreRetryTimerRef.current !== null) {
        window.clearTimeout(historyRestoreRetryTimerRef.current)
        historyRestoreRetryTimerRef.current = null
      }
    }
  }, [])

  const {
    directoryState,
    selectedAgent,
    selectAgent,
    setSelectedAgentId,
  } = useAssistantDirectoryState({
    bootstrap,
    language,
    listAgents: listAgentsImpl,
    initialDirectoryState,
  })

  useEffect(() => {
    directoryAgentsRef.current = directoryState.agents
  }, [directoryState.agents])

  const {
    sessionListState,
    setSessionListState,
    sessionShell,
    sessionStatus,
    sessionError,
    createSessionLabel,
    createSessionButtonDisabled,
    activateSession,
    handleCreateSession: createSessionForSelectedAgent,
  } = useAssistantSessionCreation({
    bootstrap,
    language,
    selectedAgent,
    setSelectedAgentId,
    createSession: createSessionImpl,
    getCapabilities: getCapabilitiesImpl,
    initialSessionShell,
  })
  const sessionListStateRef = useRef(sessionListState)
  const historyRestoreRetryAttemptRef = useRef(0)
  const liveSessionSelectionVersionRef = useRef(0)

  useEffect(() => {
    sessionListStateRef.current = sessionListState
  }, [sessionListState])

  const touchRuntimeController = useCallback((sessionId: string | null | undefined) => {
    const normalizedSessionId = sessionId?.trim() ?? ''
    if (normalizedSessionId === '') {
      return
    }

    setRuntimeControllerBySessionId((current) => updateCopilotThreadRuntimeControllerStateRecord(
      current,
      normalizedSessionId,
      (controllerState) => controllerState,
    ))
  }, [])

  const retrySessionHistoryLoad = useCallback((sessionId: string) => {
    setSessionHistoryById((current) => {
      const historyState = current[sessionId]
      if (historyState === undefined) {
        return current
      }

      const retryTarget = historyState.detailStatus === 'error'
        ? 'detail'
        : historyState.replayStatus === 'error'
          ? 'replay'
          : historyState.capabilitiesStatus === 'error'
            ? 'capabilities'
            : 'none'
      const nextHistoryState = historyState.detailStatus === 'error'
        ? retryAssistantSessionHistoryDetail(historyState)
        : historyState.replayStatus === 'error'
          ? retryAssistantSessionHistoryReplay(historyState)
          : historyState.capabilitiesStatus === 'error'
            ? retryAssistantSessionCapabilitiesHydration(historyState)
            : historyState

      appendWorkspaceDebugLog('session-history-retry-requested', {
        sessionId,
        retryTarget,
        ...summarizeAssistantHistoryStateForLog(historyState),
      })

      return nextHistoryState === historyState
        ? current
        : {
            ...current,
            [sessionId]: nextHistoryState,
          }
    })
  }, [appendWorkspaceDebugLog])

  const markUserLiveSessionSelection = useCallback(() => {
    liveSessionSelectionVersionRef.current += 1
    appendWorkspaceDebugLog('live-session-selection-marked', {
      liveSessionSelectionVersion: liveSessionSelectionVersionRef.current,
      activeSessionId: sessionListStateRef.current.activeSessionId,
    })
  }, [appendWorkspaceDebugLog])

  const activateSessionWithHistoryRetry = useCallback((sessionEntry: AssistantSessionShell) => {
    const historyState = sessionHistoryById[sessionEntry.sessionId]
    appendWorkspaceDebugLog('session-activate-requested', {
      currentActiveSessionId: sessionListState.activeSessionId,
      nextSessionId: sessionEntry.sessionId,
      capabilitiesVersion: sessionEntry.capabilities.capabilitiesVersion,
      ...summarizeAssistantHistoryStateForLog(historyState),
    })

    if (sessionEntry.capabilities.capabilitiesVersion !== 'history-shell') {
      markUserLiveSessionSelection()
    } else if (historyState?.selectedRunId !== null) {
      appendWorkspaceDebugLog('session-activate-cleared-run-selection', {
        sessionId: sessionEntry.sessionId,
        previousSelectedRunId: historyState.selectedRunId,
        reason: 'default-thread-view',
      })
      setSessionHistoryById((current) => {
        const currentHistoryState = current[sessionEntry.sessionId]
        if (currentHistoryState === undefined || currentHistoryState.selectedRunId === null) {
          return current
        }

        const nextHistoryState = selectAssistantSessionHistoryRun(currentHistoryState, null)
        return nextHistoryState === currentHistoryState
          ? current
          : {
              ...current,
              [sessionEntry.sessionId]: nextHistoryState,
            }
      })
    }

    touchRuntimeController(sessionEntry.sessionId)
    retrySessionHistoryLoad(sessionEntry.sessionId)
    activateSession(sessionEntry)
  }, [
    activateSession,
    appendWorkspaceDebugLog,
    markUserLiveSessionSelection,
    retrySessionHistoryLoad,
    sessionHistoryById,
    sessionListState.activeSessionId,
    touchRuntimeController,
  ])

  const renameSessionPersistence = useCallback(async (
    sessionId: string,
    nextTitle: string,
    sessionEntry: AssistantSessionShell,
  ) => {
    const result = await renameHistoryThreadImpl(sessionId, { title: nextTitle })
    if (!result.ok) {
      appendWorkspaceDebugLog('session-rename-failed', {
        sessionId,
        error: result.error,
      })
      throw new Error(result.error)
    }

    const renamedSessionShell = {
      ...createAssistantSessionShellFromHistorySummary({
        summary: result.thread,
        agents: directoryAgentsRef.current,
      }),
      capabilities: sessionEntry.capabilities,
    }

    appendWorkspaceDebugLog('session-rename-succeeded', {
      sessionId,
      nextTitle: result.thread.title,
      updatedAt: result.thread.updatedAt,
    })
    setSessionListState((current) => ({
      ...current,
      sessions: current.sessions.map((currentSession) => currentSession.sessionId === sessionId
        ? renamedSessionShell
        : currentSession),
    }))
    setSessionHistoryById((current) => {
      const historyState = current[sessionId]
      if (historyState === undefined) {
        return current
      }

      return {
        ...current,
        [sessionId]: {
          ...historyState,
          summary: { ...result.thread },
        },
      }
    })
  }, [appendWorkspaceDebugLog, renameHistoryThreadImpl, setSessionListState])

  const duplicateSessionPersistence = useCallback(async (
    sessionId: string,
    sessionEntry: AssistantSessionShell,
  ) => {
    const result = await duplicateHistoryThreadImpl(sessionId)
    if (!result.ok) {
      appendWorkspaceDebugLog('session-duplicate-failed', {
        sessionId,
        sourceCapabilitiesVersion: sessionEntry.capabilities.capabilitiesVersion,
        error: result.error,
      })
      throw new Error(result.error)
    }

    const duplicatedSessionShell = createAssistantSessionShellFromHistorySummary({
      summary: result.thread,
      agents: directoryAgentsRef.current,
    })

    appendWorkspaceDebugLog('session-duplicate-succeeded', {
      sessionId,
      duplicatedSessionId: duplicatedSessionShell.sessionId,
      duplicatedTitle: result.thread.title,
    })
    setSessionListState((current) => ({
      sessions: [
        duplicatedSessionShell,
        ...current.sessions.filter((currentSession) => currentSession.sessionId !== duplicatedSessionShell.sessionId),
      ],
      activeSessionId: duplicatedSessionShell.sessionId,
    }))
    setSessionHistoryById((current) => ({
      ...current,
      [duplicatedSessionShell.sessionId]: createAssistantSessionHistoryState(result.thread, null),
    }))
    setSelectedAgentId(duplicatedSessionShell.boundAgent.id)
  }, [appendWorkspaceDebugLog, duplicateHistoryThreadImpl, setSelectedAgentId, setSessionListState])

  const deleteSessionPersistence = useCallback(async (
    sessionId: string,
    sessionEntry: AssistantSessionShell,
  ) => {
    const result = await deleteHistoryThreadImpl(sessionId)
    if (!result.ok) {
      appendWorkspaceDebugLog('session-delete-failed', {
        sessionId,
        sourceCapabilitiesVersion: sessionEntry.capabilities.capabilitiesVersion,
        error: result.error,
      })
      throw new Error(result.error)
    }

    appendWorkspaceDebugLog('session-delete-succeeded', {
      sessionId,
      deletedAt: result.deletedAt,
    })
    setSessionListState((current) => ({
      sessions: current.sessions.filter((currentSession) => currentSession.sessionId !== sessionId),
      activeSessionId: current.activeSessionId === sessionId ? null : current.activeSessionId,
    }))
    setSessionHistoryById((current) => {
      if (current[sessionId] === undefined) {
        return current
      }
      const nextState = { ...current }
      delete nextState[sessionId]
      return nextState
    })
    setRuntimeControllerBySessionId((current) => {
      if (current[sessionId] === undefined) {
        return current
      }
      const nextState = { ...current }
      delete nextState[sessionId]
      return nextState
    })
    const previousShellState = persistedShellStateRef.current
    const nextSelectedRunIdByThreadId = Object.fromEntries(
      Object.entries(previousShellState.selectedRunIdByThreadId).filter(([threadId]) => threadId !== sessionId),
    )
    const nextShellState = {
      selectedThreadId: previousShellState.selectedThreadId === sessionId ? null : previousShellState.selectedThreadId,
      selectedRunIdByThreadId: nextSelectedRunIdByThreadId,
      threadSummaries: previousShellState.threadSummaries.filter((threadSummary) => threadSummary.threadId !== sessionId),
    }
    persistedShellStateRef.current = nextShellState
    persistShellStateImpl(nextShellState)
  }, [appendWorkspaceDebugLog, deleteHistoryThreadImpl, persistShellStateImpl, setSessionListState])

  const {
    renderedSessions,
    dragPreviewIndex,
    draggingSessionShell,
    sessionContextMenu,
    sessionDragState,
    sessionListRef,
    sessionDragGhostRef,
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu: showSessionContextMenu,
    dismissSessionContextMenu,
    selectSessionContextSubmenu,
  } = useAssistantSessionInteractionState({
    sessionListState,
    setSessionListState,
    activateSession: activateSessionWithHistoryRetry,
  })
  const {
    renamingSessionId,
    renamingValue,
    deleteConfirmationSessionId,
    handleSessionContextMenu,
    dismissSessionContextMenu: dismissManagedSessionContextMenu,
    requestSessionRename,
    updateSessionRenameValue,
    commitSessionRename,
    cancelSessionRename,
    duplicateSession,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
  } = useAssistantSessionManagementState({
    sessionListState,
    setSelectedAgentId,
    dismissSessionContextMenu,
    showSessionContextMenu,
    onRenameSession: renameSessionPersistence,
    onDeleteSession: deleteSessionPersistence,
    onDuplicateSession: duplicateSessionPersistence,
  })

  const activeSessionHistory = sessionShell === null
    ? null
    : sessionHistoryById[sessionShell.sessionId] ?? null
  const runtimeControllerRegistrySessionKey = sessionListState.sessions
    .map((sessionEntry) => sessionEntry.sessionId)
    .join('::')

  useEffect(() => {
    setSessionHistoryById((current) => {
      let hasChanged = false
      const nextState = { ...current }
      const sessionIds = new Set(sessionListState.sessions.map((sessionEntry) => sessionEntry.sessionId))

      for (const sessionEntry of sessionListState.sessions) {
        if (nextState[sessionEntry.sessionId] !== undefined) {
          continue
        }

        nextState[sessionEntry.sessionId] = createAssistantSessionHistoryStateFromSessionShell(sessionEntry, null)
        hasChanged = true
      }

      for (const sessionId of Object.keys(nextState)) {
        if (sessionIds.has(sessionId)) {
          continue
        }

        delete nextState[sessionId]
        hasChanged = true
      }

      return hasChanged ? nextState : current
    })
  }, [sessionListState.sessions])

  useEffect(() => {
    setRuntimeControllerBySessionId((current) => syncCopilotThreadRuntimeControllerStateRecord(current, sessionListState.sessions))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session membership changes are intentionally keyed by the joined session id list.
  }, [runtimeControllerRegistrySessionKey])

  useEffect(() => {
    setRuntimeControllerBySessionId((current) => {
      const { nextControllers, evictedSessionIds } = pruneCopilotThreadRuntimeControllers({
        controllers: current,
        sessionHistoryById,
        activeSessionId: sessionListState.activeSessionId,
        maxControllerCount: COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY,
      })
      if (evictedSessionIds.length === 0) {
        return current
      }

      appendWorkspaceDebugLog('runtime-controller-lru-evicted', {
        activeSessionId: sessionListState.activeSessionId,
        maxControllerCount: COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY,
        controllerCountBefore: Object.keys(current).length,
        controllerCountAfter: Object.keys(nextControllers).length,
        evictedSessionIds,
      })
      return nextControllers
    })
  }, [appendWorkspaceDebugLog, runtimeControllerBySessionId, sessionHistoryById, sessionListState.activeSessionId])

  const retryActiveSessionHistoryLoad = useCallback(() => {
    if (sessionShell === null) {
      return
    }

    retrySessionHistoryLoad(sessionShell.sessionId)
  }, [retrySessionHistoryLoad, sessionShell])

  const selectActiveSessionHistoryRun = useCallback((runId: string | null) => {
    if (sessionShell === null) {
      return
    }

    setSessionHistoryById((current) => {
      const historyState = current[sessionShell.sessionId]
      if (historyState === undefined) {
        return current
      }

      const nextHistoryState = selectAssistantSessionHistoryRun(historyState, runId)
      appendWorkspaceDebugLog('active-session-run-selected', {
        sessionId: sessionShell.sessionId,
        previousSelectedRunId: historyState.selectedRunId,
        nextSelectedRunId: runId,
        replayStatus: historyState.replayStatus,
        cachedReplayRunId: historyState.replay?.run.runId ?? null,
      })
      return nextHistoryState === historyState
        ? current
        : {
            ...current,
            [sessionShell.sessionId]: nextHistoryState,
          }
    })
  }, [appendWorkspaceDebugLog, sessionShell])

  const handleActiveSessionRunSettled = useCallback((runId: string | null, sessionId: string | null) => {
    const settledSessionId = sessionId?.trim() ?? ''
    if (settledSessionId === '') {
      return
    }

    const settledRunId = runId?.trim() ?? ''
    const settledSessionShell = sessionListStateRef.current.sessions.find(
      (sessionEntry) => sessionEntry.sessionId === settledSessionId,
    ) ?? null

    appendWorkspaceDebugLog('session-run-settled', {
      sessionId: settledSessionId,
      activeSessionId: sessionShell?.sessionId ?? null,
      runId,
      previousSelectedRunId: sessionHistoryById[settledSessionId]?.selectedRunId ?? null,
      hasSessionShell: settledSessionShell !== null,
    })
    if (settledRunId !== '') {
      setRuntimeControllerBySessionId((current) => updateCopilotThreadRuntimeControllerStateRecord(
        current,
        settledSessionId,
        (controllerState) => ({
          ...controllerState,
          pendingHistorySyncRunId: settledRunId,
          pendingHistorySyncLogKey: null,
        }),
      ))
    }
    setSessionHistoryById((current) => {
      const historyState = current[settledSessionId]
        ?? (settledSessionShell === null
          ? undefined
          : createAssistantSessionHistoryStateFromSessionShell(settledSessionShell, null))
      if (historyState === undefined) {
        return current
      }

      const nextHistoryState = retryAssistantSessionHistoryDetail(historyState)

      return nextHistoryState === historyState
        ? current
        : {
            ...current,
            [settledSessionId]: nextHistoryState,
          }
    })
    setHistoryRestoreRetryKey((current) => current + 1)
  }, [appendWorkspaceDebugLog, sessionHistoryById, sessionShell])

  const handleCreateSession = useCallback(async () => {
    dismissManagedSessionContextMenu()
    markUserLiveSessionSelection()
    await createSessionForSelectedAgent()
  }, [createSessionForSelectedAgent, dismissManagedSessionContextMenu, markUserLiveSessionSelection])

  const clearHistoryRestoreRetry = useCallback(() => {
    if (historyRestoreRetryTimerRef.current === null) {
      return
    }

    window.clearTimeout(historyRestoreRetryTimerRef.current)
    historyRestoreRetryTimerRef.current = null
  }, [])

  const resetHistoryRestoreRetryBackoff = useCallback(() => {
    historyRestoreRetryAttemptRef.current = 0
  }, [])

  const scheduleHistoryRestoreRetry = useCallback(() => {
    if (historyRestoreRetryTimerRef.current !== null) {
      return null
    }

    const retryDelayMs = Math.min(1_000 * 2 ** historyRestoreRetryAttemptRef.current, 15_000)
    historyRestoreRetryAttemptRef.current += 1
    appendWorkspaceDebugLog('history-restore-retry-scheduled', {
      retryAttempt: historyRestoreRetryAttemptRef.current,
      retryDelayMs,
    })
    historyRestoreRetryTimerRef.current = window.setTimeout(() => {
      historyRestoreRetryTimerRef.current = null
      if (!isMountedRef.current) {
        return
      }

      setHistoryRestoreRetryKey((current) => current + 1)
    }, retryDelayMs)
    return retryDelayMs
  }, [appendWorkspaceDebugLog, isMountedRef])


  useEffect(() => {
    if (directoryState.agents.length === 0) {
      return
    }

    setSessionListState((current) => {
      let hasChanged = false
      const nextSessions = current.sessions.map((sessionEntry) => {
        const nextSessionEntry = syncAssistantSessionShellBoundAgent(sessionEntry, directoryState.agents)
        if (nextSessionEntry !== sessionEntry) {
          hasChanged = true
        }
        return nextSessionEntry
      })

      return hasChanged
        ? {
            ...current,
            sessions: nextSessions,
          }
        : current
    })
  }, [directoryState.agents, setSessionListState])

  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state)) {
      return
    }

    const runtimeUrl = bootstrap.state.runtimeUrl
    const restoreKey = `${runtimeUrl}:${historyRestoreRetryKey}`
    if (restoredRuntimeUrlRef.current === restoreKey || provisionalEmptyRestoreKeyRef.current === restoreKey) {
      return
    }

    const requestVersion = historyListRequestVersionRef.current + 1
    historyListRequestVersionRef.current = requestVersion
    const liveSessionSelectionVersionAtRequest = liveSessionSelectionVersionRef.current
    let cancelled = false

    void (async () => {
      const persistedShellState = persistedShellStateRef.current

      appendWorkspaceDebugLog('history-restore-request-started', {
        runtimeUrl,
        restoreKey,
        requestVersion,
        retryKey: historyRestoreRetryKey,
        liveSessionSelectionVersionAtRequest,
        persistedSelectedThreadId: persistedShellState.selectedThreadId,
        persistedSelectedRunCount: Object.keys(persistedShellState.selectedRunIdByThreadId).length,
        currentActiveSessionId: sessionListStateRef.current.activeSessionId,
      })

      try {
        const historyResult = await listHistoryThreadsImpl()

        if (cancelled || !isMountedRef.current || historyListRequestVersionRef.current !== requestVersion) {
          appendWorkspaceDebugLog('history-restore-request-discarded', {
            runtimeUrl,
            restoreKey,
            requestVersion,
            latestRequestVersion: historyListRequestVersionRef.current,
            discardReason: cancelled
              ? 'effect-cleanup'
              : !isMountedRef.current
                ? 'unmounted'
                : 'stale-request-version',
            ok: historyResult.ok,
            threadCount: historyResult.ok ? historyResult.threads.length : null,
            error: historyResult.ok ? null : historyResult.error,
          })
          return
        }

        if (!historyResult.ok) {
          restoredRuntimeUrlRef.current = null
          provisionalEmptyRestoreKeyRef.current = null
          setHistoryRestoreError(historyResult.error)
          const retryDelayMs = scheduleHistoryRestoreRetry()
          appendWorkspaceDebugLog('history-restore-request-failed', {
            runtimeUrl,
            restoreKey,
            requestVersion,
            failureSource: 'result',
            error: historyResult.error,
            retryDelayMs,
          })
          return
        }

        const isProvisionalEmptyRestore = historyResult.threads.length === 0
        const cachedThreadSummaries = isProvisionalEmptyRestore
          ? persistedShellState.threadSummaries
          : []
        const usingPersistedThreadSummaryCache = isProvisionalEmptyRestore && cachedThreadSummaries.length > 0
        const effectiveThreadSummaries = usingPersistedThreadSummaryCache
          ? cachedThreadSummaries
          : historyResult.threads
        const currentSessionsById = new Map(
          sessionListStateRef.current.sessions.map((sessionEntry) => [sessionEntry.sessionId, sessionEntry] as const),
        )
        const agentsAtRestoreApply = directoryAgentsRef.current
        const restoredSessions = effectiveThreadSummaries.map((summary) => {
          const restoredSession = createAssistantSessionShellFromHistorySummary({
            summary,
            agents: agentsAtRestoreApply,
          })
          const currentSession = currentSessionsById.get(summary.threadId)

          return currentSession !== undefined && currentSession.capabilities.capabilitiesVersion !== 'history-shell'
            ? {
                ...restoredSession,
                capabilities: currentSession.capabilities,
              }
            : restoredSession
        })
        const restoredSessionsById = new Map(
          restoredSessions.map((sessionEntry) => [sessionEntry.sessionId, sessionEntry] as const),
        )
        const preferredActiveSessionId = persistedShellState.selectedThreadId !== null
          && restoredSessions.some((sessionEntry) => sessionEntry.sessionId === persistedShellState.selectedThreadId)
          ? persistedShellState.selectedThreadId
          : restoredSessions[0]?.sessionId ?? null

        const shouldProtectUserLiveSelection = liveSessionSelectionVersionRef.current !== liveSessionSelectionVersionAtRequest
        const restoredSessionIds = new Set(restoredSessions.map((sessionEntry) => sessionEntry.sessionId))
        const currentSessionListState = sessionListStateRef.current
        const liveOnlySessions = currentSessionListState.sessions.filter((sessionEntry) => !restoredSessionIds.has(sessionEntry.sessionId))
        const mergedSessions = [...restoredSessions, ...liveOnlySessions]
        const currentActiveSession = currentSessionListState.activeSessionId === null
          ? null
          : currentSessionListState.sessions.find((sessionEntry) => sessionEntry.sessionId === currentSessionListState.activeSessionId) ?? null
        const currentActiveSessionIsLiveOnly = currentActiveSession !== null
          && currentActiveSession.capabilities.capabilitiesVersion !== 'history-shell'
          && !restoredSessionIds.has(currentActiveSession.sessionId)
        const preserveCurrentActiveLiveSession = currentActiveSessionIsLiveOnly
          || (shouldProtectUserLiveSelection && currentActiveSession !== null && currentActiveSession.capabilities.capabilitiesVersion !== 'history-shell')
        const restoredActiveSessionId = preserveCurrentActiveLiveSession
          ? currentSessionListState.activeSessionId
          : preferredActiveSessionId
            ?? (currentSessionListState.activeSessionId !== null && mergedSessions.some((sessionEntry) => sessionEntry.sessionId === currentSessionListState.activeSessionId)
              ? currentSessionListState.activeSessionId
              : mergedSessions[0]?.sessionId ?? null)
        const restoreSelectionSummary: Record<string, unknown> = {
          previousActiveSessionId: currentSessionListState.activeSessionId,
          nextActiveSessionId: restoredActiveSessionId,
          activeSessionChanged: currentSessionListState.activeSessionId !== restoredActiveSessionId,
          liveOnlySessionCount: liveOnlySessions.length,
          mergedSessionCount: mergedSessions.length,
          currentActiveSessionIsLiveOnly,
          preserveCurrentActiveLiveSession,
          usingPersistedThreadSummaryCache,
        }

        setSessionListState({
          sessions: mergedSessions,
          activeSessionId: restoredActiveSessionId,
        })
        setSessionHistoryById((current) => {
          const nextState: Record<string, AssistantSessionHistoryState> = {}
          for (const summary of effectiveThreadSummaries) {
            const currentHistoryState = current[summary.threadId]
            const syncedHistoryState = currentHistoryState === undefined
              ? createAssistantSessionHistoryState(summary, null)
              : syncAssistantSessionHistorySummary(currentHistoryState, summary, null)
            const restoredSession = restoredSessionsById.get(summary.threadId)
            const shouldDefaultRestoredActiveThreadView = restoredActiveSessionId === summary.threadId
              && restoredSession?.capabilities.capabilitiesVersion === 'history-shell'
            const pendingHistorySyncRunId = shouldDefaultRestoredActiveThreadView
              ? runtimeControllerBySessionIdRef.current[summary.threadId]?.pendingHistorySyncRunId ?? null
              : null
            const defaultThreadViewHistoryState = shouldDefaultRestoredActiveThreadView
              && syncedHistoryState.selectedRunId !== null
              ? selectAssistantSessionHistoryRun(syncedHistoryState, null)
              : syncedHistoryState
            const shouldRestartCapabilitiesHydration = currentHistoryState !== undefined
              && currentHistoryState.isPersistedThread !== true
              && restoredSession?.capabilities.capabilitiesVersion === 'history-shell'

            if (defaultThreadViewHistoryState !== syncedHistoryState) {
              appendWorkspaceDebugLog('history-restore-defaulted-active-thread-view', {
                sessionId: summary.threadId,
                previousSelectedRunId: syncedHistoryState.selectedRunId,
                pendingHistorySyncRunId,
                reason: 'restore-active-thread-default-thread-view',
              })
            }

            nextState[summary.threadId] = shouldRestartCapabilitiesHydration
              ? {
                  ...defaultThreadViewHistoryState,
                  capabilitiesStatus: 'idle',
                  capabilitiesError: null,
                }
              : defaultThreadViewHistoryState
          }

          for (const [sessionId, historyState] of Object.entries(current)) {
            if (nextState[sessionId] === undefined) {
              nextState[sessionId] = historyState
            }
          }

          return nextState
        })

        const restoredActiveSession = restoredActiveSessionId === null
          ? null
          : restoredSessionsById.get(restoredActiveSessionId)
            ?? currentSessionsById.get(restoredActiveSessionId)
            ?? null
        const selectedAgentSyncApplied = !shouldProtectUserLiveSelection && restoredActiveSession !== null
        if (selectedAgentSyncApplied) {
          setSelectedAgentId(restoredActiveSession.boundAgent.id)
        }

        if (isProvisionalEmptyRestore) {
          restoredRuntimeUrlRef.current = null
          provisionalEmptyRestoreKeyRef.current = restoreKey
          setHistoryRestoreError(null)
          const retryDelayMs = scheduleHistoryRestoreRetry()
          appendWorkspaceDebugLog('history-restore-request-empty-provisional', {
            runtimeUrl,
            restoreKey,
            requestVersion,
            threadCount: 0,
            cachedThreadSummaryCount: cachedThreadSummaries.length,
            usingPersistedThreadSummaryCache,
            agentCountAtApply: agentsAtRestoreApply.length,
            sessionCountBeforeRestore: currentSessionsById.size,
            restoredSessionCount: restoredSessions.length,
            retryDelayMs,
            preferredActiveSessionId,
            shouldProtectUserLiveSelection,
            selectedAgentSyncApplied,
            selectedAgentSyncSessionId: restoredActiveSession?.sessionId ?? null,
            selectedAgentSyncAgentId: restoredActiveSession?.boundAgent.id ?? null,
            ...(restoreSelectionSummary ?? {}),
          })
          return
        }

        provisionalEmptyRestoreKeyRef.current = null
        appendWorkspaceDebugLog('history-restore-request-succeeded', {
          runtimeUrl,
          restoreKey,
          requestVersion,
          threadCount: historyResult.threads.length,
          isEmpty: false,
          usingPersistedThreadSummaryCache,
          agentCountAtApply: agentsAtRestoreApply.length,
          sessionCountBeforeRestore: currentSessionsById.size,
          effectiveThreadSummaryCount: effectiveThreadSummaries.length,
          restoredSessionCount: restoredSessions.length,
          preferredActiveSessionId,
          shouldProtectUserLiveSelection,
          selectedAgentSyncApplied,
          selectedAgentSyncSessionId: restoredActiveSession?.sessionId ?? null,
          selectedAgentSyncAgentId: restoredActiveSession?.boundAgent.id ?? null,
          ...(restoreSelectionSummary ?? {}),
        })

        clearHistoryRestoreRetry()
        resetHistoryRestoreRetryBackoff()
        setHistoryRestoreError(null)
        restoredRuntimeUrlRef.current = restoreKey
      } catch (error) {
        if (cancelled || !isMountedRef.current || historyListRequestVersionRef.current !== requestVersion) {
          return
        }

        const formattedError = formatAssistantWorkspaceError(error)
        restoredRuntimeUrlRef.current = null
        provisionalEmptyRestoreKeyRef.current = null
        setHistoryRestoreError(formattedError)
        const retryDelayMs = scheduleHistoryRestoreRetry()
        appendWorkspaceDebugLog('history-restore-request-failed', {
          runtimeUrl,
          restoreKey,
          requestVersion,
          failureSource: 'exception',
          error: formattedError,
          retryDelayMs,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    appendWorkspaceDebugLog,
    bootstrap.state,
    clearHistoryRestoreRetry,
    historyRestoreRetryKey,
    isMountedRef,
    listHistoryThreadsImpl,
    liveSessionSelectionVersionRef,
    resetHistoryRestoreRetryBackoff,
    scheduleHistoryRestoreRetry,
    setSelectedAgentId,
    setSessionListState,
    setSessionHistoryById,
  ])

  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state) || sessionShell === null) {
      return
    }

    if (sessionShell.capabilities.capabilitiesVersion !== 'history-shell') {
      return
    }

    const sessionId = sessionShell.sessionId
    const historyState = sessionHistoryById[sessionId]
    if (
      historyState === undefined
      || historyState.isPersistedThread !== true
      || historyState.capabilitiesStatus !== 'idle'
    ) {
      return
    }

    const requestVersion = (historyCapabilitiesRequestVersionRef.current[sessionId] ?? 0) + 1
    historyCapabilitiesRequestVersionRef.current[sessionId] = requestVersion

    setSessionHistoryById((current) => ({
      ...current,
      [sessionId]: setAssistantSessionCapabilitiesHydrationLoading(current[sessionId] ?? historyState),
    }))
    appendWorkspaceDebugLog('history-capabilities-hydration-started', {
      sessionId,
      requestVersion,
      ...summarizeAssistantHistoryStateForLog(historyState),
    })

    void getCapabilitiesImpl({
      runtimeUrl: bootstrap.state.runtimeUrl,
      sessionId,
    })
      .then((response) => {
        if (
          !isMountedRef.current
          || historyCapabilitiesRequestVersionRef.current[sessionId] !== requestVersion
        ) {
          return
        }

        appendWorkspaceDebugLog('history-capabilities-hydration-succeeded', {
          sessionId,
          requestVersion,
          capabilitiesVersion: response.capabilitiesVersion,
        })
        setSessionListState((current) => ({
          ...current,
          sessions: current.sessions.map((sessionEntry) => sessionEntry.sessionId === sessionId
            ? applyAssistantSessionCapabilities(sessionEntry, response)
            : sessionEntry),
        }))
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionCapabilitiesHydrationReady(current[sessionId] ?? historyState),
        }))
      })
      .catch((error) => {
        if (
          !isMountedRef.current
          || historyCapabilitiesRequestVersionRef.current[sessionId] !== requestVersion
        ) {
          return
        }

        const formattedError = formatAssistantWorkspaceError(error)
        appendWorkspaceDebugLog('history-capabilities-hydration-failed', {
          sessionId,
          requestVersion,
          error: formattedError,
        })
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionCapabilitiesHydrationError(
            current[sessionId] ?? historyState,
            formattedError,
          ),
        }))
      })
  }, [
    appendWorkspaceDebugLog,
    bootstrap.state,
    getCapabilitiesImpl,
    historyCapabilitiesRequestVersionRef,
    isMountedRef,
    sessionHistoryById,
    sessionShell,
    setSessionHistoryById,
    setSessionListState,
  ])

  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state)) {
      return
    }

    const runtimeUrl = bootstrap.state.runtimeUrl
    const registryClient = createWindowMcpRegistryClient()
    const requestVersionBySessionId = new Map<string, number>()
    const latestCapabilitiesVersionBySessionId = new Map<string, string>()

    for (const sessionEntry of sessionListState.sessions) {
      if (sessionEntry.capabilities.capabilitiesVersion !== 'history-shell') {
        latestCapabilitiesVersionBySessionId.set(
          sessionEntry.sessionId,
          sessionEntry.capabilities.capabilitiesVersion,
        )
      }
    }

    return registryClient.subscribe((event) => {
      if (event.kind !== 'snapshot') {
        return
      }

      const liveSessions = sessionListState.sessions.filter((sessionEntry) => {
        return sessionEntry.capabilities.capabilitiesVersion !== 'history-shell'
      })

      for (const liveSession of liveSessions) {
        const nextRequestVersion = (requestVersionBySessionId.get(liveSession.sessionId) ?? 0) + 1
        requestVersionBySessionId.set(liveSession.sessionId, nextRequestVersion)

        void getCapabilitiesImpl({
          runtimeUrl,
          sessionId: liveSession.sessionId,
        }).then((response) => {
          if (requestVersionBySessionId.get(liveSession.sessionId) !== nextRequestVersion) {
            return
          }

          const previousCapabilitiesVersion = latestCapabilitiesVersionBySessionId.get(liveSession.sessionId) ?? null
          const previousSession = sessionListState.sessions.find((sessionEntry) => {
            return sessionEntry.sessionId === liveSession.sessionId
          }) ?? null
          if (!shouldApplyLiveCapabilitiesUpdate({
            previousCapabilitiesVersion,
            response,
            previousSession,
          })) {
            return
          }

          latestCapabilitiesVersionBySessionId.set(liveSession.sessionId, response.capabilitiesVersion)

          setSessionListState((current) => ({
            ...current,
            sessions: current.sessions.map((sessionEntry) => sessionEntry.sessionId === liveSession.sessionId
              ? applyAssistantSessionCapabilities(sessionEntry, response)
              : sessionEntry),
          }))
        }).catch(() => {
          // Keep the previous live capabilities until a later MCP snapshot refresh succeeds.
        })
      }
    })
  }, [bootstrap.state, getCapabilitiesImpl, sessionListState.sessions, setSessionListState])

  useEffect(() => {
    if (sessionShell === null) {
      return
    }

    const sessionId = sessionShell.sessionId
    const historyState = sessionHistoryById[sessionId]
    if (
      historyState === undefined
      || historyState.isPersistedThread !== true
      || historyState.detailStatus !== 'idle'
    ) {
      return
    }

    const requestVersion = (historyDetailRequestVersionRef.current[sessionId] ?? 0) + 1
    historyDetailRequestVersionRef.current[sessionId] = requestVersion

    setSessionHistoryById((current) => ({
      ...current,
      [sessionId]: setAssistantSessionHistoryDetailLoading(historyState),
    }))
    appendWorkspaceDebugLog('history-detail-request-started', {
      sessionId,
      requestVersion,
      ...summarizeAssistantHistoryStateForLog(historyState),
    })

    void (async () => {
      const detailResult = await getHistoryThreadDetailImpl(sessionId)
      if (
        !isMountedRef.current
        || historyDetailRequestVersionRef.current[sessionId] !== requestVersion
      ) {
        return
      }

      if (!detailResult.ok) {
        appendWorkspaceDebugLog('history-detail-request-failed', {
          sessionId,
          requestVersion,
          error: detailResult.error,
        })
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionHistoryDetailError(
            current[sessionId] ?? historyState,
            detailResult.error,
          ),
        }))
        return
      }

      appendWorkspaceDebugLog('history-detail-request-succeeded', {
        sessionId,
        requestVersion,
        selectedRunId: historyState.selectedRunId,
        runSummaryCount: detailResult.runSummaries.length,
        timelineItemCount: detailResult.timelineItems.length,
      })
      setSessionHistoryById((current) => ({
        ...current,
        [sessionId]: applyAssistantSessionHistoryDetail(
          current[sessionId] ?? historyState,
          detailResult,
        ),
      }))
      setSessionListState((current) => ({
        ...current,
        sessions: current.sessions.map((sessionEntry) => sessionEntry.sessionId === sessionId
          ? {
              ...sessionEntry,
              title: detailResult.thread.title ?? sessionEntry.title,
              updatedAt: detailResult.thread.updatedAt,
            }
          : sessionEntry),
      }))
    })()
  }, [
    appendWorkspaceDebugLog,
    getHistoryThreadDetailImpl,
    historyDetailRequestVersionRef,
    isMountedRef,
    sessionHistoryById,
    sessionShell,
    setSessionHistoryById,
    setSessionListState,
  ])

  useEffect(() => {
    if (sessionShell === null) {
      return
    }

    const sessionId = sessionShell.sessionId
    const historyState = sessionHistoryById[sessionId]
    const selectedRunId = historyState?.selectedRunId ?? null
    const pendingHandoffRunId = runtimeControllerBySessionId[sessionId]?.pendingHistorySyncRunId ?? null
    const shouldRequestSelectedRunReplay = historyState !== undefined
      && historyState.detailStatus === 'ready'
      && selectedRunId !== null
      && historyState.replayStatus === 'idle'
      && !hasAssistantSessionHistoryReplayForRun(historyState, selectedRunId)
    const shouldRequestPendingHandoffReplay = historyState !== undefined
      && historyState.detailStatus === 'ready'
      && pendingHandoffRunId !== null
      && pendingHandoffRunId !== selectedRunId
      && !hasAssistantSessionHistoryReplayForRun(historyState, pendingHandoffRunId)
    const replayRequestRunId = shouldRequestSelectedRunReplay
      ? selectedRunId
      : shouldRequestPendingHandoffReplay
        ? pendingHandoffRunId
        : null
    const tracksSelectedRunReplay = replayRequestRunId !== null && replayRequestRunId === selectedRunId
    if (
      historyState === undefined
      || historyState.detailStatus !== 'ready'
      || replayRequestRunId === null
    ) {
      return
    }

    const requestVersion = (historyReplayRequestVersionRef.current[sessionId] ?? 0) + 1
    historyReplayRequestVersionRef.current[sessionId] = requestVersion

    if (tracksSelectedRunReplay) {
      setSessionHistoryById((current) => ({
        ...current,
        [sessionId]: setAssistantSessionHistoryReplayLoading(historyState, replayRequestRunId),
      }))
    }
    appendWorkspaceDebugLog('history-replay-request-started', {
      sessionId,
      requestVersion,
      selectedRunId,
      replayRequestRunId,
      pendingHandoffRunId,
      tracksSelectedRunReplay,
      ...summarizeAssistantHistoryStateForLog(historyState),
    })

    void (async () => {
      const replayResult = await getHistoryRunReplayImpl(replayRequestRunId)
      if (
        !isMountedRef.current
        || historyReplayRequestVersionRef.current[sessionId] !== requestVersion
      ) {
        return
      }

      if (!replayResult.ok) {
        appendWorkspaceDebugLog('history-replay-request-failed', {
          sessionId,
          requestVersion,
          selectedRunId,
          replayRequestRunId,
          pendingHandoffRunId,
          tracksSelectedRunReplay,
          error: replayResult.error,
        })
        if (tracksSelectedRunReplay) {
          setSessionHistoryById((current) => ({
            ...current,
            [sessionId]: setAssistantSessionHistoryReplayError(
              current[sessionId] ?? historyState,
              replayResult.error,
              replayRequestRunId,
            ),
          }))
        }
        return
      }

      appendWorkspaceDebugLog('history-replay-request-succeeded', {
        sessionId,
        requestVersion,
        selectedRunId,
        replayRequestRunId,
        pendingHandoffRunId,
        tracksSelectedRunReplay,
        replayRunId: replayResult.run.runId,
        orderedEventCount: replayResult.orderedEvents.length,
        toolCallBlockCount: replayResult.toolCallBlocks.length,
        diagnosticBlockCount: replayResult.diagnosticBlocks.length,
      })
      setSessionHistoryById((current) => ({
        ...current,
        [sessionId]: applyAssistantSessionHistoryReplay(
          current[sessionId] ?? historyState,
          replayResult,
        ),
      }))
    })()
  }, [
    appendWorkspaceDebugLog,
    getHistoryRunReplayImpl,
    historyReplayRequestVersionRef,
    isMountedRef,
    runtimeControllerBySessionId,
    sessionHistoryById,
    sessionShell,
    setSessionHistoryById,
  ])

  useEffect(() => {
    const previousShellState = persistedShellStateRef.current
    const selectedRunIdByThreadId = Object.fromEntries(
      sessionListState.sessions.flatMap((sessionEntry) => {
        const historyState = sessionHistoryById[sessionEntry.sessionId]
        const nextSelectedRunId = historyState === undefined
          ? null
          : resolveAssistantSessionHistoryPersistableSelectedRunId(historyState)

        return nextSelectedRunId === null ? [] : [[sessionEntry.sessionId, nextSelectedRunId] as const]
      }),
    )
    const threadSummaries = sessionListState.sessions.length > 0
      ? sessionListState.sessions.flatMap((sessionEntry) => {
          const historyState = sessionHistoryById[sessionEntry.sessionId]
          if (historyState?.isPersistedThread === true) {
            return [{ ...historyState.summary }]
          }
          if (sessionEntry.capabilities.capabilitiesVersion !== 'history-shell') {
            return []
          }
          return [createAssistantSessionHistoryStateFromSessionShell(sessionEntry, null).summary]
        })
      : previousShellState.threadSummaries

    const nextShellState = {
      selectedThreadId: sessionListState.activeSessionId ?? (sessionListState.sessions.length === 0
        ? previousShellState.selectedThreadId
        : null),
      selectedRunIdByThreadId,
      threadSummaries,
    }
    appendWorkspaceDebugLog('workspace-shell-state-persisted', {
      selectedThreadId: nextShellState.selectedThreadId,
      selectedRunIdCount: Object.keys(nextShellState.selectedRunIdByThreadId).length,
      selectedRunIdByThreadId: nextShellState.selectedRunIdByThreadId,
      sessionCount: sessionListState.sessions.length,
      threadSummaryCount: nextShellState.threadSummaries.length,
      threadSummarySource: sessionListState.sessions.length > 0
        ? 'session-list'
        : 'previous-shell-cache',
      skippedSelectedRunCount: Object.keys(sessionHistoryById).length - Object.keys(nextShellState.selectedRunIdByThreadId).length,
    })
    persistedShellStateRef.current = nextShellState
    persistShellStateImpl(nextShellState)
  }, [appendWorkspaceDebugLog, persistShellStateImpl, sessionHistoryById, sessionListState.activeSessionId, sessionListState.sessions])

  return {
    directoryState,
    selectedAgent,
    sessionShell,
    activeSessionHistory,
    runtimeControllerBySessionId,
    setRuntimeControllerBySessionId,
    sessionListState,
    sessionStatus,
    sessionError,
    historyRestoreError,
    createSessionLabel,
    createSessionButtonDisabled,
    renderedSessions,
    dragPreviewIndex,
    draggingSessionShell,
    sessionContextMenu,
    renamingSessionId,
    renamingValue,
    deleteConfirmationSessionId,
    sessionDragState,
    sessionListRef,
    sessionDragGhostRef,
    selectAgent,
    handleCreateSession,
    retryActiveSessionHistoryLoad,
    selectActiveSessionHistoryRun,
    handleActiveSessionRunSettled,
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu,
    dismissSessionContextMenu: dismissManagedSessionContextMenu,
    selectSessionContextSubmenu,
    requestSessionRename,
    updateSessionRenameValue,
    commitSessionRename,
    cancelSessionRename,
    duplicateSession,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
  }
}

