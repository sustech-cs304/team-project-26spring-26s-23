import {
  createRuntimeSession,
  getRuntimeCapabilities,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { AgentType, AssistantSessionShell } from '../types'
import {
  createAssistantSessionShell,
  isCopilotConnectableState,
} from './assistant-workspace-controller'

export type AssistantWorkspaceSessionStatus = 'idle' | 'creating' | 'error'

export async function createAssistantSessionShellForAgent(input: {
  runtimeUrl: string
  selectedAgent: AgentType
  createSession: typeof createRuntimeSession
  getCapabilities: typeof getRuntimeCapabilities
}): Promise<AssistantSessionShell> {
  const sessionResponse = await input.createSession({
    runtimeUrl: input.runtimeUrl,
    agentId: input.selectedAgent.id,
  })
  const capabilitiesResponse = await input.getCapabilities({
    runtimeUrl: input.runtimeUrl,
    sessionId: sessionResponse.sessionId,
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
}): string {
  if (input.selectedAgent === null) {
    return '等待后端目录提供可用智能体'
  }

  if (input.sessionShell !== null && input.sessionShell.boundAgent.id !== input.selectedAgent.id) {
    return `切换到 ${input.selectedAgent.label} 并新建会话`
  }

  return `为 ${input.selectedAgent.label} 创建会话`
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
