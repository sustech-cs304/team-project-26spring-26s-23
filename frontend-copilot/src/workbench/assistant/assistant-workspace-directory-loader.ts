import { listRuntimeAgents } from '../../features/copilot/chat-contract'
import { pickDefaultAgentId } from '../config'
import type { AgentType } from '../types'
import {
  createAssistantAgentDirectoryState,
  emptyAssistantAgentDirectoryState,
  formatAssistantWorkspaceError,
  type AssistantAgentDirectoryState,
} from './assistant-workspace-controller'

export function createInitialAssistantSelectedAgentId(
  initialDirectoryState: AssistantAgentDirectoryState,
): string | null {
  return pickDefaultAgentId({
    agents: initialDirectoryState.agents,
    defaultAgentId: initialDirectoryState.defaultAgentId,
  })
}

export function resolveAssistantSelectedAgentId(input: {
  directoryState: AssistantAgentDirectoryState
  previousAgentId?: string | null
}): string | null {
  return pickDefaultAgentId({
    agents: input.directoryState.agents,
    defaultAgentId: input.directoryState.defaultAgentId,
    previousAgentId: input.previousAgentId,
  })
}

export function resolveAssistantSelectedAgent(input: {
  agents: AgentType[]
  selectedAgentId: string | null
}): AgentType | null {
  return input.agents.find((agent) => agent.id === input.selectedAgentId) ?? null
}

export function createAssistantDirectoryDisconnectedState(
  current: AssistantAgentDirectoryState,
): AssistantAgentDirectoryState {
  return {
    ...current,
    status: current.status === 'ready' ? current.status : 'idle',
    error: null,
  }
}

export function createAssistantDirectoryLoadingState(
  current: AssistantAgentDirectoryState,
): AssistantAgentDirectoryState {
  return {
    ...current,
    status: current.agents.length > 0 ? current.status : 'loading',
    error: null,
  }
}

export function createAssistantDirectoryErrorState(
  error: unknown,
): AssistantAgentDirectoryState {
  return {
    ...emptyAssistantAgentDirectoryState,
    status: 'error',
    error: formatAssistantWorkspaceError(error),
  }
}

export async function loadAssistantAgentDirectory(input: {
  runtimeUrl: string
  listAgents: typeof listRuntimeAgents
  language?: string
}): Promise<AssistantAgentDirectoryState> {
  const response = await input.listAgents({ runtimeUrl: input.runtimeUrl })
  return createAssistantAgentDirectoryState(response, input.language)
}
