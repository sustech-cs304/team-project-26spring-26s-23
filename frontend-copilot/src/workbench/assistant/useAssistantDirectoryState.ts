import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'

import { listRuntimeAgents } from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import {
  emptyAssistantAgentDirectoryState,
  isCopilotConnectableState,
  type AssistantAgentDirectoryState,
} from './assistant-workspace-controller'
import {
  createAssistantDirectoryDisconnectedState,
  createAssistantDirectoryErrorState,
  createAssistantDirectoryLoadingState,
  createInitialAssistantSelectedAgentId,
  loadAssistantAgentDirectory,
  resolveAssistantSelectedAgent,
  resolveAssistantSelectedAgentId,
} from './assistant-workspace-directory-loader'

interface UseAssistantDirectoryStateInput {
  bootstrap: CopilotBootstrapController
  listAgents?: typeof listRuntimeAgents
  initialDirectoryState?: AssistantAgentDirectoryState
}

interface UseAssistantDirectoryStateResult {
  directoryState: AssistantAgentDirectoryState
  selectedAgentId: string | null
  selectedAgent: ReturnType<typeof resolveAssistantSelectedAgent>
  selectAgent: Dispatch<SetStateAction<string | null>>
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>
}

export function useAssistantDirectoryState({
  bootstrap,
  listAgents: listAgentsImpl = listRuntimeAgents,
  initialDirectoryState = emptyAssistantAgentDirectoryState,
}: UseAssistantDirectoryStateInput): UseAssistantDirectoryStateResult {
  const [directoryState, setDirectoryState] = useState<AssistantAgentDirectoryState>(initialDirectoryState)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => (
    createInitialAssistantSelectedAgentId(initialDirectoryState)
  ))

  useEffect(() => {
    if (!isCopilotConnectableState(bootstrap.state)) {
      setDirectoryState((current) => createAssistantDirectoryDisconnectedState(current))
      return
    }

    let disposed = false
    setDirectoryState((current) => createAssistantDirectoryLoadingState(current))

    void loadAssistantAgentDirectory({
      runtimeUrl: bootstrap.state.runtimeUrl,
      listAgents: listAgentsImpl,
    })
      .then((nextDirectoryState) => {
        if (disposed) {
          return
        }

        setDirectoryState(nextDirectoryState)
        setSelectedAgentId((currentSelectedAgentId) => resolveAssistantSelectedAgentId({
          directoryState: nextDirectoryState,
          previousAgentId: currentSelectedAgentId,
        }))
      })
      .catch((error) => {
        if (disposed) {
          return
        }

        setDirectoryState(createAssistantDirectoryErrorState(error))
      })

    return () => {
      disposed = true
    }
  }, [bootstrap.state, listAgentsImpl])

  const selectedAgent = useMemo(
    () => resolveAssistantSelectedAgent({
      agents: directoryState.agents,
      selectedAgentId,
    }),
    [directoryState.agents, selectedAgentId],
  )

  return {
    directoryState,
    selectedAgentId,
    selectedAgent,
    selectAgent: setSelectedAgentId,
    setSelectedAgentId,
  }
}
