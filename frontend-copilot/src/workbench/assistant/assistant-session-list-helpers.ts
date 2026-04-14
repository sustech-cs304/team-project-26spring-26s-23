import { getAssistantSessionCopy } from '../locale'
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

export function getAssistantSessionPrimaryActions(language: string): AssistantSessionMenuAction[] {
  const copy = getAssistantSessionCopy(language)

  return [
    {
      label: copy.contextMenu.renameSession,
      testId: 'assistant-session-context-action-rename',
    },
    {
      label: copy.contextMenu.deleteSession,
      testId: 'assistant-session-context-action-delete',
    },
    {
      label: copy.contextMenu.generateSessionTitle,
      testId: 'assistant-session-context-action-generate-title',
    },
  ]
}

export function getAssistantSessionCopyActions(language: string): AssistantSessionMenuAction[] {
  const copy = getAssistantSessionCopy(language)

  return [
    {
      label: copy.contextMenu.copyAsNewSession,
      testId: 'assistant-session-context-action-copy-session',
    },
    {
      label: copy.contextMenu.copyAsMarkdown,
      testId: 'assistant-session-context-action-copy-markdown',
    },
    {
      label: copy.contextMenu.copyAsPlainText,
      testId: 'assistant-session-context-action-copy-text',
    },
  ]
}

export function getAssistantSessionExportActions(language: string): AssistantSessionMenuAction[] {
  const copy = getAssistantSessionCopy(language)

  return [
    {
      label: copy.contextMenu.exportToMarkdown,
      testId: 'assistant-session-context-action-export-markdown',
    },
    {
      label: copy.contextMenu.exportToJson,
      testId: 'assistant-session-context-action-export-json',
    },
    {
      label: copy.contextMenu.exportAsPlainText,
      testId: 'assistant-session-context-action-export-text',
    },
  ]
}

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
