import { describe, expect, it } from 'vitest'
import {
  appendFailureDetail,
  createHostedBackendFailure,
  formatExitReason,
  isHostedBackendFailure,
  summarizeUnknownError,
  type HostedBackendFailureCode,
} from './runtime-diagnostics'

const ALL_CODES: HostedBackendFailureCode[] = [
  'runtime_resolution_failed',
  'port_allocation_failed',
  'spawn_failed',
  'startup_timeout',
  'healthcheck_failed',
  'unexpected_exit',
  'shutdown_timeout',
  'shutdown_failed',
]

describe('hosted backend failure codes', () => {
  it('defines exactly eight failure codes', () => {
    expect(ALL_CODES).toHaveLength(8)
  })

  it('has only unique failure codes', () => {
    expect(new Set(ALL_CODES).size).toBe(ALL_CODES.length)
  })
})

describe('createHostedBackendFailure', () => {
  it('defaults retryable to true for spawn_failed', () => {
    const failure = createHostedBackendFailure({
      code: 'spawn_failed',
      phase: 'spawn',
      message: 'Spawn failed.',
    })

    expect(failure.retryable).toBe(true)
  })

  it('defaults retryable to false for runtime_resolution_failed', () => {
    const failure = createHostedBackendFailure({
      code: 'runtime_resolution_failed',
      phase: 'resolve',
      message: 'Resolution failed.',
    })

    expect(failure.retryable).toBe(false)
  })

  it('defaults retryable to false for shutdown_timeout', () => {
    const failure = createHostedBackendFailure({
      code: 'shutdown_timeout',
      phase: 'shutdown',
      message: 'Shutdown timed out.',
    })

    expect(failure.retryable).toBe(false)
  })

  it('defaults retryable to false for shutdown_failed', () => {
    const failure = createHostedBackendFailure({
      code: 'shutdown_failed',
      phase: 'shutdown',
      message: 'Shutdown failed.',
    })

    expect(failure.retryable).toBe(false)
  })

  it('uses provided retryable value over the default', () => {
    const failure = createHostedBackendFailure({
      code: 'spawn_failed',
      phase: 'spawn',
      message: 'Spawn failed.',
      retryable: false,
    })

    expect(failure.retryable).toBe(false)
  })

  it('defaults exitCode and signal to null', () => {
    const failure = createHostedBackendFailure({
      code: 'unexpected_exit',
      phase: 'runtime',
      message: 'Unexpected exit.',
    })

    expect(failure.exitCode).toBeNull()
    expect(failure.signal).toBeNull()
  })

  it('accepts explicit exitCode and signal', () => {
    const failure = createHostedBackendFailure({
      code: 'unexpected_exit',
      phase: 'runtime',
      message: 'Unexpected exit.',
      exitCode: 1,
      signal: 'SIGTERM',
    })

    expect(failure.exitCode).toBe(1)
    expect(failure.signal).toBe('SIGTERM')
  })

  it('sets timestamp to an ISO string', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
    })

    expect(failure.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('normalizes detail text by trimming whitespace', () => {
    const failure = createHostedBackendFailure({
      code: 'healthcheck_failed',
      phase: 'healthcheck',
      message: 'Health check failed.',
      detail: '   probe returned 503   ',
    })

    expect(failure.detail).toBe('probe returned 503')
  })

  it('pulls detail from cause when detail is empty', () => {
    const failure = createHostedBackendFailure({
      code: 'spawn_failed',
      phase: 'spawn',
      message: 'Spawn failed.',
      cause: new Error('ENOENT: python3 not found'),
    })

    expect(failure.detail).toBe('ENOENT: python3 not found')
  })

  it('prefers explicit detail over cause', () => {
    const failure = createHostedBackendFailure({
      code: 'spawn_failed',
      phase: 'spawn',
      message: 'Spawn failed.',
      detail: 'Custom detail',
      cause: new Error('Original error'),
    })

    expect(failure.detail).toBe('Custom detail')
  })

  it('sets detail to null when neither detail nor cause are provided', () => {
    const failure = createHostedBackendFailure({
      code: 'unexpected_exit',
      phase: 'runtime',
      message: 'Exit.',
    })

    expect(failure.detail).toBeNull()
  })
})

describe('appendFailureDetail', () => {
  it('appends extra detail to existing detail', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
      detail: 'Probe failed',
    })

    const updated = appendFailureDetail(failure, 'stdout: traceback')
    expect(updated.detail).toBe('Probe failed\nstdout: traceback')
  })

  it('returns unchanged failure when extraDetail is empty string', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
      detail: 'Probe failed',
    })

    const updated = appendFailureDetail(failure, '')
    expect(updated).toBe(failure)
  })

  it('returns unchanged failure when extraDetail is null', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
      detail: 'Probe failed',
    })

    const updated = appendFailureDetail(failure, null)
    expect(updated).toBe(failure)
  })

  it('returns unchanged failure when extraDetail is undefined', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
      detail: 'Probe failed',
    })

    const updated = appendFailureDetail(failure, undefined)
    expect(updated).toBe(failure)
  })

  it('sets detail to extraDetail when existing detail is null', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Timed out.',
    })

    const updated = appendFailureDetail(failure, 'new detail')
    expect(updated.detail).toBe('new detail')
  })
})

describe('formatExitReason', () => {
  it('formats signal reason', () => {
    expect(formatExitReason(null, 'SIGTERM')).toBe('signal SIGTERM')
    expect(formatExitReason(null, 'SIGKILL')).toBe('signal SIGKILL')
  })

  it('formats exit code reason', () => {
    expect(formatExitReason(0, null)).toBe('exit code 0')
    expect(formatExitReason(1, null)).toBe('exit code 1')
  })

  it('prioritizes signal over exit code when both are present', () => {
    expect(formatExitReason(1, 'SIGTERM')).toBe('signal SIGTERM')
  })

  it('returns unknown reason when both are null', () => {
    expect(formatExitReason(null, null)).toBe('unknown reason')
  })
})

describe('summarizeUnknownError', () => {
  it('returns the message of an Error instance', () => {
    expect(summarizeUnknownError(new Error('Something went wrong'))).toBe('Something went wrong')
  })

  it('returns the string representation of a non-Error value', () => {
    expect(summarizeUnknownError('plain string')).toBe('plain string')
    expect(summarizeUnknownError(42)).toBe('42')
    expect(summarizeUnknownError(null)).toBe('null')
    expect(summarizeUnknownError(undefined)).toBe('undefined')
  })

  it('returns the string representation when Error message is empty', () => {
    expect(summarizeUnknownError(new Error())).toBe('Error')
  })
})

describe('isHostedBackendFailure', () => {
  it('returns true for a valid failure object', () => {
    const failure = createHostedBackendFailure({
      code: 'spawn_failed',
      phase: 'spawn',
      message: 'Spawn failed.',
    })

    expect(isHostedBackendFailure(failure)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isHostedBackendFailure(null)).toBe(false)
  })

  it('returns false for a plain object without required fields', () => {
    expect(isHostedBackendFailure({ code: 'spawn_failed' })).toBe(false)
    expect(isHostedBackendFailure({ message: 'hi' })).toBe(false)
    expect(isHostedBackendFailure({})).toBe(false)
  })

  it('returns false for primitives', () => {
    expect(isHostedBackendFailure('spawn_failed')).toBe(false)
    expect(isHostedBackendFailure(42)).toBe(false)
    expect(isHostedBackendFailure(undefined)).toBe(false)
  })
})
