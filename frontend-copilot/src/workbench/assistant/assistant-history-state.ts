import { Sparkles } from 'lucide-react'

import type {
  CopilotHistoryRunReplaySuccess,
  CopilotHistoryRunSummary,
  CopilotHistoryThreadDetailSuccess,
  CopilotHistoryThreadSummary,
} from '../../../electron/copilot-history'
import type { RuntimeCapabilitiesGetResponse } from '../../features/copilot/chat-contract'
import type {
  AgentType,
  AssistantSessionCapabilities,
  AssistantSessionShell,
} from '../types'

export type AssistantSessionHistoryLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AssistantSessionHistoryState {
  summary: CopilotHistoryThreadSummary
  detailStatus: AssistantSessionHistoryLoadStatus
  detailError: string | null
  timelineItems: Record<string, unknown>[]
  runSummaries: CopilotHistoryRunSummary[]
  latestConfigurationSnapshot: Record<string, unknown> | null
  availabilityDrift: Record<string, unknown> | null
  selectedRunId: string | null
  replayStatus: AssistantSessionHistoryLoadStatus
  replayError: string | null
  replay: CopilotHistoryRunReplaySuccess | null
}

export function createEmptyAssistantSessionCapabilities(): AssistantSessionCapabilities {
  return {
    capabilitiesVersion: 'history-shell',
    allAvailableTools: [],
    recommendedToolsForAgent: [],
    defaultEnabledTools: [],
    toolSelectionMode: 'recommendation-only',
  }
}

export function createAssistantSessionCapabilitiesFromRuntime(
  response: RuntimeCapabilitiesGetResponse,
): AssistantSessionCapabilities {
  return {
    capabilitiesVersion: response.capabilitiesVersion,
    allAvailableTools: response.tools.map((tool) => ({ ...tool })),
    recommendedToolsForAgent: [...response.recommendedTools],
    defaultEnabledTools: [...response.recommendedTools],
    toolSelectionMode: response.toolSelectionMode,
  }
}

export function createAssistantSessionShellFromHistorySummary(input: {
  summary: CopilotHistoryThreadSummary
  agents: AgentType[]
}): AssistantSessionShell {
  return {
    sessionId: input.summary.threadId,
    title: resolveAssistantHistorySessionTitle(input.summary),
    boundAgent: resolveAssistantHistoryBoundAgent(input.summary.boundAgentId, input.agents),
    createdAt: input.summary.createdAt,
    updatedAt: input.summary.updatedAt,
    capabilities: createEmptyAssistantSessionCapabilities(),
  }
}

export function syncAssistantSessionShellBoundAgent(
  sessionShell: AssistantSessionShell,
  agents: AgentType[],
): AssistantSessionShell {
  const nextBoundAgent = resolveAssistantHistoryBoundAgent(sessionShell.boundAgent.id, agents)

  return sessionShell.boundAgent.id === nextBoundAgent.id
    && sessionShell.boundAgent.label === nextBoundAgent.label
    && sessionShell.boundAgent.shortLabel === nextBoundAgent.shortLabel
    && sessionShell.boundAgent.description === nextBoundAgent.description
    && sessionShell.boundAgent.hint === nextBoundAgent.hint
    && sessionShell.boundAgent.status === nextBoundAgent.status
    && sessionShell.boundAgent.recommendedTools.join('|') === nextBoundAgent.recommendedTools.join('|')
    ? sessionShell
    : {
        ...sessionShell,
        boundAgent: nextBoundAgent,
      }
}

export function applyAssistantSessionCapabilities(
  sessionShell: AssistantSessionShell,
  response: RuntimeCapabilitiesGetResponse,
): AssistantSessionShell {
  return {
    ...sessionShell,
    capabilities: createAssistantSessionCapabilitiesFromRuntime(response),
  }
}

export function createAssistantSessionHistoryState(
  summary: CopilotHistoryThreadSummary,
  selectedRunId: string | null,
): AssistantSessionHistoryState {
  return {
    summary: { ...summary },
    detailStatus: 'idle',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    selectedRunId: selectedRunId ?? summary.lastRunId,
    replayStatus: 'idle',
    replayError: null,
    replay: null,
  }
}

export function setAssistantSessionHistoryDetailLoading(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    detailStatus: 'loading',
    detailError: null,
  }
}

export function applyAssistantSessionHistoryDetail(
  state: AssistantSessionHistoryState,
  detail: CopilotHistoryThreadDetailSuccess,
): AssistantSessionHistoryState {
  const runSummaries = detail.runSummaries.map((runSummary) => ({ ...runSummary }))
  const selectedRunId = runSummaries.some((runSummary) => runSummary.runId === state.selectedRunId)
    ? state.selectedRunId
    : detail.thread.lastRunId
      ?? runSummaries[runSummaries.length - 1]?.runId
      ?? null

  return {
    ...state,
    summary: { ...detail.thread },
    detailStatus: 'ready',
    detailError: null,
    timelineItems: detail.timelineItems.map((item) => ({ ...item })),
    runSummaries,
    latestConfigurationSnapshot: detail.latestConfigurationSnapshot === null
      ? null
      : { ...detail.latestConfigurationSnapshot },
    availabilityDrift: detail.availabilityDrift === null
      ? null
      : { ...detail.availabilityDrift },
    selectedRunId,
  }
}

export function setAssistantSessionHistoryDetailError(
  state: AssistantSessionHistoryState,
  error: string,
): AssistantSessionHistoryState {
  return {
    ...state,
    detailStatus: 'error',
    detailError: error,
  }
}

export function setAssistantSessionHistoryReplayLoading(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    replayStatus: 'loading',
    replayError: null,
  }
}

export function applyAssistantSessionHistoryReplay(
  state: AssistantSessionHistoryState,
  replay: CopilotHistoryRunReplaySuccess,
): AssistantSessionHistoryState {
  return {
    ...state,
    selectedRunId: replay.run.runId,
    replayStatus: 'ready',
    replayError: null,
    replay: {
      ...replay,
      run: { ...replay.run },
      historicalSnapshot: replay.historicalSnapshot === null ? null : { ...replay.historicalSnapshot },
      orderedEvents: replay.orderedEvents.map((event) => ({
        ...event,
        payload: { ...event.payload },
      })),
      toolCallBlocks: replay.toolCallBlocks.map((block) => ({ ...block })),
      diagnosticBlocks: replay.diagnosticBlocks.map((block) => ({ ...block })),
      terminalState: replay.terminalState === null ? null : { ...replay.terminalState },
      availabilityInterpretation: replay.availabilityInterpretation === null
        ? null
        : { ...replay.availabilityInterpretation },
    },
  }
}

export function setAssistantSessionHistoryReplayError(
  state: AssistantSessionHistoryState,
  error: string,
): AssistantSessionHistoryState {
  return {
    ...state,
    replayStatus: 'error',
    replayError: error,
  }
}

export function resolveAssistantHistoryBoundAgent(boundAgentId: string, agents: AgentType[]): AgentType {
  const matchedAgent = agents.find((agent) => agent.id === boundAgentId)
  if (matchedAgent !== undefined) {
    return matchedAgent
  }

  const label = boundAgentId.trim() === '' ? '历史智能体' : boundAgentId
  return {
    id: boundAgentId,
    label,
    shortLabel: label,
    description: '历史会话绑定的智能体当前未在目录中提供。',
    hint: '历史绑定',
    status: 'historical',
    icon: Sparkles,
    recommendedTools: [],
  }
}

function resolveAssistantHistorySessionTitle(summary: CopilotHistoryThreadSummary): string {
  const title = summary.title?.trim()
  if (title) {
    return title
  }

  const userPreview = summary.lastUserMessagePreview?.trim()
  if (userPreview) {
    return userPreview
  }

  const assistantPreview = summary.lastAssistantMessagePreview?.trim()
  if (assistantPreview) {
    return assistantPreview
  }

  return summary.boundAgentId.trim() || '历史会话'
}
