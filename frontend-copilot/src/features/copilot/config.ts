import { loadCopilotRuntime, retryCopilotRuntime } from './runtime'
import { loadCopilotSettings } from './settings'
import type {
  CopilotAgentNameSource,
  CopilotConfigMissingField,
  CopilotConfigState,
  CopilotDiagnosticsSummary,
  CopilotNormalizedSettings,
  CopilotRendererRuntimeLoadResult,
  CopilotRendererRuntimeSnapshot,
  CopilotRendererSettings,
  CopilotRendererSettingsLoadResult,
  CopilotRuntimeSource,
} from './types'

export function normalizeCopilotSettings(
  settings: Partial<CopilotRendererSettings> | null | undefined,
): CopilotNormalizedSettings {
  return {
    runtimeUrl: normalizeOptionalString(settings?.runtimeUrl),
    agentName: normalizeOptionalString(settings?.agentName),
  }
}

export function getMissingCopilotConfigFields(
  settings: CopilotNormalizedSettings,
): CopilotConfigMissingField[] {
  const missingFields: CopilotConfigMissingField[] = []

  if (settings.runtimeUrl === null) {
    missingFields.push('runtimeUrl')
  }

  if (settings.agentName === null) {
    missingFields.push('agentName')
  }

  return missingFields
}

export function resolveCopilotConfigState(input: {
  settingsResult: CopilotRendererSettingsLoadResult
  runtimeResult: CopilotRendererRuntimeLoadResult
}): CopilotConfigState {
  if (!input.settingsResult.ok) {
    return {
      status: 'error',
      error: input.settingsResult.error,
    }
  }

  if (!input.runtimeResult.ok) {
    return {
      status: 'error',
      error: input.runtimeResult.error,
    }
  }

  const settings = normalizeCopilotSettings(input.settingsResult.settings)
  const runtime = input.runtimeResult.snapshot.hosted
  const devOverrideAllowed = !runtime.isPackaged && runtime.expectedMode === 'development'
  const devOverrideConfigured = devOverrideAllowed && settings.runtimeUrl !== null
  const runtimeSelection = resolveRuntimeSelection({
    runtime,
    settings,
    devOverrideConfigured,
  })
  const agentName = settings.agentName
  const agentNameSource: CopilotAgentNameSource = agentName === null ? 'missing' : 'settings'
  const diagnostics = buildCopilotDiagnosticsSummary({
    runtime,
    runtimeSource: runtimeSelection.runtimeSource,
  })
  const baseState = {
    settings,
    storageState: input.settingsResult.storageState,
    runtime,
    runtimeUrl: runtimeSelection.runtimeUrl,
    runtimeSource: runtimeSelection.runtimeSource,
    agentName,
    agentNameSource,
    diagnostics,
    devOverrideAllowed,
    devOverrideConfigured,
  }

  switch (runtime.status) {
    case 'ready': {
      const missingFields = getMissingReadyStateFields(baseState)

      if (missingFields.length > 0) {
        return {
          ...baseState,
          status: 'incomplete',
          missingFields,
        }
      }

      return {
        ...baseState,
        status: 'ready',
        runtimeUrl: baseState.runtimeUrl!,
        agentName: baseState.agentName!,
      }
    }

    case 'starting':
      return {
        ...baseState,
        status: 'starting',
      }

    case 'degraded': {
      const missingFields = getMissingReadyStateFields(baseState)

      if (missingFields.length > 0) {
        return {
          ...baseState,
          status: 'incomplete',
          missingFields,
        }
      }

      return {
        ...baseState,
        status: 'degraded',
        runtimeUrl: baseState.runtimeUrl!,
        agentName: baseState.agentName!,
      }
    }

    case 'failed':
      if (runtimeSelection.runtimeSource === 'dev-override') {
        const missingFields = getMissingReadyStateFields(baseState)

        if (missingFields.length > 0) {
          return {
            ...baseState,
            status: 'incomplete',
            missingFields,
          }
        }

        return {
          ...baseState,
          status: 'ready',
          runtimeUrl: baseState.runtimeUrl!,
          agentName: baseState.agentName!,
        }
      }

      return {
        ...baseState,
        status: 'failed',
      }

    case 'stopped': {
      if (runtimeSelection.runtimeSource === 'dev-override') {
        const missingFields = getMissingReadyStateFields(baseState)

        if (missingFields.length > 0) {
          return {
            ...baseState,
            status: 'incomplete',
            missingFields,
          }
        }

        return {
          ...baseState,
          status: 'ready',
          runtimeUrl: baseState.runtimeUrl!,
          agentName: baseState.agentName!,
        }
      }

      const missingFields = getMissingReadyStateFields(baseState)

      if (missingFields.length === 2) {
        return {
          ...baseState,
          status: 'empty',
          missingFields,
        }
      }

      return {
        ...baseState,
        status: 'incomplete',
        missingFields,
      }
    }
  }
}

export async function loadCopilotConfigState(): Promise<CopilotConfigState> {
  const [settingsResult, runtimeResult] = await Promise.all([
    loadCopilotSettings(),
    loadCopilotRuntime(),
  ])

  return resolveCopilotConfigState({
    settingsResult,
    runtimeResult,
  })
}

export async function retryCopilotConfigState(): Promise<CopilotConfigState> {
  const [settingsResult, runtimeResult] = await Promise.all([
    loadCopilotSettings(),
    retryCopilotRuntime(),
  ])

  return resolveCopilotConfigState({
    settingsResult,
    runtimeResult,
  })
}

function buildCopilotDiagnosticsSummary(input: {
  runtime: CopilotRendererRuntimeSnapshot
  runtimeSource: CopilotRuntimeSource
}): CopilotDiagnosticsSummary {
  return {
    hostedStatus: input.runtime.status,
    failure: input.runtime.failure,
    mode: input.runtime.resolvedMode ?? input.runtime.expectedMode,
    modeSource: input.runtime.resolvedMode === null ? 'expected' : 'resolved',
    runtimeSource: input.runtimeSource,
  }
}

function resolveRuntimeSelection(input: {
  runtime: CopilotRendererRuntimeSnapshot
  settings: CopilotNormalizedSettings
  devOverrideConfigured: boolean
}): {
  runtimeSource: CopilotRuntimeSource
  runtimeUrl: string | null
} {
  switch (input.runtime.status) {
    case 'ready':
    case 'starting':
    case 'degraded':
      return {
        runtimeSource: 'hosted',
        runtimeUrl: input.runtime.runtimeUrl,
      }

    case 'failed':
    case 'stopped':
      if (input.devOverrideConfigured) {
        return {
          runtimeSource: 'dev-override',
          runtimeUrl: input.settings.runtimeUrl,
        }
      }

      return {
        runtimeSource: 'none',
        runtimeUrl: null,
      }
  }
}

function getMissingReadyStateFields(input: {
  runtimeUrl: string | null
  agentName: string | null
}): CopilotConfigMissingField[] {
  const missingFields: CopilotConfigMissingField[] = []

  if (input.runtimeUrl === null) {
    missingFields.push('runtimeUrl')
  }

  if (input.agentName === null) {
    missingFields.push('agentName')
  }

  return missingFields
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}
