import type { CopilotHistoryThreadSummary } from '../../../electron/copilot-history'

export interface AssistantWorkspaceShellState {
  selectedThreadId: string | null
  selectedRunIdByThreadId: Record<string, string>
  threadSummaries: CopilotHistoryThreadSummary[]
}

const ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY = 'candue:assistant-workspace-shell:v1'

export function createEmptyAssistantWorkspaceShellState(): AssistantWorkspaceShellState {
  return {
    selectedThreadId: null,
    selectedRunIdByThreadId: {},
    threadSummaries: [],
  }
}

export function loadAssistantWorkspaceShellState(
  storage: Pick<Storage, 'getItem'> | null = getAssistantWorkspaceShellStateStorage(),
): AssistantWorkspaceShellState {
  if (storage === null) {
    return createEmptyAssistantWorkspaceShellState()
  }

  try {
    const rawValue = storage.getItem(ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY)
    if (rawValue === null) {
      return createEmptyAssistantWorkspaceShellState()
    }

    const parsedValue = JSON.parse(rawValue)
    return parseAssistantWorkspaceShellState(parsedValue)
  } catch {
    return createEmptyAssistantWorkspaceShellState()
  }
}

export function persistAssistantWorkspaceShellState(
  state: AssistantWorkspaceShellState,
  storage: Pick<Storage, 'setItem'> | null = getAssistantWorkspaceShellStateStorage(),
): void {
  if (storage === null) {
    return
  }

  storage.setItem(
    ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY,
    JSON.stringify({
      selectedThreadId: normalizeOptionalString(state.selectedThreadId),
      selectedRunIdByThreadId: filterStringRecord(state.selectedRunIdByThreadId),
      threadSummaries: filterThreadSummaries(state.threadSummaries),
    }),
  )
}

function parseAssistantWorkspaceShellState(value: unknown): AssistantWorkspaceShellState {
  if (!isRecord(value)) {
    return createEmptyAssistantWorkspaceShellState()
  }

  return {
    selectedThreadId: normalizeOptionalString(value.selectedThreadId),
    selectedRunIdByThreadId: filterStringRecord(value.selectedRunIdByThreadId),
    threadSummaries: filterThreadSummaries(value.threadSummaries),
  }
}

function filterThreadSummaries(value: unknown): CopilotHistoryThreadSummary[] {
  if (!Array.isArray(value)) {
    return []
  }

  const nextSummaries: CopilotHistoryThreadSummary[] = []
  for (const item of value) {
    const normalizedSummary = normalizeThreadSummary(item)
    if (normalizedSummary !== null) {
      nextSummaries.push(normalizedSummary)
    }
  }

  return nextSummaries
}

function normalizeThreadSummary(value: unknown): CopilotHistoryThreadSummary | null {
  if (!isRecord(value)) {
    return null
  }

  const threadId = normalizeOptionalString(value.threadId)
  const boundAgentId = normalizeOptionalString(value.boundAgentId)
  const createdAt = normalizeOptionalString(value.createdAt)
  const updatedAt = normalizeOptionalString(value.updatedAt)
  if (threadId === null || boundAgentId === null || createdAt === null || updatedAt === null) {
    return null
  }

  return {
    threadId,
    boundAgentId,
    title: normalizeOptionalString(value.title),
    titleSource: normalizeOptionalString(value.titleSource),
    summary: normalizeOptionalString(value.summary),
    summarySource: normalizeOptionalString(value.summarySource),
    createdAt,
    updatedAt,
    lastActivityAt: normalizeOptionalString(value.lastActivityAt),
    lastRunId: normalizeOptionalString(value.lastRunId),
    lastRunStatus: normalizeOptionalString(value.lastRunStatus),
    lastUserMessagePreview: normalizeOptionalString(value.lastUserMessagePreview),
    lastAssistantMessagePreview: normalizeOptionalString(value.lastAssistantMessagePreview),
    driftSummary: cloneOptionalRecord(value.driftSummary),
  }
}

function filterStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }

  const nextRecord: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = key.trim()
    const normalizedValue = normalizeOptionalString(item)
    if (normalizedKey !== '' && normalizedValue !== null) {
      nextRecord[normalizedKey] = normalizedValue
    }
  }

  return nextRecord
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}

function cloneOptionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? { ...value } : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getAssistantWorkspaceShellStateStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof globalThis === 'object' && 'localStorage' in globalThis
      ? globalThis.localStorage
      : null
  } catch {
    return null
  }
}

export { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY }
