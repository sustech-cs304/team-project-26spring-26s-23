import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configCenterMocks = vi.hoisted(() => ({
  loadConfigCenterPublicSnapshot: vi.fn(),
}))

vi.mock('./config-center', () => ({
  loadConfigCenterPublicSnapshot: configCenterMocks.loadConfigCenterPublicSnapshot,
}))

import {
  loadBootstrapFieldsFromConfigCenterPublicSnapshot,
  loadCopilotConfigState,
  resolveCopilotConfigState,
  retryCopilotConfigState,
} from './config'
import type {
  CopilotBootstrapFieldsLoadResult,
  CopilotBootstrapFieldsStorageState,
  CopilotRendererRuntimeLoadResult,
  CopilotRendererRuntimeSnapshot,
} from './types'

type RuntimeModule = typeof import('./runtime')

function createBootstrapFieldsResult(
  fields: Partial<{ runtimeUrl: string | null; agentName: string | null }> = {},
  storageState: CopilotBootstrapFieldsStorageState = 'stored',
): CopilotBootstrapFieldsLoadResult {
  return {
    ok: true,
    fields: {
      runtimeUrl: fields.runtimeUrl ?? null,
      agentName: fields.agentName ?? null,
    },
    storageState,
  }
}

function createRuntimeResult(
  overrides: Partial<CopilotRendererRuntimeSnapshot> = {},
): CopilotRendererRuntimeLoadResult {
  return {
    ok: true,
    snapshot: {
      hosted: {
        status: 'stopped',
        expectedMode: 'development',
        resolvedMode: null,
        runtimeUrl: null,
        isPackaged: false,
        failure: null,
        ...overrides,
      },
    },
  }
}

beforeEach(() => {
  configCenterMocks.loadConfigCenterPublicSnapshot.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveCopilotConfigState', () => {
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
    expect(state.agentName).toBe('campus-agent')
    expect(state.agentNameSource).toBe('config-center')
    expect(state.bootstrapFields).toEqual({
      runtimeUrl: 'http://manual-override:9000',
      agentName: 'campus-agent',
    })
    expect(state.diagnostics.modeSource).toBe('resolved')
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

  it('falls back to a development override when hosted runtime is unavailable', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        runtimeUrl: 'http://127.0.0.1:3000',
        agentName: 'campus-agent',
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
    expect(state.agentName).toBe('campus-agent')
  })

  it('reports incomplete development override state when the agent name is missing', () => {
    const state = resolveCopilotConfigState({
      bootstrapFieldsResult: createBootstrapFieldsResult({
        runtimeUrl: 'http://127.0.0.1:3000',
        agentName: null,
      }),
      runtimeResult: createRuntimeResult({
        status: 'stopped',
      }),
    })

    expect(state.status).toBe('incomplete')
    if (state.status !== 'incomplete') {
      throw new Error('Expected incomplete state.')
    }

    expect(state.runtimeSource).toBe('dev-override')
    expect(state.missingFields).toEqual(['agentName'])
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

  it('returns an empty state when neither hosted runtime nor bootstrap fields provide connection facts', () => {
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

    expect(state.missingFields).toEqual(['runtimeUrl', 'agentName'])
    expect(state.runtimeSource).toBe('none')
    expect(state.storageState).toBe('empty')
  })
})

describe('loadBootstrapFieldsFromConfigCenterPublicSnapshot', () => {
  it('extracts bootstrap fields directly from the config center public snapshot shape', () => {
    expect(loadBootstrapFieldsFromConfigCenterPublicSnapshot({
      version: 1,
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
        assistantBehavior: {
          agentName: 'planner',
        },
        hostConfig: {
          runtimeUrl: 'http://localhost:4400',
        },
        backendExposed: {
          model: null,
        },
      },
    })).toEqual({
      ok: true,
      fields: {
        runtimeUrl: 'http://localhost:4400',
        agentName: 'planner',
      },
      storageState: 'stored',
    })
  })
})

describe('loadCopilotConfigState', () => {
  it('loads renderer bootstrap fields directly from the config center public snapshot bridge', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'dark',
          },
          assistantBehavior: {
            agentName: 'planner',
          },
          hostConfig: {
            runtimeUrl: 'http://localhost:4400',
          },
          backendExposed: {
            model: null,
          },
        },
      },
    })

    const runtimeModule = await import('./runtime') as RuntimeModule
    const loadCopilotRuntimeSpy = vi.spyOn(runtimeModule, 'loadCopilotRuntime').mockResolvedValueOnce(
      createRuntimeResult({
        status: 'stopped',
      }),
    )

    await expect(loadCopilotConfigState()).resolves.toMatchObject({
      status: 'ready',
      runtimeSource: 'dev-override',
      runtimeUrl: 'http://localhost:4400',
      agentName: 'planner',
      agentNameSource: 'config-center',
      bootstrapFields: {
        runtimeUrl: 'http://localhost:4400',
        agentName: 'planner',
      },
      storageState: 'stored',
    })

    expect(configCenterMocks.loadConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(loadCopilotRuntimeSpy).toHaveBeenCalledOnce()
  })

  it('surfaces config center public snapshot load failures as config errors', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: false,
      error: 'snapshot unavailable',
    })

    const runtimeModule = await import('./runtime') as RuntimeModule
    const loadCopilotRuntimeSpy = vi.spyOn(runtimeModule, 'loadCopilotRuntime').mockResolvedValueOnce(
      createRuntimeResult({
        status: 'ready',
        runtimeUrl: 'http://127.0.0.1:8765',
        resolvedMode: 'development',
      }),
    )

    await expect(loadCopilotConfigState()).resolves.toEqual({
      status: 'error',
      error: 'snapshot unavailable',
    })

    expect(configCenterMocks.loadConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(loadCopilotRuntimeSpy).toHaveBeenCalledOnce()
  })

  it('reuses the same config center public snapshot path during retry', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'light',
          },
          assistantBehavior: {
            agentName: 'campus-agent',
          },
          hostConfig: {
            runtimeUrl: 'http://127.0.0.1:3000',
          },
          backendExposed: {
            model: null,
          },
        },
      },
    })

    const runtimeModule = await import('./runtime') as RuntimeModule
    const retryCopilotRuntimeSpy = vi.spyOn(runtimeModule, 'retryCopilotRuntime').mockResolvedValueOnce(
      createRuntimeResult({
        status: 'stopped',
      }),
    )

    await expect(retryCopilotConfigState()).resolves.toMatchObject({
      status: 'ready',
      runtimeSource: 'dev-override',
      runtimeUrl: 'http://127.0.0.1:3000',
      agentName: 'campus-agent',
      agentNameSource: 'config-center',
      bootstrapFields: {
        runtimeUrl: 'http://127.0.0.1:3000',
        agentName: 'campus-agent',
      },
    })

    expect(configCenterMocks.loadConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(retryCopilotRuntimeSpy).toHaveBeenCalledOnce()
  })
})
