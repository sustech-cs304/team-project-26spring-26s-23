import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import {
  RuntimeRequestError,
  type RuntimeMessageSendResponse,
} from './chat-contract'
import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from './types'

export interface CopilotChatComposerDraft {
  messageText: string
  model: string
  enabledTools: string[]
  requestOptionsText: string
}

export interface RuntimeMessageSendInput {
  runtimeUrl: string
  sessionId: string
  agent: string
  message: {
    role: 'user'
    content: string
  }
  model: string
  enabledTools: string[]
  requestOptions: Record<string, unknown>
}

export interface CopilotConversationTurn {
  id: string
  kind: 'user' | 'assistant' | 'error'
  title: string
  content: string
  resolvedModelId?: string
  resolvedToolIds?: string[]
  requestOptions?: Record<string, unknown>
}

export const DEFAULT_COPILOT_COMPOSER_HEIGHT = 160
export const MIN_COPILOT_COMPOSER_HEIGHT = 120
export const MAX_COPILOT_COMPOSER_HEIGHT = 360

export function createEmptyComposerDraft(): CopilotChatComposerDraft {
  return {
    messageText: '',
    model: '',
    enabledTools: [],
    requestOptionsText: '{}',
  }
}

export function createComposerDraftFromSession(sessionShell: AssistantSessionShell): CopilotChatComposerDraft {
  return {
    messageText: '',
    model: sessionShell.capabilities.defaultModelPreference ?? '',
    enabledTools: [...sessionShell.capabilities.defaultEnabledTools],
    requestOptionsText: '{}',
  }
}

export function buildRuntimeMessageSendInput(input: {
  runtimeUrl: string
  sessionShell: AssistantSessionShell
  draft: CopilotChatComposerDraft
  requestOptions: Record<string, unknown>
}): RuntimeMessageSendInput {
  return {
    runtimeUrl: input.runtimeUrl,
    sessionId: input.sessionShell.sessionId,
    agent: input.sessionShell.boundAgent.id,
    message: {
      role: 'user',
      content: input.draft.messageText.trim(),
    },
    model: input.draft.model.trim(),
    enabledTools: dedupeToolIds(input.draft.enabledTools),
    requestOptions: { ...input.requestOptions },
  }
}

export function parseRequestOptionsText(requestOptionsText: string): Record<string, unknown> {
  const trimmed = requestOptionsText.trim()
  if (trimmed === '') {
    return {}
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('requestOptions 必须是 JSON 对象。')
  }

  return { ...(parsed as Record<string, unknown>) }
}

export function formatRuntimeMessageSendError(error: unknown): string {
  if (error instanceof RuntimeRequestError) {
    switch (error.code) {
      case 'agent_mismatch':
        return `agent_mismatch：当前消息携带的 agent 校验值与会话绑定智能体不一致。${error.message}`
      case 'tool_not_found':
        return `tool_not_found：本次消息启用了后端未注册的 toolId。${error.message}`
      case 'tool_unavailable':
        return `tool_unavailable：本次消息请求的工具当前不可用。${error.message}`
      case 'invalid_request':
        return `invalid_request：消息请求结构无效。${error.message}`
      case 'capabilities_version_stale':
        return `capabilities_version_stale：当前能力面版本已过期，需要重新拉取 capabilities 后再发。${error.message}`
      default:
        return error.message
    }
  }

  return error instanceof Error ? error.message : String(error)
}

export function buildRuntimeDebugSummary(input: {
  state: Extract<CopilotBootstrapState, { status: 'ready' | 'degraded' }>
  directoryState: AssistantAgentDirectoryState
  selectedAgent: AgentType | null
}) {
  return {
    runtimeSource: input.state.runtimeSource,
    connectionSummary: `${formatRuntimeSource(input.state.runtimeSource)} · ${input.state.runtimeUrl} · ${formatModeSummary(input.state.diagnostics)}`,
    runtimeUrl: input.state.runtimeUrl,
    hostedStatus: input.state.diagnostics.hostedStatus,
    directoryStatus: input.directoryState.status,
    selectedAgent: input.selectedAgent === null
      ? null
      : {
          id: input.selectedAgent.id,
          label: input.selectedAgent.label,
        },
  }
}

export function buildSessionDebugSummary(sessionShell: AssistantSessionShell) {
  return {
    sessionId: sessionShell.sessionId,
    boundAgent: sessionShell.boundAgent.id,
    capabilitiesVersion: sessionShell.capabilities.capabilitiesVersion,
    allAvailableTools: sessionShell.capabilities.allAvailableTools.map((tool) => tool.toolId),
    recommendedTools: [...sessionShell.capabilities.recommendedToolsForAgent],
    defaultEnabledTools: [...sessionShell.capabilities.defaultEnabledTools],
    defaultEnabledSource: {
      boundAgent: sessionShell.boundAgent.id,
      defaultModelPreference: sessionShell.capabilities.defaultModelPreference,
      toolSelectionMode: sessionShell.capabilities.toolSelectionMode,
    },
  }
}

export function createUserTurn(content: string): CopilotConversationTurn {
  return {
    id: `user:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'user',
    title: '',
    content,
  }
}

export function createAssistantTurn(response: RuntimeMessageSendResponse): CopilotConversationTurn {
  return {
    id: `assistant:${response.sessionId}:${Math.random().toString(36).slice(2)}`,
    kind: 'assistant',
    title: '助手响应',
    content: response.assistantMessage.content,
    resolvedModelId: response.resolvedModelId,
    resolvedToolIds: [...response.resolvedToolIds],
    requestOptions: { ...response.requestOptions },
  }
}

export function createErrorTurn(content: string): CopilotConversationTurn {
  return {
    id: `error:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'error',
    title: '发送失败',
    content,
  }
}

export function clampComposerHeight(height: number): number {
  return Math.min(MAX_COPILOT_COMPOSER_HEIGHT, Math.max(MIN_COPILOT_COMPOSER_HEIGHT, Math.round(height)))
}

export function formatRequestOptionsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function dedupeToolIds(toolIds: string[]): string[] {
  const uniqueToolIds = new Set<string>()

  for (const toolId of toolIds) {
    const normalizedToolId = toolId.trim()
    if (normalizedToolId !== '') {
      uniqueToolIds.add(normalizedToolId)
    }
  }

  return [...uniqueToolIds]
}

export function formatRuntimeSource(source: 'hosted' | 'dev-override' | 'none'): string {
  switch (source) {
    case 'hosted':
      return '宿主管理'
    case 'dev-override':
      return '开发态 override'
    case 'none':
      return '暂无有效来源'
  }
}

export function formatModeSummary(diagnostics: CopilotDiagnosticsSummary): string {
  return `${diagnostics.mode}（${diagnostics.modeSource === 'resolved' ? '已解析' : '预期'}）`
}
