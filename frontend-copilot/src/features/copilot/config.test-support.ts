import type { ConfigCenterPublicSnapshot } from '../../../electron/config-center/public-snapshot'
import type {
  CopilotBootstrapFieldsLoadResult,
  CopilotBootstrapFieldsStorageState,
  CopilotRendererRuntimeLoadResult,
  CopilotRendererRuntimeSnapshot,
} from './types'

export type RuntimeModule = typeof import('./runtime')

export function createBootstrapFieldsResult(
  fields: Partial<{ runtimeUrl: string | null; agentName: string | null; debugModeEnabled: boolean }> = {},
  storageState: CopilotBootstrapFieldsStorageState = 'stored',
): CopilotBootstrapFieldsLoadResult {
  return {
    ok: true,
    fields: {
      runtimeUrl: fields.runtimeUrl ?? null,
      agentName: fields.agentName ?? null,
      debugModeEnabled: fields.debugModeEnabled ?? false,
    },
    storageState,
  }
}

export function createRuntimeResult(
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

export function createConfigCenterPublicSnapshot(
  overrides: Partial<{
    theme: ConfigCenterPublicSnapshot['domains']['frontendPreferences']['theme']
    animationsEnabled: boolean
    agentName: string | null
    debugModeEnabled: boolean
    runtimeUrl: string | null
    model: string | null
  }> = {},
): ConfigCenterPublicSnapshot {
  return {
    version: 1,
    domains: {
      frontendPreferences: {
        theme: overrides.theme ?? 'dark',
        animationsEnabled: overrides.animationsEnabled ?? true,
      },
      assistantBehavior: {
        agentName: overrides.agentName ?? null,
        debugModeEnabled: overrides.debugModeEnabled ?? false,
      },
      hostConfig: {
        runtimeUrl: overrides.runtimeUrl ?? null,
      },
      backendExposed: {
        model: overrides.model ?? null,
      },
      general: {
        language: 'zh-CN',
      },
    },
  }
}
