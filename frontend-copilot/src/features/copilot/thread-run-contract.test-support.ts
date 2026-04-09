import { vi } from 'vitest'

import type {
  RuntimeAgentsListResponse,
  RuntimeBoundAgent,
  RuntimeCapabilitiesGetResponse,
  RuntimeMessagePayload,
  RuntimeModelRoute,
  RuntimeResolvedModelRoute,
  RuntimeRunCancelResponse,
  RuntimeRunCompletedEvent,
  RuntimeRunEvent,
  RuntimeRunMetadataEvent,
  RuntimeRunStartResponse,
  RuntimeRunView,
  RuntimeThinkingCapability,
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
    capabilities: {
      tools: {
        selectionMode: 'recommendation-only',
      },
    },
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
  })

  return {
    ok: true,
    sessionId: threadResponse.threadId,
    boundAgent: threadResponse.boundAgent,
    capabilitiesVersion: threadResponse.capabilitiesVersion,
    tools: threadResponse.tools.map((tool) => ({ ...tool })),
    recommendedTools: [...threadResponse.recommendedTools],
    toolSelectionMode: threadResponse.toolSelectionMode,
    ...overrides,
  }
}

type RuntimeModelRouteFixtureOverrides = Partial<RuntimeResolvedModelRoute> & {
  providerProfileId?: string
  modelId?: string
  snapshot?: {
    provider?: string
    endpointType?: string
    baseUrl?: string
    modelId?: string
  }
}

export function createRuntimeModelRoute(
  overrides: RuntimeModelRouteFixtureOverrides = {},
): RuntimeModelRoute & RuntimeResolvedModelRoute {
  const providerProfileId = overrides.providerProfileId ?? overrides.routeRef?.profileId ?? 'provider-openai'
  const modelId = overrides.snapshot?.modelId ?? overrides.modelId ?? overrides.routeRef?.modelId ?? 'qwen-plus'
  const provider = overrides.snapshot?.provider ?? overrides.provider ?? 'openai'
  const endpointType = overrides.snapshot?.endpointType ?? overrides.endpointType ?? 'openai-compatible'
  const baseUrl = overrides.snapshot?.baseUrl ?? overrides.baseUrl ?? 'https://api.example.com/v1'
  const routeRef = overrides.routeRef ?? {
    routeKind: 'provider-model' as const,
    profileId: providerProfileId,
    modelId,
  }

  return {
    routeRef,
    catalogRevision: overrides.catalogRevision ?? '2026-04-06-provider-catalog-v1',
    providerProfileId,
    provider,
    providerId: overrides.providerId ?? provider,
    adapterId: overrides.adapterId ?? provider,
    runtimeStatus: overrides.runtimeStatus ?? 'enabled',
    endpointFamily: overrides.endpointFamily ?? endpointType.split('-')[0] ?? endpointType,
    endpointType,
    baseUrl,
    modelId,
    authKind: overrides.authKind ?? 'api-key',
  }
}

export function createRuntimeResolvedModelRoute(
  overrides: Partial<RuntimeResolvedModelRoute> = {},
): RuntimeResolvedModelRoute {
  const providerProfileId = overrides.providerProfileId ?? 'provider-openai'
  const modelId = overrides.modelId ?? overrides.routeRef?.modelId ?? 'qwen-plus'

  return {
    routeRef: overrides.routeRef ?? {
      routeKind: 'provider-model',
      profileId: providerProfileId,
      modelId,
    },
    providerProfileId,
    provider: overrides.provider ?? 'openai',
    providerId: overrides.providerId ?? 'openai',
    adapterId: overrides.adapterId ?? 'openai',
    runtimeStatus: overrides.runtimeStatus ?? 'enabled',
    catalogRevision: overrides.catalogRevision ?? '2026-04-06-provider-catalog-v1',
    endpointFamily: overrides.endpointFamily ?? 'openai',
    endpointType: overrides.endpointType ?? 'openai-compatible',
    baseUrl: overrides.baseUrl ?? 'https://api.example.com/v1',
    modelId,
    authKind: overrides.authKind ?? 'api-key',
  }
}

type RuntimeRunStartResponseOverrides = Omit<Partial<RuntimeRunStartResponse>, 'run'> & {
  run?: Partial<RuntimeRunView>
}

type RuntimeRunCancelResponseOverrides = Omit<Partial<RuntimeRunCancelResponse>, 'run'> & {
  run?: Partial<RuntimeRunView>
}

export function createRuntimeRunStartResponse(
  overrides: RuntimeRunStartResponseOverrides = {},
): RuntimeRunStartResponse {
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
      requestedThinkingLevel: overrides.run?.requestedThinkingLevel ?? null,
      appliedThinkingLevel: overrides.run?.appliedThinkingLevel ?? null,
      thinkingCapabilitySnapshot: overrides.run?.thinkingCapabilitySnapshot ?? null,
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
      requestedThinkingLevel: overrides.run?.requestedThinkingLevel ?? null,
      appliedThinkingLevel: overrides.run?.appliedThinkingLevel ?? null,
      thinkingCapabilitySnapshot: overrides.run?.thinkingCapabilitySnapshot ?? null,
    },
    cancelAccepted: overrides.cancelAccepted ?? true,
  }
}

export function createRuntimeThinkingCapability(
  overrides: Partial<RuntimeThinkingCapability> = {},
): RuntimeThinkingCapability {
  return {
    status: overrides.status ?? 'verified-supported',
    source: overrides.source ?? 'verified',
    supported: overrides.supported ?? true,
    supportedLevels: overrides.supportedLevels ?? ['off', 'auto', 'low', 'medium', 'high', 'xhigh'],
    defaultLevel: overrides.defaultLevel ?? 'auto',
    reasonCode: overrides.reasonCode ?? 'verified_supported',
    providerHint: overrides.providerHint ?? 'openai-compatible',
    routeFingerprint: overrides.routeFingerprint ?? {
      providerProfileId: 'provider-openai',
      provider: 'openai',
      endpointType: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      modelId: 'qwen-plus',
    },
    overrideLevels: overrides.overrideLevels ?? [],
  }
}

export function createRuntimeRunMetadataEvent(
  overrides: Partial<RuntimeRunMetadataEvent> = {},
): RuntimeRunMetadataEvent {
  return {
    type: 'run_metadata',
    runId: overrides.runId ?? 'run-1',
    sessionId: overrides.sessionId ?? sessionId,
    sequence: overrides.sequence ?? 2,
    payload: {
      requestedThinkingLevel: overrides.payload?.requestedThinkingLevel ?? 'auto',
      appliedThinkingLevel: overrides.payload?.appliedThinkingLevel ?? 'auto',
      thinkingCapabilitySnapshot: overrides.payload?.thinkingCapabilitySnapshot ?? createRuntimeThinkingCapability(),
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
      resolvedModelRoute: overrides.payload?.resolvedModelRoute ?? createRuntimeResolvedModelRoute(),
      resolvedToolIds: overrides.payload?.resolvedToolIds ?? ['tool.file-convert'],
      requestOptions: overrides.payload?.requestOptions ?? { trace: true },
    },
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
): Extract<RuntimeMessagePayload, { role: 'user' }> {
  return {
    role: 'user',
    content: '请总结这份文档',
    ...overrides,
  } as Extract<RuntimeMessagePayload, { role: 'user' }>
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

export function createRuntimeErrorPayload(input: {
  code?: string
  message?: string
  details?: Record<string, unknown>
} = {}) {
  return {
    ok: false as const,
    ...(input.code || input.message || input.details
      ? {
          error: {
            ...(input.code ? { code: input.code } : {}),
            ...(input.message ? { message: input.message } : {}),
            ...(input.details ? { details: input.details } : {}),
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
