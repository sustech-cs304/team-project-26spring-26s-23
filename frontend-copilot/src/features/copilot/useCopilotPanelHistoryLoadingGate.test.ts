/** @vitest-environment jsdom */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { act } from 'react'
import { renderHook } from '@testing-library/react'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import {
  usePersistedHistorySwitchLoadingGate,
  type PersistedHistoryViewState,
} from './useCopilotPanelHistoryLoadingGate'

function createSessionHistory(overrides: Partial<AssistantSessionHistoryState> = {}): AssistantSessionHistoryState {
  return {
    isPersistedThread: false,
    detailStatus: 'unknown',
    detailError: null,
    ...overrides,
  } as AssistantSessionHistoryState
}

function renderGate(initialSessionId: string | null, initialViewState: PersistedHistoryViewState, history?: AssistantSessionHistoryState | null) {
  return renderHook(
    ({ sessionId, persistedHistoryViewState, sessionHistory }) =>
      usePersistedHistorySwitchLoadingGate({ sessionId, sessionHistory, persistedHistoryViewState }),
    {
      initialProps: {
        sessionId: initialSessionId,
        persistedHistoryViewState: initialViewState,
        sessionHistory: history ?? null,
      },
    },
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('usePersistedHistorySwitchLoadingGate', () => {
  describe('initial state', () => {
    it('returns viewState matching the input when no history switch has occurred', () => {
      vi.useFakeTimers()
      const { result } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('returns initial viewState when sessionId is null', () => {
      vi.useFakeTimers()
      const { result } = renderGate(null, 'none')

      expect(result.current.viewState).toBe('none')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('returns loading viewState when input starts with loading', () => {
      vi.useFakeTimers()
      const { result } = renderGate('session-1', 'loading')

      expect(result.current.viewState).toBe('loading')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('returns error viewState when input is in error state', () => {
      vi.useFakeTimers()
      const { result } = renderGate('session-1', 'error')

      expect(result.current.viewState).toBe('error')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })
  })

  describe('pass-through without history switch', () => {
    it('passes through changing viewState when sessionId does not change', () => {
      vi.useFakeTimers()
      const { result, rerender } = renderGate('session-1', 'loading')

      rerender({ sessionId: 'session-1', persistedHistoryViewState: 'ready', sessionHistory: null })

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('passes through viewState changes for non-persisted threads', () => {
      vi.useFakeTimers()
      const { result, rerender } = renderGate('session-1', 'loading')

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'ready',
        sessionHistory: createSessionHistory({ isPersistedThread: false }),
      })

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('does not trigger gate when previous sessionId was null', () => {
      vi.useFakeTimers()
      const { result, rerender } = renderGate(null, 'loading')

      rerender({
        sessionId: 'session-1',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('loading')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })
  })

  describe('persisted history switch detection', () => {
    it('immediately holds previous content when switching between persisted threads that are loading', () => {
      vi.useFakeTimers()
      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('none')
      expect(result.current.isHoldingPreviousContent).toBe(true)
    })

    it('shows loading gate after the configured delay when switching persisted threads', async () => {
      vi.useFakeTimers()
      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('none')
      expect(result.current.isHoldingPreviousContent).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current.viewState).toBe('loading')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('stays in loading gate until viewState transitions and minimum visible time elapses', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-21T10:00:00.000Z'))

      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current.viewState).toBe('loading')

      // Loading completes after 100ms (total 400ms since switch) - still within 500ms min
      vi.advanceTimersByTime(100)
      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'ready',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      // At this point: Date.now() ≈ 400ms, shownAt = 300ms, delta = 100ms, remaining = 400ms
      expect(result.current.viewState).toBe('loading')

      // Advance past the remaining minimum visible time (400ms)
      await act(async () => {
        vi.advanceTimersByTime(500)
      })

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('transitions immediately when loading completes after minimum visible time', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-21T10:00:00.000Z'))

      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      // Loading takes 600ms (well past the 500ms minimum)
      vi.advanceTimersByTime(600)
      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'ready',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('transitions to error state when loading gate reaches error', async () => {
      vi.useFakeTimers()

      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      vi.advanceTimersByTime(1000)
      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'error',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('error')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })
  })

  describe('gate cancellation', () => {
    it('cancels the loading gate when switching to another session before the show timer fires', async () => {
      vi.useFakeTimers()

      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('none')
      expect(result.current.isHoldingPreviousContent).toBe(true)

      // Switch to a third session before the 300ms show timer fires
      vi.advanceTimersByTime(100)
      rerender({
        sessionId: 'session-3',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      // Should reset for the new switch
      expect(result.current.viewState).toBe('none')
      expect(result.current.isHoldingPreviousContent).toBe(true)

      // The old 300ms timer was cleared, new timer fires for session-3
      await act(async () => {
        vi.advanceTimersByTime(300)
      })

      expect(result.current.viewState).toBe('loading')
    })

    it('cancels the gate timer when switching back to original session', async () => {
      vi.useFakeTimers()

      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      expect(result.current.viewState).toBe('none')

      // Switch back to session-1 before timer fires
      vi.advanceTimersByTime(100)
      rerender({
        sessionId: 'session-1',
        persistedHistoryViewState: 'ready',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      // Should return to original state
      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('cancels the gate when loading resolves before the show timer fires', async () => {
      vi.useFakeTimers()

      const { result, rerender } = renderGate('session-1', 'ready', createSessionHistory({ isPersistedThread: true }))

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      // Before the 300ms show timer fires, loading completes
      vi.advanceTimersByTime(100)
      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'ready',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      // Gate was never shown, should be at ready
      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('handles undefined sessionHistory gracefully', () => {
      vi.useFakeTimers()
      const { result } = renderGate('session-1', 'ready', undefined)

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('handles null sessionHistory gracefully', () => {
      vi.useFakeTimers()
      const { result } = renderGate('session-1', 'ready', null)

      expect(result.current.viewState).toBe('ready')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('does not trigger gate when sessionHistory is undefined during switch', () => {
      vi.useFakeTimers()
      const { result, rerender } = renderGate('session-1', 'ready')

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: undefined,
      })

      expect(result.current.viewState).toBe('loading')
      expect(result.current.isHoldingPreviousContent).toBe(false)
    })

    it('teardown cleans up timers on unmount', () => {
      vi.useFakeTimers()

      const { result, rerender, unmount } = renderGate(
        'session-1', 'ready',
        createSessionHistory({ isPersistedThread: true }),
      )

      rerender({
        sessionId: 'session-2',
        persistedHistoryViewState: 'loading',
        sessionHistory: createSessionHistory({ isPersistedThread: true }),
      })

      unmount()

      // Timer cleanup occurred, advancing timers should not throw
      vi.advanceTimersByTime(1000)
      expect(true).toBe(true)
    })
  })
})
