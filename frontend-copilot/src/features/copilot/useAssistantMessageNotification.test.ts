/** @vitest-environment jsdom */

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
    reasoningTraceState: { currentTraceFragment: null, observedAt: 0 },
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

describe.skip('useAssistantMessageNotification', () => {
  describe('terminal phase transitions', () => {
    it('fires notification on first transition to completed phase', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
        segments: [createAssistantSegment({ text: 'Hello from AI' })],
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      expect(effectFn).toBeDefined()
      effectFn!()

      expect(mockShow).toHaveBeenCalledTimes(1)
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '助手消息已完成',
          tag: `${LABEL_RUN_ID}:completed`,
        }),
      )
    })

    it('fires notification on transition to failed phase', () => {
      const runState = createRunState({
        phase: 'failed',
        runId: LABEL_RUN_ID,
        failure: {
          code: 'error_code',
          message: 'Something went wrong',
          details: {},
        },
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledTimes(1)
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '助手执行失败',
          tag: `${LABEL_RUN_ID}:failed`,
        }),
      )
    })

    it('does not fire notification when notifications are disabled', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: false,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire when runId is null', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: null,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: null })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire when previous phase was already terminal', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'completed' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire when transitioning from cancelled to completed', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'cancelled' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire when runId changes between previous and current', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: 'run-2',
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })
  })

  describe('notification body resolution', () => {
    it('uses assistant segment text as success body', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
        segments: [createAssistantSegment({ text: 'Here is the AI response.' })],
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Here is the AI response.',
        }),
      )
    })

    it('uses fallback body when assistant text is empty', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
        segments: [createAssistantSegment({ text: '   ' })],
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'AI 助手已返回新的消息。',
        }),
      )
    })

    it('uses failure message as failure body', () => {
      const runState = createRunState({
        phase: 'failed',
        runId: LABEL_RUN_ID,
        failure: {
          code: 'error',
          message: 'Connection timeout',
          details: {},
        },
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Connection timeout',
        }),
      )
    })

    it('uses failed tool error summary for failure body', () => {
      const runState = createRunState({
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
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          body: 'Tool failed: API rate limit exceeded',
        }),
      )
    })
  })

  describe('transition dedup', () => {
    it('does not fire for already handled transitions', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: `${LABEL_RUN_ID}:streaming->completed` })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })
  })

  describe('language support', () => {
    it('uses English copy for en-US language', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
        segments: [createAssistantSegment({ text: 'Hello' })],
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'en-US',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Assistant Message Completed',
        }),
      )
    })

    it('falls back to zh-CN for unknown language', () => {
      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
        segments: [createAssistantSegment({ text: 'Result' })],
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'fr-FR',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '助手消息已完成',
        }),
      )
    })
  })

  describe('non-terminal phases', () => {
    it('does not fire notification for streaming phase', () => {
      const runState = createRunState({
        phase: 'streaming',
        runId: LABEL_RUN_ID,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'starting' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })

    it('does not fire notification for idle phase', () => {
      const runState = createRunState({
        phase: 'idle',
        runId: LABEL_RUN_ID,
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'idle' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(mockShow).not.toHaveBeenCalled()
    })
  })

  describe('async notification show', () => {
    it('handles notification API error gracefully', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockShow.mockRejectedValueOnce(new Error('Permission denied'))

      const runState = createRunState({
        phase: 'completed',
        runId: LABEL_RUN_ID,
        segments: [createAssistantSegment({ text: 'Hello' })],
      })

      const mocks = mockReactHooks()
      mocks.useRefReturnValues.set('previousPhase', { current: 'streaming' })
      mocks.useRefReturnValues.set('previousRunId', { current: LABEL_RUN_ID })
      mocks.useRefReturnValues.set('lastHandledTransition', { current: null })

      useAssistantMessageNotification({
        language: 'zh-CN',
        notificationsEnabled: true,
        runState,
      })

      const effectFn = mocks.useEffectCalls[0]?.callback
      effectFn!()

      expect(consoleSpy).toHaveBeenCalledWith(
        '[assistant-notification] Failed to show desktop notification.',
        expect.any(Error),
      )
      consoleSpy.mockRestore()
    })
  })
})

interface MockedHookCalls {
  useEffectCalls: Array<{
    callback: () => void
    deps: unknown[]
  }>
  useRefReturnValues: Map<string, { current: unknown }>
}

let mockReactModule: {
  useEffect: ReturnType<typeof vi.fn>
  useRef: ReturnType<typeof vi.fn>
  default: Record<string, unknown>
}

function mockReactHooks(): MockedHookCalls {
  const calls: MockedHookCalls = {
    useEffectCalls: [],
    useRefReturnValues: new Map(),
  }

  let refCallIndex = 0
  const refSequence = ['previousPhase', 'previousRunId', 'lastHandledTransition']

  vi.doMock('react', () => {
    const useEffect = vi.fn((callback: () => void, deps?: unknown[]) => {
      calls.useEffectCalls.push({ callback, deps: deps ?? [] })
    })

    const useRef = vi.fn((initialValue?: unknown) => {
      const key = refSequence[refCallIndex] ?? `ref-${refCallIndex}`
      refCallIndex += 1
      const existing = calls.useRefReturnValues.get(key)
      if (existing) return existing
      const ref = { current: initialValue ?? null }
      calls.useRefReturnValues.set(key, ref)
      return ref
    })

    return { useEffect, useRef }
  })

  return calls
}
