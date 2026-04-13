export interface AssistantWorkspaceShellState {
  selectedThreadId: string | null
  selectedRunIdByThreadId: Record<string, string>
}

const ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY = 'candue:assistant-workspace-shell:v1'

export function createEmptyAssistantWorkspaceShellState(): AssistantWorkspaceShellState {
  return {
    selectedThreadId: null,
    selectedRunIdByThreadId: {},
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
