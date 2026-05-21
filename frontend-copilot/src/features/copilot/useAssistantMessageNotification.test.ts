/** @vitest-environment jsdom */

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CopilotAssistantSegment } from './run-segment-types'
import type { CopilotRunState } from './types'

import { useAssistantMessageNotification } from './useAssistantMessageNotification'

const LABEL_RUN_ID = 'run-1'
const LABEL_THREAD_ID = 'thread-1'

function createRunState(overrides: Partial<CopilotRunState> = {}): CopilotRunState {
  return {
    phase: 'idle',
    runId: LABEL_RUN_ID,
    threadId: LABEL_THREAD_ID,
    activeModelRoute: null,
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
    requestedThinkingSelection: null,
    appliedThinkingSelection: null,
    requestedThinkingLevel: null,
    appliedThinkingLevel: null,
    thinkingCapabilitySnapshot: null,
    thinkingSeriesDecision: null,
    reasoningSuppressionBasis: null,
    reasoningSuppressed: false,
    reasoningTraceState: 'not_observed',
    diagnostic: null,
    failure: null,
    cancelReason: null,
    segments: [],
    ...overrides,
  }
}

function createAssistantSegment(
  overrides: Partial<CopilotAssistantSegment> = {},
): CopilotAssistantSegment {
  return {
    id: 'assistant:1',
    kind: 'assistant',
    runId: LABEL_RUN_ID,
    startedSequence: 1,
    lastSequence: 3,
    status: 'completed',
    assistantMessageId: `${LABEL_RUN_ID}:assistant`,
    text: 'Here is the result.',
    firstContentSequence: 2,
    resolvedModelId: 'openai/gpt-4.1',
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
    ...overrides,
  }
}

const mockShow = vi.fn().mockResolvedValue(undefined)
const mockDesktopNotification = { show: mockShow }

beforeEach(() => {
  ;(window as Record<string, unknown>).desktopNotification = mockDesktopNotification
})

afterEach(() => {
  delete (window as Record<string, unknown>).desktopNotification
  mockShow.mockClear()
})

function render(config: {
  language?: string
  notificationsEnabled: boolean
  runState: CopilotRunState
}) {
  return renderHook(
    (props) =>
      useAssistantMessageNotification({
        language: props.language,
        notificationsEnabled: props.notificationsEnabled,
        runState: props.runState,
      }),
    {
      initialProps: {
        language: config.language ?? 'zh-CN',
        notificationsEnabled: config.notificationsEnabled,
        runState: config.runState,
      },
    },
  )
}

describe('useAssistantMessageNotification', () => {
  describe('terminal phase transitions', () => {
    it('fires notification on first transition to completed phase', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'Hello from AI' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledTimes(1)
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '助手消息已完成',
          tag: `${LABEL_RUN_ID}:completed`,
        }),
      )
    })

    it('fires notification on transition to failed phase', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'failed',
          runId: LABEL_RUN_ID,
          failure: {
            code: 'error_code',
            message: 'Something went wrong',
            details: {},
          },
        }),
      })

      expect(mockShow).toHaveBeenCalledTimes(1)
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '助手执行失败',
          tag: `${LABEL_RUN_ID}:failed`,
        }),
      )
    })

    it('does not fire notification when notifications are disabled', () => {
      const { rerender } = render({
        notificationsEnabled: false,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: false,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
        }),
      })

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire when runId is null', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: null }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'completed', runId: null }),
      })

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire when previous phase was already terminal', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'completed', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'completed', runId: LABEL_RUN_ID }),
      })

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('fires notification when transitioning from cancelled to completed', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'cancelled', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'Result after cancel' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledTimes(1)
    })

    it('does not fire when runId changes between previous and current', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'completed', runId: 'run-2' }),
      })

      expect(mockShow).not.toHaveBeenCalled()
    })
  })

  describe('notification body resolution', () => {
    it('uses assistant segment text as success body', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'Here is the AI response.' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Here is the AI response.',
        }),
      )
    })

    it('uses fallback body when assistant text is empty', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: '   ' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'AI 助手已返回新的消息。',
        }),
      )
    })

    it('uses failure message as failure body', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'failed',
          runId: LABEL_RUN_ID,
          failure: {
            code: 'error',
            message: 'Connection timeout',
            details: {},
          },
        }),
      })

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Connection timeout',
        }),
      )
    })

    it('uses failed tool error summary for failure body', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'failed',
          runId: LABEL_RUN_ID,
          failure: { code: 'err', message: 'fail', details: {} },
          segments: [
            {
              id: 'tool:1',
              kind: 'tool',
              runId: LABEL_RUN_ID,
              startedSequence: 1,
              lastSequence: 2,
              status: 'failed',
              toolCallId: 'tool.search:1',
              toolId: 'tool.search',
              toolPhase: 'failed',
              title: 'Search',
              summary: 'Failed',
              inputSummary: null,
              resultSummary: null,
              errorSummary: 'API rate limit exceeded',
            },
          ],
        }),
      })

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Tool failed: API rate limit exceeded',
        }),
      )
    })
  })

  describe('transition dedup', () => {
    it('does not fire for already handled transitions', () => {
      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'First time' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledTimes(1)

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'completed', runId: LABEL_RUN_ID }),
      })

      expect(mockShow).toHaveBeenCalledTimes(1)
    })
  })

  describe('language support', () => {
    it('uses English copy for en-US language', () => {
      const { rerender } = render({
        language: 'en-US',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'en-US',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'Hello' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Assistant Message Completed',
        }),
      )
    })

    it('falls back to zh-CN for unknown language', () => {
      const { rerender } = render({
        language: 'fr-FR',
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'fr-FR',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'Result' })],
        }),
      })

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '助手消息已完成',
        }),
      )
    })
  })

  describe('non-terminal phases', () => {
    it('does not fire notification for streaming phase', () => {
      render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire notification for idle phase', () => {
      render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'idle', runId: LABEL_RUN_ID }),
      })

      expect(mockShow).not.toHaveBeenCalled()
    })
  })

  describe('async notification show', () => {
    it('handles notification API error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockShow.mockRejectedValueOnce(new Error('Permission denied'))

      const { rerender } = render({
        notificationsEnabled: true,
        runState: createRunState({ phase: 'streaming', runId: LABEL_RUN_ID }),
      })

      rerender({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState: createRunState({
          phase: 'completed',
          runId: LABEL_RUN_ID,
          segments: [createAssistantSegment({ text: 'Hello' })],
        }),
      })

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          '[assistant-notification] Failed to show desktop notification.',
          expect.any(Error),
        )
      })

      consoleSpy.mockRestore()
    })
  })
})
