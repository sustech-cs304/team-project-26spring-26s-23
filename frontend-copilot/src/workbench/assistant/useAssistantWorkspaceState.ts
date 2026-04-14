import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
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
  retryAssistantSessionHistoryDetail,
  retryAssistantSessionHistoryReplay,
  selectAssistantSessionHistoryRun,
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
  handleActiveSessionRunSettled: (runId: string | null) => void
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
  const persistedShellStateRef = useRef(loadShellStateImpl())
  const [sessionHistoryById, setSessionHistoryById] = useState<Record<string, AssistantSessionHistoryState>>({})
  const historyListRequestVersionRef = useRef(0)
  const historyDetailRequestVersionRef = useRef<Record<string, number>>({})
  const historyReplayRequestVersionRef = useRef<Record<string, number>>({})
  const historyRestoreRetryTimerRef = useRef<number | null>(null)
  const [historyRestoreRetryKey, setHistoryRestoreRetryKey] = useState(0)
  const isMountedRef = useRef(true)
  const [historyRestoreError, setHistoryRestoreError] = useState<string | null>(null)

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

  const retrySessionHistoryLoad = useCallback((sessionId: string) => {
    setSessionHistoryById((current) => {
      const historyState = current[sessionId]
      if (historyState === undefined) {
        return current
      }

      const nextHistoryState = historyState.detailStatus === 'error'
        ? retryAssistantSessionHistoryDetail(historyState)
        : historyState.replayStatus === 'error'
          ? retryAssistantSessionHistoryReplay(historyState)
          : historyState

      return nextHistoryState === historyState
        ? current
        : {
            ...current,
            [sessionId]: nextHistoryState,
          }
    })
  }, [])

  const activateSessionWithHistoryRetry = useCallback((sessionEntry: AssistantSessionShell) => {
    retrySessionHistoryLoad(sessionEntry.sessionId)
    activateSession(sessionEntry)
  }, [activateSession, retrySessionHistoryLoad])

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

        const selectedRunId = persistedShellStateRef.current.selectedRunIdByThreadId[sessionEntry.sessionId] ?? null
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
      return nextHistoryState === historyState
        ? current
        : {
            ...current,
            [sessionShell.sessionId]: nextHistoryState,
          }
    })
  }, [sessionShell])

  const handleActiveSessionRunSettled = useCallback((runId: string | null) => {
    if (sessionShell === null) {
      return
    }

    setSessionHistoryById((current) => {
      const historyState = current[sessionShell.sessionId]
        ?? createAssistantSessionHistoryStateFromSessionShell(sessionShell, runId)
      const nextHistoryState = retryAssistantSessionHistoryDetail(
        selectAssistantSessionHistoryRun(historyState, runId),
      )

      return {
        ...current,
        [sessionShell.sessionId]: nextHistoryState,
      }
    })
    setHistoryRestoreRetryKey((current) => current + 1)
  }, [sessionShell])

  const handleCreateSession = useCallback(async () => {
    dismissManagedSessionContextMenu()
    await createSessionForSelectedAgent()
  }, [createSessionForSelectedAgent, dismissManagedSessionContextMenu])

  const clearHistoryRestoreRetry = useCallback(() => {
    if (historyRestoreRetryTimerRef.current === null) {
      return
    }

    window.clearTimeout(historyRestoreRetryTimerRef.current)
    historyRestoreRetryTimerRef.current = null
  }, [])

  const scheduleHistoryRestoreRetry = useCallback(() => {
    if (historyRestoreRetryTimerRef.current !== null) {
      return
    }

    historyRestoreRetryTimerRef.current = window.setTimeout(() => {
      historyRestoreRetryTimerRef.current = null
      if (!isMountedRef.current) {
        return
      }

      setHistoryRestoreRetryKey((current) => current + 1)
    }, 0)
  }, [])


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
    if (restoredRuntimeUrlRef.current === restoreKey) {
      return
    }

    const requestVersion = historyListRequestVersionRef.current + 1
    historyListRequestVersionRef.current = requestVersion
    let cancelled = false

    void (async () => {
      const persistedShellState = persistedShellStateRef.current

      try {
        const historyResult = await listHistoryThreadsImpl()

        if (cancelled || !isMountedRef.current || historyListRequestVersionRef.current !== requestVersion) {
          return
        }

        if (!historyResult.ok) {
          restoredRuntimeUrlRef.current = null
          setHistoryRestoreError(historyResult.error)
          scheduleHistoryRestoreRetry()
          return
        }

        const restoredSessions = historyResult.threads.map((summary) => createAssistantSessionShellFromHistorySummary({
          summary,
          agents: directoryState.agents,
        }))
        const preferredActiveSessionId = persistedShellState.selectedThreadId !== null
          && restoredSessions.some((sessionEntry) => sessionEntry.sessionId === persistedShellState.selectedThreadId)
          ? persistedShellState.selectedThreadId
          : restoredSessions[0]?.sessionId ?? null

        setSessionListState((current) => {
          const restoredSessionIds = new Set(restoredSessions.map((sessionEntry) => sessionEntry.sessionId))
          const liveOnlySessions = current.sessions.filter((sessionEntry) => !restoredSessionIds.has(sessionEntry.sessionId))
          const mergedSessions = [...restoredSessions, ...liveOnlySessions]
          const nextActiveSessionId = preferredActiveSessionId
            ?? (current.activeSessionId !== null && mergedSessions.some((sessionEntry) => sessionEntry.sessionId === current.activeSessionId)
              ? current.activeSessionId
              : mergedSessions[0]?.sessionId ?? null)

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
            nextState[summary.threadId] = currentHistoryState === undefined
              ? createAssistantSessionHistoryState(summary, selectedRunId)
              : syncAssistantSessionHistorySummary(currentHistoryState, summary, selectedRunId)
          }

          for (const [sessionId, historyState] of Object.entries(current)) {
            if (nextState[sessionId] === undefined) {
              nextState[sessionId] = historyState
            }
          }

          return nextState
        })

        if (preferredActiveSessionId !== null) {
          const activeSession = restoredSessions.find((sessionEntry) => sessionEntry.sessionId === preferredActiveSessionId) ?? null
          if (activeSession !== null) {
            setSelectedAgentId(activeSession.boundAgent.id)
          }
        }

        clearHistoryRestoreRetry()
        setHistoryRestoreError(null)
        restoredRuntimeUrlRef.current = restoreKey
      } catch (error) {
        if (cancelled || !isMountedRef.current || historyListRequestVersionRef.current !== requestVersion) {
          return
        }

        restoredRuntimeUrlRef.current = null
        setHistoryRestoreError(formatAssistantWorkspaceError(error))
        scheduleHistoryRestoreRetry()
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

    let cancelled = false

    void getCapabilitiesImpl({
      runtimeUrl: bootstrap.state.runtimeUrl,
      sessionId: sessionShell.sessionId,
    })
      .then((response) => {
        if (cancelled) {
          return
        }

        setSessionListState((current) => ({
          ...current,
          sessions: current.sessions.map((sessionEntry) => sessionEntry.sessionId === sessionShell.sessionId
            ? applyAssistantSessionCapabilities(sessionEntry, response)
            : sessionEntry),
        }))
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [bootstrap.state, getCapabilitiesImpl, sessionShell, setSessionListState])

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

    void (async () => {
      const detailResult = await getHistoryThreadDetailImpl(sessionId)
      if (
        !isMountedRef.current
        || historyDetailRequestVersionRef.current[sessionId] !== requestVersion
      ) {
        return
      }

      if (!detailResult.ok) {
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionHistoryDetailError(
            current[sessionId] ?? historyState,
            detailResult.error,
          ),
        }))
        return
      }

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
    if (
      historyState === undefined
      || historyState.detailStatus !== 'ready'
      || selectedRunId === null
      || historyState.replayStatus !== 'idle'
      || historyState.replay?.run.runId === selectedRunId
    ) {
      return
    }

    const requestVersion = (historyReplayRequestVersionRef.current[sessionId] ?? 0) + 1
    historyReplayRequestVersionRef.current[sessionId] = requestVersion

    setSessionHistoryById((current) => ({
      ...current,
      [sessionId]: setAssistantSessionHistoryReplayLoading(historyState),
    }))

    void (async () => {
      const replayResult = await getHistoryRunReplayImpl(selectedRunId)
      if (
        !isMountedRef.current
        || historyReplayRequestVersionRef.current[sessionId] !== requestVersion
      ) {
        return
      }

      if (!replayResult.ok) {
        setSessionHistoryById((current) => ({
          ...current,
          [sessionId]: setAssistantSessionHistoryReplayError(
            current[sessionId] ?? historyState,
            replayResult.error,
          ),
        }))
        return
      }

      setSessionHistoryById((current) => ({
        ...current,
        [sessionId]: applyAssistantSessionHistoryReplay(
          current[sessionId] ?? historyState,
          replayResult,
        ),
      }))
    })()
  }, [
    getHistoryRunReplayImpl,
    historyReplayRequestVersionRef,
    isMountedRef,
    sessionHistoryById,
    sessionShell,
    setSessionHistoryById,
  ])

  useEffect(() => {
    const selectedRunIdByThreadId = Object.fromEntries(
      Object.entries(sessionHistoryById).flatMap(([sessionId, historyState]) => {
        const selectedRunId = historyState.selectedRunId?.trim() ?? ''
        return selectedRunId === '' ? [] : [[sessionId, selectedRunId] as const]
      }),
    )

    const nextShellState = {
      selectedThreadId: sessionListState.activeSessionId,
      selectedRunIdByThreadId,
    }
    persistedShellStateRef.current = nextShellState
    persistShellStateImpl(nextShellState)
  }, [persistShellStateImpl, sessionHistoryById, sessionListState.activeSessionId])

  return {
    directoryState,
    selectedAgent,
    sessionShell,
    activeSessionHistory,
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

