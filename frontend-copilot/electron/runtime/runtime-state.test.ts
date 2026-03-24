import { describe, expect, it } from 'vitest'
import {
  appendFailureDetail,
  classifyUnexpectedExit,
  createHostedBackendFailure,
  formatExitReason,
} from './runtime-diagnostics'
import {
  createInitialHostedBackendState,
  markHostedBackendDegraded,
  markHostedBackendFailed,
  markHostedBackendReady,
  markHostedBackendStarting,
  markHostedBackendStopped,
} from './runtime-state'

describe('runtime diagnostics', () => {
  it('creates retryable startup failures with normalized detail text', () => {
    const failure = createHostedBackendFailure({
      code: 'startup_timeout',
      phase: 'healthcheck',
      message: 'Runtime readiness timed out.',
      detail: '  last probe timed out  ',
    })

    expect(failure.retryable).toBe(true)
    expect(failure.detail).toBe('last probe timed out')
    expect(failure.exitCode).toBeNull()
    expect(failure.signal).toBeNull()
  })

  it('classifies unexpected exits and appends captured output', () => {
    const failure = appendFailureDetail(
      classifyUnexpectedExit(7, null, 'runtime'),
      'stderr:\nTraceback...',
    )

    expect(failure.code).toBe('unexpected_exit')
    expect(failure.phase).toBe('runtime')
    expect(failure.exitCode).toBe(7)
    expect(failure.detail).toContain('stderr:')
    expect(formatExitReason(7, null)).toBe('exit code 7')
  })
})

describe('runtime state transitions', () => {
  it('tracks starting, ready, degraded, failed, and stopped states', () => {
    const initialState = createInitialHostedBackendState()
    const startingState = markHostedBackendStarting(initialState, {
      mode: 'development',
      baseUrl: 'http://127.0.0.1:4000',
      pid: 1234,
    })

    expect(startingState.status).toBe('starting')
    expect(startingState.baseUrl).toBe('http://127.0.0.1:4000')
    expect(startingState.pid).toBe(1234)
    expect(startingState.lastFailure).toBeNull()

    const readyState = markHostedBackendReady(startingState)
    expect(readyState.status).toBe('ready')
    expect(readyState.readyAt).not.toBeNull()

    const degradedFailure = classifyUnexpectedExit(1, null, 'runtime')
    const degradedState = markHostedBackendDegraded(readyState, {
      failure: degradedFailure,
      exitCode: 1,
    })
    expect(degradedState.status).toBe('degraded')
    expect(degradedState.lastFailure).toEqual(degradedFailure)

    const failedFailure = createHostedBackendFailure({
      code: 'spawn_failed',
      phase: 'spawn',
      message: 'Spawn failed.',
      retryable: true,
    })
    const failedState = markHostedBackendFailed(degradedState, {
      failure: failedFailure,
      exitCode: 2,
    })
    expect(failedState.status).toBe('failed')
    expect(failedState.exitCode).toBe(2)
    expect(failedState.lastFailure).toEqual(failedFailure)

    const stoppedState = markHostedBackendStopped(failedState, {
      exitCode: 0,
    })
    expect(stoppedState.status).toBe('stopped')
    expect(stoppedState.exitCode).toBe(0)
    expect(stoppedState.stoppedAt).not.toBeNull()
  })
})
