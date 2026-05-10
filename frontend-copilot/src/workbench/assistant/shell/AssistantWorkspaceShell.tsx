import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  createRuntimeThread,
  getRuntimeCapabilities,
  listRuntimeAgents,
} from '../../../features/copilot/chat-contract'
import {
  deleteCopilotHistoryThread,
  duplicateCopilotHistoryThread,
  getCopilotHistoryRunReplay,
  getCopilotHistoryThreadDetail,
  listCopilotHistoryThreads,
  renameCopilotHistoryThread,
} from '../../../features/copilot/history'
import { CopilotChatPanel } from '../../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController } from '../../../features/copilot/types'
import type { WorkbenchLanguage } from '../../locale'
import type { AssistantSessionShell } from '../../types'
import type { AssistantSessionHistoryState } from '../assistant-history-state'
import { AssistantAgentDirectoryPane } from '../AssistantAgentDirectoryPane'
import { AssistantSessionList } from '../AssistantSessionList'
import {
  emptyAssistantAgentDirectoryState,
  type AssistantAgentDirectoryState,
} from '../assistant-workspace-controller'
import { useAssistantWorkspaceState } from '../useAssistantWorkspaceState'

export interface AssistantWorkspaceShellProps {
  bootstrap: CopilotBootstrapController
  language?: WorkbenchLanguage
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeThread
  getCapabilities?: typeof getRuntimeCapabilities
  listHistoryThreads?: typeof listCopilotHistoryThreads
  getHistoryThreadDetail?: typeof getCopilotHistoryThreadDetail
  getHistoryRunReplay?: typeof getCopilotHistoryRunReplay
  renameHistoryThread?: typeof renameCopilotHistoryThread
  duplicateHistoryThread?: typeof duplicateCopilotHistoryThread
  deleteHistoryThread?: typeof deleteCopilotHistoryThread
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

const UI_PANEL_KEEPALIVE_CAPACITY = 10

export function AssistantWorkspaceShell({
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
  initialDirectoryState = emptyAssistantAgentDirectoryState,
  initialSessionShell = null,
}: AssistantWorkspaceShellProps) {
  const {
    directoryState,
    selectedAgent,
    sessionShell,
    sessionHistoryById,
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
    dismissSessionContextMenu,
    selectSessionContextSubmenu,
    selectAgent,
    handleCreateSession,
    retryActiveSessionHistoryLoad,
    selectActiveSessionHistoryRun,
    handleActiveSessionRunSettled,
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu,
    requestSessionRename,
    duplicateSession,
    updateSessionRenameValue,
    commitSessionRename,
    cancelSessionRename,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
  } = useAssistantWorkspaceState({
    bootstrap,
    language,
    listAgents: listAgentsImpl,
    createSession: createSessionImpl,
    getCapabilities: getCapabilitiesImpl,
    listHistoryThreads: listHistoryThreadsImpl,
    getHistoryThreadDetail: getHistoryThreadDetailImpl,
    getHistoryRunReplay: getHistoryRunReplayImpl,
    renameHistoryThread: renameHistoryThreadImpl,
    duplicateHistoryThread: duplicateHistoryThreadImpl,
    deleteHistoryThread: deleteHistoryThreadImpl,
    initialDirectoryState,
    initialSessionShell,
  })

  const activeSessionId = sessionShell?.sessionId ?? null
  const activeSessionHistory = activeSessionId === null ? null : sessionHistoryById[activeSessionId] ?? null
  const [keepAliveSessionIds, setKeepAliveSessionIds] = useState<string[]>(() => (
    activeSessionId !== null ? [activeSessionId] : []
  ))
  const [sessionSwitchRetention, setSessionSwitchRetention] = useState<SessionSwitchRetentionState | null>(null)
  const prevActiveSessionIdRef = useRef<string | null>(activeSessionId)
  const keepAliveSessionIdsRef = useRef<string[]>(keepAliveSessionIds)
  keepAliveSessionIdsRef.current = keepAliveSessionIds

  const immediateSessionSwitchRetention = resolveImmediateSessionSwitchRetention({
    activeSessionId,
    activeSessionHistory,
    keepAliveSessionIds,
    previousActiveSessionId: prevActiveSessionIdRef.current,
    sessionShell,
  })
  const effectiveSessionSwitchRetention = sessionSwitchRetention?.targetSessionId === activeSessionId
    ? sessionSwitchRetention
    : immediateSessionSwitchRetention
  const visibleSessionId = effectiveSessionSwitchRetention?.retainedSessionId ?? activeSessionId
  const pendingSwitchTargetSessionId = effectiveSessionSwitchRetention?.targetSessionId ?? null

  useEffect(() => {
    if (activeSessionId === null) {
      prevActiveSessionIdRef.current = null
      setSessionSwitchRetention(null)
      return
    }

    if (prevActiveSessionIdRef.current !== activeSessionId) {
      const previousActiveSessionId = prevActiveSessionIdRef.current
      const targetWasAlreadyKeptAlive = keepAliveSessionIdsRef.current.includes(activeSessionId)
      const shouldRetainPreviousSession = previousActiveSessionId !== null
        && !targetWasAlreadyKeptAlive
        && isRestoredSessionDetailPending(sessionShell, activeSessionHistory)

      prevActiveSessionIdRef.current = activeSessionId
      setSessionSwitchRetention(shouldRetainPreviousSession
        ? {
            targetSessionId: activeSessionId,
            retainedSessionId: previousActiveSessionId,
          }
        : null)
      setKeepAliveSessionIds((current) => computeKeepAliveSessionIds(
        current,
        activeSessionId,
        UI_PANEL_KEEPALIVE_CAPACITY,
      ))
    }
  }, [activeSessionHistory, activeSessionId, sessionShell])

  useEffect(() => {
    if (
      sessionSwitchRetention !== null
      && sessionSwitchRetention.targetSessionId === activeSessionId
      && !isRestoredSessionDetailPending(sessionShell, activeSessionHistory)
    ) {
      setSessionSwitchRetention(null)
    }
  }, [activeSessionHistory, activeSessionId, sessionShell, sessionSwitchRetention])

  const sessionShellById = useRef<Map<string, AssistantSessionShell>>(new Map())
  sessionShellById.current.clear()
  for (const sessionEntry of sessionListState.sessions) {
    sessionShellById.current.set(sessionEntry.sessionId, sessionEntry)
  }

  const activeNoop = useCallback(() => {}, [])
  const activeSessionRunSettledNoop = useCallback(() => {}, [])

  return (
    <section className="workspace-stage conversation-workspace" aria-label="助手工作区">
      <AssistantAgentDirectoryPane
        directoryState={directoryState}
        selectedAgent={selectedAgent}
        onSelectAgent={selectAgent}
        language={language}
      />

      <AssistantSessionList
        language={language}
        selectedAgent={selectedAgent}
        sessionListState={sessionListState}
        sessionStatus={sessionStatus}
        createSessionLabel={createSessionLabel}
        createSessionButtonDisabled={createSessionButtonDisabled}
        renderedSessions={renderedSessions}
        dragPreviewIndex={dragPreviewIndex}
        draggingSessionShell={draggingSessionShell}
        sessionContextMenu={sessionContextMenu}
        renamingSessionId={renamingSessionId}
        renamingValue={renamingValue}
        deleteConfirmationSessionId={deleteConfirmationSessionId}
        sessionDragState={sessionDragState}
        sessionError={sessionError}
        sessionListRef={sessionListRef}
        sessionDragGhostRef={sessionDragGhostRef}
        onCreateSession={() => {
          void handleCreateSession()
        }}
        onSessionPointerDown={handleSessionPointerDown}
        onSessionClick={handleSessionClick}
        onSessionContextMenu={handleSessionContextMenu}
        onRequestRename={requestSessionRename}
        onDuplicateSession={duplicateSession}
        onRenameValueChange={updateSessionRenameValue}
        onCommitRename={commitSessionRename}
        onCancelRename={cancelSessionRename}
        onRequestDelete={requestSessionDelete}
        onConfirmDelete={confirmSessionDelete}
        onCancelDelete={cancelSessionDelete}
        onDismissContextMenu={dismissSessionContextMenu}
        onSelectSubmenu={selectSessionContextSubmenu}
      />

      <main className="workspace-main workspace-main--chat" aria-label="会话主内容区">
        <div className="workspace-chat-layout" data-testid="assistant-chat-workspace">
          {keepAliveSessionIds.length === 0 ? (
            <CopilotChatPanel
              language={language}
              state={bootstrap.state}
              retrying={bootstrap.retrying}
              retry={bootstrap.retry}
              selectedAgent={selectedAgent}
              sessionShell={sessionShell}
              directoryState={directoryState}
              sessionStatus={sessionStatus}
              sessionError={sessionError}
              historyRestoreError={historyRestoreError}
              sessionHistory={null}
              retrySessionHistory={retryActiveSessionHistoryLoad}
              selectSessionHistoryRun={selectActiveSessionHistoryRun}
              onSessionRunSettled={handleActiveSessionRunSettled}
              runtimeControllerBySessionId={runtimeControllerBySessionId}
              setRuntimeControllerBySessionId={setRuntimeControllerBySessionId}
            />
          ) : (
            keepAliveSessionIds.map((sessionId) => {
              const isActive = sessionId === activeSessionId
              const isVisible = sessionId === visibleSessionId
              const isRetainedForPendingSwitch = sessionId !== activeSessionId
                && sessionId === effectiveSessionSwitchRetention?.retainedSessionId
              const panelSessionShell = sessionShellById.current.get(sessionId) ?? null
              const panelSessionHistory = sessionHistoryById[sessionId] ?? null

              if (panelSessionShell === null) {
                return null
              }

              return (
                <div
                  key={sessionId}
                  className="workspace-chat-keepalive-panel"
                  hidden={!isVisible}
                  aria-hidden={!isVisible}
                  data-keepalive-panel={sessionId}
                  data-session-switch-retained={isRetainedForPendingSwitch ? 'true' : undefined}
                  data-session-switch-pending-target={sessionId === pendingSwitchTargetSessionId ? 'true' : undefined}
                  {...(isRetainedForPendingSwitch ? { inert: '' } : {})}
                  style={isVisible ? undefined : { display: 'none' }}
                >
                  <CopilotChatPanel
                    language={language}
                    state={bootstrap.state}
                    retrying={bootstrap.retrying}
                    retry={bootstrap.retry}
                    selectedAgent={selectedAgent}
                    sessionShell={panelSessionShell}
                    directoryState={directoryState}
                    sessionStatus={isActive ? sessionStatus : 'idle'}
                    sessionError={isActive ? sessionError : null}
                    historyRestoreError={isActive ? historyRestoreError : null}
                    sessionHistory={panelSessionHistory}
                    retrySessionHistory={isActive ? retryActiveSessionHistoryLoad : activeNoop}
                    selectSessionHistoryRun={isActive ? selectActiveSessionHistoryRun : undefined}
                    onSessionRunSettled={isActive ? handleActiveSessionRunSettled : activeSessionRunSettledNoop}
                    renderLoadingSkeleton={isVisible}
                    runtimeControllerBySessionId={runtimeControllerBySessionId}
                    setRuntimeControllerBySessionId={setRuntimeControllerBySessionId}
                  />
                </div>
              )
            })
          )}
        </div>
      </main>
    </section>
  )
}

interface SessionSwitchRetentionState {
  targetSessionId: string
  retainedSessionId: string
}

function resolveImmediateSessionSwitchRetention(input: {
  activeSessionId: string | null
  activeSessionHistory: AssistantSessionHistoryState | null
  keepAliveSessionIds: readonly string[]
  previousActiveSessionId: string | null
  sessionShell: AssistantSessionShell | null
}): SessionSwitchRetentionState | null {
  if (
    input.activeSessionId === null
    || input.previousActiveSessionId === null
    || input.previousActiveSessionId === input.activeSessionId
    || input.keepAliveSessionIds.includes(input.activeSessionId)
    || !isRestoredSessionDetailPending(input.sessionShell, input.activeSessionHistory)
  ) {
    return null
  }

  return {
    targetSessionId: input.activeSessionId,
    retainedSessionId: input.previousActiveSessionId,
  }
}

function isRestoredSessionDetailPending(
  sessionShell: AssistantSessionShell | null,
  historyState: AssistantSessionHistoryState | null,
): boolean {
  if (historyState === null || historyState === undefined) {
    return sessionShell?.capabilities.capabilitiesVersion === 'history-shell'
  }

  return historyState.isPersistedThread === true
    && historyState.hasLoadedDetail !== true
    && historyState.detailStatus !== 'ready'
    && historyState.detailStatus !== 'error'
}

function computeKeepAliveSessionIds(
  current: readonly string[],
  activeSessionId: string,
  capacity: number,
): string[] {
  const filtered = current.filter((id) => id !== activeSessionId)
  const next = [activeSessionId, ...filtered]

  if (next.length <= capacity) {
    return next
  }

  return next.slice(0, capacity)
}
