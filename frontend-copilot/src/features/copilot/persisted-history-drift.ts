import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import type { ProviderModelProfile, ProviderProfile, AssistantSessionShell } from '../../workbench/types'
import { resolveThinkingCapability } from '../../workbench/thinking-capabilities'
import type { CopilotModelOption } from './model-picker'

export type PersistedHistoryDriftCode =
  | 'historical_valid_currently_missing'
  | 'historical_provider_removed'
  | 'historical_tool_unregistered'
  | 'historical_thinking_no_longer_supported'

export interface PersistedHistoryDriftWarning {
  code: PersistedHistoryDriftCode
  message: string
}

export interface PersistedHistoryDriftSummary {
  historicalModelId: string | null
  historicalToolIds: string[]
  historicalThinkingSummary: string | null
  warnings: PersistedHistoryDriftWarning[]
  requiresExplicitRebind: boolean
}

export function resolvePersistedHistoryDrift(input: {
  history: AssistantSessionHistoryState | null
  sessionShell: AssistantSessionShell | null
  providerProfiles: ProviderProfile[]
  models: CopilotModelOption[]
}): PersistedHistoryDriftSummary | null {
  const backendSummary = resolveBackendPersistedHistoryDrift(input.history)
  if (backendSummary !== null) {
    return backendSummary
  }

  return evaluatePersistedHistoryDrift(input)
}

export function evaluatePersistedHistoryDrift(input: {
  history: AssistantSessionHistoryState | null
  sessionShell: AssistantSessionShell | null
  providerProfiles: ProviderProfile[]
  models: CopilotModelOption[]
}): PersistedHistoryDriftSummary | null {
  if (input.history === null || input.sessionShell === null) {
    return null
  }

  const snapshot = resolveHistoricalSnapshot(input.history)
  const historicalModelId = normalizeOptionalString(readString(snapshot?.resolvedModelId))
    ?? normalizeOptionalString(input.history.replay?.run.resolvedModelId)
  const historicalToolIds = readStringArray(snapshot?.resolvedToolIds ?? snapshot?.enabledToolIds)
  const historicalThinkingSummary = formatHistoricalThinkingSummary(
    snapshot?.appliedThinkingSelection ?? snapshot?.requestedThinkingSelection,
  )
  const warnings: PersistedHistoryDriftWarning[] = []

  const routeRef = readRouteRef(snapshot?.resolvedModelRoute ?? snapshot?.selectedModelRoute)
  if (historicalModelId !== null || routeRef !== null) {
    const providerProfile = routeRef === null
      ? null
      : input.providerProfiles.find((profile) => profile.id === routeRef.profileId) ?? null
    const matchingModel = findMatchingModel({
      providerProfiles: input.providerProfiles,
      models: input.models,
      routeRef,
      historicalModelId,
    })

    if (routeRef !== null && providerProfile === null) {
      warnings.push({
        code: 'historical_provider_removed',
        message: '历史线程绑定的模型服务商当前已不可用，继续对话前需重新绑定模型。',
      })
    } else if (historicalModelId !== null && matchingModel === null) {
      warnings.push({
        code: 'historical_valid_currently_missing',
        message: `历史线程使用的模型当前不可用：${historicalModelId}`,
      })
    }

    if (historicalThinkingSummary !== null && providerProfile !== null) {
      const modelProfile = resolveProviderModelProfile(providerProfile, routeRef?.modelId ?? historicalModelId)
      if (modelProfile === null) {
        warnings.push({
          code: 'historical_thinking_no_longer_supported',
          message: '历史线程的思考能力当前已无法校验，请重新绑定模型后继续。',
        })
      } else {
        const capability = resolveThinkingCapability({
          providerProfile,
          modelProfile,
        })
        if (!capability.supported) {
          warnings.push({
            code: 'historical_thinking_no_longer_supported',
            message: '历史线程使用的思考能力当前已不再受支持。',
          })
        }
      }
    }
  }

  if (historicalToolIds.length > 0) {
    const availableToolIds = new Set(
      input.sessionShell.capabilities.allAvailableTools.map((tool) => tool.toolId),
    )
    const missingToolIds = historicalToolIds.filter((toolId) => !availableToolIds.has(toolId))
    if (missingToolIds.length > 0) {
      warnings.push({
        code: 'historical_tool_unregistered',
        message: `历史线程使用的工具当前不可用：${missingToolIds.join('、')}`,
      })
    }
  }

  return {
    historicalModelId,
    historicalToolIds,
    historicalThinkingSummary,
    warnings,
    requiresExplicitRebind: warnings.length > 0,
  }
}

function resolveHistoricalSnapshot(
  history: AssistantSessionHistoryState,
): Record<string, unknown> | null {
  const replay = history.replay
  if (history.replayStatus === 'ready' && replay !== null && replay.historicalSnapshot !== null) {
    return { ...replay.historicalSnapshot }
  }

  const latestConfigurationSnapshot = history.latestConfigurationSnapshot
  if (latestConfigurationSnapshot === null) {
    return null
  }

  const modelSnapshot = isRecord(latestConfigurationSnapshot['modelSnapshot'])
    ? latestConfigurationSnapshot['modelSnapshot']
    : null
  const toolsSnapshot = isRecord(latestConfigurationSnapshot['toolsSnapshot'])
    ? latestConfigurationSnapshot['toolsSnapshot']
    : null

  return {
    resolvedModelId: readString(modelSnapshot?.['resolvedModelId']),
    resolvedModelRoute: cloneRecord(modelSnapshot?.['resolvedModelRoute']),
    selectedModelRoute: cloneRecord(modelSnapshot?.['selectedModelRoute']),
    requestedThinkingSelection: cloneRecord(modelSnapshot?.['requestedThinkingSelection']),
    appliedThinkingSelection: cloneRecord(modelSnapshot?.['appliedThinkingSelection']),
    resolvedToolIds: readStringArray(toolsSnapshot?.['resolvedToolIds']),
    enabledToolIds: readStringArray(toolsSnapshot?.['enabledToolIds']),
  }
}

function findMatchingModel(input: {
  providerProfiles: ProviderProfile[]
  models: CopilotModelOption[]
  routeRef: { profileId: string; modelId: string } | null
  historicalModelId: string | null
}): CopilotModelOption | null {
  if (input.routeRef !== null) {
    const exactRouteMatch = input.models.find((model) => (
      model.routeRef?.profileId === input.routeRef?.profileId
      && model.routeRef?.modelId === input.routeRef?.modelId
      && model.available
    ))
    if (exactRouteMatch !== undefined) {
      return exactRouteMatch
    }
  }

  if (input.historicalModelId === null) {
    return null
  }

  const exactModelIdMatch = input.models.find((model) => (
    model.modelId === input.historicalModelId && model.available
  ))
  return exactModelIdMatch ?? null
}

function resolveProviderModelProfile(
  providerProfile: ProviderProfile,
  modelId: string | null | undefined,
): ProviderModelProfile | null {
  const normalizedModelId = normalizeOptionalString(modelId)
  if (normalizedModelId === null) {
    return null
  }

  return providerProfile.availableModels.find((model) => model.modelId === normalizedModelId) ?? null
}

function resolveBackendPersistedHistoryDrift(
  history: AssistantSessionHistoryState | null,
): PersistedHistoryDriftSummary | null {
  if (history === null) {
    return null
  }

  if (history.replayStatus === 'ready' && history.replay !== null) {
    const replaySummary = readBackendPersistedHistoryDriftSummary(history.replay.availabilityInterpretation)
    if (replaySummary !== null) {
      return replaySummary
    }
  }

  return readBackendPersistedHistoryDriftSummary(history.availabilityDrift)
}

function readBackendPersistedHistoryDriftSummary(value: unknown): PersistedHistoryDriftSummary | null {
  const record = isRecord(value) ? value : null
  if (record === null) {
    return null
  }

  const warnings = readWarningArray(record.warnings)
  const requiresExplicitRebind = typeof record.requiresExplicitRebind === 'boolean'
    ? record.requiresExplicitRebind
    : null
  const historicalThinkingSummary = normalizeOptionalString(readString(record.historicalThinkingSummary))
    ?? formatHistoricalThinkingSummary(record.historicalThinkingSelection)
  const hasStructuredConclusion = Array.isArray(record.warnings)
    || requiresExplicitRebind !== null
    || historicalThinkingSummary !== null

  if (!hasStructuredConclusion) {
    return null
  }

  return {
    historicalModelId: normalizeOptionalString(readString(record.historicalModelId)),
    historicalToolIds: readStringArray(record.historicalToolIds),
    historicalThinkingSummary,
    warnings,
    requiresExplicitRebind: requiresExplicitRebind ?? warnings.length > 0,
  }
}

function formatHistoricalThinkingSummary(value: unknown): string | null {
  const record = isRecord(value) ? value : null
  if (record === null) {
    return null
  }

  const series = normalizeOptionalString(readString(record.series))
  const mode = normalizeOptionalString(readString(record.mode))
  const level = normalizeOptionalString(readString(record.level))
  const valueRecord = isRecord(record.value) ? record.value : null
  const valueLabel = normalizeOptionalString(readString(valueRecord?.labelZh))
    ?? normalizeOptionalString(readString(valueRecord?.code))
  const budgetTokens = typeof valueRecord?.budgetTokens === 'number' ? `${valueRecord.budgetTokens} tokens` : null

  return [series, valueLabel, level, mode, budgetTokens]
    .filter((item): item is string => item !== null)
    .join(' / ') || null
}

function readRouteRef(value: unknown): { profileId: string; modelId: string } | null {
  const record = isRecord(value) ? value : null
  const routeRef = isRecord(record?.routeRef) ? record.routeRef : null
  const profileId = normalizeOptionalString(readString(routeRef?.profileId))
  const modelId = normalizeOptionalString(readString(routeRef?.modelId))

  return profileId !== null && modelId !== null
    ? { profileId, modelId }
    : null
}

function readWarningArray(value: unknown): PersistedHistoryDriftWarning[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    const record = isRecord(item) ? item : null
    const code = record === null ? null : normalizePersistedHistoryDriftCode(record.code)
    const message = record === null ? null : normalizeOptionalString(readString(record.message))
    return code !== null && message !== null
      ? [{ code, message }]
      : []
  })
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeOptionalString(readString(item)))
    .filter((item): item is string => item !== null)
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim() ?? ''
  return normalizedValue === '' ? null : normalizedValue
}

function cloneRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {}
}

function normalizePersistedHistoryDriftCode(value: unknown): PersistedHistoryDriftCode | null {
  if (value === 'historical_valid_currently_missing'
    || value === 'historical_provider_removed'
    || value === 'historical_tool_unregistered'
    || value === 'historical_thinking_no_longer_supported') {
    return value
  }
  return null
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
