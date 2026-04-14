import { useEffect, useRef } from 'react'

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
  const lastNotifiedRunKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!notificationsEnabled) {
      return
    }

    const notificationApi = globalThis.Notification
    if (typeof window === 'undefined' || notificationApi === undefined || runState.runId === null) {
      return
    }

    if (runState.phase !== 'completed' && runState.phase !== 'failed') {
      return
    }

    const notificationKey = `${runState.runId}:${runState.phase}:${runState.segments.length}`
    if (lastNotifiedRunKeyRef.current === notificationKey) {
      return
    }
    lastNotifiedRunKeyRef.current = notificationKey

    if (notificationApi.permission === 'default') {
      void notificationApi.requestPermission().then((permission) => {
        if (permission === 'granted') {
          showAssistantMessageNotification(notificationApi, language, runState)
        }
      }).catch(() => undefined)
      return
    }

    if (notificationApi.permission !== 'granted') {
      return
    }

    showAssistantMessageNotification(notificationApi, language, runState)
  }, [language, notificationsEnabled, runState])
}

function showAssistantMessageNotification(
  notificationApi: typeof Notification,
  language: string,
  runState: CopilotRunState,
) {
  const copy = getAssistantMessageNotificationCopy(language)
  const title = runState.phase === 'completed' ? copy.successTitle : copy.failureTitle
  const body = runState.phase === 'completed'
    ? resolveAssistantSuccessBody(runState, copy)
    : resolveAssistantFailureBody(runState, copy)

  new notificationApi(title, {
    body,
    tag: `${runState.runId}:${runState.phase}`,
  })
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

function getAssistantMessageNotificationCopy(language: string): AssistantMessageNotificationCopy {
  return assistantMessageNotificationCopyByLanguage[language] ?? assistantMessageNotificationCopyByLanguage['zh-CN']
}
