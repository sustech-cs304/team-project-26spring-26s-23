import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'

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

interface PersistedHistoryDriftInputShape {
  history: AssistantSessionHistoryState | null
}

export function resolvePersistedHistoryDrift(
  input: AssistantSessionHistoryState | null | PersistedHistoryDriftInputShape,
): PersistedHistoryDriftSummary | null {
  const history = readHistoryInput(input)
  if (history === null) {
    return null
  }

  if (history.replayStatus === 'ready' && history.replay !== null) {
    const replaySummary = readBackendPersistedHistoryDriftSummary(history.replay.availabilityInterpretation)
    if (replaySummary !== null) {
      return replaySummary
    }
  }

  const detailSummary = readBackendPersistedHistoryDriftSummary(history.availabilityDrift)
  if (detailSummary !== null) {
    return detailSummary
  }

  return readBackendPersistedHistoryDriftSummary(history.summary.driftSummary)
}

export function evaluatePersistedHistoryDrift(
  input: AssistantSessionHistoryState | null | PersistedHistoryDriftInputShape,
): PersistedHistoryDriftSummary | null {
  return resolvePersistedHistoryDrift(input)
}

function readHistoryInput(
  input: AssistantSessionHistoryState | null | PersistedHistoryDriftInputShape,
): AssistantSessionHistoryState | null {
  if (isRecord(input) && 'history' in input) {
    const history = input.history
    return isRecord(history) ? history as AssistantSessionHistoryState : null
  }

  return isRecord(input) ? input as AssistantSessionHistoryState : null
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
  const historicalModelId = normalizeOptionalString(readString(record.historicalModelId))
  const historicalToolIds = readStringArray(record.historicalToolIds)
  const hasStructuredConclusion = Array.isArray(record.warnings)
    || requiresExplicitRebind !== null
    || historicalThinkingSummary !== null
    || historicalModelId !== null
    || historicalToolIds.length > 0

  if (!hasStructuredConclusion) {
    return null
  }

  return {
    historicalModelId,
    historicalToolIds,
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

function normalizePersistedHistoryDriftCode(value: unknown): PersistedHistoryDriftCode | null {
  if (value === 'historical_valid_currently_missing'
    || value === 'historical_provider_removed'
    || value === 'historical_tool_unregistered'
    || value === 'historical_thinking_no_longer_supported') {
    return value
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
