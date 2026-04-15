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
  getCopilotHistoryRunReplay,
  getCopilotHistoryThreadDetail,
  listCopilotHistoryThreads,
} from '../../features/copilot/history'
import { appendCopilotDebugLog, isCopilotDebugModeEnabled } from '../../features/copilot/debug-mode-log'
import {
  syncCopilotThreadRuntimeControllerStateRecord,
  updateCopilotThreadRuntimeControllerStateRecord,
  type CopilotThreadRuntimeControllerState,
} from '../../features/copilot/thread-runtime-controller'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AgentType, AssistantSessionShell } from '../types'
import type {
  AssistantSessionContextMenuState,
  AssistantSessionContextSubmenu,
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
import {
  type AssistantWorkspaceSessionStatus,
} from './assistant-workspace-session-controller'
import { useAssistantDirectoryState } from './useAssistantDirectoryState'
import { useAssistantSessionCreation } from './useAssistantSessionCreation'
import { useAssistantSessionInteractionState } from './useAssistantSessionInteractionState'
import { useAssistantSessionManagementState } from './state/useAssistantSessionManagementState'

interface UseAssistantWorkspaceStateInput {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeThread
  getCapabilities?: typeof getRuntimeCapabilities
  listHistoryThreads?: typeof listCopilotHistoryThreads
  getHistoryThreadDetail?: typeof getCopilotHistoryThreadDetail
  getHistoryRunReplay?: typeof getCopilotHistoryRunReplay
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
  requestSessionRename: (sessionId: string) => void
  updateSessionRenameValue: (value: string) => void
  commitSessionRename: () => void
  cancelSessionRename: () => void
  requestSessionDelete: (sessionId: string) => void
  confirmSessionDelete: (sessionId: string) => void
  cancelSessionDelete: () => void
  selectSessionSubmenu: (submenu: AssistantSessionContextSubmenu | null) => void
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

export function useAssistantWorkspaceState({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeThread,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  listHistoryThreads: listHistoryThreadsImpl = listCopilotHistoryThreads,
  getHistoryThreadDetail: getHistoryThreadDetailImpl = getCopilotHistoryThreadDetail,
  getHistoryRunReplay: getHistoryRunReplayImpl = getCopilotHistoryRunReplay,
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
  const historyListRequestVersionRef = useRef(0)
  const historyCapabilitiesRequestVersionRef = useRef<Record<string, number>>({})
  const historyDetailRequestVersionRef = useRef<Record<string, number>>({})
  const historyReplayRequestVersionRef = useRef<Record<string, number>>({})
  const historyRestoreRetryTimerRef = useRef<number | null>(null)
  const [historyRestoreRetryKey, setHistoryRestoreRetryKey] = useState(0)
  const isMountedRef = useRef(true)
  const [historyRestoreError, setHistoryRestoreError] = useState<string | null>(null)
  const debugModeEnabled = isCopilotDebugModeEnabled(bootstrap.state)
  const debugModeEnabledRef = useRef(debugModeEnabled)
  const appendWorkspaceDebugLog = useCallback((event: string, context: Record<string, unknown> = {}) => {
    appendCopilotDebugLog(debugModeEnabledRef.current, 'assistant-workspace', event, context)
  }, [])

  useEffect(() => {
    debugModeEnabledRef.current = debugModeEnabled
  }, [debugModeEnabled])

  useEffect(() => () => {
    isMountedRef.current = false
    if (historyRestoreRetryTimerRef.current !== null) {
      window.clearTimeout(historyRestoreRetryTimerRef.current)
      historyRestoreRetryTimerRef.current = null
    }
  }, [])

  const {
    directoryState,
    selectedAgent,
    selectAgent,
    setSelectedAgentId,
  } = useAssistantDirectoryState({
    bootstrap,
    listAgents: listAgentsImpl,
    initialDirectoryState,
  })
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
    }

    retrySessionHistoryLoad(sessionEntry.sessionId)
    activateSession(sessionEntry)
  }, [
    activateSession,
    appendWorkspaceDebugLog,
    markUserLiveSessionSelection,
    retrySessionHistoryLoad,
    sessionHistoryById,
    sessionListState.activeSessionId,
  ])

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
    selectSessionSubmenu,
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
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
  } = useAssistantSessionManagementState({
    sessionListState,
    setSessionListState,
    setSelectedAgentId,
    dismissSessionContextMenu,
    showSessionContextMenu,
  })

  const activeSessionHistory = sessionShell === null
    ? null
    : sessionHistoryById[sessionShell.sessionId] ?? null

  useEffect(() => {
    setSessionHistoryById((current) => {
      let hasChanged = false
      const nextState = { ...current }
      const sessionIds = new Set(sessionListState.sessions.map((sessionEntry) => sessionEntry.sessionId))

      for (const sessionEntry of sessionListState.sessions) {
        if (nextState[sessionEntry.sessionId] !== undefined) {
          continue
        }

        const selectedRunId = sessionEntry.capabilities.capabilitiesVersion === 'history-shell'
          ? persistedShellStateRef.current.selectedRunIdByThreadId[sessionEntry.sessionId] ?? null
          : null
        nextState[sessionEntry.sessionId] = createAssistantSessionHistoryStateFromSessionShell(sessionEntry, selectedRunId)
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
  }, [sessionListState.sessions])

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

        const currentSessionsById = new Map(
          sessionListStateRef.current.sessions.map((sessionEntry) => [sessionEntry.sessionId, sessionEntry] as const),
        )
        const restoredSessions = historyResult.threads.map((summary) => {
          const restoredSession = createAssistantSessionShellFromHistorySummary({
            summary,
            agents: directoryState.agents,
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
        let restoreSelectionSummary: Record<string, unknown> | null = null

        setSessionListState((current) => {
          const restoredSessionIds = new Set(restoredSessions.map((sessionEntry) => sessionEntry.sessionId))
          const liveOnlySessions = current.sessions.filter((sessionEntry) => !restoredSessionIds.has(sessionEntry.sessionId))
          const mergedSessions = [...restoredSessions, ...liveOnlySessions]
          const currentActiveSession = current.activeSessionId === null
            ? null
            : current.sessions.find((sessionEntry) => sessionEntry.sessionId === current.activeSessionId) ?? null
          const currentActiveSessionIsLiveOnly = currentActiveSession !== null
            && currentActiveSession.capabilities.capabilitiesVersion !== 'history-shell'
            && !restoredSessionIds.has(currentActiveSession.sessionId)
          const preserveCurrentActiveLiveSession = currentActiveSessionIsLiveOnly
            || (shouldProtectUserLiveSelection && currentActiveSession !== null && currentActiveSession.capabilities.capabilitiesVersion !== 'history-shell')
          const nextActiveSessionId = preserveCurrentActiveLiveSession
            ? current.activeSessionId
            : preferredActiveSessionId
              ?? (current.activeSessionId !== null && mergedSessions.some((sessionEntry) => sessionEntry.sessionId === current.activeSessionId)
                ? current.activeSessionId
                : mergedSessions[0]?.sessionId ?? null)

          restoreSelectionSummary = {
            previousActiveSessionId: current.activeSessionId,
            nextActiveSessionId,
            activeSessionChanged: current.activeSessionId !== nextActiveSessionId,
            liveOnlySessionCount: liveOnlySessions.length,
            mergedSessionCount: mergedSessions.length,
            currentActiveSessionIsLiveOnly,
            preserveCurrentActiveLiveSession,
          }

          return {
            sessions: mergedSessions,
            activeSessionId: nextActiveSessionId,
          }
        })
        setSessionHistoryById((current) => {
          const nextState: Record<string, AssistantSessionHistoryState> = {}
          for (const summary of historyResult.threads) {
            const selectedRunId = persistedShellState.selectedRunIdByThreadId[summary.threadId] ?? null
            const currentHistoryState = current[summary.threadId]
            const syncedHistoryState = currentHistoryState === undefined
              ? createAssistantSessionHistoryState(summary, selectedRunId)
              : syncAssistantSessionHistorySummary(currentHistoryState, summary, selectedRunId)
            const restoredSession = restoredSessionsById.get(summary.threadId)
            const shouldRestartCapabilitiesHydration = currentHistoryState !== undefined
              && currentHistoryState.isPersistedThread !== true
              && restoredSession?.capabilities.capabilitiesVersion === 'history-shell'

            nextState[summary.threadId] = shouldRestartCapabilitiesHydration
              ? {
                  ...syncedHistoryState,
                  capabilitiesStatus: 'idle',
                  capabilitiesError: null,
                }
              : syncedHistoryState
          }

          for (const [sessionId, historyState] of Object.entries(current)) {
            if (nextState[sessionId] === undefined) {
              nextState[sessionId] = historyState
            }
          }

          return nextState
        })

        const isProvisionalEmptyRestore = historyResult.threads.length === 0
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
            retryDelayMs,
            preferredActiveSessionId,
            shouldProtectUserLiveSelection,
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
          preferredActiveSessionId,
          shouldProtectUserLiveSelection,
          ...(restoreSelectionSummary ?? {}),
        })

        if (!shouldProtectUserLiveSelection && preferredActiveSessionId !== null) {
          const activeSession = restoredSessions.find((sessionEntry) => sessionEntry.sessionId === preferredActiveSessionId) ?? null
          if (activeSession !== null) {
            setSelectedAgentId(activeSession.boundAgent.id)
          }
        }

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
    bootstrap.state,
    clearHistoryRestoreRetry,
    directoryState.agents,
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
    const selectedRunIdByThreadId = Object.fromEntries(
      Object.entries(sessionHistoryById).flatMap(([sessionId, historyState]) => {
        const persistableSelectedRunId = resolveAssistantSessionHistoryPersistableSelectedRunId(historyState)
        return persistableSelectedRunId === null ? [] : [[sessionId, persistableSelectedRunId] as const]
      }),
    )

    const nextShellState = {
      selectedThreadId: sessionListState.activeSessionId,
      selectedRunIdByThreadId,
    }
    appendWorkspaceDebugLog('workspace-shell-state-persisted', {
      selectedThreadId: nextShellState.selectedThreadId,
      selectedRunIdCount: Object.keys(nextShellState.selectedRunIdByThreadId).length,
      selectedRunIdByThreadId: nextShellState.selectedRunIdByThreadId,
      skippedSelectedRunCount: Object.keys(sessionHistoryById).length - Object.keys(nextShellState.selectedRunIdByThreadId).length,
    })
    persistedShellStateRef.current = nextShellState
    persistShellStateImpl(nextShellState)
  }, [appendWorkspaceDebugLog, persistShellStateImpl, sessionHistoryById, sessionListState.activeSessionId])

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
    requestSessionRename,
    updateSessionRenameValue,
    commitSessionRename,
    cancelSessionRename,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
    selectSessionSubmenu,
  }
}

