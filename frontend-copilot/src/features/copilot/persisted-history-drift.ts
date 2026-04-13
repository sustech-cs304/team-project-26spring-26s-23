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
  if (history.replayStatus === 'ready' && history.replay?.historicalSnapshot !== null) {
    return { ...history.replay.historicalSnapshot }
  }

  const latestConfigurationSnapshot = history.latestConfigurationSnapshot
  if (latestConfigurationSnapshot === null) {
    return null
  }

  return {
    resolvedModelId: readString(latestConfigurationSnapshot.modelSnapshot?.resolvedModelId),
    resolvedModelRoute: cloneRecord(latestConfigurationSnapshot.modelSnapshot?.resolvedModelRoute),
    selectedModelRoute: cloneRecord(latestConfigurationSnapshot.modelSnapshot?.selectedModelRoute),
    requestedThinkingSelection: cloneRecord(latestConfigurationSnapshot.modelSnapshot?.requestedThinkingSelection),
    appliedThinkingSelection: cloneRecord(latestConfigurationSnapshot.modelSnapshot?.appliedThinkingSelection),
    resolvedToolIds: readStringArray(latestConfigurationSnapshot.toolsSnapshot?.resolvedToolIds),
    enabledToolIds: readStringArray(latestConfigurationSnapshot.toolsSnapshot?.enabledToolIds),
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

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
