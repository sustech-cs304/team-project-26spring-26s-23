import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import type { CopilotRunFailureSummary } from './run-segment-types'
import type {
  CopilotAssistantMessageItem,
  CopilotDiagnosticMessageItem,
  CopilotMessageListItem,
  CopilotReasoningMessageItem,
  CopilotTerminalMessageItem,
  CopilotToolMessageItem,
} from './run-segment-view-model'
import {
  cloneRuntimeReasoningSuppressionBasis,
  cloneRuntimeThinkingCapability,
  cloneRuntimeThinkingSelection,
  type RuntimeModelRoute,
  type RuntimeResolvedModelRoute,
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

export function buildPersistedConversationFromHistory(
  history: AssistantSessionHistoryState | null,
): CopilotMessageListItem[] {
  if (history === null || history.detailStatus !== 'ready') {
    return []
  }

  const runContexts = buildPersistedRunContextMap(history)

  return history.timelineItems.flatMap((timelineItem, index) => {
    const normalizedTimelineItem = cloneRecord(timelineItem)
    const kind = readString(normalizedTimelineItem.kind)

    switch (kind) {
      case 'user_message':
        return mapUserMessageItem(normalizedTimelineItem, index)
      case 'assistant_message':
        return mapAssistantMessageItem(normalizedTimelineItem, index, runContexts)
      case 'reasoning_block':
        return mapReasoningMessageItem(normalizedTimelineItem, index)
      case 'tool_call_block':
        return mapToolMessageItem(normalizedTimelineItem, index)
      case 'diagnostic_block':
        return mapDiagnosticMessageItem(normalizedTimelineItem, index)
      case 'terminal_block':
        return mapTerminalMessageItem(normalizedTimelineItem, index, runContexts)
      default:
        return []
    }
  })
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

  if (history.replayStatus !== 'ready' || history.replay === null) {
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
