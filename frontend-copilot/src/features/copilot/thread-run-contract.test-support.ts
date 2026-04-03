import { vi } from 'vitest'

import type {
  RuntimeAgentsListResponse,
  RuntimeBoundAgent,
  RuntimeCapabilitiesGetResponse,
  RuntimeMessagePayload,
  RuntimeModelRoute,
  RuntimeRunCancelResponse,
  RuntimeRunCompletedEvent,
  RuntimeRunEvent,
  RuntimeRunStartResponse,
  RuntimeSessionCreateResponse,
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

export function createRuntimeRunStartResponse(
  overrides: Partial<RuntimeRunStartResponse> = {},
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
  overrides: Partial<RuntimeRunCancelResponse> = {},
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
    },
    cancelAccepted: overrides.cancelAccepted ?? true,
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
