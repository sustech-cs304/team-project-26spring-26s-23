import { describe, expect, it, vi } from 'vitest'

const configMocks = vi.hoisted(() => ({
  loadCopilotConfigStateFromPublicSnapshot: vi.fn(),
}))

vi.mock('./features/copilot/config', async () => {
  const actual = await vi.importActual<typeof import('./features/copilot/config')>('./features/copilot/config')
  return {
    ...actual,
    loadCopilotConfigStateFromPublicSnapshot: configMocks.loadCopilotConfigStateFromPublicSnapshot,
  }
})

import { refreshCopilotBootstrapStateFromPublicSnapshot } from './CopilotAppRoot'
import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from './features/copilot/types'

describe('refreshCopilotBootstrapStateFromPublicSnapshot', () => {
  it('applies the latest bootstrap state resolved from a public snapshot without requiring a global agentName', async () => {
    const nextState = createReadyState({
      runtimeUrl: 'http://localhost:4400',
      agentName: null,
      agentNameSource: 'missing',
    })
    const applyState = vi.fn()
    configMocks.loadCopilotConfigStateFromPublicSnapshot.mockResolvedValueOnce(nextState)

    const result = await refreshCopilotBootstrapStateFromPublicSnapshot({
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'dark',
            animationsEnabled: true,
          },
          assistantBehavior: {
            agentName: null,
            debugModeEnabled: false,
          },
          hostConfig: {
            runtimeUrl: 'http://localhost:4400',
          },
          backendExposed: {
            model: null,
          },
        },
      },
      applyState,
    })

    expect(configMocks.loadCopilotConfigStateFromPublicSnapshot).toHaveBeenCalledOnce()
    expect(applyState).toHaveBeenCalledOnce()
    expect(applyState).toHaveBeenCalledWith(nextState)
    expect(result).toEqual(nextState)
  })

  it('falls back to an error bootstrap state when snapshot refresh fails', async () => {
    const applyState = vi.fn()
    configMocks.loadCopilotConfigStateFromPublicSnapshot.mockRejectedValueOnce(new Error('refresh failed'))

    const result = await refreshCopilotBootstrapStateFromPublicSnapshot({
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'light',
            animationsEnabled: true,
          },
          assistantBehavior: {
            agentName: null,
            debugModeEnabled: false,
          },
          hostConfig: {
            runtimeUrl: null,
          },
          backendExposed: {
            model: null,
          },
        },
      },
      applyState,
    })

    expect(applyState).toHaveBeenCalledOnce()
    expect(applyState).toHaveBeenCalledWith({
      status: 'error',
      error: 'refresh failed',
    })
    expect(result).toEqual({
      status: 'error',
      error: 'refresh failed',
    })
  })
})

function createDiagnosticsSummary(
  overrides: Partial<CopilotDiagnosticsSummary> = {},
): CopilotDiagnosticsSummary {
  return {
    hostedStatus: 'ready',
    failure: null,
    mode: 'development',
    modeSource: 'resolved',
    runtimeSource: 'hosted',
    ...overrides,
  }
}

function createBaseResolvedState(
  overrides: Partial<Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'>> = {},
): Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'> {
  return {
    bootstrapFields: {
      runtimeUrl: 'http://127.0.0.1:8765',
      agentName: null,
      debugModeEnabled: false,
    },
    storageState: 'stored',
    runtime: {
      status: 'ready',
      expectedMode: 'development',
      resolvedMode: 'development',
      runtimeUrl: 'http://127.0.0.1:8765',
      isPackaged: false,
      failure: null,
    },
    runtimeUrl: 'http://127.0.0.1:8765',
    runtimeSource: 'hosted',
    agentName: null,
    agentNameSource: 'missing',
    diagnostics: createDiagnosticsSummary(),
    devOverrideAllowed: true,
    devOverrideConfigured: false,
    ...overrides,
  }
}

function createReadyState(
  overrides: Partial<Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'>> = {},
): CopilotBootstrapState {
  return {
    status: 'ready',
    ...createBaseResolvedState(overrides),
  }
}
