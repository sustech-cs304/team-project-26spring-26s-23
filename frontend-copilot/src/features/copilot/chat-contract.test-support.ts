import { vi } from 'vitest'

import type {
  RuntimeAgentsListResponse,
  RuntimeBoundAgent,
  RuntimeCapabilitiesGetResponse,
  RuntimeMessagePayload,
  RuntimeModelRoute,
  RuntimeRunCompletedEvent,
  RuntimeRunEvent,
  RuntimeSessionCreateResponse,
} from './chat-contract'

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

export function createRuntimeSessionCreateResponse(
  overrides: Partial<RuntimeSessionCreateResponse> = {},
): RuntimeSessionCreateResponse {
  return {
    ok: true,
    sessionId,
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

export function createRuntimeCapabilitiesGetResponse(
  overrides: Partial<RuntimeCapabilitiesGetResponse> = {},
): RuntimeCapabilitiesGetResponse {
  return {
    ok: true,
    sessionId,
    boundAgent: createBoundAgent(),
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
): AsyncGenerator<RuntimeRunEvent> {
  for (const event of events) {
    yield event
  }
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

export function createFetchResponse(payload: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
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
    body: null,
  }
}

export function createFetchFn(payload: unknown, init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn().mockResolvedValue(createFetchResponse(payload, init))
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
