import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

import {
  createRuntimeThread,
  getRuntimeCapabilities,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AgentType, AssistantSessionShell } from '../types'
import {
  activateAssistantSession,
  formatAssistantWorkspaceError,
  isCopilotConnectableState,
  type AssistantSessionListState,
} from './assistant-workspace-controller'
import {
  createAssistantSessionShellForAgent,
  getAssistantCreateSessionLabel,
  isAssistantCreateSessionButtonDisabled,
  type AssistantWorkspaceSessionStatus,
} from './assistant-workspace-session-controller'
import {
  appendAssistantSessionShell,
  createAssistantSessionListState,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'

interface UseAssistantSessionCreationInput {
  bootstrap: CopilotBootstrapController
  selectedAgent: AgentType | null
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
  createSession?: typeof createRuntimeThread
  getCapabilities?: typeof getRuntimeCapabilities
  initialSessionShell?: AssistantSessionShell | null
}

interface UseAssistantSessionCreationResult {
  sessionListState: AssistantSessionListState
  setSessionListState: Dispatch<SetStateAction<AssistantSessionListState>>
  sessionShell: AssistantSessionShell | null
  sessionStatus: AssistantWorkspaceSessionStatus
  sessionError: string | null
  createSessionLabel: string
  createSessionButtonDisabled: boolean
  activateSession: (sessionEntry: AssistantSessionShell) => void
  handleCreateSession: () => Promise<void>
}

export function useAssistantSessionCreation({
  bootstrap,
  selectedAgent,
  setSelectedAgentId,
  createSession: createSessionImpl = createRuntimeThread,
  getCapabilities: getCapabilitiesImpl = getRuntimeCapabilities,
  initialSessionShell = null,
}: UseAssistantSessionCreationInput): UseAssistantSessionCreationResult {
  const [sessionListState, setSessionListState] = useState<AssistantSessionListState>(() => (
    createAssistantSessionListState(initialSessionShell)
  ))
  const [sessionStatus, setSessionStatus] = useState<AssistantWorkspaceSessionStatus>('idle')
  const [sessionError, setSessionError] = useState<string | null>(null)

  const sessionShell = useMemo(
    () => resolveActiveAssistantSessionShell(sessionListState),
    [sessionListState],
  )
  const createSessionLabel = useMemo(
    () => getAssistantCreateSessionLabel({ selectedAgent, sessionShell }),
    [selectedAgent, sessionShell],
  )
  const createSessionButtonDisabled = isAssistantCreateSessionButtonDisabled({
    bootstrapState: bootstrap.state,
    selectedAgent,
    sessionStatus,
  })

  const activateSession = useCallback((sessionEntry: AssistantSessionShell) => {
    setSessionListState((current) => activateAssistantSession(current, sessionEntry.sessionId))
    setSelectedAgentId(sessionEntry.boundAgent.id)
  }, [setSelectedAgentId])

  const handleCreateSession = useCallback(async () => {
    if (!isCopilotConnectableState(bootstrap.state) || selectedAgent === null || sessionStatus === 'creating') {
      return
    }

    setSessionStatus('creating')
    setSessionError(null)

    try {
      const nextSessionShell = await createAssistantSessionShellForAgent({
        runtimeUrl: bootstrap.state.runtimeUrl,
        selectedAgent,
        createSession: createSessionImpl,
        getCapabilities: getCapabilitiesImpl,
      })
      setSessionListState((current) => appendAssistantSessionShell(current, nextSessionShell))
      setSessionStatus('idle')
    } catch (error) {
      setSessionStatus('error')
      setSessionError(formatAssistantWorkspaceError(error))
    }
  }, [bootstrap.state, createSessionImpl, getCapabilitiesImpl, selectedAgent, sessionStatus])

  return {
    sessionListState,
    setSessionListState,
    sessionShell,
    sessionStatus,
    sessionError,
    createSessionLabel,
    createSessionButtonDisabled,
    activateSession,
    handleCreateSession,
  }
}
