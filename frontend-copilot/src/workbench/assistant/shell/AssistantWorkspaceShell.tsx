/* eslint-disable react-refresh/only-export-components */

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
    dismissSessionContextMenu,
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
        onSelectSubmenu={() => undefined}
      />

      <main className="workspace-main workspace-main--chat" aria-label="会话主内容区">
        <div className="workspace-chat-layout" data-testid="assistant-chat-workspace">
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
            sessionHistory={activeSessionHistory}
            retrySessionHistory={retryActiveSessionHistoryLoad}
            selectSessionHistoryRun={selectActiveSessionHistoryRun}
            onSessionRunSettled={handleActiveSessionRunSettled}
            runtimeControllerBySessionId={runtimeControllerBySessionId}
            setRuntimeControllerBySessionId={setRuntimeControllerBySessionId}
          />
        </div>
      </main>
    </section>
  )
}
