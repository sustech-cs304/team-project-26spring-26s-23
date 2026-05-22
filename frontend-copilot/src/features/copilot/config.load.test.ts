import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configCenterMocks = vi.hoisted(() => ({
  loadConfigCenterPublicSnapshot: vi.fn(),
}))

vi.mock('./config-center', () => ({
  loadConfigCenterPublicSnapshot: configCenterMocks.loadConfigCenterPublicSnapshot,
}))

import { loadCopilotConfigState, retryCopilotConfigState } from './config'
import {
  createConfigCenterPublicSnapshot,
  createRuntimeResult,
  type RuntimeModule,
} from './config.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_HTTP_LOCALHOST_4400 = 'http://localhost:4400'


beforeEach(() => {
  configCenterMocks.loadConfigCenterPublicSnapshot.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadCopilotConfigState', () => {
  it('loads renderer bootstrap fields directly from the config center public snapshot bridge', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot: createConfigCenterPublicSnapshot({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
        agentName: 'planner',
        theme: 'light',
        model: 'gpt-4.1-mini',
      }),
    })

    const runtimeModule = await import('./runtime') as RuntimeModule
    const loadCopilotRuntimeSpy = vi.spyOn(runtimeModule, 'loadCopilotRuntime').mockResolvedValueOnce(
      createRuntimeResult({
        status: 'stopped',
      }),
    )

    const state = await loadCopilotConfigState()

    expect(state).toMatchObject({
      status: 'ready',
      runtimeSource: 'dev-override',
      runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      bootstrapFields: {
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
        agentName: 'planner',
        debugModeEnabled: false,
      },
      storageState: 'stored',
    })
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') {
      throw new Error('Expected ready state from config center public snapshot bridge.')
    }

    expect(state.bootstrapFields).not.toHaveProperty('theme')
    expect(state.bootstrapFields).not.toHaveProperty('model')
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

  it('surfaces runtime load failures without falling back to legacy settings data', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot: createConfigCenterPublicSnapshot({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
        agentName: 'planner',
      }),
    })

    const runtimeModule = await import('./runtime') as RuntimeModule
    const loadCopilotRuntimeSpy = vi.spyOn(runtimeModule, 'loadCopilotRuntime').mockResolvedValueOnce({
      ok: false,
      error: 'runtime unavailable',
    })

    await expect(loadCopilotConfigState()).resolves.toEqual({
      status: 'error',
      error: 'runtime unavailable',
    })

    expect(configCenterMocks.loadConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(loadCopilotRuntimeSpy).toHaveBeenCalledOnce()
  })
})

describe('retryCopilotConfigState', () => {
  it('reuses the same config center public snapshot path during retry', async () => {
    configCenterMocks.loadConfigCenterPublicSnapshot.mockResolvedValueOnce({
      ok: true,
      snapshot: createConfigCenterPublicSnapshot({
        runtimeUrl: 'http://127.0.0.1:3000',
        agentName: null,
        theme: 'light',
        model: null,
      }),
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
      agentName: null,
      agentNameSource: 'missing',
      bootstrapFields: {
        runtimeUrl: 'http://127.0.0.1:3000',
        agentName: null,
        debugModeEnabled: false,
      },
    })

    expect(configCenterMocks.loadConfigCenterPublicSnapshot).toHaveBeenCalledOnce()
    expect(retryCopilotRuntimeSpy).toHaveBeenCalledOnce()
  })
})
