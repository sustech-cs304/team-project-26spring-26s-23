import {
  RuntimeRequestError,
  type FetchLike,
} from './thread-run-contract'

export type RuntimeToolApprovalMode = 'allow' | 'ask' | 'delay' | 'deny'
export type RuntimeToolApprovalDecision = 'approved' | 'rejected'
export type RuntimeToolApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timed_out'
export type RuntimeToolApprovalTimeoutAction = 'approve' | 'deny'

export interface RuntimeToolApprovalEventPayload {
  mode: RuntimeToolApprovalMode
  timeoutAt?: string
  timeoutSeconds?: number | null
  timeoutAction?: RuntimeToolApprovalTimeoutAction | null
}

export interface RuntimeToolApprovalResolveResponse {
  ok: true
  runId: string
  toolCallId: string
  decision: RuntimeToolApprovalDecision
  status: RuntimeToolApprovalStatus
  resolvedAt: string
  source: string
  details: {
    toolId?: string
    mode?: RuntimeToolApprovalMode
    timeoutAction?: RuntimeToolApprovalTimeoutAction
  }
}

export async function resolveRuntimeToolApproval(input: {
  runtimeUrl: string
  runId: string
  toolCallId: string
  decision: RuntimeToolApprovalDecision
  fetchFn?: FetchLike
  signal?: AbortSignal
}): Promise<RuntimeToolApprovalResolveResponse> {
  const fetchFn = input.fetchFn ?? fetch
  let response: Awaited<ReturnType<FetchLike>>

  try {
    response = await fetchFn(buildRuntimeEndpoint(input.runtimeUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'tool-approval/resolve',
        body: {
          runId: input.runId,
          toolCallId: input.toolCallId,
          decision: input.decision,
        },
      }),
      signal: input.signal,
    })
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted === true) {
      throw createAbortError()
    }
    throwMappedRuntimeTransportError(error)
  }

  const payload = await response.json() as RuntimeToolApprovalResolveResponse | RuntimeErrorPayload
  if (!response.ok) {
    throw buildRuntimeRequestError(isRuntimeErrorPayload(payload) ? payload : {}, response.status)
  }
  if (isRuntimeErrorPayload(payload)) {
    throw buildRuntimeRequestError(payload, response.status)
  }

  return payload
}

interface RuntimeErrorPayload {
  ok?: false
  error?: {
    code?: string
    message?: string
    details?: Record<string, unknown>
  }
}

function buildRuntimeEndpoint(runtimeUrl: string): string {
  return runtimeUrl.endsWith('/') ? runtimeUrl : `${runtimeUrl}/`
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === 'AbortError'
  }

  return error instanceof Error && error.name === 'AbortError'
}

function createAbortError(): DOMException | Error {
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError')
  }

  const error = new Error('The operation was aborted.')
  error.name = 'AbortError'
  return error
}

function throwMappedRuntimeTransportError(error: unknown): never {
  if (error instanceof RuntimeRequestError) {
    throw error
  }

  const message = error instanceof Error ? error.message : String(error)
  throw new RuntimeRequestError(message, {
    status: 0,
    details: {},
  })
}

function isRuntimeErrorPayload(payload: unknown): payload is RuntimeErrorPayload {
  return !!payload && typeof payload === 'object' && 'ok' in payload && payload.ok === false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildRuntimeRequestError(payload: RuntimeErrorPayload, status: number): RuntimeRequestError {
  return new RuntimeRequestError(buildRuntimeErrorMessage(payload, status), {
    code: payload.error?.code,
    status,
    details: isRecord(payload.error?.details) ? payload.error.details : {},
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
