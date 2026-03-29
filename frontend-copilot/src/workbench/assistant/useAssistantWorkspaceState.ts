import {
  useCallback,
  useEffect,
  type MutableRefObject,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  createRuntimeSession,
  getRuntimeCapabilities,
  listRuntimeAgents,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AgentType, AssistantSessionShell } from '../types'
import type {
  AssistantSessionContextMenuState,
  AssistantSessionContextSubmenu,
  AssistantSessionDragState,
} from './assistant-session-list-helpers'
import {
  emptyAssistantAgentDirectoryState,
  type AssistantAgentDirectoryState,
  type AssistantSessionListState,
} from './assistant-workspace-controller'
import {
  type AssistantWorkspaceSessionStatus,
} from './assistant-workspace-session-controller'
import { useAssistantDirectoryState } from './useAssistantDirectoryState'
import { useAssistantSessionCreation } from './useAssistantSessionCreation'
import { useAssistantSessionInteractionState } from './useAssistantSessionInteractionState'

interface UseAssistantWorkspaceStateInput {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeSession
  getCapabilities?: typeof getRuntimeCapabilities
  initialDirectoryState?: AssistantAgentDirectoryState
  initialSessionShell?: AssistantSessionShell | null
}

interface UseAssistantWorkspaceStateResult {
  directoryState: AssistantAgentDirectoryState
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  sessionListState: AssistantSessionListState
  sessionStatus: AssistantWorkspaceSessionStatus
  sessionError: string | null
  createSessionLabel: string
  createSessionButtonDisabled: boolean
  renderedSessions: AssistantSessionShell[]
  dragPreviewIndex: number | null
  draggingSessionShell: AssistantSessionShell | null
  sessionContextMenu: AssistantSessionContextMenuState | null
  sessionDragState: AssistantSessionDragState | null
  sessionListRef: MutableRefObject<HTMLUListElement | null>
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
  selectAgent: (agentId: string | null) => void
  handleCreateSession: () => Promise<void>
  handleSessionPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, sessionId: string) => void
  handleSessionClick: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  handleSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  dismissSessionContextMenu: () => void
  selectSessionSubmenu: (submenu: AssistantSessionContextSubmenu | null) => void
}

export function useAssistantWorkspaceState({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  createSession: createSessionImpl = createRuntimeSession,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  initialDirectoryState = emptyAssistantAgentDirectoryState,
  initialSessionShell = null,
}: UseAssistantWorkspaceStateInput): UseAssistantWorkspaceStateResult {
  useEffect(() => {
    console.info('[startup]', JSON.stringify({
      scope: 'AssistantWorkspace',
      stage: 'mounted',
      t: Math.round(performance.now()),
      bootstrapStatus: bootstrap.state.status,
    }))

    return () => {
      console.info('[startup]', JSON.stringify({
        scope: 'AssistantWorkspace',
        stage: 'unmounted',
        t: Math.round(performance.now()),
      }))
    }
  }, [bootstrap.state.status])

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
    handleSessionContextMenu,
    dismissSessionContextMenu,
    selectSessionSubmenu,
  } = useAssistantSessionInteractionState({
    sessionListState,
    setSessionListState,
    activateSession,
  })

  const handleCreateSession = useCallback(async () => {
    dismissSessionContextMenu()
    await createSessionForSelectedAgent()
  }, [createSessionForSelectedAgent, dismissSessionContextMenu])

  return {
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
    sessionDragState,
    sessionListRef,
    sessionDragGhostRef,
    selectAgent,
    handleCreateSession,
    handleSessionPointerDown,
    handleSessionClick,
    handleSessionContextMenu,
    dismissSessionContextMenu,
    selectSessionSubmenu,
  }
}
