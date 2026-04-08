import type {
  AgentType,
  AssistantSessionShell,
  ThinkingLevelIntent,
} from '../../workbench/types'
import {
  THINKING_BUDGET_DEFAULT_MAX_TOKENS,
  THINKING_BUDGET_DEFAULT_MIN_TOKENS,
  THINKING_BUDGET_DEFAULT_STEP_TOKENS,
  findThinkingCodeValue,
  formatThinkingTokenCount,
} from '../../workbench/thinking-display'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import {
  RuntimeRequestError,
  cloneRuntimeThinkingSelection,
  type RuntimeModelRoute,
  type RuntimeRunCompletedEvent,
  type RuntimeThinkingCapability,
  type RuntimeThinkingSelection,
  type RuntimeToolEvent,
  type RuntimeToolEventPhase,
} from './thread-run-contract'
import type {
  CopilotBootstrapState,
  CopilotDiagnosticsSummary,
  CopilotRunDiagnosticSummary,
} from './types'

export interface CopilotChatComposerDraft {
  messageText: string
  selectedModelId: string
  selectedModelRoute: RuntimeModelRoute | null
  thinkingSelection: RuntimeThinkingSelection | null
  thinkingSelectionByModelKey: Record<string, RuntimeThinkingSelection | null>
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
  modelRoute: RuntimeModelRoute
  thinkingSelection: RuntimeThinkingSelection | null
  thinkingCapabilityOverride?: Record<string, unknown> | null
  enabledTools: string[]
  requestOptions: Record<string, unknown>
}

export type CopilotToolStepPhase = RuntimeToolEventPhase | 'cancelled'

export interface CopilotConversationTurn {
  id: string
  runId?: string
  kind: 'user' | 'assistant' | 'error' | 'tool' | 'diagnostic' | 'terminal'
  title: string
  content: string
  status?: 'streaming' | 'completed' | 'failed' | 'cancelled'
  resolvedModelId?: string
  resolvedModelRoute?: RuntimeModelRoute
  resolvedToolIds?: string[]
  requestOptions?: Record<string, unknown>
  requestedThinkingLevel?: ThinkingLevelIntent | null
  appliedThinkingLevel?: ThinkingLevelIntent | null
  thinkingCapabilitySnapshot?: RuntimeThinkingCapability | null
  diagnostic?: CopilotRunDiagnosticSummary | null
  toolCallId?: string
  toolId?: string
  toolPhase?: CopilotToolStepPhase
  inputSummary?: string | null
  resultSummary?: string | null
  errorSummary?: string | null
}

export const DEFAULT_COPILOT_COMPOSER_HEIGHT = 160
export const MIN_COPILOT_COMPOSER_HEIGHT = 120
export const MAX_COPILOT_COMPOSER_HEIGHT = 360

export function createEmptyComposerDraft(): CopilotChatComposerDraft {
  return {
    messageText: '',
    selectedModelId: '',
    selectedModelRoute: null,
    thinkingSelection: null,
    thinkingSelectionByModelKey: {},
    enabledTools: [],
    requestOptionsText: '{}',
  }
}

export function createComposerDraftFromSession(
  sessionShell?: AssistantSessionShell,
): CopilotChatComposerDraft {
  return {
    messageText: '',
    selectedModelId: sessionShell?.capabilities.defaultModelPreference ?? '',
    selectedModelRoute: null,
    thinkingSelection: null,
    thinkingSelectionByModelKey: {},
    enabledTools: [],
    requestOptionsText: '{}',
  }
}

export function buildRuntimeMessageSendInput(input: {
  runtimeUrl: string
  sessionShell: AssistantSessionShell
  draft: CopilotChatComposerDraft
  requestOptions: Record<string, unknown>
  thinkingCapabilityOverride?: Record<string, unknown> | null
}): RuntimeMessageSendInput {
  if (input.draft.selectedModelRoute === null) {
    throw new Error('请先选择可发送的模型路由。')
  }

  const thinkingSelection = cloneRuntimeThinkingSelection(input.draft.thinkingSelection)

  return {
    runtimeUrl: input.runtimeUrl,
    sessionId: input.sessionShell.sessionId,
    agent: input.sessionShell.boundAgent.id,
    message: {
      role: 'user',
      content: input.draft.messageText.trim(),
    },
    modelRoute: cloneRuntimeModelRoute(input.draft.selectedModelRoute),
    thinkingSelection,
    ...(input.thinkingCapabilityOverride === undefined
      ? {}
      : {
          thinkingCapabilityOverride: input.thinkingCapabilityOverride === null
            ? null
            : { ...input.thinkingCapabilityOverride },
        }),
    enabledTools: dedupeToolIds(input.draft.enabledTools),
    requestOptions: { ...input.requestOptions },
  }
}

export function buildThinkingSessionMemoryKey(route: RuntimeModelRoute): string {
  return [
    route.providerProfileId,
    route.snapshot.provider,
    route.snapshot.endpointType,
    route.snapshot.baseUrl,
    route.snapshot.modelId,
  ].join('|')
}

export function applyModelSelectionToComposerDraft(
  draft: CopilotChatComposerDraft,
  input: {
    modelId: string
    modelRoute: RuntimeModelRoute
  },
): CopilotChatComposerDraft {
  const nextRoute = cloneRuntimeModelRoute(input.modelRoute)
  const memoryKey = buildThinkingSessionMemoryKey(nextRoute)

  return {
    ...draft,
    selectedModelId: input.modelId,
    selectedModelRoute: nextRoute,
    thinkingSelection: cloneRuntimeThinkingSelection(draft.thinkingSelectionByModelKey[memoryKey] ?? null),
  }
}

export function applyThinkingSelectionToComposerDraft(
  draft: CopilotChatComposerDraft,
  input: {
    modelRoute: RuntimeModelRoute | null
    thinkingSelection: RuntimeThinkingSelection | null
  },
): CopilotChatComposerDraft {
  if (input.modelRoute === null || input.thinkingSelection === null) {
    return {
      ...draft,
      thinkingSelection: null,
    }
  }

  const memoryKey = buildThinkingSessionMemoryKey(input.modelRoute)
  const nextThinkingSelection = cloneRuntimeThinkingSelection(input.thinkingSelection)

  return {
    ...draft,
    thinkingSelection: nextThinkingSelection,
    thinkingSelectionByModelKey: {
      ...draft.thinkingSelectionByModelKey,
      [memoryKey]: nextThinkingSelection,
    },
  }
}

export function syncComposerDraftThinkingSelection(
  draft: CopilotChatComposerDraft,
  input: {
    modelRoute: RuntimeModelRoute | null
    thinkingCapability: RuntimeThinkingCapability | null
  },
): CopilotChatComposerDraft {
  if (input.modelRoute === null) {
    return draft.thinkingSelection === null
      ? draft
      : {
          ...draft,
          thinkingSelection: null,
        }
  }

  if (input.thinkingCapability === null) {
    return draft
  }

  const memoryKey = buildThinkingSessionMemoryKey(input.modelRoute)
  const nextThinkingSelection = resolveThinkingSelectionForCapability(
    input.thinkingCapability,
    draft.thinkingSelectionByModelKey[memoryKey] ?? draft.thinkingSelection,
  )

  if (isSameRuntimeThinkingSelection(nextThinkingSelection, draft.thinkingSelection)) {
    return draft
  }

  return {
    ...draft,
    thinkingSelection: nextThinkingSelection,
    thinkingSelectionByModelKey: nextThinkingSelection === null
      ? { ...draft.thinkingSelectionByModelKey }
      : {
          ...draft.thinkingSelectionByModelKey,
          [memoryKey]: nextThinkingSelection,
        },
  }
}

export function resolveThinkingSelectionForCapability(
  capability: RuntimeThinkingCapability,
  value: RuntimeThinkingSelection | null | undefined,
): RuntimeThinkingSelection | null {
  if (capability.series === null || capability.editorType === null || capability.defaultValue === null) {
    return null
  }

  return normalizeRuntimeThinkingSelectionForCapability(value, capability)
    ?? buildRuntimeThinkingSelectionFromValue(capability.series, capability.defaultValue)
}

function normalizeRuntimeThinkingSelectionForCapability(
  value: RuntimeThinkingSelection | null | undefined,
  capability: RuntimeThinkingCapability,
): RuntimeThinkingSelection | null {
  if (value == null || capability.series === null || capability.editorType === null) {
    return null
  }

  if (value.series !== capability.series) {
    return null
  }

  const runtimeValue = cloneRuntimeThinkingValue(value.value)
    ?? buildRuntimeThinkingValueFromLegacySelection(value)
  if (runtimeValue === null) {
    return null
  }

  const normalizedValue = normalizeRuntimeThinkingValueForCapability(runtimeValue, capability)
  if (normalizedValue === null) {
    return null
  }

  return buildRuntimeThinkingSelectionFromValue(capability.series, normalizedValue)
}

function normalizeRuntimeThinkingValueForCapability(
  value: NonNullable<RuntimeThinkingSelection['value']> | null | undefined,
  capability: RuntimeThinkingCapability,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  if (value == null || capability.editorType === null) {
    return null
  }

  switch (capability.editorType) {
    case 'fixed': {
      const fixedValue = capability.defaultValue?.valueType === 'fixed'
        ? capability.defaultValue
        : capability.allowedValues.find((candidate) => candidate.valueType === 'fixed') ?? null
      return cloneRuntimeThinkingValue(fixedValue)
    }
    case 'budget':
      if (value.valueType !== 'budget') {
        return null
      }
      if (value.mode === 'budget' && typeof value.budgetTokens === 'number') {
        if (!supportsExactBudgetThinkingSelection(capability)) {
          return null
        }
        const budgetTokens = normalizeBudgetTokens(value.budgetTokens)
        return budgetTokens === null
          ? null
          : {
              valueType: 'budget',
              mode: 'budget',
              budgetTokens,
              labelZh: formatThinkingTokenCount(budgetTokens),
            }
      }
      return cloneRuntimeThinkingValue(
        capability.allowedValues.find((candidate) => (
          candidate.valueType === 'budget' && candidate.mode === value.mode
        )) ?? null,
      )
    case 'discrete':
      if (value.valueType !== 'code') {
        return null
      }
      return cloneRuntimeThinkingValue(findThinkingCodeValue(capability.allowedValues, value.code))
  }
}

function supportsExactBudgetThinkingSelection(capability: RuntimeThinkingCapability): boolean {
  return capability.editorType === 'budget'
    && capability.controlSpec?.kind === 'budget'
    && capability.controlSpec.budget !== null
    && capability.controlSpec.budget !== undefined
}

function buildRuntimeThinkingSelectionFromValue(
  capabilitySeries: string,
  value: NonNullable<RuntimeThinkingSelection['value']>,
): RuntimeThinkingSelection {
  return {
    series: capabilitySeries,
    value: cloneRuntimeThinkingValue(value)!,
    ...deriveLegacyThinkingSelectionFields(value),
  }
}

function cloneRuntimeThinkingValue(
  value: RuntimeThinkingSelection['value'] | null | undefined,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  if (value == null) {
    return null
  }

  switch (value.valueType) {
    case 'code':
      return {
        valueType: 'code',
        code: value.code,
        labelZh: value.labelZh,
      }
    case 'budget':
      return {
        valueType: 'budget',
        mode: value.mode,
        budgetTokens: value.budgetTokens,
        labelZh: value.labelZh,
      }
    case 'fixed':
      return {
        valueType: 'fixed',
        code: 'fixed',
        labelZh: value.labelZh,
      }
  }
}

function buildRuntimeThinkingValueFromLegacySelection(
  selection: RuntimeThinkingSelection,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  if (selection.mode === 'budget' && typeof selection.budgetTokens === 'number') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: selection.budgetTokens,
      labelZh: formatThinkingTokenCount(selection.budgetTokens),
    }
  }

  if (typeof selection.level !== 'string' || selection.level.trim() === '') {
    return null
  }

  if (selection.level === 'fixed') {
    return {
      valueType: 'fixed',
      code: 'fixed',
      labelZh: '固定推理',
    }
  }

  return {
    valueType: 'code',
    code: selection.level,
    labelZh: selection.level,
  }
}

function deriveLegacyThinkingSelectionFields(
  value: NonNullable<RuntimeThinkingSelection['value']>,
): Pick<RuntimeThinkingSelection, 'mode' | 'level' | 'budgetTokens'> {
  switch (value.valueType) {
    case 'budget':
      return {
        mode: 'budget',
        level: null,
        budgetTokens: value.mode === 'budget' ? value.budgetTokens : null,
      }
    case 'fixed':
      return {
        mode: 'preset',
        level: 'fixed',
        budgetTokens: null,
      }
    case 'code':
      return {
        mode: 'preset',
        level: mapSeriesCodeToLegacyLevel(value.code),
        budgetTokens: null,
      }
  }
}

function mapSeriesCodeToLegacyLevel(code: string): ThinkingLevelIntent {
  switch (code) {
    case 'none':
    case 'off':
    case 'disabled':
    case 'false':
      return 'off'
    case 'minimal':
    case 'dynamic':
      return 'auto'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
    case 'true':
    case 'enabled':
      return 'high'
    case 'max':
    case 'xhigh':
      return 'xhigh'
    default:
      return 'auto'
  }
}

function normalizeBudgetTokens(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const minimum = THINKING_BUDGET_DEFAULT_MIN_TOKENS
  const maximum = THINKING_BUDGET_DEFAULT_MAX_TOKENS
  const step = THINKING_BUDGET_DEFAULT_STEP_TOKENS
  const clamped = Math.min(maximum, Math.max(minimum, Math.trunc(value)))
  const stepped = minimum + (Math.round((clamped - minimum) / step) * step)

  return Math.min(maximum, Math.max(minimum, stepped))
}

function isSameRuntimeThinkingSelection(
  left: RuntimeThinkingSelection | null,
  right: RuntimeThinkingSelection | null,
): boolean {
  if (left === right) {
    return true
  }

  if (left === null || right === null) {
    return false
  }

  const leftValue = cloneRuntimeThinkingValue(left.value) ?? buildRuntimeThinkingValueFromLegacySelection(left)
  const rightValue = cloneRuntimeThinkingValue(right.value) ?? buildRuntimeThinkingValueFromLegacySelection(right)
  if (leftValue === null || rightValue === null) {
    return false
  }

  return left.series === right.series && isSameRuntimeThinkingValue(leftValue, rightValue)
}

function isSameRuntimeThinkingValue(
  left: NonNullable<RuntimeThinkingSelection['value']>,
  right: NonNullable<RuntimeThinkingSelection['value']>,
): boolean {
  if (left.valueType !== right.valueType) {
    return false
  }

  switch (left.valueType) {
    case 'code':
      return right.valueType === 'code' && left.code === right.code
    case 'fixed':
      return right.valueType === 'fixed'
    case 'budget':
      return right.valueType === 'budget'
        && left.mode === right.mode
        && left.budgetTokens === right.budgetTokens
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
      case 'thinking_not_supported_for_route':
        return `thinking_not_supported_for_route：当前模型路由不支持所选思考档位。${error.message}`
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
    status: 'completed',
  }
}

export function createPendingAssistantTurn(input: {
  assistantMessageId: string
  diagnostic?: CopilotRunDiagnosticSummary | null
}): CopilotConversationTurn {
  return {
    id: input.assistantMessageId,
    kind: 'assistant',
    title: '助手响应',
    content: '',
    status: 'streaming',
    diagnostic: input.diagnostic ?? null,
  }
}

export function appendAssistantDelta(
  turns: CopilotConversationTurn[],
  input: {
    assistantMessageId: string
    delta: string
  },
): CopilotConversationTurn[] {
  return turns.map((turn) => {
    if (turn.id !== input.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      content: `${turn.content}${input.delta}`,
      status: 'streaming',
    }
  })
}

export function completeAssistantTurn(
  turns: CopilotConversationTurn[],
  event: RuntimeRunCompletedEvent,
  diagnostic: CopilotRunDiagnosticSummary | null,
): CopilotConversationTurn[] {
  const nextTurns: CopilotConversationTurn[] = turns.map((turn): CopilotConversationTurn => {
    if (turn.id !== event.payload.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      content: event.payload.assistantText,
      status: 'completed',
      resolvedModelId: event.payload.resolvedModelId,
      resolvedModelRoute: cloneRuntimeModelRoute(event.payload.resolvedModelRoute),
      resolvedToolIds: [...event.payload.resolvedToolIds],
      requestOptions: { ...event.payload.requestOptions },
      diagnostic,
    }
  })

  return ensureAssistantTurnExists(nextTurns, {
    id: event.payload.assistantMessageId,
    kind: 'assistant',
    title: '助手响应',
    content: event.payload.assistantText,
    status: 'completed',
    resolvedModelId: event.payload.resolvedModelId,
    resolvedModelRoute: cloneRuntimeModelRoute(event.payload.resolvedModelRoute),
    resolvedToolIds: [...event.payload.resolvedToolIds],
    requestOptions: { ...event.payload.requestOptions },
    diagnostic,
  })
}

export function upsertToolStepTurn(
  turns: CopilotConversationTurn[],
  event: RuntimeToolEvent,
  input: {
    assistantMessageId: string | null
  },
): CopilotConversationTurn[] {
  const nextTurn = buildToolStepTurn(event)
  const existingTurnIndex = turns.findIndex((turn) => turn.toolCallId === event.payload.toolCallId)
  if (existingTurnIndex >= 0) {
    return turns.map((turn, index) => (index === existingTurnIndex ? {
      ...turn,
      ...nextTurn,
    } : turn))
  }

  const insertIndex = resolveToolTurnInsertIndex(turns, input.assistantMessageId)
  return [
    ...turns.slice(0, insertIndex),
    nextTurn,
    ...turns.slice(insertIndex),
  ]
}

export function cancelStreamingToolTurns(turns: CopilotConversationTurn[]): CopilotConversationTurn[] {
  return turns.map((turn) => {
    if (turn.kind !== 'tool' || turn.status !== 'streaming') {
      return turn
    }

    return {
      ...turn,
      status: 'cancelled',
      toolPhase: 'cancelled',
    }
  })
}

export function failAssistantTurn(
  turns: CopilotConversationTurn[],
  input: {
    assistantMessageId: string | null
    content: string
    diagnostic: CopilotRunDiagnosticSummary | null
  },
): CopilotConversationTurn[] {
  if (input.assistantMessageId === null) {
    return [...turns, createErrorTurn(input.content, input.diagnostic)]
  }

  const nextTurns: CopilotConversationTurn[] = turns.map((turn): CopilotConversationTurn => {
    if (turn.id !== input.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      kind: 'error',
      title: '发送失败',
      content: input.content,
      status: 'failed',
      diagnostic: input.diagnostic,
    }
  })

  return ensureAssistantTurnExists(nextTurns, {
    id: input.assistantMessageId,
    kind: 'error',
    title: '发送失败',
    content: input.content,
    status: 'failed',
    diagnostic: input.diagnostic,
  })
}

export function cancelAssistantTurn(
  turns: CopilotConversationTurn[],
  input: {
    assistantMessageId: string | null
    reason: string
    diagnostic: CopilotRunDiagnosticSummary | null
  },
): CopilotConversationTurn[] {
  if (input.assistantMessageId === null) {
    return turns
  }

  return turns.map((turn) => {
    if (turn.id !== input.assistantMessageId) {
      return turn
    }

    return {
      ...turn,
      status: 'cancelled',
      title: '已取消',
      content: turn.content === '' ? formatCancelledReason(input.reason) : turn.content,
      diagnostic: input.diagnostic,
    }
  })
}

export function createErrorTurn(
  content: string,
  diagnostic: CopilotRunDiagnosticSummary | null = null,
): CopilotConversationTurn {
  return {
    id: `error:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'error',
    title: '发送失败',
    content,
    status: 'failed',
    diagnostic,
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

function ensureAssistantTurnExists(
  turns: CopilotConversationTurn[],
  turn: CopilotConversationTurn,
): CopilotConversationTurn[] {
  return turns.some((currentTurn) => currentTurn.id === turn.id)
    ? turns
    : [...turns, turn]
}

function buildToolStepTurn(event: RuntimeToolEvent): CopilotConversationTurn {
  return {
    id: `tool:${event.payload.toolCallId}`,
    kind: 'tool',
    title: event.payload.title,
    content: event.payload.summary,
    status: mapToolPhaseToTurnStatus(event.payload.phase),
    toolCallId: event.payload.toolCallId,
    toolId: event.payload.toolId,
    toolPhase: event.payload.phase,
    inputSummary: event.payload.inputSummary ?? null,
    resultSummary: event.payload.resultSummary ?? null,
    errorSummary: event.payload.errorSummary ?? null,
  }
}

function mapToolPhaseToTurnStatus(
  phase: RuntimeToolEventPhase,
): NonNullable<CopilotConversationTurn['status']> {
  switch (phase) {
    case 'started':
      return 'streaming'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
  }
}

function resolveToolTurnInsertIndex(
  turns: CopilotConversationTurn[],
  assistantMessageId: string | null,
): number {
  if (assistantMessageId === null) {
    return turns.length
  }

  const assistantTurnIndex = turns.findIndex((turn) => turn.id === assistantMessageId)
  if (assistantTurnIndex < 0) {
    return turns.length
  }

  const assistantTurn = turns[assistantTurnIndex]
  if (assistantTurn.kind === 'assistant' && assistantTurn.status === 'streaming' && assistantTurn.content === '') {
    return assistantTurnIndex
  }

  return turns.length
}

function cloneRuntimeModelRoute(route: RuntimeModelRoute): RuntimeModelRoute {
  return {
    providerProfileId: route.providerProfileId,
    snapshot: {
      provider: route.snapshot.provider,
      endpointType: route.snapshot.endpointType,
      baseUrl: route.snapshot.baseUrl,
      modelId: route.snapshot.modelId,
    },
  }
}

function formatCancelledReason(reason: string): string {
  const trimmedReason = reason.trim()
  return trimmedReason === '' ? '本次响应已取消。' : `本次响应已取消：${trimmedReason}`
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
