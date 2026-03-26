/**
 * Legacy disk schema for pre-unified-config Copilot settings files.
 * Main-process internal only; renderer code must use config center public APIs.
 */
export interface CopilotSettings {
  runtimeUrl: string | null
  agentName: string | null
}

export function normalizeCopilotSettings(input: unknown): CopilotSettings {
  const record = typeof input === 'object' && input !== null
    ? input as Record<string, unknown>
    : {}

  return {
    runtimeUrl: normalizeOptionalString(record.runtimeUrl),
    agentName: normalizeOptionalString(record.agentName),
  }
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()

  return normalizedValue.length > 0 ? normalizedValue : null
}
