import type {
  CopilotBootstrapState,
  CopilotDiagnosticsSummary,
} from '../features/copilot/types'

export function createDiagnosticsSummary(
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

export function createBaseResolvedBootstrapState(
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

export function createReadyBootstrapState(
  overrides: Partial<Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'>> = {},
): CopilotBootstrapState {
  return {
    status: 'ready',
    ...createBaseResolvedBootstrapState(overrides),
  }
}
