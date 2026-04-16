import type { AssistantSessionShell } from '../types'

export interface AssistantSessionContextMenuState {
  sessionId: string
  sessionLabel: string
  x: number
  y: number
}

export interface AssistantSessionDragState {
  draggingSessionId: string
  previewIndex: number
}

export interface AssistantSessionMenuAction {
  label: string
  testId: string
}

export const assistantSessionPrimaryActions: AssistantSessionMenuAction[] = [
  {
    label: '重命名会话',
    testId: 'assistant-session-context-action-rename',
  },
  {
    label: '删除会话',
    testId: 'assistant-session-context-action-delete',
  },
  {
    label: '复制为新会话',
    testId: 'assistant-session-context-action-copy-session',
  },
]

export function getAssistantSessionDropGapTestId(index: number): string {
  return `assistant-session-drop-gap-${index}`
}

export function getAssistantSessionListItemTestId(sessionId: string): string {
  return `assistant-session-list-item-${sessionId}`
}

export function getAssistantSessionCardTestId(sessionId: string): string {
  return `assistant-session-card-${sessionId}`
}

export function getAssistantSessionRenameInputTestId(sessionId: string): string {
  return `assistant-session-rename-input-${sessionId}`
}

export function resolveAssistantSessionActiveState(
  sessionEntry: AssistantSessionShell,
  activeSessionId: string | null,
): boolean {
  return sessionEntry.sessionId === activeSessionId
}
