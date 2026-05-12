import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from 'react'

import type { AssistantSessionShell } from '../../types'
import type { AssistantSessionListState } from '../assistant-workspace-controller'
import { resolveAssistantSessionTitle } from '../assistant-session-helpers'

interface UseAssistantSessionManagementStateInput {
  sessionListState: AssistantSessionListState
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
  dismissSessionContextMenu: () => void
  showSessionContextMenu: (
    sessionEntry: AssistantSessionShell,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => void
  onRenameSession: (
    sessionId: string,
    nextTitle: string,
    sessionEntry: AssistantSessionShell,
  ) => Promise<void> | void
  onDeleteSession: (
    sessionId: string,
    sessionEntry: AssistantSessionShell,
  ) => Promise<void> | void
  onDuplicateSession: (
    sessionId: string,
    sessionEntry: AssistantSessionShell,
  ) => Promise<void> | void
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
  duplicateSession: (sessionId: string) => void
  requestSessionDelete: (sessionId: string) => void
  confirmSessionDelete: (sessionId: string) => void
  cancelSessionDelete: () => void
}

// This hook encapsulates all session management actions (rename, duplicate,
// delete) that share the same state and mutex refs. Extracting individual
// callbacks would require lifting the shared refs and state to a parent,
// adding boilerplate without reducing actual complexity.
// eslint-disable-next-line max-lines-per-function
export function useAssistantSessionManagementState({
  sessionListState,
  setSelectedAgentId,
  dismissSessionContextMenu,
  showSessionContextMenu,
  onRenameSession,
  onDeleteSession,
  onDuplicateSession,
}: UseAssistantSessionManagementStateInput): UseAssistantSessionManagementStateResult {
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [deleteConfirmationSessionId, setDeleteConfirmationSessionId] = useState<string | null>(null)
  const renamingCommitInFlightSessionIdRef = useRef<string | null>(null)
  const deleteInFlightSessionIdRef = useRef<string | null>(null)
  const duplicateInFlightSessionIdRef = useRef<string | null>(null)

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

    if (renamingCommitInFlightSessionIdRef.current === renamingSessionId) {
      return
    }

    const normalizedTitle = renamingValue.trim()
    const nextTitle = normalizedTitle.length > 0 ? normalizedTitle : resolveAssistantSessionTitle(sessionEntry)
    renamingCommitInFlightSessionIdRef.current = renamingSessionId

    void (async () => {
      try {
        await onRenameSession(renamingSessionId, nextTitle, sessionEntry)
        cancelSessionRename()
      } catch {
        // Keep the rename editor open so the caller can retry after surfacing the error elsewhere.
      } finally {
        if (renamingCommitInFlightSessionIdRef.current === renamingSessionId) {
          renamingCommitInFlightSessionIdRef.current = null
        }
      }
    })()
  }, [cancelSessionRename, onRenameSession, renamingSessionId, renamingValue, sessionListState.sessions])

  const duplicateSession = useCallback((sessionId: string) => {
    const sessionEntry = sessionListState.sessions.find((sessionItem) => sessionItem.sessionId === sessionId)
    if (sessionEntry === undefined) {
      return
    }

    if (duplicateInFlightSessionIdRef.current === sessionId) {
      return
    }

    duplicateInFlightSessionIdRef.current = sessionId
    void (async () => {
      try {
        await onDuplicateSession(sessionId, sessionEntry)
        setDeleteConfirmationSessionId(null)
        dismissSessionContextMenu()
      } catch {
        // Mutation errors are surfaced by the caller.
      } finally {
        if (duplicateInFlightSessionIdRef.current === sessionId) {
          duplicateInFlightSessionIdRef.current = null
        }
      }
    })()
  }, [dismissSessionContextMenu, onDuplicateSession, sessionListState.sessions])

  const requestSessionDelete = useCallback((sessionId: string) => {
    setDeleteConfirmationSessionId(sessionId)
  }, [])

  const cancelSessionDelete = useCallback(() => {
    setDeleteConfirmationSessionId(null)
  }, [])

  const confirmSessionDelete = useCallback((sessionId: string) => {
    const sessionEntry = sessionListState.sessions.find((sessionItem) => sessionItem.sessionId === sessionId)
    if (sessionEntry === undefined || deleteInFlightSessionIdRef.current === sessionId) {
      return
    }

    deleteInFlightSessionIdRef.current = sessionId
    void (async () => {
      try {
        await onDeleteSession(sessionId, sessionEntry)
        setSelectedAgentId(sessionEntry.boundAgent.id)
        setDeleteConfirmationSessionId(null)
        if (renamingSessionId === sessionId) {
          cancelSessionRename()
        }
        dismissSessionContextMenu()
      } catch {
        // Mutation errors are surfaced by the caller.
      } finally {
        if (deleteInFlightSessionIdRef.current === sessionId) {
          deleteInFlightSessionIdRef.current = null
        }
      }
    })()
  }, [cancelSessionRename, dismissSessionContextMenu, onDeleteSession, renamingSessionId, sessionListState.sessions, setSelectedAgentId])

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
    duplicateSession,
    requestSessionDelete,
    confirmSessionDelete,
    cancelSessionDelete,
  }
}
