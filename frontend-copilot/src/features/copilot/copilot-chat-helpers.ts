import type {
  AgentType,
  AssistantSessionShell,
  ThinkingLevelIntent,
} from '../../workbench/types'
import { serializeModelRouteRef } from '../../workbench/settings/settings-workspace-model-options'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import {
  RuntimeRequestError,
  type RuntimeModelRoute,
  type RuntimeResolvedModelRoute,
  type RuntimeRunCompletedEvent,
  type RuntimeThinkingCapability,
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
  thinkingLevelIntent: ThinkingLevelIntent | null
  thinkingLevelByModelKey: Record<string, ThinkingLevelIntent>
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
  thinkingLevelIntent: ThinkingLevelIntent | null
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
  resolvedModelRoute?: RuntimeResolvedModelRoute | RuntimeModelRoute
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
    thinkingLevelIntent: null,
    thinkingLevelByModelKey: {},
    enabledTools: [],
    requestOptionsText: '{}',
  }
}

export function createComposerDraftFromSession(
  _sessionShell?: AssistantSessionShell,
): CopilotChatComposerDraft {
  return {
    messageText: '',
    selectedModelId: '',
    selectedModelRoute: null,
    thinkingLevelIntent: null,
    thinkingLevelByModelKey: {},
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

  return {
    runtimeUrl: input.runtimeUrl,
    sessionId: input.sessionShell.sessionId,
    agent: input.sessionShell.boundAgent.id,
    message: {
      role: 'user',
      content: input.draft.messageText.trim(),
    },
    modelRoute: cloneRuntimeModelRoute(input.draft.selectedModelRoute),
    thinkingLevelIntent: input.draft.thinkingLevelIntent,
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
  const routeRef = route.routeRef
  return routeRef === undefined || routeRef === null
    ? ''
    : serializeModelRouteRef(routeRef)
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
    thinkingLevelIntent: draft.thinkingLevelByModelKey[memoryKey] ?? null,
  }
}

export function applyThinkingLevelSelectionToComposerDraft(
  draft: CopilotChatComposerDraft,
  input: {
    modelRoute: RuntimeModelRoute | null
    thinkingLevelIntent: ThinkingLevelIntent | null
  },
): CopilotChatComposerDraft {
  if (input.modelRoute === null || input.thinkingLevelIntent === null) {
    return {
      ...draft,
      thinkingLevelIntent: null,
    }
  }

  const memoryKey = buildThinkingSessionMemoryKey(input.modelRoute)

  return {
    ...draft,
    thinkingLevelIntent: input.thinkingLevelIntent,
    thinkingLevelByModelKey: {
      ...draft.thinkingLevelByModelKey,
      [memoryKey]: input.thinkingLevelIntent,
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
  if (input.modelRoute === null || input.thinkingCapability === null) {
    return draft.thinkingLevelIntent === null
      ? draft
      : {
          ...draft,
          thinkingLevelIntent: null,
        }
  }

  const memoryKey = buildThinkingSessionMemoryKey(input.modelRoute)
  const nextThinkingLevelIntent = resolveThinkingLevelIntentFromCapability(
    input.thinkingCapability,
    draft.thinkingLevelByModelKey[memoryKey],
  )

  if (nextThinkingLevelIntent === draft.thinkingLevelIntent) {
    return draft
  }

  return {
    ...draft,
    thinkingLevelIntent: nextThinkingLevelIntent,
    thinkingLevelByModelKey: nextThinkingLevelIntent === null
      ? { ...draft.thinkingLevelByModelKey }
      : {
          ...draft.thinkingLevelByModelKey,
          [memoryKey]: nextThinkingLevelIntent,
        },
  }
}

function resolveThinkingLevelIntentFromCapability(
  capability: RuntimeThinkingCapability,
  value: ThinkingLevelIntent | null | undefined,
): ThinkingLevelIntent | null {
  if (!capability.supported || capability.supportedLevels.length === 0) {
    return null
  }

  if (value !== null && value !== undefined && capability.supportedLevels.includes(value)) {
    return value
  }

  return capability.defaultLevel ?? capability.supportedLevels[0] ?? null
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
      case 'provider_catalog_only':
        return `provider_catalog_only：当前 provider 仅完成 catalog 接入，运行时尚未启用。${error.message}`
      case 'provider_legacy_unsupported':
        return `provider_legacy_unsupported：当前 provider 已标记为历史兼容 / 不受支持。${error.message}`
      case 'provider_runtime_not_enabled':
        return `provider_runtime_not_enabled：当前 provider 运行时未启用。${error.message}`
      case 'adapter_missing':
        return `adapter_missing：当前 provider 缺少 Python runtime adapter。${error.message}`
      case 'provider_auth_missing':
      case 'provider_secret_missing':
        return `${error.code}：当前 provider 缺少必需认证信息。${error.message}`
      case 'provider_auth_kind_unsupported':
        return `provider_auth_kind_unsupported：当前 provider 不支持该认证方式。${error.message}`
      case 'provider_adapter_mismatch':
        return `provider_adapter_mismatch：当前模型路由的 adapter 信息与 catalog 不一致。${error.message}`
      case 'provider_profile_not_found':
        return `provider_profile_not_found：当前模型路由对应的 provider 配置不存在。${error.message}`
      case 'route_ref_snapshot_mismatch':
        return `route_ref_snapshot_mismatch：当前模型路由已失效，请重新选择。${error.message}`
      case 'host_model_route_unavailable':
        return `host_model_route_unavailable：宿主模型路由解析服务当前不可用。${error.message}`
      case 'host_model_route_access_denied':
        return `host_model_route_access_denied：宿主模型路由解析凭据无效。${error.message}`
      default:
        return error.message
    }
  }

  return error instanceof Error ? error.message : String(error)
}

export function buildRuntimeThinkingCapabilityFromError(input: {
  error: RuntimeRequestError
  modelRoute: RuntimeModelRoute
}): RuntimeThinkingCapability {
  const reasonCode = input.error.code ?? 'thinking_capability_query_failed'
  const verifiedReasonCode = isVerifiedThinkingCapabilityErrorCode(reasonCode)
    ? reasonCode
    : null
  const routeRef = input.modelRoute.routeRef ?? null
  const providerHint = readRuntimeErrorDetail(input.error.details, 'providerId')
    ?? readRuntimeErrorDetail(input.error.details, 'provider')
    ?? null

  return {
    status: verifiedReasonCode === null ? 'unknown-without-override' : 'verified-unsupported',
    source: verifiedReasonCode === null ? 'unknown' : 'verified',
    supported: false,
    supportedLevels: [],
    defaultLevel: null,
    reasonCode,
    providerHint,
    routeFingerprint: {
      providerProfileId: routeRef?.profileId ?? '',
      provider: providerHint ?? 'unknown-provider',
      endpointType: readRuntimeErrorDetail(input.error.details, 'endpointType') ?? '',
      baseUrl: readRuntimeErrorDetail(input.error.details, 'baseUrl') ?? '',
      modelId: routeRef?.modelId ?? '',
    },
    overrideLevels: [],
  }
}

export function describeThinkingCapabilityUnavailableReason(
  capability: RuntimeThinkingCapability | null,
): string | null {
  if (capability === null || capability.supported) {
    return null
  }

  switch (capability.reasonCode) {
    case 'provider_catalog_only':
      return '当前 provider 仅完成 catalog 接入'
    case 'provider_legacy_unsupported':
      return '当前 provider 已废弃或不受支持'
    case 'provider_runtime_not_enabled':
      return '当前 provider 运行时未启用'
    case 'adapter_missing':
      return '当前 provider 缺少 runtime adapter'
    case 'provider_auth_missing':
    case 'provider_secret_missing':
      return '当前 provider 缺少认证信息'
    case 'provider_auth_kind_unsupported':
      return '当前 provider 认证方式不受支持'
    case 'provider_profile_not_found':
    case 'route_ref_snapshot_mismatch':
      return '当前模型路由已失效'
    case 'host_model_route_unavailable':
    case 'host_model_route_access_denied':
      return 'thinking 能力查询失败'
    default:
      return '当前模型不支持'
  }
}

function isVerifiedThinkingCapabilityErrorCode(code: string): boolean {
  return [
    'provider_catalog_only',
    'provider_legacy_unsupported',
    'provider_runtime_not_enabled',
    'adapter_missing',
    'provider_auth_missing',
    'provider_secret_missing',
    'provider_auth_kind_unsupported',
    'provider_adapter_mismatch',
    'provider_profile_not_found',
    'route_ref_snapshot_mismatch',
    'host_model_route_unavailable',
    'host_model_route_access_denied',
    'thinking_not_supported_for_route',
  ].includes(code)
}

function readRuntimeErrorDetail(details: Record<string, unknown>, key: string): string | null {
  const value = details[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : null
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
      resolvedModelRoute: cloneRuntimeResolvedModelRoute(event.payload.resolvedModelRoute),
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
    resolvedModelRoute: cloneRuntimeResolvedModelRoute(event.payload.resolvedModelRoute),
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
    ...(route.routeRef === undefined || route.routeRef === null
      ? {}
      : {
          routeRef: {
            routeKind: route.routeRef.routeKind,
            profileId: route.routeRef.profileId,
            modelId: route.routeRef.modelId,
          },
        }),
    ...(route.catalogRevision === undefined ? {} : { catalogRevision: route.catalogRevision }),
  }
}

function cloneRuntimeResolvedModelRoute(route: RuntimeResolvedModelRoute): RuntimeResolvedModelRoute {
  return {
    routeRef: {
      routeKind: route.routeRef.routeKind,
      profileId: route.routeRef.profileId,
      modelId: route.routeRef.modelId,
    },
    providerProfileId: route.providerProfileId,
    provider: route.provider,
    providerId: route.providerId,
    adapterId: route.adapterId,
    runtimeStatus: route.runtimeStatus,
    catalogRevision: route.catalogRevision,
    endpointFamily: route.endpointFamily,
    endpointType: route.endpointType,
    baseUrl: route.baseUrl,
    modelId: route.modelId,
    authKind: route.authKind,
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
