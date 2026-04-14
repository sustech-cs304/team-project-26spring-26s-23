import type { CopilotHistoryRunEvent } from '../../../electron/copilot-history'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { applyRuntimeRunEventToCopilotRunState, createIdleCopilotRunState } from './run-segment-reducer'
import type { CopilotRunFailureSummary } from './run-segment-types'
import {
  buildCopilotRunSegmentViewModel,
  type CopilotAssistantMessageItem,
  type CopilotDiagnosticMessageItem,
  type CopilotMessageListItem,
  type CopilotReasoningMessageItem,
  type CopilotTerminalMessageItem,
  type CopilotToolMessageItem,
} from './run-segment-view-model'
import {
  cloneRuntimeReasoningSuppressionBasis,
  cloneRuntimeThinkingCapability,
  cloneRuntimeThinkingSelection,
  type RuntimeModelRoute,
  type RuntimeResolvedModelRoute,
  type RuntimeRunEvent,
  type RuntimeRunThinkingMetadata,
} from './thread-run-contract'

interface PersistedRunContext {
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
  requestedThinkingSelection: ReturnType<typeof cloneRuntimeThinkingSelection>
  appliedThinkingSelection: ReturnType<typeof cloneRuntimeThinkingSelection>
  thinkingCapabilitySnapshot: ReturnType<typeof cloneRuntimeThinkingCapability>
  reasoningSuppressionBasis: ReturnType<typeof cloneRuntimeReasoningSuppressionBasis>
  historicalSnapshot: Record<string, unknown> | null
  availabilityInterpretation: Record<string, unknown> | null
  availabilityDrift: Record<string, unknown> | null
}

export type PersistedConversationSource = 'none' | 'timeline' | 'replay'

export interface PersistedConversationBuildResult {
  conversation: CopilotMessageListItem[]
  selectedRunConversationSource: PersistedConversationSource
}

export function buildPersistedConversationFromHistory(
  history: AssistantSessionHistoryState | null,
): PersistedConversationBuildResult {
  if (history === null || (!history.hasLoadedDetail && history.detailStatus !== 'ready')) {
    return {
      conversation: [],
      selectedRunConversationSource: 'none',
    }
  }

  const selectedRunId = normalizeOptionalString(history.selectedRunId)
  const runContexts = buildPersistedRunContextMap(history)
  const timelineConversation = buildPersistedConversationFromTimeline({
    history,
    timelineItems: filterTimelineItemsForSelectedRun(history.timelineItems, selectedRunId),
    runContexts,
  })

  if (selectedRunId === null) {
    return {
      conversation: timelineConversation,
      selectedRunConversationSource: timelineConversation.length === 0 ? 'none' : 'timeline',
    }
  }

  const replayConversation = buildPersistedConversationFromReplay(history, selectedRunId)
  return replayConversation.some((item) => item.kind !== 'user')
    ? {
        conversation: replayConversation,
        selectedRunConversationSource: 'replay',
      }
    : {
        conversation: timelineConversation,
        selectedRunConversationSource: timelineConversation.length === 0 ? 'none' : 'timeline',
      }
}

function buildPersistedConversationFromTimeline(input: {
  history: AssistantSessionHistoryState
  timelineItems: Record<string, unknown>[]
  runContexts: Map<string, PersistedRunContext>
}): CopilotMessageListItem[] {
  return input.timelineItems.flatMap((timelineItem, index) => {
    const normalizedTimelineItem = cloneRecord(timelineItem)
    const kind = readString(normalizedTimelineItem.kind)

    switch (kind) {
      case 'user_message':
        return mapUserMessageItem(normalizedTimelineItem, index)
      case 'assistant_message':
        return mapAssistantMessageItem(normalizedTimelineItem, index, input.runContexts)
      case 'reasoning_block':
        return mapReasoningMessageItem(normalizedTimelineItem, index)
      case 'tool_call_block':
        return mapToolMessageItem(normalizedTimelineItem, index)
      case 'diagnostic_block':
        return mapDiagnosticMessageItem(normalizedTimelineItem, index)
      case 'terminal_block':
        return mapTerminalMessageItem(normalizedTimelineItem, index, input.runContexts)
      default:
        return []
    }
  })
}

function buildPersistedConversationFromReplay(
  history: AssistantSessionHistoryState,
  selectedRunId: string,
): CopilotMessageListItem[] {
  if (
    history.replay === null
    || history.replay.run.runId !== selectedRunId
  ) {
    return []
  }

  const replay = history.replay
  const replayState = replay.orderedEvents.reduce((currentState, orderedEvent) => {
    const runtimeEvent = mapPersistedRunEventToRuntimeRunEvent(replay.run.runId, replay.run.threadId, replay.historicalSnapshot, orderedEvent)
    return runtimeEvent === null
      ? currentState
      : applyRuntimeRunEventToCopilotRunState(currentState, runtimeEvent)
  }, createIdleCopilotRunState())
  const historicalRequestMessage = asRecord(asRecord(replay.historicalSnapshot)?.requestMessage)
  const userMessageText = normalizeOptionalString(replay.run.requestedMessageText)
    ?? normalizeOptionalString(readString(historicalRequestMessage?.content))
  const conversation = buildCopilotRunSegmentViewModel(replayState).map((item) => {
    if (item.kind !== 'assistant' && item.kind !== 'terminal') {
      return item
    }

    return {
      ...item,
      historicalSnapshot: cloneRecord(replay.historicalSnapshot),
      availabilityInterpretation: cloneRecord(replay.availabilityInterpretation),
      availabilityDrift: history.availabilityDrift === null ? null : cloneRecord(history.availabilityDrift),
    }
  })

  return userMessageText === null
    ? conversation
    : [{
        id: `history:user:${selectedRunId}`,
        kind: 'user',
        title: '',
        content: userMessageText,
        status: 'completed',
      }, ...conversation]
}

function buildPersistedRunContextMap(
  history: AssistantSessionHistoryState,
): Map<string, PersistedRunContext> {
  const contextMap = new Map<string, PersistedRunContext>()

  for (const runSummary of history.runSummaries) {
    contextMap.set(runSummary.runId, {
      resolvedModelId: normalizeOptionalString(runSummary.resolvedModelId),
      resolvedModelRoute: null,
      resolvedToolIds: [],
      requestOptions: {},
      requestedThinkingSelection: null,
      appliedThinkingSelection: null,
      thinkingCapabilitySnapshot: null,
      reasoningSuppressionBasis: null,
      historicalSnapshot: null,
      availabilityInterpretation: null,
      availabilityDrift: history.availabilityDrift === null ? null : cloneRecord(history.availabilityDrift),
    })
  }

  if (history.replay === null) {
    return contextMap
  }

  const replay = history.replay
  const historicalSnapshot = cloneRecord(replay.historicalSnapshot)
  const resolvedModelRoute = asRuntimeRoute(historicalSnapshot?.resolvedModelRoute)
  const resolvedToolIds = readStringArray(
    historicalSnapshot?.resolvedToolIds
      ?? historicalSnapshot?.enabledToolIds,
  )
  const requestOptions = cloneRecord(historicalSnapshot?.requestOptions)
  const requestedThinkingSelection = cloneRuntimeThinkingSelection(
    asRecord(historicalSnapshot?.requestedThinkingSelection) as Parameters<typeof cloneRuntimeThinkingSelection>[0],
  )
  const appliedThinkingSelection = cloneRuntimeThinkingSelection(
    asRecord(historicalSnapshot?.appliedThinkingSelection) as Parameters<typeof cloneRuntimeThinkingSelection>[0],
  )
  const thinkingCapabilitySnapshot = cloneRuntimeThinkingCapability(
    asRecord(historicalSnapshot?.thinkingCapabilitySnapshot) as Parameters<typeof cloneRuntimeThinkingCapability>[0],
  )
  const reasoningSuppressionBasis = cloneRuntimeReasoningSuppressionBasis(
    asRecord(historicalSnapshot?.reasoningSuppressionBasis) as Parameters<typeof cloneRuntimeReasoningSuppressionBasis>[0],
  )

  contextMap.set(replay.run.runId, {
    resolvedModelId: normalizeOptionalString(replay.run.resolvedModelId)
      ?? normalizeOptionalString(readString(historicalSnapshot?.resolvedModelId)),
    resolvedModelRoute,
    resolvedToolIds,
    requestOptions,
    requestedThinkingSelection,
    appliedThinkingSelection,
    thinkingCapabilitySnapshot,
    reasoningSuppressionBasis,
    historicalSnapshot,
    availabilityInterpretation: cloneRecord(replay.availabilityInterpretation),
    availabilityDrift: history.availabilityDrift === null ? null : cloneRecord(history.availabilityDrift),
  })

  return contextMap
}

function filterTimelineItemsForSelectedRun(
  timelineItems: Record<string, unknown>[],
  selectedRunId: string | null,
): Record<string, unknown>[] {
  if (selectedRunId === null) {
    return timelineItems.map((timelineItem) => ({ ...timelineItem }))
  }

  return timelineItems
    .filter((timelineItem) => {
      const runId = normalizeOptionalString(readString(timelineItem.runId))
      return runId === null || runId === selectedRunId
    })
    .map((timelineItem) => ({ ...timelineItem }))
}

function mapPersistedRunEventToRuntimeRunEvent(
  runId: string,
  threadId: string,
  historicalSnapshot: Record<string, unknown> | null,
  event: CopilotHistoryRunEvent,
): RuntimeRunEvent | null {
  const payload = cloneRecord(event.payload)
  const historicalRecord = asRecord(historicalSnapshot)
  const historicalRequestMessage = asRecord(historicalRecord?.requestMessage)
  const assistantMessageId = normalizeOptionalString(readString(payload.assistantMessageId)) ?? buildReplayAssistantMessageId(runId)

  switch (event.eventType) {
    case 'run_started':
      return {
        type: 'run_started',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          ...payload,
          assistantMessageId,
        },
      }
    case 'run_metadata':
      return {
        type: 'run_metadata',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: buildRuntimeRunThinkingMetadataPayload(payload),
      }
    case 'text_delta': {
      const delta = normalizeOptionalString(readString(payload.delta))
      if (delta === null) {
        return null
      }

      return {
        type: 'text_delta',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          assistantMessageId,
          delta,
        },
      }
    }
    case 'reasoning_delta': {
      const delta = normalizeOptionalString(readString(payload.delta))
      if (delta === null) {
        return null
      }

      return {
        type: 'reasoning_delta',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          delta,
        },
      }
    }
    case 'tool_event': {
      const phase = normalizeOptionalString(readString(payload.phase)) ?? normalizeOptionalString(event.phase)
      if (phase !== 'started' && phase !== 'completed' && phase !== 'failed') {
        return null
      }

      const title = normalizeOptionalString(readString(payload.title)) ?? '工具调用'
      const summary = normalizeOptionalString(readString(payload.summary))
        ?? normalizeOptionalString(readString(payload.resultSummary))
        ?? normalizeOptionalString(readString(payload.errorSummary))
        ?? title

      return {
        type: 'tool_event',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          toolCallId: normalizeOptionalString(readString(payload.toolCallId)) ?? normalizeOptionalString(event.toolCallId) ?? `history-tool-call-${event.sequence}`,
          toolId: normalizeOptionalString(readString(payload.toolId)) ?? normalizeOptionalString(event.toolId) ?? 'unknown-tool',
          phase,
          title,
          summary,
          inputSummary: normalizeOptionalString(readString(payload.inputSummary)) ?? undefined,
          resultSummary: normalizeOptionalString(readString(payload.resultSummary)) ?? undefined,
          errorSummary: normalizeOptionalString(readString(payload.errorSummary)) ?? undefined,
        },
      }
    }
    case 'run_diagnostic':
      return {
        type: 'run_diagnostic',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          code: normalizeOptionalString(readString(payload.code)) ?? 'history_diagnostic',
          message: normalizeOptionalString(readString(payload.message)) ?? '历史运行诊断',
          details: cloneRecord(payload.details),
          stage: normalizeOptionalString(readString(payload.stage)) ?? 'history',
        },
      }
    case 'run_completed': {
      const resolvedModelId = normalizeOptionalString(readString(payload.resolvedModelId))
        ?? normalizeOptionalString(readString(historicalRecord?.resolvedModelId))
        ?? 'history-model'
      const resolvedModelRoute = asRuntimeResolvedRoute(payload.resolvedModelRoute)
        ?? asRuntimeResolvedRoute(historicalRecord?.resolvedModelRoute)
        ?? buildFallbackRuntimeResolvedModelRoute(resolvedModelId)
      const resolvedToolIds = readStringArray(payload.resolvedToolIds)
      const fallbackToolIds = readStringArray(historicalRecord?.resolvedToolIds)

      return {
        type: 'run_completed',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          assistantMessageId,
          assistantText: normalizeOptionalString(readString(payload.assistantText))
            ?? normalizeOptionalString(readString(payload.delta))
            ?? normalizeOptionalString(readString(payload.text))
            ?? normalizeOptionalString(readString(payload.message))
            ?? normalizeOptionalString(readString(historicalRequestMessage?.content))
            ?? '',
          resolvedModelId,
          resolvedModelRoute,
          resolvedToolIds: resolvedToolIds.length > 0 ? resolvedToolIds : fallbackToolIds,
          requestOptions: cloneRecord(payload.requestOptions ?? historicalRecord?.requestOptions),
        },
      }
    }
    case 'run_failed':
      return {
        type: 'run_failed',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          code: normalizeOptionalString(readString(payload.code)) ?? 'history_failed',
          message: normalizeOptionalString(readString(payload.message)) ?? '当前响应失败，请重试。',
          details: cloneRecord(payload.details),
        },
      }
    case 'run_cancelled':
      return {
        type: 'run_cancelled',
        runId,
        sessionId: threadId,
        sequence: event.sequence,
        payload: {
          assistantMessageId,
          reason: normalizeOptionalString(readString(payload.reason)) ?? 'cancelled',
        },
      }
    default:
      return null
  }
}

function buildRuntimeRunThinkingMetadataPayload(
  payload: Record<string, unknown>,
): RuntimeRunThinkingMetadata {
  return {
    requestedThinkingSelection: asRecord(payload.requestedThinkingSelection) as RuntimeRunThinkingMetadata['requestedThinkingSelection'],
    appliedThinkingSelection: asRecord(payload.appliedThinkingSelection) as RuntimeRunThinkingMetadata['appliedThinkingSelection'],
    thinkingCapabilitySnapshot: asRecord(payload.thinkingCapabilitySnapshot) as RuntimeRunThinkingMetadata['thinkingCapabilitySnapshot'],
    thinkingSeriesDecision: asRecord(payload.thinkingSeriesDecision) as RuntimeRunThinkingMetadata['thinkingSeriesDecision'],
    reasoningSuppressionBasis: asRecord(payload.reasoningSuppressionBasis) as RuntimeRunThinkingMetadata['reasoningSuppressionBasis'],
    requestedThinkingLevel: normalizeThinkingLevel(payload.requestedThinkingLevel),
    appliedThinkingLevel: normalizeThinkingLevel(payload.appliedThinkingLevel),
  }
}

function buildReplayAssistantMessageId(runId: string): string {
  return `history:${runId}:assistant`
}

function mapUserMessageItem(
  timelineItem: Record<string, unknown>,
  index: number,
): CopilotMessageListItem[] {
  const content = normalizeOptionalString(readString(timelineItem.text))
  if (content === null) {
    return []
  }

  return [{
    id: buildHistoryItemId('user', timelineItem, index),
    kind: 'user',
    title: '',
    content,
    status: 'completed',
  }]
}

function mapAssistantMessageItem(
  timelineItem: Record<string, unknown>,
  index: number,
  runContexts: Map<string, PersistedRunContext>,
): CopilotMessageListItem[] {
  const content = normalizeOptionalString(readString(timelineItem.text))
  if (content === null) {
    return []
  }

  const runId = normalizeOptionalString(readString(timelineItem.runId)) ?? `history-run-${index}`
  const runContext = runContexts.get(runId) ?? createFallbackRunContext()

  const item: CopilotAssistantMessageItem = {
    id: buildHistoryItemId('assistant', timelineItem, index),
    kind: 'assistant',
    runId,
    sequence: readNumber(timelineItem.sequenceStart) ?? index,
    title: runContext.resolvedModelId ?? '助手响应',
    content,
    status: 'completed',
    resolvedModelId: runContext.resolvedModelId,
    resolvedModelRoute: runContext.resolvedModelRoute,
    resolvedToolIds: [...runContext.resolvedToolIds],
    requestOptions: { ...runContext.requestOptions },
    requestedThinkingSelection: cloneRuntimeThinkingSelection(runContext.requestedThinkingSelection),
    appliedThinkingSelection: cloneRuntimeThinkingSelection(runContext.appliedThinkingSelection),
    thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runContext.thinkingCapabilitySnapshot),
    reasoningSuppressionBasis: cloneRuntimeReasoningSuppressionBasis(runContext.reasoningSuppressionBasis),
    availabilityInterpretation: cloneRecord(runContext.availabilityInterpretation),
    availabilityDrift: cloneRecord(runContext.availabilityDrift),
    historicalSnapshot: cloneRecord(runContext.historicalSnapshot),
  }

  return [item]
}

function mapReasoningMessageItem(
  timelineItem: Record<string, unknown>,
  index: number,
): CopilotMessageListItem[] {
  const content = normalizeOptionalString(readString(timelineItem.text))
  if (content === null) {
    return []
  }

  const observedAt = resolveTimestamp(timelineItem.createdAt) ?? Date.now()
  const runId = normalizeOptionalString(readString(timelineItem.runId)) ?? `history-run-${index}`
  const item: CopilotReasoningMessageItem = {
    id: buildHistoryItemId('reasoning', timelineItem, index),
    kind: 'reasoning',
    runId,
    sequence: readNumber(timelineItem.sequenceStart) ?? index,
    title: '思考',
    content,
    observedStartedAt: observedAt,
    observedFinishedAt: observedAt,
    status: 'completed',
    isCollapsedByDefault: true,
  }

  return [item]
}

function mapToolMessageItem(
  timelineItem: Record<string, unknown>,
  index: number,
): CopilotMessageListItem[] {
  const runId = normalizeOptionalString(readString(timelineItem.runId)) ?? `history-run-${index}`
  const phases = Array.isArray(timelineItem.phases)
    ? timelineItem.phases.map((phase) => cloneRecord(phase))
    : []
  const status = resolveToolMessageStatus(phases)
  const title = normalizeOptionalString(readString(timelineItem.title)) ?? '工具调用'
  const content = normalizeOptionalString(
    readString(timelineItem.resultSummary)
      ?? readString(timelineItem.errorSummary)
      ?? readString(timelineItem.summary),
  ) ?? title

  const item: CopilotToolMessageItem = {
    id: buildHistoryItemId('tool', timelineItem, index),
    kind: 'tool',
    runId,
    sequence: readNumber(timelineItem.sequenceStart) ?? index,
    status,
    toolCallId: normalizeOptionalString(readString(timelineItem.toolCallId)) ?? `history-tool-call-${index}`,
    toolId: normalizeOptionalString(readString(timelineItem.toolId)) ?? 'unknown-tool',
    toolPhase: status === 'failed' ? 'failed' : status === 'streaming' ? 'started' : 'completed',
    title,
    content,
    inputSummary: normalizeOptionalString(readString(timelineItem.inputSummary)),
    resultSummary: normalizeOptionalString(readString(timelineItem.resultSummary)),
    errorSummary: normalizeOptionalString(readString(timelineItem.errorSummary)),
  }

  return [item]
}

function mapDiagnosticMessageItem(
  timelineItem: Record<string, unknown>,
  index: number,
): CopilotMessageListItem[] {
  const message = normalizeOptionalString(readString(timelineItem.message))
  if (message === null) {
    return []
  }

  const runId = normalizeOptionalString(readString(timelineItem.runId)) ?? `history-run-${index}`
  const item: CopilotDiagnosticMessageItem = {
    id: buildHistoryItemId('diagnostic', timelineItem, index),
    kind: 'diagnostic',
    runId,
    sequence: readNumber(timelineItem.sequenceStart) ?? index,
    title: '运行诊断',
    content: message,
    status: 'completed',
    diagnostic: {
      code: normalizeOptionalString(readString(timelineItem.code)) ?? 'unknown_diagnostic',
      message,
      stage: normalizeOptionalString(readString(timelineItem.stage)) ?? 'history',
      details: cloneRecord(timelineItem.details),
    },
  }

  return [item]
}

function mapTerminalMessageItem(
  timelineItem: Record<string, unknown>,
  index: number,
  runContexts: Map<string, PersistedRunContext>,
): CopilotMessageListItem[] {
  const terminalStatus = normalizeOptionalString(readString(timelineItem.status))
  if (terminalStatus !== 'failed' && terminalStatus !== 'cancelled') {
    return []
  }

  const runId = normalizeOptionalString(readString(timelineItem.runId)) ?? `history-run-${index}`
  const runContext = runContexts.get(runId) ?? createFallbackRunContext()
  const failure = buildTerminalFailureSummary(timelineItem)
  const item: CopilotTerminalMessageItem = {
    id: buildHistoryItemId('terminal', timelineItem, index),
    kind: 'terminal',
    runId,
    sequence: readNumber(timelineItem.sequenceStart) ?? index,
    title: terminalStatus === 'cancelled' ? '已取消' : '发送失败',
    content: terminalStatus === 'cancelled'
      ? normalizeOptionalString(readString(timelineItem.cancelReason)) ?? '当前响应已取消。'
      : normalizeOptionalString(readString(timelineItem.failureMessage)) ?? '当前响应失败，请重试。',
    status: terminalStatus,
    terminalPhase: terminalStatus,
    cancelReason: normalizeOptionalString(readString(timelineItem.cancelReason)),
    failure,
    resolvedModelId: runContext.resolvedModelId,
    resolvedModelRoute: runContext.resolvedModelRoute,
    resolvedToolIds: [...runContext.resolvedToolIds],
    requestOptions: { ...runContext.requestOptions },
    errorDetail: null,
    requestedThinkingSelection: cloneRuntimeThinkingSelection(runContext.requestedThinkingSelection),
    appliedThinkingSelection: cloneRuntimeThinkingSelection(runContext.appliedThinkingSelection),
    thinkingCapabilitySnapshot: cloneRuntimeThinkingCapability(runContext.thinkingCapabilitySnapshot),
    reasoningSuppressionBasis: cloneRuntimeReasoningSuppressionBasis(runContext.reasoningSuppressionBasis),
    availabilityInterpretation: cloneRecord(runContext.availabilityInterpretation),
    availabilityDrift: cloneRecord(runContext.availabilityDrift),
    historicalSnapshot: cloneRecord(runContext.historicalSnapshot),
  }

  return [item]
}

function buildTerminalFailureSummary(
  timelineItem: Record<string, unknown>,
): CopilotRunFailureSummary | null {
  const code = normalizeOptionalString(readString(timelineItem.failureCode))
  const message = normalizeOptionalString(readString(timelineItem.failureMessage))

  if (code === null && message === null) {
    return null
  }

  return {
    code: code ?? 'history_terminal_failed',
    message: message ?? '当前响应失败，请重试。',
    details: cloneRecord(timelineItem.payload),
  }
}

function resolveToolMessageStatus(phases: Array<Record<string, unknown>>): CopilotToolMessageItem['status'] {
  const phaseNames = phases.map((phase) => normalizeOptionalString(readString(phase.phase))).filter((phase): phase is string => phase !== null)
  if (phaseNames.includes('failed')) {
    return 'failed'
  }
  if (phaseNames.includes('completed')) {
    return 'completed'
  }
  return 'streaming'
}

function buildHistoryItemId(
  prefix: string,
  timelineItem: Record<string, unknown>,
  index: number,
): string {
  const runId = normalizeOptionalString(readString(timelineItem.runId)) ?? 'history-run'
  const sequence = readNumber(timelineItem.sequenceStart) ?? index
  return `history:${prefix}:${runId}:${sequence}`
}

function createFallbackRunContext(): PersistedRunContext {
  return {
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
    requestedThinkingSelection: null,
    appliedThinkingSelection: null,
    thinkingCapabilitySnapshot: null,
    reasoningSuppressionBasis: null,
    historicalSnapshot: null,
    availabilityInterpretation: null,
    availabilityDrift: null,
  }
}

function resolveTimestamp(value: unknown): number | null {
  const normalizedValue = normalizeOptionalString(readString(value))
  if (normalizedValue === null) {
    return null
  }

  const timestamp = Date.parse(normalizedValue)
  return Number.isFinite(timestamp) ? timestamp : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeOptionalString(readString(item)))
    .filter((item): item is string => item !== null)
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim() ?? ''
  return normalizedValue === '' ? null : normalizedValue
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {}
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? { ...value } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRuntimeRoute(
  value: unknown,
): RuntimeResolvedModelRoute | RuntimeModelRoute | null {
  if (!isRecord(value)) {
    return null
  }

  return { ...value } as RuntimeResolvedModelRoute | RuntimeModelRoute
}

function asRuntimeResolvedRoute(
  value: unknown,
): RuntimeResolvedModelRoute | null {
  const record = isRecord(value) ? value : null
  const routeRefRecord = isRecord(record?.routeRef) ? record.routeRef : null
  const routeKind = readString(routeRefRecord?.routeKind) === 'provider-model' ? 'provider-model' : null
  const profileId = normalizeOptionalString(readString(routeRefRecord?.profileId))
  const modelIdFromRouteRef = normalizeOptionalString(readString(routeRefRecord?.modelId))
  const routeRef: RuntimeResolvedModelRoute['routeRef'] | null = routeKind !== null && profileId !== null && modelIdFromRouteRef !== null
    ? {
        routeKind: 'provider-model',
        profileId,
        modelId: modelIdFromRouteRef,
      }
    : null
  const providerProfileId = normalizeOptionalString(readString(record?.providerProfileId))
  const provider = normalizeOptionalString(readString(record?.provider))
  const providerId = normalizeOptionalString(readString(record?.providerId))
  const adapterId = normalizeOptionalString(readString(record?.adapterId))
  const runtimeStatus = normalizeOptionalString(readString(record?.runtimeStatus))
  const catalogRevision = normalizeOptionalString(readString(record?.catalogRevision))
  const endpointFamily = normalizeOptionalString(readString(record?.endpointFamily))
  const endpointType = normalizeOptionalString(readString(record?.endpointType))
  const baseUrl = readString(record?.baseUrl)
  const modelId = normalizeOptionalString(readString(record?.modelId))
  const authKind = normalizeOptionalString(readString(record?.authKind))

  if (
    routeRef === null
    || providerProfileId === null
    || provider === null
    || providerId === null
    || adapterId === null
    || runtimeStatus === null
    || catalogRevision === null
    || endpointFamily === null
    || endpointType === null
    || baseUrl === null
    || modelId === null
    || authKind === null
  ) {
    return null
  }

  return {
    routeRef,
    providerProfileId,
    provider,
    providerId,
    adapterId,
    runtimeStatus,
    catalogRevision,
    endpointFamily,
    endpointType,
    baseUrl,
    modelId,
    authKind,
  }
}

function buildFallbackRuntimeResolvedModelRoute(modelId: string): RuntimeResolvedModelRoute {
  return {
    routeRef: {
      routeKind: 'provider-model',
      profileId: 'history-profile',
      modelId,
    },
    providerProfileId: 'history-profile',
    provider: 'history-provider',
    providerId: 'history-provider',
    adapterId: 'history-adapter',
    runtimeStatus: 'historical',
    catalogRevision: 'history',
    endpointFamily: 'history',
    endpointType: 'history',
    baseUrl: '',
    modelId,
    authKind: 'unknown',
  }
}

function normalizeThinkingLevel(
  value: unknown,
): RuntimeRunThinkingMetadata['requestedThinkingLevel'] {
  return typeof value === 'string' || value === null
    ? value as RuntimeRunThinkingMetadata['requestedThinkingLevel']
    : undefined
}
