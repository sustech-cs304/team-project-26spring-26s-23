import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react'

import type { AssistantSessionShell } from '../../types'
import type { AssistantSessionListState } from '../assistant-workspace-controller'
import {
  removeAssistantSessionShell,
  renameAssistantSessionShell,
  resolveAssistantSessionTitle,
} from '../assistant-session-helpers'

interface UseAssistantSessionManagementStateInput {
  sessionListState: AssistantSessionListState
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
  dismissSessionContextMenu: () => void
  showSessionContextMenu: (
    sessionEntry: AssistantSessionShell,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void
}

interface UseAssistantSessionManagementStateResult {
  renamingSessionId: string | null
  renamingValue: string
  deleteConfirmationSessionId: string | null
  handleSessionContextMenu: (sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => void
  dismissSessionContextMenu: () => void
  requestSessionRename: (sessionId: string) => void
  updateSessionRenameValue: (value: string) => void
  commitSessionRename: () => void
  cancelSessionRename: () => void
  requestSessionDelete: (sessionId: string) => void
  confirmSessionDelete: (sessionId: string) => void
  cancelSessionDelete: () => void
}

export function useAssistantSessionManagementState({
  sessionListState,
  setSessionListState,
  setSelectedAgentId,
  dismissSessionContextMenu,
  showSessionContextMenu,
}: UseAssistantSessionManagementStateInput): UseAssistantSessionManagementStateResult {
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

  const dismissSessionContextMenuWithDeleteReset = useCallback(() => {
    setDeleteConfirmationSessionId(null)
    dismissSessionContextMenu()
  }, [dismissSessionContextMenu])

  const handleSessionContextMenu = useCallback((sessionEntry: AssistantSessionShell, event: ReactMouseEvent<HTMLButtonElement>) => {
    setDeleteConfirmationSessionId(null)
    showSessionContextMenu(sessionEntry, event)
  }, [showSessionContextMenu])

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
    renamingSessionId,
    renamingValue,
    deleteConfirmationSessionId,
    handleSessionContextMenu,
    dismissSessionContextMenu: dismissSessionContextMenuWithDeleteReset,
    requestSessionRename,
    updateSessionRenameValue,
    commitSessionRename,
    cancelSessionRename,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
  }
}
