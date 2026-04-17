import { useEffect, useRef } from 'react'

import type { DesktopNotificationRequest } from '../../../electron/desktop-notification'
import type { CopilotAssistantSegment } from './run-segment-types'
import type { CopilotRunState } from './types'

interface UseAssistantMessageNotificationInput {
  language?: string
  notificationsEnabled: boolean
  runState: CopilotRunState
}

interface AssistantMessageNotificationCopy {
  successTitle: string
  failureTitle: string
  successBodyFallback: string
  failureBodyFallback: string
}

const assistantMessageNotificationCopyByLanguage: Record<string, AssistantMessageNotificationCopy> = {
  'zh-CN': {
    successTitle: '助手消息已完成',
    failureTitle: '助手执行失败',
    successBodyFallback: 'AI 助手已返回新的消息。',
    failureBodyFallback: 'AI 助手执行失败，请返回聊天界面查看详情。',
  },
  'en-US': {
    successTitle: 'Assistant Message Completed',
    failureTitle: 'Assistant Execution Failed',
    successBodyFallback: 'The AI assistant has returned a new message.',
    failureBodyFallback: 'The AI assistant failed to finish. Open the chat view for details.',
  },
}

export function useAssistantMessageNotification({
  language = 'zh-CN',
  notificationsEnabled,
  runState,
}: UseAssistantMessageNotificationInput): void {
  const previousPhaseRef = useRef(runState.phase)
  const previousRunIdRef = useRef<string | null>(runState.runId)
  const lastHandledTransitionRef = useRef<string | null>(null)

  useEffect(() => {
    const previousPhase = previousPhaseRef.current
    const previousRunId = previousRunIdRef.current
    const nextPhase = runState.phase
    const nextRunId = runState.runId

    previousPhaseRef.current = nextPhase
    previousRunIdRef.current = nextRunId

    if (!notificationsEnabled || typeof window === 'undefined' || nextRunId === null) {
      return
    }

    if (!isAssistantRunTerminalPhase(nextPhase) || isAssistantRunTerminalPhase(previousPhase)) {
      return
    }

    if (previousRunId !== nextRunId) {
      return
    }

    const transitionKey = `${nextRunId}:${previousPhase}->${nextPhase}`
    if (lastHandledTransitionRef.current === transitionKey) {
      return
    }
    lastHandledTransitionRef.current = transitionKey

    const request = createAssistantMessageNotificationRequest(language, runState)
    void showAssistantMessageNotification(request)
  }, [language, notificationsEnabled, runState])
}

function createAssistantMessageNotificationRequest(
  language: string,
  runState: CopilotRunState,
): DesktopNotificationRequest {
  const copy = getAssistantMessageNotificationCopy(language)
  const effectivePhase = resolveAssistantNotificationPhase(runState)
  const title = effectivePhase === 'completed' ? copy.successTitle : copy.failureTitle
  const body = effectivePhase === 'completed'
    ? resolveAssistantSuccessBody(runState, copy)
    : resolveAssistantFailureBody(runState, copy)

  return {
    title,
    body,
    tag: `${runState.runId}:${effectivePhase}`,
  }
}

async function showAssistantMessageNotification(request: DesktopNotificationRequest): Promise<void> {
  const api = getDesktopNotificationApi()
  if (api === undefined) {
    return
  }

  try {
    await api.show(request)
  } catch (error) {
    console.warn('[assistant-notification] Failed to show desktop notification.', error)
  }
}

function getDesktopNotificationApi() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.desktopNotification
}

function isAssistantRunTerminalPhase(phase: CopilotRunState['phase']): phase is 'completed' | 'failed' {
  return phase === 'completed' || phase === 'failed'
}

function resolveAssistantNotificationPhase(runState: CopilotRunState): 'completed' | 'failed' {
  if (runState.phase !== 'completed') {
    return 'failed'
  }

  return hasFailedToolSegment(runState) ? 'failed' : 'completed'
}

function resolveAssistantSuccessBody(
  runState: CopilotRunState,
  copy: AssistantMessageNotificationCopy,
): string {
  const assistantText = getLatestAssistantSegment(runState)?.text.trim() ?? ''
  return assistantText.length > 0 ? assistantText : copy.successBodyFallback
}

function resolveAssistantFailureBody(
  runState: CopilotRunState,
  copy: AssistantMessageNotificationCopy,
): string {
  const toolFailureMessage = getLatestFailedToolMessage(runState)
  if (toolFailureMessage !== null) {
    return toolFailureMessage
  }

  const rawMessage = readFailureDetailString(runState.failure?.details, '__copilotMeta_rawMessage')
  if (rawMessage !== null) {
    return rawMessage
  }

  const message = runState.failure?.message?.trim() ?? ''
  return message.length > 0 ? message : copy.failureBodyFallback
}

function getLatestAssistantSegment(runState: CopilotRunState): CopilotAssistantSegment | null {
  for (let index = runState.segments.length - 1; index >= 0; index -= 1) {
    const segment = runState.segments[index]
    if (segment?.kind === 'assistant') {
      return segment
    }
  }

  return null
}

function hasFailedToolSegment(runState: CopilotRunState): boolean {
  return runState.segments.some((segment) => segment.kind === 'tool' && segment.status === 'failed')
}

function getLatestFailedToolMessage(runState: CopilotRunState): string | null {
  for (let index = runState.segments.length - 1; index >= 0; index -= 1) {
    const segment = runState.segments[index]
    if (segment?.kind !== 'tool' || segment.status !== 'failed') {
      continue
    }

    const errorSummary = segment.errorSummary?.trim() ?? ''
    if (errorSummary.length > 0) {
      return `Tool failed: ${errorSummary}`
    }
  }

  return null
}

function readFailureDetailString(
  details: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = details?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getAssistantMessageNotificationCopy(language: string): AssistantMessageNotificationCopy {
  return assistantMessageNotificationCopyByLanguage[language] ?? assistantMessageNotificationCopyByLanguage['zh-CN']
}
