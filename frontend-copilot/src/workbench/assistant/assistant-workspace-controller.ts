import {
  type RuntimeAgentsListResponse,
  type RuntimeCapabilitiesGetResponse,
  type RuntimeThreadCreateResponse,
} from '../../features/copilot/chat-contract'
import { sanitizeEnabledToolIds } from '../../features/copilot/tool-picker'
import type { CopilotBootstrapController, CopilotConnectableState } from '../../features/copilot/types'
import { enhanceRuntimeAgents } from '../config'
import type { AgentType, AssistantSessionCapabilities, AssistantSessionShell } from '../types'

export interface AssistantAgentDirectoryState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  directoryVersion: string | null
  defaultAgentId: string | null
  agents: AgentType[]
  error: string | null
}

export interface AssistantSessionListState {
  sessions: AssistantSessionShell[]
  activeSessionId: string | null
}

export const emptyAssistantAgentDirectoryState: AssistantAgentDirectoryState = {
  status: 'idle',
  directoryVersion: null,
  defaultAgentId: null,
  agents: [],
  error: null,
}

export function createAssistantAgentDirectoryState(
  response: RuntimeAgentsListResponse,
  language: string = 'zh-CN',
): AssistantAgentDirectoryState {
  return {
    status: 'ready',
    directoryVersion: response.directoryVersion,
    defaultAgentId: response.defaultAgentId,
    agents: enhanceRuntimeAgents(response.agents, language),
    error: null,
  }
}

export function createAssistantSessionCapabilities(
  response: RuntimeCapabilitiesGetResponse,
): AssistantSessionCapabilities {
  return {
    capabilitiesVersion: response.capabilitiesVersion,
    allAvailableTools: response.tools.map((tool) => ({ ...tool })),
    recommendedToolsForAgent: [...response.recommendedTools],
    defaultEnabledTools: createDefaultEnabledToolIds(response.tools),
    toolSelectionMode: response.toolSelectionMode,
  }
}

function createDefaultEnabledToolIds(
  tools: RuntimeCapabilitiesGetResponse['tools'],
): string[] {
  return sanitizeEnabledToolIds({
    selectedToolIds: tools.map((tool) => tool.toolId),
    tools,
    policy: null,
  })
}

export function createAssistantSessionShell(input: {
  response: RuntimeThreadCreateResponse
  selectedAgent: AgentType
  capabilities: RuntimeCapabilitiesGetResponse
}): AssistantSessionShell {
  return {
    sessionId: input.response.threadId,
    title: '新话题',
    boundAgent: input.selectedAgent,
    createdAt: input.response.createdAt,
    updatedAt: input.response.updatedAt,
    capabilities: createAssistantSessionCapabilities(input.capabilities),
  }
}

export function activateAssistantSession(
  state: AssistantSessionListState,
  sessionId: string,
): AssistantSessionListState {
  if (state.activeSessionId === sessionId) {
    return state
  }

  if (!state.sessions.some((sessionEntry) => sessionEntry.sessionId === sessionId)) {
    return state
  }

  return {
    ...state,
    activeSessionId: sessionId,
  }
}

export function isCopilotConnectableState(
  state: CopilotBootstrapController['state'],
): state is CopilotConnectableState {
  return state.status === 'ready' || state.status === 'degraded'
}

export function formatAssistantWorkspaceError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
