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
  isPersistedThread?: boolean
  hasLoadedDetail?: boolean
  detailStatus: AssistantSessionHistoryLoadStatus
  detailError: string | null
  timelineItems: Record<string, unknown>[]
  runSummaries: CopilotHistoryRunSummary[]
  latestConfigurationSnapshot: Record<string, unknown> | null
  availabilityDrift: Record<string, unknown> | null
  capabilitiesStatus?: AssistantSessionHistoryLoadStatus
  capabilitiesError?: string | null
  selectedRunId: string | null
  replayStatus: AssistantSessionHistoryLoadStatus
  replayError: string | null
  replay: CopilotHistoryRunReplaySuccess | null
  replayByRunId?: Record<string, CopilotHistoryRunReplaySuccess>
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

export function createAssistantSessionHistoryStateFromSessionShell(
  sessionShell: AssistantSessionShell,
  selectedRunId: string | null,
): AssistantSessionHistoryState {
  return createAssistantSessionHistoryState(
    createAssistantHistorySummaryFromSessionShell(sessionShell),
    selectedRunId,
    false,
  )
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
  isPersistedThread = true,
): AssistantSessionHistoryState {
  return {
    summary: { ...summary },
    isPersistedThread,
    hasLoadedDetail: false,
    detailStatus: 'idle',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    capabilitiesStatus: isPersistedThread ? 'idle' : 'ready',
    capabilitiesError: null,
    selectedRunId: resolveAssistantSessionSelectedRunId({
      persistedSelectedRunId: selectedRunId,
      fallbackRunId: summary.lastRunId,
    }),
    replayStatus: 'idle',
    replayError: null,
    replay: null,
    replayByRunId: {},
  }
}

export function syncAssistantSessionHistorySummary(
  state: AssistantSessionHistoryState,
  summary: CopilotHistoryThreadSummary,
  selectedRunId: string | null,
): AssistantSessionHistoryState {
  const nextSelectedRunId = resolveAssistantSessionSelectedRunId({
    persistedSelectedRunId: selectedRunId,
    currentSelectedRunId: state.selectedRunId,
    runSummaries: state.runSummaries,
    fallbackRunId: summary.lastRunId,
  })
  const replayForSelectedRun = getAssistantSessionHistoryReplayForRun(state, nextSelectedRunId)

  return {
    ...state,
    summary: { ...summary },
    isPersistedThread: true,
    selectedRunId: nextSelectedRunId,
    replayStatus: replayForSelectedRun !== null
      ? 'ready'
      : nextSelectedRunId === null
        ? 'idle'
        : state.selectedRunId === nextSelectedRunId
          ? state.replayStatus
          : 'idle',
    replayError: state.selectedRunId === nextSelectedRunId ? state.replayError : null,
    replay: replayForSelectedRun ?? state.replay,
  }
}

export function retryAssistantSessionHistoryDetail(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    detailStatus: 'idle',
    detailError: null,
  }
}

export function retryAssistantSessionHistoryReplay(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    replayStatus: 'idle',
    replayError: null,
    replay: getAssistantSessionHistoryReplayForRun(state, state.selectedRunId) ?? state.replay,
  }
}

export function retryAssistantSessionCapabilitiesHydration(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    capabilitiesStatus: 'idle',
    capabilitiesError: null,
  }
}

export function setAssistantSessionCapabilitiesHydrationLoading(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    capabilitiesStatus: 'loading',
    capabilitiesError: null,
  }
}

export function setAssistantSessionCapabilitiesHydrationReady(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    capabilitiesStatus: 'ready',
    capabilitiesError: null,
  }
}

export function setAssistantSessionCapabilitiesHydrationError(
  state: AssistantSessionHistoryState,
  error: string,
): AssistantSessionHistoryState {
  return {
    ...state,
    capabilitiesStatus: 'error',
    capabilitiesError: error,
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
  const selectedRunId = resolveAssistantSessionSelectedRunId({
    currentSelectedRunId: state.selectedRunId,
    runSummaries,
    fallbackRunId: detail.thread.lastRunId,
  })
  const replayForSelectedRun = getAssistantSessionHistoryReplayForRun(state, selectedRunId)

  return {
    ...state,
    summary: { ...detail.thread },
    isPersistedThread: true,
    hasLoadedDetail: true,
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
    replayStatus: replayForSelectedRun !== null
      ? 'ready'
      : selectedRunId === null
        ? 'idle'
        : state.selectedRunId === selectedRunId
          ? state.replayStatus
          : 'idle',
    replayError: state.selectedRunId === selectedRunId ? state.replayError : null,
    replay: replayForSelectedRun ?? state.replay,
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

export function selectAssistantSessionHistoryRun(
  state: AssistantSessionHistoryState,
  runId: string | null,
): AssistantSessionHistoryState {
  const nextSelectedRunId = normalizeOptionalString(runId)
  if (nextSelectedRunId === state.selectedRunId) {
    return state.replayStatus === 'error'
      ? retryAssistantSessionHistoryReplay(state)
      : state
  }

  const replayForSelectedRun = getAssistantSessionHistoryReplayForRun(state, nextSelectedRunId)
  return {
    ...state,
    selectedRunId: nextSelectedRunId,
    replayStatus: replayForSelectedRun !== null
      ? 'ready'
      : 'idle',
    replayError: null,
    replay: replayForSelectedRun ?? state.replay,
  }
}

export function setAssistantSessionHistoryReplayLoading(
  state: AssistantSessionHistoryState,
): AssistantSessionHistoryState {
  return {
    ...state,
    replayStatus: 'loading',
    replayError: null,
    replay: getAssistantSessionHistoryReplayForRun(state, state.selectedRunId) ?? state.replay,
  }
}

export function applyAssistantSessionHistoryReplay(
  state: AssistantSessionHistoryState,
  replay: CopilotHistoryRunReplaySuccess,
): AssistantSessionHistoryState {
  const nextReplay = cloneAssistantSessionHistoryReplay(replay)

  return {
    ...state,
    selectedRunId: replay.run.runId,
    replayStatus: 'ready',
    replayError: null,
    replay: nextReplay,
    replayByRunId: {
      ...(state.replayByRunId ?? {}),
      [replay.run.runId]: nextReplay,
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
    replay: getAssistantSessionHistoryReplayForRun(state, state.selectedRunId) ?? state.replay,
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

function createAssistantHistorySummaryFromSessionShell(
  sessionShell: AssistantSessionShell,
): CopilotHistoryThreadSummary {
  const title = normalizeOptionalString(sessionShell.title)

  return {
    threadId: sessionShell.sessionId,
    boundAgentId: sessionShell.boundAgent.id,
    title,
    titleSource: title === null ? null : 'session-shell',
    summary: null,
    summarySource: null,
    createdAt: sessionShell.createdAt,
    updatedAt: sessionShell.updatedAt,
    lastActivityAt: sessionShell.updatedAt,
    lastRunId: null,
    lastRunStatus: null,
    lastUserMessagePreview: null,
    lastAssistantMessagePreview: null,
    driftSummary: null,
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

function resolveAssistantSessionSelectedRunId(input: {
  persistedSelectedRunId?: string | null
  currentSelectedRunId?: string | null
  runSummaries?: CopilotHistoryRunSummary[]
  fallbackRunId?: string | null
}): string | null {
  const availableRunIds = new Set(
    (input.runSummaries ?? [])
      .map((runSummary) => normalizeOptionalString(runSummary.runId))
      .filter((runId): runId is string => runId !== null),
  )
  const candidates = [
    normalizeOptionalString(input.persistedSelectedRunId),
    normalizeOptionalString(input.currentSelectedRunId),
    normalizeOptionalString(input.fallbackRunId),
    input.runSummaries?.[input.runSummaries.length - 1]?.runId ?? null,
  ]

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeOptionalString(candidate)
    if (normalizedCandidate === null) {
      continue
    }

    if (availableRunIds.size === 0 || availableRunIds.has(normalizedCandidate)) {
      return normalizedCandidate
    }
  }

  return null
}

export function hasAssistantSessionHistoryReplayForRun(
  state: AssistantSessionHistoryState,
  runId: string | null,
): boolean {
  return getAssistantSessionHistoryReplayForRun(state, runId) !== null
}

function getAssistantSessionHistoryReplayForRun(
  state: AssistantSessionHistoryState,
  runId: string | null,
): CopilotHistoryRunReplaySuccess | null {
  const normalizedRunId = normalizeOptionalString(runId)
  if (normalizedRunId === null) {
    return null
  }

  const cachedReplay = state.replayByRunId?.[normalizedRunId]
  if (cachedReplay !== undefined) {
    return cloneAssistantSessionHistoryReplay(cachedReplay)
  }

  if (state.replay?.run.runId === normalizedRunId) {
    return cloneAssistantSessionHistoryReplay(state.replay)
  }

  return null
}

function cloneAssistantSessionHistoryReplay(
  replay: CopilotHistoryRunReplaySuccess,
): CopilotHistoryRunReplaySuccess {
  return {
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
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim() ?? ''
  return normalizedValue === '' ? null : normalizedValue
}
