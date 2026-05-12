import type { ConfigCenterPublicSnapshot } from '../../../electron/config-center/public-snapshot'
import { loadConfigCenterPublicSnapshot } from './config-center'
import { loadCopilotRuntime, retryCopilotRuntime } from './runtime'
import type {
  CopilotAgentNameSource,
  CopilotBootstrapFields,
  CopilotBootstrapFieldsLoadResult,
  CopilotConfigMissingField,
  CopilotConfigState,
  CopilotDiagnosticsSummary,
  CopilotRendererRuntimeLoadResult,
  CopilotRendererRuntimeSnapshot,
  CopilotRuntimeSource,
} from './types'

export function normalizeCopilotBootstrapFields(
  fields: Partial<CopilotBootstrapFields> | null | undefined,
): CopilotBootstrapFields {
  return {
    runtimeUrl: normalizeOptionalString(fields?.runtimeUrl),
    agentName: normalizeOptionalString(fields?.agentName),
    debugModeEnabled: fields?.debugModeEnabled === true,
  }
}

export function getMissingCopilotConfigFields(
  fields: CopilotBootstrapFields,
): CopilotConfigMissingField[] {
  const missingFields: CopilotConfigMissingField[] = []

  if (fields.runtimeUrl === null) {
    missingFields.push('runtimeUrl')
  }

  return missingFields
}

export function resolveCopilotConfigState(input: {
  bootstrapFieldsResult: CopilotBootstrapFieldsLoadResult
  runtimeResult: CopilotRendererRuntimeLoadResult
}): CopilotConfigState {
  if (!input.bootstrapFieldsResult.ok) {
    return { status: 'error', error: input.bootstrapFieldsResult.error }
  }

  if (!input.runtimeResult.ok) {
    return { status: 'error', error: input.runtimeResult.error }
  }

  const bootstrapFields = normalizeCopilotBootstrapFields(input.bootstrapFieldsResult.fields)
  const runtime = input.runtimeResult.snapshot.hosted
  const devOverrideAllowed = !runtime.isPackaged && runtime.expectedMode === 'development'
  const devOverrideConfigured = devOverrideAllowed && bootstrapFields.runtimeUrl !== null
  const runtimeSelection = resolveRuntimeSelection({
    runtime,
    bootstrapFields,
    devOverrideConfigured,
  })
  const agentName = bootstrapFields.agentName
  const agentNameSource: CopilotAgentNameSource = agentName === null ? 'missing' : 'config-center'
  const diagnostics = buildCopilotDiagnosticsSummary({
    runtime,
    runtimeSource: runtimeSelection.runtimeSource,
  })
  const baseState = {
    bootstrapFields,
    storageState: input.bootstrapFieldsResult.storageState,
    runtime,
    runtimeUrl: runtimeSelection.runtimeUrl,
    runtimeSource: runtimeSelection.runtimeSource,
    agentName,
    agentNameSource,
    diagnostics,
    devOverrideAllowed,
    devOverrideConfigured,
  }
  const isDevOverride = runtimeSelection.runtimeSource === 'dev-override'

  switch (runtime.status) {
    case 'ready':
      return resolveReadyLikeState(baseState, 'ready')
    case 'starting':
      return { ...baseState, status: 'starting' }
    case 'degraded':
      return resolveReadyLikeState(baseState, 'degraded')
    case 'failed':
      if (isDevOverride) {
        return resolveReadyLikeState(baseState, 'ready')
      }
      return { ...baseState, status: 'failed' }
    case 'stopped':
      if (isDevOverride) {
        return resolveReadyLikeState(baseState, 'ready')
      }
      return resolveStoppedState(baseState)
  }
}

export async function loadCopilotConfigState(): Promise<CopilotConfigState> {
  const [bootstrapFieldsResult, runtimeResult] = await Promise.all([
    loadBootstrapFields(),
    loadCopilotRuntime(),
  ])

  return resolveCopilotConfigState({
    bootstrapFieldsResult,
    runtimeResult,
  })
}

export async function loadCopilotConfigStateFromPublicSnapshot(
  snapshot: ConfigCenterPublicSnapshot,
): Promise<CopilotConfigState> {
  const [bootstrapFieldsResult, runtimeResult] = await Promise.all([
    Promise.resolve(loadBootstrapFieldsFromConfigCenterPublicSnapshot(snapshot)),
    loadCopilotRuntime(),
  ])

  return resolveCopilotConfigState({
    bootstrapFieldsResult,
    runtimeResult,
  })
}

export async function retryCopilotConfigState(): Promise<CopilotConfigState> {
  const [bootstrapFieldsResult, runtimeResult] = await Promise.all([
    loadBootstrapFields(),
    retryCopilotRuntime(),
  ])

  return resolveCopilotConfigState({
    bootstrapFieldsResult,
    runtimeResult,
  })
}

async function loadBootstrapFields(): Promise<CopilotBootstrapFieldsLoadResult> {
  const snapshotResult = await loadConfigCenterPublicSnapshot()

  if (!snapshotResult.ok) {
    return {
      ok: false,
      error: snapshotResult.error,
    }
  }

  return loadBootstrapFieldsFromConfigCenterPublicSnapshot(snapshotResult.snapshot)
}

export function loadBootstrapFieldsFromConfigCenterPublicSnapshot(
  snapshot: ConfigCenterPublicSnapshot,
): CopilotBootstrapFieldsLoadResult {
  const fields = normalizeCopilotBootstrapFields({
    runtimeUrl: snapshot.domains.hostConfig.runtimeUrl,
    agentName: snapshot.domains.assistantBehavior.agentName,
    debugModeEnabled: snapshot.domains.assistantBehavior.debugModeEnabled,
  })

  return {
    ok: true,
    fields,
    storageState: fields.runtimeUrl === null ? 'empty' : 'stored',
  }
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
  bootstrapFields: CopilotBootstrapFields
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
          runtimeUrl: input.bootstrapFields.runtimeUrl,
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
}): CopilotConfigMissingField[] {
  const missingFields: CopilotConfigMissingField[] = []

  if (input.runtimeUrl === null) {
    missingFields.push('runtimeUrl')
  }

  return missingFields
}

function resolveReadyLikeState(
  baseState: Omit<CopilotConfigState, 'status'> & { runtimeUrl: string | null },
  status: 'ready' | 'degraded',
): CopilotConfigState {
  const missingFields = getMissingReadyStateFields(baseState)

  if (missingFields.length > 0) {
    return { ...baseState, status: 'incomplete', missingFields } as CopilotConfigState
  }

  return { ...baseState, status, runtimeUrl: baseState.runtimeUrl! } as CopilotConfigState
}

function resolveStoppedState(
  baseState: Omit<CopilotConfigState, 'status'> & { runtimeUrl: string | null },
): CopilotConfigState {
  const missingFields = getMissingReadyStateFields(baseState)

  if (missingFields.length === 1 && missingFields[0] === 'runtimeUrl') {
    return { ...baseState, status: 'empty', missingFields } as CopilotConfigState
  }

  return { ...baseState, status: 'incomplete', missingFields } as CopilotConfigState
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}
