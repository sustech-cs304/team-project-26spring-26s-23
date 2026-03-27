export interface RuntimeAgentDirectoryEntry {
  agentId: string
  status: string
  recommendedTools: string[]
  defaultModelPreference: string | null
  displayName: string | null
  description: string | null
  iconKey: string | null
}

export interface RuntimeAgentsListResponse {
  ok: true
  directoryVersion: string
  defaultAgentId: string
  agents: RuntimeAgentDirectoryEntry[]
}

export interface RuntimeBoundAgent {
  agentId: string
  status: string
  displayName: string | null
  description: string | null
  iconKey: string | null
}

export interface RuntimeSessionCreateResponse {
  ok: true
  sessionId: string
  boundAgent: RuntimeBoundAgent
  createdAt: string
  updatedAt: string
  recommendedTools: string[]
  defaultModelPreference: string | null
  capabilities: Record<string, unknown>
}

interface RuntimeErrorPayload {
  ok?: false
  error?: {
    code?: string
    message?: string
  }
}

interface RuntimeMethodRequest {
  method: 'agents/list' | 'session/create'
  body?: Record<string, unknown>
}

export type FetchLike = typeof fetch

export async function listRuntimeAgents(input: {
  runtimeUrl: string
  fetchFn?: FetchLike
}): Promise<RuntimeAgentsListResponse> {
  return postRuntimeMethod<RuntimeAgentsListResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'agents/list',
    fetchFn: input.fetchFn,
  })
}

export async function createRuntimeSession(input: {
  runtimeUrl: string
  agentId: string
  fetchFn?: FetchLike
}): Promise<RuntimeSessionCreateResponse> {
  return postRuntimeMethod<RuntimeSessionCreateResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'session/create',
    body: {
      agentId: input.agentId,
    },
    fetchFn: input.fetchFn,
  })
}

async function postRuntimeMethod<TResponse>(input: {
  runtimeUrl: string
  method: RuntimeMethodRequest['method']
  body?: Record<string, unknown>
  fetchFn?: FetchLike
}): Promise<TResponse> {
  const fetchFn = input.fetchFn ?? fetch
  const response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRuntimeRequest(input)),
  })

  const payload = await response.json() as TResponse | RuntimeErrorPayload

  if (!response.ok) {
    throw new Error(buildRuntimeErrorMessage(payload, response.status))
  }

  if (isRuntimeErrorPayload(payload)) {
    throw new Error(buildRuntimeErrorMessage(payload, response.status))
  }

  return payload
}

function buildRuntimeRequest(input: {
  method: RuntimeMethodRequest['method']
  body?: Record<string, unknown>
}): RuntimeMethodRequest {
  if (input.body === undefined) {
    return { method: input.method }
  }

  return {
    method: input.method,
    body: input.body,
  }
}

export function buildRuntimeEndpoint(runtimeUrl: string): string {
  return runtimeUrl.endsWith('/') ? runtimeUrl : `${runtimeUrl}/`
}

function isRuntimeErrorPayload(payload: unknown): payload is RuntimeErrorPayload {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  return 'ok' in payload && payload.ok === false
}

function buildRuntimeErrorMessage(payload: RuntimeErrorPayload, status: number): string {
  const code = payload.error?.code
  const message = payload.error?.message

  if (code && message) {
    return `${code}: ${message}`
  }

  if (code) {
    return code
  }

  if (message) {
    return message
  }

  return `Runtime request failed with HTTP ${status}.`
}
