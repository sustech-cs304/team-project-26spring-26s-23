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

import {
  refreshCopilotBootstrapStateFromPublicSnapshot,
  shouldLoadCopilotProvider,
} from './CopilotAppRoot'
import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from './features/copilot/types'

describe('shouldLoadCopilotProvider', () => {
  it('starts a provider load when a connectable runtime still has no provider instance', () => {
    const configState = createReadyState()

    expect(shouldLoadCopilotProvider({
      configState,
      providerLoadState: { status: 'idle' },
      allowWorkbenchWithoutProvider: false,
      providerLoaded: false,
    })).toBe(true)

    expect(shouldLoadCopilotProvider({
      configState,
      providerLoadState: { status: 'loading' },
      allowWorkbenchWithoutProvider: false,
      providerLoaded: false,
    })).toBe(true)

    expect(shouldLoadCopilotProvider({
      configState,
      providerLoadState: { status: 'ready' },
      allowWorkbenchWithoutProvider: false,
      providerLoaded: true,
    })).toBe(false)

    expect(shouldLoadCopilotProvider({
      configState,
      providerLoadState: { status: 'error', error: 'boom' },
      allowWorkbenchWithoutProvider: false,
      providerLoaded: false,
    })).toBe(false)
  })

  it('keeps waiting on an in-flight provider import during StrictMode remounts', () => {
    expect(shouldLoadCopilotProvider({
      configState: createReadyState(),
      providerLoadState: { status: 'loading' },
      allowWorkbenchWithoutProvider: false,
      providerLoaded: false,
    })).toBe(true)
  })

  it('does not start another provider load after opting into workbench fallback', () => {
    expect(shouldLoadCopilotProvider({
      configState: createReadyState(),
      providerLoadState: { status: 'idle' },
      allowWorkbenchWithoutProvider: true,
      providerLoaded: false,
    })).toBe(false)
  })

  it('does not start another provider load after the provider module is already available', () => {
    expect(shouldLoadCopilotProvider({
      configState: createReadyState(),
      providerLoadState: { status: 'loading' },
      allowWorkbenchWithoutProvider: false,
      providerLoaded: true,
    })).toBe(false)
  })
})

describe('refreshCopilotBootstrapStateFromPublicSnapshot', () => {
  it('applies the latest bootstrap state resolved from a public snapshot', async () => {
    const nextState = createReadyState({
      runtimeUrl: 'http://localhost:4400',
      agentName: 'planner',
    })
    const applyState = vi.fn()
    configMocks.loadCopilotConfigStateFromPublicSnapshot.mockResolvedValueOnce(nextState)

    const result = await refreshCopilotBootstrapStateFromPublicSnapshot({
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
          },
          assistantBehavior: {
            agentName: null,
          },
          hostConfig: {
            runtimeUrl: null,
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
      agentName: 'campus-agent',
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
    agentName: 'campus-agent',
    agentNameSource: 'config-center',
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
