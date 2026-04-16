import {
  createRuntimeThread,
  getRuntimeCapabilities,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { getAssistantSessionCopy } from '../locale'
import type { AgentType, AssistantSessionShell } from '../types'
import {
  createAssistantSessionShell,
  isCopilotConnectableState,
} from './assistant-workspace-controller'

export type AssistantWorkspaceSessionStatus = 'idle' | 'creating' | 'error'

export async function createAssistantSessionShellForAgent(input: {
  runtimeUrl: string
  selectedAgent: AgentType
  createSession: typeof createRuntimeThread
  getCapabilities: typeof getRuntimeCapabilities
}): Promise<AssistantSessionShell> {
  const sessionResponse = await input.createSession({
    runtimeUrl: input.runtimeUrl,
    agentId: input.selectedAgent.id,
  })
  const capabilitiesResponse = await input.getCapabilities({
    runtimeUrl: input.runtimeUrl,
    sessionId: sessionResponse.threadId,
  })

  return createAssistantSessionShell({
    response: sessionResponse,
    selectedAgent: input.selectedAgent,
    capabilities: capabilitiesResponse,
  })
}

export function getAssistantCreateSessionLabel(input: {
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  language?: string
}): string {
  const copy = getAssistantSessionCopy(input.language ?? 'zh-CN')

  if (input.selectedAgent === null) {
    return copy.createSession.waitingForAgent
  }

  if (input.sessionShell !== null && input.sessionShell.boundAgent.id !== input.selectedAgent.id) {
    return copy.createSession.switchAndCreate(input.selectedAgent.label)
  }

  return copy.createSession.create(input.selectedAgent.label)
}

export function isAssistantCreateSessionButtonDisabled(input: {
  bootstrapState: CopilotBootstrapController['state']
  selectedAgent: AgentType | null
  sessionStatus: AssistantWorkspaceSessionStatus
}): boolean {
  return !isCopilotConnectableState(input.bootstrapState)
    || input.selectedAgent === null
    || input.sessionStatus === 'creating'
}
