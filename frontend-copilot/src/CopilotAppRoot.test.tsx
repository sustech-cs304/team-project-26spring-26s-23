import { describe, expect, it } from 'vitest'

import { shouldLoadCopilotProvider } from './CopilotAppRoot'
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

function createBaseResolvedState(): Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'> {
  return {
    settings: {
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
    agentNameSource: 'settings',
    diagnostics: createDiagnosticsSummary(),
    devOverrideAllowed: true,
    devOverrideConfigured: false,
  }
}

function createReadyState(): CopilotBootstrapState {
  return {
    status: 'ready',
    ...createBaseResolvedState(),
  }
}
