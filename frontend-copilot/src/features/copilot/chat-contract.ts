import {
  isTerminalRuntimeRunEvent,
  parseRuntimeRunEventStream,
} from './runtime-message-stream'

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

export interface RuntimeModelRouteSnapshot {
  provider: string
  endpointType: string
  baseUrl: string
  modelId: string
}

export interface RuntimeModelRoute {
  providerProfileId: string
  snapshot: RuntimeModelRouteSnapshot
}

export interface RuntimeRunEventBase<TType extends string, TPayload extends Record<string, unknown>> {
  type: TType
  runId: string
  sessionId: string
  sequence: number
  payload: TPayload
}

export type RuntimeRunStartedEvent = RuntimeRunEventBase<'run_started', {
  assistantMessageId: string
}>

export type RuntimeTextDeltaEvent = RuntimeRunEventBase<'text_delta', {
  assistantMessageId: string
  delta: string
}>

export type RuntimeRunCompletedEvent = RuntimeRunEventBase<'run_completed', {
  assistantMessageId: string
  assistantText: string
  resolvedModelId: string
  resolvedModelRoute: RuntimeModelRoute
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}>

export type RuntimeRunFailedEvent = RuntimeRunEventBase<'run_failed', {
  code: string
  message: string
  details: Record<string, unknown>
}>

export type RuntimeRunCancelledEvent = RuntimeRunEventBase<'run_cancelled', {
  assistantMessageId: string
  reason: string
}>

export type RuntimeRunDiagnosticEvent = RuntimeRunEventBase<'run_diagnostic', {
  code: string
  message: string
  details: Record<string, unknown>
  stage: string
}>

export type RuntimeToolEventReservedEvent = RuntimeRunEventBase<'tool_event_reserved', Record<string, unknown>>

export type RuntimeRunEvent =
  | RuntimeRunStartedEvent
  | RuntimeTextDeltaEvent
  | RuntimeRunCompletedEvent
  | RuntimeRunFailedEvent
  | RuntimeRunCancelledEvent
  | RuntimeRunDiagnosticEvent
  | RuntimeToolEventReservedEvent

export type RuntimeRunTerminalEvent =
  | RuntimeRunCompletedEvent
  | RuntimeRunFailedEvent
  | RuntimeRunCancelledEvent

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

export async function* sendRuntimeMessage(input: {
  runtimeUrl: string
  sessionId: string
  agent?: string
  message: RuntimeMessagePayload
  modelRoute: RuntimeModelRoute
  enabledTools: string[]
  requestOptions?: Record<string, unknown>
  fetchFn?: FetchLike
  signal?: AbortSignal
}): AsyncGenerator<RuntimeRunEvent> {
  const fetchFn = input.fetchFn ?? fetch
  const response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildRuntimeRequest({
      method: 'message/send',
      body: {
        sessionId: input.sessionId,
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        message: input.message,
        policy: {
          modelRoute: input.modelRoute,
          enabledTools: input.enabledTools,
          requestOptions: input.requestOptions ?? {},
        },
      },
    })),
    signal: input.signal,
  })

  if (!response.ok) {
    throw await buildRuntimeRequestErrorFromResponse(response)
  }

  if (response.body === null) {
    throw new Error('Runtime message stream response body is unavailable.')
  }

  let lastSequence = 0
  let runId: string | null = null
  let sessionId: string | null = null
  let sawRunStarted = false
  let sawTerminal = false

  try {
    for await (const event of parseRuntimeRunEventStream(response.body)) {
      if (sawTerminal) {
        throw new Error('Runtime event stream emitted additional events after a terminal event.')
      }

      if (event.sequence <= lastSequence) {
        throw new Error(`Runtime event sequence regressed from ${lastSequence} to ${event.sequence}.`)
      }

      if (runId !== null && event.runId !== runId) {
        throw new Error(`Runtime event stream changed runId from ${runId} to ${event.runId}.`)
      }

      if (sessionId !== null && event.sessionId !== sessionId) {
        throw new Error(`Runtime event stream changed sessionId from ${sessionId} to ${event.sessionId}.`)
      }

      if (!sawRunStarted && event.type !== 'run_started') {
        throw new Error(`Runtime event stream must begin with run_started, received ${event.type}.`)
      }

      lastSequence = event.sequence
      runId = event.runId
      sessionId = event.sessionId
      if (event.type === 'run_started') {
        sawRunStarted = true
      }
      if (isTerminalRuntimeRunEvent(event)) {
        sawTerminal = true
      }

      yield event
    }

    if (!sawRunStarted) {
      throw new Error('Runtime event stream ended before run_started was received.')
    }

    if (!sawTerminal) {
      throw new Error('Runtime event stream ended without a terminal event.')
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted === true) {
      throw createAbortError()
    }
    throw error
  }
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

async function buildRuntimeRequestErrorFromResponse(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<RuntimeRequestError> {
  const payload = await readRuntimeErrorPayload(response)
  return buildRuntimeRequestError(payload, response.status)
}

async function readRuntimeErrorPayload(
  response: Awaited<ReturnType<FetchLike>>,
): Promise<RuntimeErrorPayload> {
  const contentType = getResponseHeader(response, 'content-type')
  if (!contentType.includes('application/json') && typeof response.json !== 'function') {
    return {}
  }

  try {
    const payload = await response.json() as unknown
    return isRuntimeErrorPayload(payload) ? payload : {}
  } catch {
    return {}
  }
}

function getResponseHeader(
  response: Awaited<ReturnType<FetchLike>>,
  headerName: string,
): string {
  const headerValue = response.headers?.get(headerName) ?? response.headers?.get(headerName.toLowerCase())
  return typeof headerValue === 'string' ? headerValue.toLowerCase() : ''
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

function createAbortError(): Error {
  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function isAbortLikeError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}
