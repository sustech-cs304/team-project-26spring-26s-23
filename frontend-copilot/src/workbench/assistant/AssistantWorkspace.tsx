import {
  createRuntimeSession,
  getRuntimeCapabilities,
  listRuntimeAgents,
} from '../../features/copilot/chat-contract'
import { CopilotChatPanel } from '../../features/copilot/CopilotChatPanel'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AssistantSessionShell } from '../types'
import { AssistantAgentDirectoryPane } from './AssistantAgentDirectoryPane'
import {
  AssistantSessionList,
} from './AssistantSessionList'
import {
  emptyAssistantAgentDirectoryState,
  type AssistantAgentDirectoryState,
} from './assistant-workspace-controller'
import { useAssistantWorkspaceState } from './useAssistantWorkspaceState'

export type {
  AssistantAgentDirectoryState,
  AssistantSessionListState,
} from './assistant-workspace-controller'
export {
  createAssistantAgentDirectoryState,
  createAssistantSessionCapabilities,
  createAssistantSessionShell,
} from './assistant-workspace-controller'
export { createAssistantSessionShellForAgent } from './assistant-workspace-session-controller'
export {
  appendAssistantSessionShell,
  createAssistantSessionListState,
  moveAssistantSessionShellToIndex,
  reorderAssistantSessionShells,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'

console.info('[startup]', JSON.stringify({
  scope: 'AssistantWorkspace',
  stage: 'module-evaluated',
  t: Math.round(performance.now()),
}))

interface AssistantWorkspaceProps {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeSession
  getCapabilities?: typeof getRuntimeCapabilities
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

export function AssistantWorkspace({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeSession,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  initialDirectoryState = emptyAssistantAgentDirectoryState,
  initialSessionShell = null,
}: AssistantWorkspaceProps) {
  const {
    directoryState,
    selectedAgent,
    sessionShell,
    sessionListState,
    sessionStatus,
    sessionError,
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
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu,
    dismissSessionContextMenu,
    requestSessionRename,
    updateSessionRenameValue,
    commitSessionRename,
    cancelSessionRename,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
    selectSessionSubmenu,
  } = useAssistantWorkspaceState({
    bootstrap,
    listAgents: listAgentsImpl,
    createSession: createSessionImpl,
    getCapabilities: getCapabilitiesImpl,
    initialDirectoryState,
    initialSessionShell,
  })

  return (
    <section className="workspace-stage conversation-workspace" aria-label="助手工作区">
      <AssistantAgentDirectoryPane
        directoryState={directoryState}
        selectedAgent={selectedAgent}
        onSelectAgent={selectAgent}
      />

      <AssistantSessionList
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
        onDismissContextMenu={dismissSessionContextMenu}
        onRequestRename={requestSessionRename}
        onRenameValueChange={updateSessionRenameValue}
        onCommitRename={commitSessionRename}
        onCancelRename={cancelSessionRename}
        onRequestDelete={requestSessionDelete}
        onConfirmDelete={confirmSessionDelete}
        onCancelDelete={cancelSessionDelete}
        onSelectSubmenu={selectSessionSubmenu}
      />

      <main className="workspace-main workspace-main--chat" aria-label="会话主内容区">
        <div className="workspace-chat-layout" data-testid="assistant-chat-workspace">
          <CopilotChatPanel
            state={bootstrap.state}
            retrying={bootstrap.retrying}
            retry={bootstrap.retry}
            selectedAgent={selectedAgent}
            sessionShell={sessionShell}
            directoryState={directoryState}
            sessionStatus={sessionStatus}
            sessionError={sessionError}
          />
        </div>
      </main>
    </section>
  )
}
