import type { AssistantSessionShell } from '../types'

export type AssistantSessionContextSubmenu = 'copy' | 'export'

export interface AssistantSessionContextMenuState {
  sessionId: string
  sessionLabel: string
  x: number
  y: number
  activeSubmenu: AssistantSessionContextSubmenu | null
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
    label: '生成会话名',
    testId: 'assistant-session-context-action-generate-title',
  },
]

export const assistantSessionCopyActions: AssistantSessionMenuAction[] = [
  {
    label: '复制为新会话',
    testId: 'assistant-session-context-action-copy-session',
  },
  {
    label: '复制为 Markdown',
    testId: 'assistant-session-context-action-copy-markdown',
  },
  {
    label: '复制为纯文本',
    testId: 'assistant-session-context-action-copy-text',
  },
]

export const assistantSessionExportActions: AssistantSessionMenuAction[] = [
  {
    label: '导出到 Markdown',
    testId: 'assistant-session-context-action-export-markdown',
  },
  {
    label: '导出到 JSON',
    testId: 'assistant-session-context-action-export-json',
  },
  {
    label: '导出为纯文本',
    testId: 'assistant-session-context-action-export-text',
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
