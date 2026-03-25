export type HostedBackendFailureCode =
  | 'runtime_resolution_failed'
  | 'port_allocation_failed'
  | 'spawn_failed'
  | 'startup_timeout'
  | 'healthcheck_failed'
  | 'unexpected_exit'
  | 'shutdown_timeout'
  | 'shutdown_failed'

export type HostedBackendPhase = 'resolve' | 'configure' | 'spawn' | 'healthcheck' | 'runtime' | 'shutdown'

export interface HostedBackendFailure {
  code: HostedBackendFailureCode
  phase: HostedBackendPhase
  message: string
  retryable: boolean
  detail: string | null
  exitCode: number | null
  signal: NodeJS.Signals | null
  timestamp: string
}

export interface HostedBackendFailureInput {
  code: HostedBackendFailureCode
  phase: HostedBackendPhase
  message: string
  cause?: unknown
  detail?: string | null
  retryable?: boolean
  exitCode?: number | null
  signal?: NodeJS.Signals | null
}

export function createHostedBackendFailure(input: HostedBackendFailureInput): HostedBackendFailure {
  return {
    code: input.code,
    phase: input.phase,
    message: input.message,
    retryable: input.retryable ?? isRetryableByDefault(input.code),
    detail: normalizeFailureDetail(input.detail, input.cause),
    exitCode: input.exitCode ?? null,
    signal: input.signal ?? null,
    timestamp: new Date().toISOString(),
  }
}

export function appendFailureDetail(
  failure: HostedBackendFailure,
  extraDetail: string | null | undefined,
): HostedBackendFailure {
  const normalizedExtraDetail = typeof extraDetail === 'string' ? extraDetail.trim() : ''

  if (normalizedExtraDetail === '') {
    return failure
  }

  return {
    ...failure,
    detail: failure.detail === null ? normalizedExtraDetail : `${failure.detail}\n${normalizedExtraDetail}`,
  }
}

export function classifyUnexpectedExit(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  phase: Extract<HostedBackendPhase, 'healthcheck' | 'runtime'> = 'runtime',
): HostedBackendFailure {
  return createHostedBackendFailure({
    code: 'unexpected_exit',
    phase,
    message: `Desktop runtime exited unexpectedly (${formatExitReason(exitCode, signal)}).`,
    exitCode,
    signal,
  })
}

export function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }

  return String(error)
}

export function formatExitReason(exitCode: number | null, signal: NodeJS.Signals | null): string {
  if (signal !== null) {
    return `signal ${signal}`
  }

  if (exitCode !== null) {
    return `exit code ${exitCode}`
  }

  return 'unknown reason'
}

export function isHostedBackendFailure(value: unknown): value is HostedBackendFailure {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'phase' in value
    && 'message' in value
    && 'timestamp' in value
}

function normalizeFailureDetail(detail: string | null | undefined, cause: unknown): string | null {
  const normalizedDetail = typeof detail === 'string' ? detail.trim() : ''

  if (normalizedDetail !== '') {
    return normalizedDetail
  }

  if (cause === undefined) {
    return null
  }

  const summarizedCause = summarizeUnknownError(cause).trim()

  return summarizedCause === '' ? null : summarizedCause
}

function isRetryableByDefault(code: HostedBackendFailureCode): boolean {
  switch (code) {
    case 'runtime_resolution_failed':
    case 'shutdown_timeout':
    case 'shutdown_failed':
      return false
    default:
      return true
  }
}
