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

export interface RuntimeToolDirectoryEntry {
  toolId: string
  kind: string
  availability: string
  displayName: string | null
  description: string | null
}

export interface RuntimeCapabilitiesGetResponse {
  ok: true
  sessionId: string
  boundAgent: RuntimeBoundAgent
  capabilitiesVersion: string
  tools: RuntimeToolDirectoryEntry[]
  recommendedTools: string[]
  toolSelectionMode: string
  defaultModelPreference: string | null
}

export interface RuntimeMessagePayload {
  role: 'user' | 'assistant'
  content: string
}

export interface RuntimeMessageSendResponse {
  ok: true
  sessionId: string
  boundAgent: RuntimeBoundAgent
  assistantMessage: RuntimeMessagePayload
  resolvedModelId: string
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}

interface RuntimeErrorPayload {
  ok?: false
  error?: {
    code?: string
    message?: string
  }
}

interface RuntimeMethodRequest {
  method: 'agents/list' | 'session/create' | 'capabilities/get' | 'message/send'
  body?: Record<string, unknown>
}

export type FetchLike = typeof fetch

export class RuntimeRequestError extends Error {
  readonly code: string | null
  readonly status: number

  constructor(message: string, input: { code?: string, status: number }) {
    super(message)
    this.name = 'RuntimeRequestError'
    this.code = input.code ?? null
    this.status = input.status
  }
}

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

export async function getRuntimeCapabilities(input: {
  runtimeUrl: string
  sessionId: string
  fetchFn?: FetchLike
}): Promise<RuntimeCapabilitiesGetResponse> {
  return postRuntimeMethod<RuntimeCapabilitiesGetResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'capabilities/get',
    body: {
      sessionId: input.sessionId,
    },
    fetchFn: input.fetchFn,
  })
}

export async function sendRuntimeMessage(input: {
  runtimeUrl: string
  sessionId: string
  agent?: string
  message: RuntimeMessagePayload
  model: string
  enabledTools: string[]
  requestOptions?: Record<string, unknown>
  fetchFn?: FetchLike
}): Promise<RuntimeMessageSendResponse> {
  return postRuntimeMethod<RuntimeMessageSendResponse>({
    runtimeUrl: input.runtimeUrl,
    method: 'message/send',
    body: {
      sessionId: input.sessionId,
      ...(input.agent === undefined ? {} : { agent: input.agent }),
      message: input.message,
      model: input.model,
      enabledTools: input.enabledTools,
      requestOptions: input.requestOptions ?? {},
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
    throw buildRuntimeRequestError(
      isRuntimeErrorPayload(payload) ? payload : {},
      response.status,
    )
  }

  if (isRuntimeErrorPayload(payload)) {
    throw buildRuntimeRequestError(payload, response.status)
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

function buildRuntimeRequestError(payload: RuntimeErrorPayload, status: number): RuntimeRequestError {
  return new RuntimeRequestError(buildRuntimeErrorMessage(payload, status), {
    code: payload.error?.code,
    status,
  })
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
