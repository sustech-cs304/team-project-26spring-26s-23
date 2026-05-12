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
import {
  useAssistantWorkspaceState,
  type CopilotThreadRuntimeControllerState,
} from '../useAssistantWorkspaceState'
import type { AssistantWorkspaceSessionStatus } from '../assistant-workspace-session-controller'
import type { AgentType } from '../../types'

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return { targetSessionId: input.activeSessionId, retainedSessionId: input.previousActiveSessionId }
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
  return next.length <= capacity ? next : next.slice(0, capacity)
}

// ---------------------------------------------------------------------------
// Sub-hook: keep-alive session switch retention
// ---------------------------------------------------------------------------

function useAssistantSessionKeepAlive(input: {
  activeSessionId: string | null
  activeSessionHistory: AssistantSessionHistoryState | null
  sessionShell: AssistantSessionShell | null
}) {
  const { activeSessionId, activeSessionHistory, sessionShell } = input
  const [keepAliveSessionIds, setKeepAliveSessionIds] = useState<string[]>(() => (
    activeSessionId !== null ? [activeSessionId] : []
  ))
  const [sessionSwitchRetention, setSessionSwitchRetention] = useState<SessionSwitchRetentionState | null>(null)
  const prevActiveSessionIdRef = useRef<string | null>(activeSessionId)
  const keepAliveSessionIdsRef = useRef<string[]>(keepAliveSessionIds)
  keepAliveSessionIdsRef.current = keepAliveSessionIds

  const immediateRetention = resolveImmediateSessionSwitchRetention({
    activeSessionId, activeSessionHistory, keepAliveSessionIds,
    previousActiveSessionId: prevActiveSessionIdRef.current, sessionShell,
  })
  const effectiveRetention = sessionSwitchRetention?.targetSessionId === activeSessionId
    ? sessionSwitchRetention
    : immediateRetention

  useEffect(() => {
    if (activeSessionId === null) {
      prevActiveSessionIdRef.current = null
      setSessionSwitchRetention(null)
      return
    }
    if (prevActiveSessionIdRef.current !== activeSessionId) {
      const previous = prevActiveSessionIdRef.current
      const alreadyKept = keepAliveSessionIdsRef.current.includes(activeSessionId)
      const shouldRetain = previous !== null && !alreadyKept
        && isRestoredSessionDetailPending(sessionShell, activeSessionHistory)
      prevActiveSessionIdRef.current = activeSessionId
      setSessionSwitchRetention(shouldRetain
        ? { targetSessionId: activeSessionId, retainedSessionId: previous }
        : null)
      setKeepAliveSessionIds((c) => computeKeepAliveSessionIds(c, activeSessionId, UI_PANEL_KEEPALIVE_CAPACITY))
    }
  }, [activeSessionHistory, activeSessionId, sessionShell])

  useEffect(() => {
    if (sessionSwitchRetention !== null
      && sessionSwitchRetention.targetSessionId === activeSessionId
      && !isRestoredSessionDetailPending(sessionShell, activeSessionHistory)
    ) {
      setSessionSwitchRetention(null)
    }
  }, [activeSessionHistory, activeSessionId, sessionShell, sessionSwitchRetention])

  return { keepAliveSessionIds, effectiveSessionSwitchRetention: effectiveRetention }
}

// ---------------------------------------------------------------------------
// Helper: Renders a single keep-alive chat panel slot
// ---------------------------------------------------------------------------

interface AssistantChatPanelSlotProps {
  sessionId: string
  isActive: boolean
  isVisible: boolean
  isRetained: boolean
  isPendingTarget: boolean
  panelSessionShell: AssistantSessionShell
  panelSessionHistory: AssistantSessionHistoryState | null
  bootstrap: CopilotBootstrapController
  language: string
  selectedAgent: AgentType | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: AssistantWorkspaceSessionStatus
  sessionError: string | null
  historyRestoreError: string | null
  retrySessionHistory: () => void
  selectSessionHistoryRun: ((runId: string | null) => void) | undefined
  onSessionRunSettled: (runId: string | null, sessionId: string | null) => void
  runtimeControllerBySessionId: Record<string, CopilotThreadRuntimeControllerState>
  setRuntimeControllerBySessionId: React.Dispatch<React.SetStateAction<Record<string, CopilotThreadRuntimeControllerState>>>
}

function AssistantChatPanelSlot({
  sessionId, isActive, isVisible, isRetained, isPendingTarget,
  panelSessionShell, panelSessionHistory,
  bootstrap, language, selectedAgent, directoryState,
  sessionStatus, sessionError, historyRestoreError,
  retrySessionHistory, selectSessionHistoryRun, onSessionRunSettled,
  runtimeControllerBySessionId, setRuntimeControllerBySessionId,
}: AssistantChatPanelSlotProps) {
  const activeNoop = useCallback(() => {}, [])
  const noopSettled = useCallback(() => {}, [])

  return (
    <div
      key={sessionId}
      className="workspace-chat-keepalive-panel"
      hidden={!isVisible}
      aria-hidden={!isVisible}
      data-keepalive-panel={sessionId}
      data-session-switch-retained={isRetained ? 'true' : undefined}
      data-session-switch-pending-target={isPendingTarget ? 'true' : undefined}
      {...(isRetained ? { inert: '' } : {})}
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
        retrySessionHistory={isActive ? retrySessionHistory : activeNoop}
        selectSessionHistoryRun={isActive ? selectSessionHistoryRun : undefined}
        onSessionRunSettled={isActive ? onSessionRunSettled : noopSettled}
        renderLoadingSkeleton={isVisible}
        runtimeControllerBySessionId={runtimeControllerBySessionId}
        setRuntimeControllerBySessionId={setRuntimeControllerBySessionId}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

// Top-level workspace orchestrator: wires the main state hook, keep-alive
// logic, and three major UI panes (directory, session list, chat panel).
// Further extraction would scatter the single source of truth across
// multiple fragments without reducing the component's essential function.
// eslint-disable-next-line max-lines-per-function
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
    directoryState, selectedAgent, sessionShell, sessionHistoryById,
    runtimeControllerBySessionId, setRuntimeControllerBySessionId,
    sessionListState, sessionStatus, sessionError, historyRestoreError,
    createSessionLabel, createSessionButtonDisabled,
    renderedSessions, dragPreviewIndex, draggingSessionShell,
    sessionContextMenu, renamingSessionId, renamingValue, deleteConfirmationSessionId,
    sessionDragState, sessionListRef, sessionDragGhostRef,
    dismissSessionContextMenu, selectSessionContextSubmenu,
    selectAgent, handleCreateSession,
    retryActiveSessionHistoryLoad, selectActiveSessionHistoryRun,
    handleActiveSessionRunSettled,
    handleSessionPointerDown, handleSessionClick, handleSessionContextMenu,
    requestSessionRename, duplicateSession, updateSessionRenameValue,
    commitSessionRename, cancelSessionRename,
    requestSessionDelete, confirmSessionDelete, cancelSessionDelete,
  } = useAssistantWorkspaceState({
    bootstrap, language, listAgents: listAgentsImpl, createSession: createSessionImpl,
    getCapabilities: getCapabilitiesImpl, listHistoryThreads: listHistoryThreadsImpl,
    getHistoryThreadDetail: getHistoryThreadDetailImpl, getHistoryRunReplay: getHistoryRunReplayImpl,
    renameHistoryThread: renameHistoryThreadImpl, duplicateHistoryThread: duplicateHistoryThreadImpl,
    deleteHistoryThread: deleteHistoryThreadImpl,
    initialDirectoryState, initialSessionShell,
  })

  const activeSessionId = sessionShell?.sessionId ?? null
  const activeSessionHistory = activeSessionId === null ? null : sessionHistoryById[activeSessionId] ?? null

  const { keepAliveSessionIds, effectiveSessionSwitchRetention } = useAssistantSessionKeepAlive({
    activeSessionId, activeSessionHistory, sessionShell,
  })

  const visibleSessionId = effectiveSessionSwitchRetention?.retainedSessionId ?? activeSessionId
  const pendingSwitchTargetId = effectiveSessionSwitchRetention?.targetSessionId ?? null

  // Build a lookup map for session shells (used by keep-alive panel slots)
  const sessionShellById = useRef<Map<string, AssistantSessionShell>>(new Map())
  sessionShellById.current.clear()
  for (const se of sessionListState.sessions) {
    sessionShellById.current.set(se.sessionId, se)
  }

  return (
    <section className="workspace-stage conversation-workspace" aria-label="助手工作区">
      <AssistantAgentDirectoryPane
        directoryState={directoryState} selectedAgent={selectedAgent}
        onSelectAgent={selectAgent} language={language}
      />
      <AssistantSessionList
        language={language} selectedAgent={selectedAgent}
        sessionListState={sessionListState} sessionStatus={sessionStatus}
        createSessionLabel={createSessionLabel}
        createSessionButtonDisabled={createSessionButtonDisabled}
        renderedSessions={renderedSessions}
        dragPreviewIndex={dragPreviewIndex}
        draggingSessionShell={draggingSessionShell}
        sessionContextMenu={sessionContextMenu}
        renamingSessionId={renamingSessionId} renamingValue={renamingValue}
        deleteConfirmationSessionId={deleteConfirmationSessionId}
        sessionDragState={sessionDragState} sessionError={sessionError}
        sessionListRef={sessionListRef} sessionDragGhostRef={sessionDragGhostRef}
        onCreateSession={() => { void handleCreateSession() }}
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
              language={language} state={bootstrap.state}
              retrying={bootstrap.retrying} retry={bootstrap.retry}
              selectedAgent={selectedAgent} sessionShell={sessionShell}
              directoryState={directoryState} sessionStatus={sessionStatus}
              sessionError={sessionError} historyRestoreError={historyRestoreError}
              sessionHistory={null} retrySessionHistory={retryActiveSessionHistoryLoad}
              selectSessionHistoryRun={selectActiveSessionHistoryRun}
              onSessionRunSettled={handleActiveSessionRunSettled}
              runtimeControllerBySessionId={runtimeControllerBySessionId}
              setRuntimeControllerBySessionId={setRuntimeControllerBySessionId}
            />
          ) : (
            keepAliveSessionIds.map((sessionId) => {
              const isActive = sessionId === activeSessionId
              const isVisible = sessionId === visibleSessionId
              const isRetained = sessionId !== activeSessionId
                && sessionId === effectiveSessionSwitchRetention?.retainedSessionId
              const panelShell = sessionShellById.current.get(sessionId) ?? null
              const panelHistory = sessionHistoryById[sessionId] ?? null
              if (panelShell === null) { return null }

              return (
                <AssistantChatPanelSlot
                  key={sessionId}
                  sessionId={sessionId}
                  isActive={isActive}
                  isVisible={isVisible}
                  isRetained={isRetained}
                  isPendingTarget={sessionId === pendingSwitchTargetId}
                  panelSessionShell={panelShell}
                  panelSessionHistory={panelHistory}
                  bootstrap={bootstrap}
                  language={language}
                  selectedAgent={selectedAgent}
                  directoryState={directoryState}
                  sessionStatus={sessionStatus}
                  sessionError={sessionError}
                  historyRestoreError={historyRestoreError}
                  retrySessionHistory={retryActiveSessionHistoryLoad}
                  selectSessionHistoryRun={selectActiveSessionHistoryRun}
                  onSessionRunSettled={handleActiveSessionRunSettled}
                  runtimeControllerBySessionId={runtimeControllerBySessionId}
                  setRuntimeControllerBySessionId={setRuntimeControllerBySessionId}
                />
              )
            })
          )}
        </div>
      </main>
    </section>
  )
}
