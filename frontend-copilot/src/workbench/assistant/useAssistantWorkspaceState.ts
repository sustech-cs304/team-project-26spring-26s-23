import {
  useCallback,
  useEffect,
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
import {
  removeAssistantSessionShell,
  renameAssistantSessionShell,
  resolveAssistantSessionTitle,
} from './assistant-session-helpers'

interface UseAssistantWorkspaceStateInput {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  createSession?: typeof createRuntimeThread
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
  renamingSessionId: string | null
  renamingValue: string
  deleteConfirmationSessionId: string | null
  sessionDragState: AssistantSessionDragState | null
  sessionListRef: MutableRefObject<HTMLUListElement | null>
  sessionDragGhostRef: MutableRefObject<HTMLDivElement | null>
  selectAgent: (agentId: string | null) => void
  handleCreateSession: () => Promise<void>
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
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [deleteConfirmationSessionId, setDeleteConfirmationSessionId] = useState<string | null>(null)

  useEffect(() => {
    if (renamingSessionId !== null && !sessionListState.sessions.some((sessionEntry) => sessionEntry.sessionId === renamingSessionId)) {
      setRenamingSessionId(null)
      setRenamingValue('')
    }
  }, [renamingSessionId, sessionListState.sessions])

  useEffect(() => {
    if (deleteConfirmationSessionId !== null && !sessionListState.sessions.some((sessionEntry) => sessionEntry.sessionId === deleteConfirmationSessionId)) {
      setDeleteConfirmationSessionId(null)
    }
  }, [deleteConfirmationSessionId, sessionListState.sessions])

  const dismissSessionContextMenuWithConfirmReset = useCallback(() => {
    setDeleteConfirmationSessionId(null)
    dismissSessionContextMenu()
  }, [dismissSessionContextMenu])

  const handleSessionContextMenuWithDeleteReset = useCallback((sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => {
    setDeleteConfirmationSessionId(null)
    handleSessionContextMenu(sessionEntry, event)
  }, [handleSessionContextMenu])

  const handleCreateSession = useCallback(async () => {
    dismissSessionContextMenuWithConfirmReset()
    await createSessionForSelectedAgent()
  }, [createSessionForSelectedAgent, dismissSessionContextMenuWithConfirmReset])

  const requestSessionRename = useCallback((sessionId: string) => {
    const sessionEntry = sessionListState.sessions.find((sessionItem) => sessionItem.sessionId === sessionId)

    if (sessionEntry === undefined) {
      return
    }

    setDeleteConfirmationSessionId(null)
    setRenamingSessionId(sessionId)
    setRenamingValue(resolveAssistantSessionTitle(sessionEntry))
    dismissSessionContextMenu()
  }, [dismissSessionContextMenu, sessionListState.sessions])

  const updateSessionRenameValue = useCallback((value: string) => {
    setRenamingValue(value)
  }, [])

  const cancelSessionRename = useCallback(() => {
    setRenamingSessionId(null)
    setRenamingValue('')
  }, [])

  const commitSessionRename = useCallback(() => {
    if (renamingSessionId === null) {
      return
    }

    const sessionEntry = sessionListState.sessions.find((sessionItem) => sessionItem.sessionId === renamingSessionId)
    if (sessionEntry === undefined) {
      cancelSessionRename()
      return
    }

    const normalizedTitle = renamingValue.trim()
    const nextTitle = normalizedTitle.length > 0 ? normalizedTitle : resolveAssistantSessionTitle(sessionEntry)

    setSessionListState((current) => renameAssistantSessionShell(current, renamingSessionId, nextTitle))
    cancelSessionRename()
  }, [cancelSessionRename, renamingSessionId, renamingValue, sessionListState.sessions, setSessionListState])

  const requestSessionDelete = useCallback((sessionId: string) => {
    setDeleteConfirmationSessionId(sessionId)
  }, [])

  const cancelSessionDelete = useCallback(() => {
    setDeleteConfirmationSessionId(null)
  }, [])

  const confirmSessionDelete = useCallback((sessionId: string) => {
    const sessionEntry = sessionListState.sessions.find((sessionItem) => sessionItem.sessionId === sessionId)
    if (sessionEntry === undefined) {
      return
    }

    setSelectedAgentId(sessionEntry.boundAgent.id)
    setSessionListState((current) => removeAssistantSessionShell(current, sessionId))
    setDeleteConfirmationSessionId(null)
    if (renamingSessionId === sessionId) {
      cancelSessionRename()
    }
    dismissSessionContextMenu()
  }, [cancelSessionRename, dismissSessionContextMenu, renamingSessionId, sessionListState.sessions, setSelectedAgentId, setSessionListState])

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
    handleSessionContextMenu: handleSessionContextMenuWithDeleteReset,
    dismissSessionContextMenu: dismissSessionContextMenuWithConfirmReset,
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
