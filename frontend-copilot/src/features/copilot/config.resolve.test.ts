import { describe, expect, it } from 'vitest'

import { resolveCopilotConfigState } from './config'
import {
  createBootstrapFieldsResult,
  createRuntimeResult,
} from './config.test-support'

describe('resolveCopilotConfigState', () => {
  it('returns an error state when bootstrap field loading fails', () => {
    expect(resolveCopilotConfigState({
      bootstrapFieldsResult: {
        ok: false,
        error: 'snapshot unavailable',
      },
      runtimeResult: createRuntimeResult({
        status: 'ready',
        runtimeUrl: 'http://127.0.0.1:8765',
        resolvedMode: 'development',
      }),
    })).toEqual({
      status: 'error',
      error: 'snapshot unavailable',
    })
  })

  it('returns an error state when hosted runtime loading fails', () => {
    expect(resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        runtimeUrl: 'http://localhost:4400',
        agentName: 'planner',
      }),
      runtimeResult: {
        ok: false,
        error: 'runtime unavailable',
      },
    })).toEqual({
      status: 'error',
      error: 'runtime unavailable',
    })
  })

  it('prefers hosted runtime facts when the backend is ready', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        runtimeUrl: 'http://manual-override:9000',
        agentName: 'campus-agent',
      }),
      runtimeResult: createRuntimeResult({
        status: 'ready',
        runtimeUrl: 'http://127.0.0.1:8765',
        resolvedMode: 'development',
      }),
    })

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') {
      throw new Error('Expected ready state.')
    }

    expect(state.runtimeUrl).toBe('http://127.0.0.1:8765')
    expect(state.runtimeSource).toBe('hosted')
    expect(state.diagnostics.modeSource).toBe('resolved')
  })

  it('no longer treats missing agentName as a readiness blocker', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        runtimeUrl: 'http://127.0.0.1:3000',
        agentName: null,
      }),
      runtimeResult: createRuntimeResult({
        status: 'stopped',
      }),
    })

    expect(state.status).toBe('ready')
    if (state.status !== 'ready') {
      throw new Error('Expected ready state from dev override.')
    }

    expect(state.runtimeSource).toBe('dev-override')
    expect(state.runtimeUrl).toBe('http://127.0.0.1:3000')
    expect(state.agentName).toBeNull()
    expect(state.agentNameSource).toBe('missing')
  })

  it('keeps a distinct starting state while the hosted backend boots', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        agentName: 'campus-agent',
      }),
      runtimeResult: createRuntimeResult({
        status: 'starting',
        runtimeUrl: 'http://127.0.0.1:8765',
      }),
    })

    expect(state.status).toBe('starting')
    if (state.status !== 'starting') {
      throw new Error('Expected starting state.')
    }

    expect(state.runtimeSource).toBe('hosted')
    expect(state.runtimeUrl).toBe('http://127.0.0.1:8765')
  })

  it('surfaces hosted startup failures in packaged mode without allowing overrides', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        runtimeUrl: 'http://manual-override:9000',
        agentName: 'campus-agent',
      }),
      runtimeResult: createRuntimeResult({
        status: 'failed',
        expectedMode: 'bundled',
        isPackaged: true,
        failure: {
          code: 'runtime_resolution_failed',
          phase: 'resolve',
          message: 'Bundled runtime manifest is missing.',
          retryable: false,
          exitCode: null,
          signal: null,
          timestamp: '2026-03-23T00:00:00.000Z',
        },
      }),
    })

    expect(state.status).toBe('failed')
    if (state.status !== 'failed') {
      throw new Error('Expected failed state.')
    }

    expect(state.runtimeSource).toBe('none')
    expect(state.runtimeUrl).toBeNull()
    expect(state.devOverrideAllowed).toBe(false)
  })

  it('preserves degraded hosted runtime state when a usable runtime url still exists', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        agentName: 'campus-agent',
      }),
      runtimeResult: createRuntimeResult({
        status: 'degraded',
        runtimeUrl: 'http://127.0.0.1:8765',
        failure: {
          code: 'unexpected_exit',
          phase: 'runtime',
          message: 'Desktop runtime exited unexpectedly.',
          retryable: true,
          exitCode: 1,
          signal: null,
          timestamp: '2026-03-23T00:00:00.000Z',
        },
      }),
    })

    expect(state.status).toBe('degraded')
    if (state.status !== 'degraded') {
      throw new Error('Expected degraded state.')
    }

    expect(state.runtimeSource).toBe('hosted')
    expect(state.runtimeUrl).toBe('http://127.0.0.1:8765')
    expect(state.diagnostics.failure?.code).toBe('unexpected_exit')
  })

  it('returns an empty state when neither hosted runtime nor bootstrap fields provide a runtime url', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({}, 'empty'),
      runtimeResult: createRuntimeResult({
        status: 'stopped',
      }),
    })

    expect(state.status).toBe('empty')
    if (state.status !== 'empty') {
      throw new Error('Expected empty state.')
    }

    expect(state.missingFields).toEqual(['runtimeUrl'])
    expect(state.runtimeSource).toBe('none')
    expect(state.storageState).toBe('empty')
  })
})
