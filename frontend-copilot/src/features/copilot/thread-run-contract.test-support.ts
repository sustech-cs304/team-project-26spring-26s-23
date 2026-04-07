import { vi } from 'vitest'

import type {
  RuntimeAgentsListResponse,
  RuntimeBoundAgent,
  RuntimeCapabilitiesGetResponse,
  RuntimeCanonicalThinkingSelection,
  RuntimeMessagePayload,
  RuntimeModelRoute,
  RuntimeRunCancelResponse,
  RuntimeRunCompletedEvent,
  RuntimeRunEvent,
  RuntimeRunMetadataEvent,
  RuntimeRunStartResponse,
  RuntimeRunView,
  RuntimeSessionCreateResponse,
  RuntimeThinkingCapability,
  RuntimeThinkingSelection,
  RuntimeThreadCreateResponse,
  RuntimeThreadGetResponse,
  RuntimeToolEvent,
} from './thread-run-contract'

export const runtimeUrl = 'http://127.0.0.1:8765'
export const sessionId = 'session-1'
export const agentId = 'general'

export function createBoundAgent(
  overrides: Partial<RuntimeBoundAgent> = {},
): RuntimeBoundAgent {
  return {
    agentId,
    status: 'active',
    displayName: '通用助手',
    description: '默认通用智能体',
    iconKey: 'sparkles',
    ...overrides,
  }
}

export function createRuntimeAgentsListResponse(
  overrides: Partial<RuntimeAgentsListResponse> = {},
): RuntimeAgentsListResponse {
  return {
    ok: true,
    directoryVersion: 'agents-v1',
    defaultAgentId: agentId,
    agents: [
      {
        agentId,
        status: 'active',
        recommendedTools: ['tool.file-convert'],
        defaultModelPreference: 'openai/gpt-4.1',
        displayName: '通用助手',
        description: '默认通用智能体',
        iconKey: 'sparkles',
      },
    ],
    ...overrides,
  }
}

export function createRuntimeThreadCreateResponse(
  overrides: Partial<RuntimeThreadCreateResponse> = {},
): RuntimeThreadCreateResponse {
  return {
    ok: true,
    threadId: sessionId,
    boundAgent: createBoundAgent(),
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    recommendedTools: ['tool.file-convert'],
    defaultModelPreference: 'openai/gpt-4.1',
    capabilities: {
      tools: {
        selectionMode: 'recommendation-only',
      },
    },
    ...overrides,
  }
}

export function createRuntimeSessionCreateResponse(
  overrides: Partial<RuntimeSessionCreateResponse> = {},
): RuntimeSessionCreateResponse {
  const threadResponse = createRuntimeThreadCreateResponse({
    threadId: overrides.sessionId ?? sessionId,
    boundAgent: overrides.boundAgent ?? createBoundAgent(),
    createdAt: overrides.createdAt ?? '2026-03-27T10:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-03-27T10:00:00Z',
    recommendedTools: overrides.recommendedTools ?? ['tool.file-convert'],
    defaultModelPreference: overrides.defaultModelPreference ?? 'openai/gpt-4.1',
    capabilities: overrides.capabilities ?? {
      tools: {
        selectionMode: 'recommendation-only',
      },
    },
  })

  return {
    ok: true,
    sessionId: threadResponse.threadId,
    boundAgent: threadResponse.boundAgent,
    createdAt: threadResponse.createdAt,
    updatedAt: threadResponse.updatedAt,
    recommendedTools: [...threadResponse.recommendedTools],
    defaultModelPreference: threadResponse.defaultModelPreference,
    capabilities: { ...threadResponse.capabilities },
    ...overrides,
  }
}

export function createRuntimeThreadGetResponse(
  overrides: Partial<RuntimeThreadGetResponse> = {},
): RuntimeThreadGetResponse {
  return {
    ok: true,
    threadId: sessionId,
    boundAgent: createBoundAgent(),
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    capabilitiesVersion: 'cap-v12',
    tools: [
      {
        toolId: 'tool.file-convert',
        kind: 'builtin',
        availability: 'available',
        displayName: '文件转换',
        description: 'DOCX/PDF/PPTX 转换工具',
      },
      {
        toolId: 'tool.remote-search',
        kind: 'external',
        availability: 'disabled-by-global-setting',
        displayName: '远程搜索',
        description: '访问外部搜索服务',
      },
    ],
    recommendedTools: ['tool.file-convert'],
    toolSelectionMode: 'recommendation-only',
    defaultModelPreference: 'openai/gpt-4.1',
    latestRunId: null,
    ...overrides,
  }
}

export function createRuntimeCapabilitiesGetResponse(
  overrides: Partial<RuntimeCapabilitiesGetResponse> = {},
): RuntimeCapabilitiesGetResponse {
  const threadResponse = createRuntimeThreadGetResponse({
    threadId: overrides.sessionId ?? sessionId,
    boundAgent: overrides.boundAgent ?? createBoundAgent(),
    capabilitiesVersion: overrides.capabilitiesVersion ?? 'cap-v12',
    tools: overrides.tools ?? [
      {
        toolId: 'tool.file-convert',
        kind: 'builtin',
        availability: 'available',
        displayName: '文件转换',
        description: 'DOCX/PDF/PPTX 转换工具',
      },
      {
        toolId: 'tool.remote-search',
        kind: 'external',
        availability: 'disabled-by-global-setting',
        displayName: '远程搜索',
        description: '访问外部搜索服务',
      },
    ],
    recommendedTools: overrides.recommendedTools ?? ['tool.file-convert'],
    toolSelectionMode: overrides.toolSelectionMode ?? 'recommendation-only',
    defaultModelPreference: overrides.defaultModelPreference ?? 'openai/gpt-4.1',
  })

  return {
    ok: true,
    sessionId: threadResponse.threadId,
    boundAgent: threadResponse.boundAgent,
    capabilitiesVersion: threadResponse.capabilitiesVersion,
    tools: threadResponse.tools.map((tool) => ({ ...tool })),
    recommendedTools: [...threadResponse.recommendedTools],
    toolSelectionMode: threadResponse.toolSelectionMode,
    defaultModelPreference: threadResponse.defaultModelPreference,
    ...overrides,
  }
}

export function createRuntimeModelRoute(
  overrides: Partial<RuntimeModelRoute> = {},
): RuntimeModelRoute {
  return {
    providerProfileId: overrides.providerProfileId ?? 'provider-openai',
    snapshot: {
      provider: overrides.snapshot?.provider ?? 'openai',
      endpointType: overrides.snapshot?.endpointType ?? 'openai-compatible',
      baseUrl: overrides.snapshot?.baseUrl ?? 'https://api.example.com/v1',
      modelId: overrides.snapshot?.modelId ?? 'qwen-plus',
    },
  }
}

type RuntimeRunStartResponseOverrides = Omit<Partial<RuntimeRunStartResponse>, 'run'> & {
  run?: Partial<RuntimeRunView>
}

type RuntimeRunCancelResponseOverrides = Omit<Partial<RuntimeRunCancelResponse>, 'run'> & {
  run?: Partial<RuntimeRunView>
}

type RuntimeRunMetadataEventOverrides = Omit<Partial<RuntimeRunMetadataEvent>, 'payload'> & {
  payload?: Partial<RuntimeRunMetadataEvent['payload']>
}

export function createRuntimeRunStartResponse(
  overrides: RuntimeRunStartResponseOverrides = {},
): RuntimeRunStartResponse {
  const requestedThinkingLevel = overrides.run?.requestedThinkingLevel ?? null
  const appliedThinkingLevel = overrides.run?.appliedThinkingLevel ?? null
  const thinkingSeriesDecision = overrides.run?.thinkingSeriesDecision ?? null

  return {
    ok: true,
    run: {
      runId: overrides.run?.runId ?? 'run-1',
      threadId: overrides.run?.threadId ?? sessionId,
      status: overrides.run?.status ?? 'pending',
      createdAt: overrides.run?.createdAt ?? '2026-03-27T10:00:00Z',
      updatedAt: overrides.run?.updatedAt ?? '2026-03-27T10:00:00Z',
      startedAt: overrides.run?.startedAt ?? null,
      terminalAt: overrides.run?.terminalAt ?? null,
      cancelRequested: overrides.run?.cancelRequested ?? false,
      requestedThinkingSelection: overrides.run?.requestedThinkingSelection
        ?? createRuntimeThinkingSelectionFromLevel(requestedThinkingLevel),
      appliedThinkingSelection: overrides.run?.appliedThinkingSelection
        ?? createRuntimeThinkingSelectionFromLevel(appliedThinkingLevel),
      thinkingSeriesDecision,
      requestedThinkingLevel,
      appliedThinkingLevel,
      thinkingCapabilitySnapshot: overrides.run?.thinkingCapabilitySnapshot ?? null,
      reasoningSuppressionBasis: overrides.run?.reasoningSuppressionBasis ?? null,
    },
    assistantMessageId: overrides.assistantMessageId ?? 'run-1:assistant',
    stream: overrides.stream ?? {
      method: 'run/stream',
      body: {
        runId: overrides.run?.runId ?? 'run-1',
      },
    },
    cancel: overrides.cancel ?? {
      method: 'run/cancel',
      body: {
        runId: overrides.run?.runId ?? 'run-1',
      },
    },
  }
}

export function createRuntimeRunCancelResponse(
  overrides: RuntimeRunCancelResponseOverrides = {},
): RuntimeRunCancelResponse {
  const requestedThinkingLevel = overrides.run?.requestedThinkingLevel ?? null
  const appliedThinkingLevel = overrides.run?.appliedThinkingLevel ?? null
  const thinkingSeriesDecision = overrides.run?.thinkingSeriesDecision ?? null

  return {
    ok: true,
    run: {
      runId: overrides.run?.runId ?? 'run-1',
      threadId: overrides.run?.threadId ?? sessionId,
      status: overrides.run?.status ?? 'cancelled',
      createdAt: overrides.run?.createdAt ?? '2026-03-27T10:00:00Z',
      updatedAt: overrides.run?.updatedAt ?? '2026-03-27T10:00:00Z',
      startedAt: overrides.run?.startedAt ?? '2026-03-27T10:00:01Z',
      terminalAt: overrides.run?.terminalAt ?? null,
      cancelRequested: overrides.run?.cancelRequested ?? true,
      requestedThinkingSelection: overrides.run?.requestedThinkingSelection
        ?? createRuntimeThinkingSelectionFromLevel(requestedThinkingLevel),
      appliedThinkingSelection: overrides.run?.appliedThinkingSelection
        ?? createRuntimeThinkingSelectionFromLevel(appliedThinkingLevel),
      thinkingSeriesDecision,
      requestedThinkingLevel,
      appliedThinkingLevel,
      thinkingCapabilitySnapshot: overrides.run?.thinkingCapabilitySnapshot ?? null,
      reasoningSuppressionBasis: overrides.run?.reasoningSuppressionBasis ?? null,
    },
    cancelAccepted: overrides.cancelAccepted ?? true,
  }
}

export function createRuntimeThinkingCapability(
  overrides: Partial<RuntimeThinkingCapability> = {},
): RuntimeThinkingCapability {
  const controlSpec = overrides.controlSpec ?? createRuntimeThinkingControlSpec()
  const supportedLevels = overrides.supportedLevels ?? ['off', 'auto', 'low', 'medium', 'high', 'xhigh']
  const defaultLevel = overrides.defaultLevel ?? 'auto'
  const series = overrides.series ?? 'compat-discrete-levels-v1'
  const editorType = overrides.editorType
    ?? (controlSpec.kind === 'budget' ? 'budget' : controlSpec.kind === 'fixed' ? 'fixed' : 'discrete')
  const defaultSelection = overrides.defaultSelection ?? createRuntimeCanonicalThinkingSelection({ value: defaultLevel })
  const allowedValues = overrides.allowedValues ?? buildAllowedThinkingValues({
    controlSpec,
    supportedLevels,
  })
  const defaultValue = overrides.defaultValue
    ?? buildThinkingValueFromCanonicalSelection(defaultSelection)
    ?? allowedValues[0]
    ?? null

  return {
    status: overrides.status ?? 'verified-supported',
    source: overrides.source ?? 'verified',
    series,
    seriesLabelZh: overrides.seriesLabelZh ?? resolveTestSeriesLabel(series),
    editorType,
    allowedValues,
    defaultValue,
    providerBuilderKey: overrides.providerBuilderKey ?? null,
    reasonCode: overrides.reasonCode ?? 'verified_supported',
    routeFingerprint: overrides.routeFingerprint ?? {
      providerProfileId: 'provider-openai',
      provider: 'openai',
      endpointType: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'qwen-plus',
    },
    supported: overrides.supported ?? true,
    controlSpec,
    defaultSelection,
    supportedLevels,
    defaultLevel,
    providerHint: overrides.providerHint ?? 'openai-compatible',
    provenance: overrides.provenance ?? {
      routeStatus: 'verified',
      override: {
        present: false,
        applied: false,
        source: null,
        format: null,
      },
    },
    visibility: overrides.visibility ?? {
      reasoning: 'visible',
      supportsSuppression: true,
    },
    overrideLevels: overrides.overrideLevels ?? [],
  }
}

export function createRuntimeRunMetadataEvent(
  overrides: RuntimeRunMetadataEventOverrides = {},
): RuntimeRunMetadataEvent {
  const requestedThinkingLevel = overrides.payload?.requestedThinkingLevel ?? 'auto'
  const appliedThinkingLevel = overrides.payload?.appliedThinkingLevel ?? 'auto'
  const thinkingSeriesDecision = overrides.payload?.thinkingSeriesDecision ?? null

  return {
    type: 'run_metadata',
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? sessionId,
    sequence: overrides.sequence ?? 2,
    payload: {
      requestedThinkingSelection: overrides.payload?.requestedThinkingSelection
        ?? createRuntimeThinkingSelectionFromLevel(requestedThinkingLevel),
      appliedThinkingSelection: overrides.payload?.appliedThinkingSelection
        ?? createRuntimeThinkingSelectionFromLevel(appliedThinkingLevel),
      thinkingSeriesDecision,
      requestedThinkingLevel,
      appliedThinkingLevel,
      thinkingCapabilitySnapshot: overrides.payload?.thinkingCapabilitySnapshot ?? createRuntimeThinkingCapability(),
      reasoningSuppressionBasis: overrides.payload?.reasoningSuppressionBasis ?? null,
    },
  }
}

export function createRuntimeRunCompletedEvent(
  overrides: Partial<RuntimeRunCompletedEvent> = {},
): RuntimeRunCompletedEvent {
  return {
    type: 'run_completed',
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? sessionId,
    sequence: overrides.sequence ?? 3,
    payload: {
      assistantMessageId: overrides.payload?.assistantMessageId ?? 'run-1:assistant',
      assistantText: overrides.payload?.assistantText ?? '这是总结结果。',
      resolvedModelId: overrides.payload?.resolvedModelId ?? 'qwen-plus',
      resolvedModelRoute: overrides.payload?.resolvedModelRoute ?? createRuntimeModelRoute(),
      resolvedToolIds: overrides.payload?.resolvedToolIds ?? ['tool.file-convert'],
      requestOptions: overrides.payload?.requestOptions ?? { trace: true },
    },
  }
}

export function createRuntimeThinkingSelection(
  overrides: Partial<RuntimeThinkingSelection> = {},
): RuntimeThinkingSelection {
  const series = overrides.series ?? 'compat-discrete-selection-v1'
  const value = overrides.value
    ?? buildRuntimeThinkingValueFromSelectionInput({
      mode: overrides.mode ?? 'preset',
      level: overrides.level === undefined ? 'auto' : overrides.level,
      budgetTokens: overrides.budgetTokens === undefined ? null : overrides.budgetTokens,
    })

  return {
    series,
    ...(value === undefined ? {} : { value }),
    ...(value === undefined ? {} : deriveLegacySelectionFields(value)),
    ...(value === undefined && overrides.mode !== undefined ? { mode: overrides.mode } : {}),
    ...(value === undefined && overrides.level !== undefined ? { level: overrides.level } : {}),
    ...(value === undefined && overrides.budgetTokens !== undefined ? { budgetTokens: overrides.budgetTokens } : {}),
  }
}

export function createRuntimeCanonicalThinkingSelection(
  overrides: Partial<RuntimeCanonicalThinkingSelection> & {
    kind?: 'preset' | 'budget'
  } = {},
): RuntimeCanonicalThinkingSelection {
  if ((overrides.kind ?? 'preset') === 'budget') {
    return {
      kind: 'budget',
      ...(overrides.budgetTokens === undefined ? {} : { budgetTokens: overrides.budgetTokens }),
    }
  }

  return {
    kind: 'preset',
    ...(overrides.value === undefined ? { value: 'auto' } : { value: overrides.value }),
  }
}

export function createRuntimeThinkingControlSpec(
  overrides: Partial<NonNullable<RuntimeThinkingCapability['controlSpec']>> = {},
): NonNullable<RuntimeThinkingCapability['controlSpec']> {
  return {
    kind: overrides.kind ?? 'discrete',
    selectionKind: overrides.selectionKind ?? 'preset',
    ...(overrides.presetOptions === undefined
      ? {
          presetOptions: [
            createRuntimeCanonicalThinkingSelection({ value: 'off' }),
            createRuntimeCanonicalThinkingSelection({ value: 'auto' }),
            createRuntimeCanonicalThinkingSelection({ value: 'medium' }),
          ],
        }
      : { presetOptions: overrides.presetOptions }),
    ...(overrides.fixedSelection === undefined ? {} : { fixedSelection: overrides.fixedSelection }),
    ...(overrides.budget === undefined ? {} : { budget: overrides.budget }),
  }
}

export function createRuntimeThinkingSelectionResult(
  overrides: Partial<NonNullable<RuntimeRunMetadataEvent['payload']['thinkingSeriesDecision']>> = {},
): NonNullable<RuntimeRunMetadataEvent['payload']['thinkingSeriesDecision']> {
  return {
    requestedSelection: overrides.requestedSelection ?? createRuntimeThinkingSelection({ level: 'auto' }),
    appliedSelection: overrides.appliedSelection ?? createRuntimeThinkingSelection({ level: 'auto' }),
    requestedThinkingLevel: overrides.requestedThinkingLevel ?? 'auto',
    appliedThinkingLevel: overrides.appliedThinkingLevel ?? 'auto',
    applied: overrides.applied ?? true,
    reasonCode: overrides.reasonCode ?? 'verified_provider_mapping_applied',
    errorCode: overrides.errorCode ?? null,
    providerBuilderKey: overrides.providerBuilderKey ?? null,
    mappingReasonCode: overrides.mappingReasonCode ?? 'provider_mapping_applied',
    providerMapping: overrides.providerMapping ?? 'openai_reasoning',
    capabilityStatus: overrides.capabilityStatus ?? 'verified-supported',
    capabilitySource: overrides.capabilitySource ?? 'verified',
    capabilitySeries: overrides.capabilitySeries ?? 'compat-discrete-levels-v1',
    capabilitySeriesLabelZh: overrides.capabilitySeriesLabelZh ?? null,
    capabilityReasonCode: overrides.capabilityReasonCode ?? 'verified_supported',
    overridePresent: overrides.overridePresent ?? false,
    overrideApplied: overrides.overrideApplied ?? false,
    overrideSource: overrides.overrideSource ?? null,
    reasoningVisibility: overrides.reasoningVisibility ?? 'visible',
    supportsSuppression: overrides.supportsSuppression ?? true,
    ...(overrides.modelSettings === undefined ? {} : { modelSettings: overrides.modelSettings }),
  }
}

export function createRuntimeReasoningSuppressionBasis(
  overrides: Partial<NonNullable<RuntimeRunMetadataEvent['payload']['reasoningSuppressionBasis']>> = {},
) {
  return {
    shouldSuppress: overrides.shouldSuppress ?? false,
    source: overrides.source ?? 'none',
    reasonCode: overrides.reasonCode ?? null,
    appliedThinkingSelection: overrides.appliedThinkingSelection
      ?? createRuntimeThinkingSelectionFromLevel(overrides.appliedThinkingLevel ?? null),
    appliedThinkingLevel: overrides.appliedThinkingLevel ?? null,
    reasoningVisibility: overrides.reasoningVisibility ?? 'visible',
    supportsSuppression: overrides.supportsSuppression ?? true,
    capabilitySource: overrides.capabilitySource ?? 'verified',
    capabilitySeries: overrides.capabilitySeries ?? 'compat-discrete-levels-v1',
  }
}

function createRuntimeThinkingSelectionFromLevel(
  level: RuntimeThinkingSelection['level'],
): RuntimeThinkingSelection | null {
  if (level === null || level === undefined) {
    return null
  }
  return createRuntimeThinkingSelection({ level })
}

function buildAllowedThinkingValues(input: {
  controlSpec: NonNullable<RuntimeThinkingCapability['controlSpec']>
  supportedLevels: NonNullable<RuntimeThinkingCapability['supportedLevels']>
}): NonNullable<RuntimeThinkingCapability['allowedValues']> {
  if (input.controlSpec.kind === 'budget') {
    return [{
      valueType: 'budget',
      mode: 'off',
      budgetTokens: null,
      labelZh: '关闭',
    }]
  }

  if (input.controlSpec.kind === 'fixed') {
    return [{
      valueType: 'fixed',
      code: 'fixed',
      labelZh: '固定推理',
    }]
  }

  return input.supportedLevels.map((level) => ({
    valueType: 'code' as const,
    code: level,
    labelZh: resolveThinkingLabel(level),
  }))
}

function buildThinkingValueFromCanonicalSelection(
  selection: RuntimeCanonicalThinkingSelection,
): RuntimeThinkingSelection['value'] | null {
  if (selection.kind === 'budget') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: selection.budgetTokens ?? 0,
      labelZh: `${selection.budgetTokens ?? 0}`,
    }
  }

  if (selection.value === undefined) {
    return null
  }

  return buildRuntimeThinkingValueFromSelectionInput({
    mode: 'preset',
    level: selection.value,
    budgetTokens: null,
  })
}

function buildRuntimeThinkingValueFromSelectionInput(input: {
  mode: RuntimeThinkingSelection['mode']
  level: RuntimeThinkingSelection['level']
  budgetTokens: RuntimeThinkingSelection['budgetTokens']
}): RuntimeThinkingSelection['value'] | undefined {
  if (input.mode === 'budget' && typeof input.budgetTokens === 'number') {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens: input.budgetTokens,
      labelZh: String(input.budgetTokens),
    }
  }

  if (input.level === null || input.level === undefined) {
    return undefined
  }

  if (input.level === 'fixed') {
    return {
      valueType: 'fixed',
      code: 'fixed',
      labelZh: '固定推理',
    }
  }

  return {
    valueType: 'code',
    code: input.level,
    labelZh: resolveThinkingLabel(input.level),
  }
}

function deriveLegacySelectionFields(
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
        level: value.code,
        budgetTokens: null,
      }
  }
}

function resolveTestSeriesLabel(series: string): string {
  switch (series) {
    case 'openai-6-level-superset-v1':
      return 'OpenAI 6 档总超集'
    case 'openai-4-level-minimal-v1':
      return 'OpenAI 4 档 Minimal 系'
    case 'openai-4-level-none-v1':
      return 'OpenAI 4 档 None 系'
    case 'gemini-2.5-budget-v1':
      return 'Gemini 2.5 Budget'
    case 'anthropic-budget-v1':
      return 'Anthropic Budget'
    case 'deepseek-fixed-reasoning-v1':
      return 'DeepSeek 固定推理'
    default:
      return series
  }
}

function resolveThinkingLabel(level: string): string {
  switch (level) {
    case 'off':
    case 'none':
      return '无'
    case 'auto':
    case 'dynamic':
      return '自动'
    case 'minimal':
      return '极简'
    case 'low':
      return '低'
    case 'medium':
      return '中'
    case 'high':
      return '高'
    case 'xhigh':
      return '超高'
    case 'disabled':
    case 'false':
      return '关闭'
    case 'true':
    case 'enabled':
      return '开启'
    case 'max':
      return '最大'
    default:
      return level
  }
}

export function createRuntimeToolEvent(
  overrides: Partial<RuntimeToolEvent> = {},
): RuntimeToolEvent {
  return {
    type: 'tool_event',
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? sessionId,
    sequence: overrides.sequence ?? 2,
    payload: {
      toolCallId: overrides.payload?.toolCallId ?? 'tool.weather-current:call-1',
      toolId: overrides.payload?.toolId ?? 'tool.weather-current',
      phase: overrides.payload?.phase ?? 'started',
      title: overrides.payload?.title ?? '调用天气工具',
      summary: overrides.payload?.summary ?? '正在获取 Shenzhen 的天气。',
      ...(overrides.payload?.inputSummary === undefined ? { inputSummary: '{"location":"Shenzhen"}' } : { inputSummary: overrides.payload.inputSummary }),
      ...(overrides.payload?.resultSummary === undefined ? {} : { resultSummary: overrides.payload.resultSummary }),
      ...(overrides.payload?.errorSummary === undefined ? {} : { errorSummary: overrides.payload.errorSummary }),
    },
  }
}

export async function* createRuntimeMessageEventStream(
  events: RuntimeRunEvent[] = [
    {
      type: 'run_started',
      runId: 'run-1',
      sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-1:assistant',
      },
    },
    {
      type: 'text_delta',
      runId: 'run-1',
      sessionId,
      sequence: 2,
      payload: {
        assistantMessageId: 'run-1:assistant',
        delta: '这是总结结果。',
      },
    },
    createRuntimeRunCompletedEvent(),
  ],
  options: {
    signal?: AbortSignal
    yieldBetweenEvents?: boolean
  } = {},
): AsyncGenerator<RuntimeRunEvent> {
  for (const [index, event] of events.entries()) {
    if (options.signal?.aborted) {
      throw createAbortError()
    }

    if (index > 0 && options.yieldBetweenEvents !== false) {
      await Promise.resolve()
      if (options.signal?.aborted) {
        throw createAbortError()
      }
    }

    yield event
  }
}

export function createSseEventStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }
      controller.close()
    },
  })
}

export function createUserMessage(
  overrides: Partial<RuntimeMessagePayload> = {},
): RuntimeMessagePayload {
  return {
    role: 'user',
    content: '请总结这份文档',
    ...overrides,
  }
}

export function createFetchResponse(
  payload: unknown,
  init: {
    ok?: boolean
    status?: number
    headers?: Record<string, string>
    body?: ReadableStream<Uint8Array> | null
  } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: {
      get(name: string) {
        const normalizedHeaders = Object.fromEntries(
          Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
        )
        return normalizedHeaders[name.toLowerCase()] ?? null
      },
    },
    json: async () => payload,
    body: init.body ?? null,
  }
}

export function createFetchFn(
  payload: unknown,
  init: {
    ok?: boolean
    status?: number
    headers?: Record<string, string>
    body?: ReadableStream<Uint8Array> | null
  } = {},
) {
  return vi.fn().mockResolvedValue(createFetchResponse(payload, init))
}

export function createFetchSequence(...responses: Array<ReturnType<typeof createFetchResponse>>) {
  const fetchFn = vi.fn()
  for (const response of responses) {
    fetchFn.mockResolvedValueOnce(response)
  }
  return fetchFn
}

export function createRuntimeErrorPayload(input: { code?: string; message?: string } = {}) {
  return {
    ok: false as const,
    ...(input.code || input.message
      ? {
          error: {
            ...(input.code ? { code: input.code } : {}),
            ...(input.message ? { message: input.message } : {}),
          },
        }
      : {}),
  }
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}
