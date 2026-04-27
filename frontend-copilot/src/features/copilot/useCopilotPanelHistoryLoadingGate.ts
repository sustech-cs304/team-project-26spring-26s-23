import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'

import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'

export type PersistedHistoryViewState = 'none' | 'loading' | 'error' | 'ready'

export interface PersistedHistorySwitchLoadingGateResult {
  viewState: PersistedHistoryViewState
  isHoldingPreviousContent: boolean
}

const SWITCHED_HISTORY_LOADING_DELAY_MS = 300
const SWITCHED_HISTORY_LOADING_MIN_VISIBLE_MS = 500
const useHistoryLoadingGateEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function clearHistoryLoadingGateTimer(timerRef: MutableRefObject<number | null>) {
  if (timerRef.current === null) {
    return
  }

  window.clearTimeout(timerRef.current)
  timerRef.current = null
}

export function usePersistedHistorySwitchLoadingGate(input: {
  sessionId: string | null
  sessionHistory: AssistantSessionHistoryState | null | undefined
  persistedHistoryViewState: PersistedHistoryViewState
}): PersistedHistorySwitchLoadingGateResult {
  const [gateState, setGateState] = useState<PersistedHistorySwitchLoadingGateResult>(() => ({
    viewState: input.persistedHistoryViewState,
    isHoldingPreviousContent: false,
  }))
  const previousSessionIdRef = useRef<string | null>(input.sessionId)
  const activeGateRef = useRef<{ sessionId: string; shownAt: number | null } | null>(null)
  const latestInputRef = useRef(input)
  const showTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  latestInputRef.current = input

  const immediateSwitchedPersistedHistoryLoading = previousSessionIdRef.current !== null
    && input.sessionId !== null
    && previousSessionIdRef.current !== input.sessionId
    && input.sessionHistory?.isPersistedThread === true
    && input.persistedHistoryViewState === 'loading'
    && (activeGateRef.current === null || activeGateRef.current.sessionId !== input.sessionId)

  useHistoryLoadingGateEffect(() => {
    return () => {
      clearHistoryLoadingGateTimer(showTimerRef)
      clearHistoryLoadingGateTimer(hideTimerRef)
    }
  }, [])

  useHistoryLoadingGateEffect(() => {
    const previousSessionId = previousSessionIdRef.current
    const nextSessionId = input.sessionId
    const isSwitchedPersistedHistoryLoading = previousSessionId !== null
      && nextSessionId !== null
      && previousSessionId !== nextSessionId
      && input.sessionHistory?.isPersistedThread === true
      && input.persistedHistoryViewState === 'loading'

    if (isSwitchedPersistedHistoryLoading) {
      clearHistoryLoadingGateTimer(showTimerRef)
      clearHistoryLoadingGateTimer(hideTimerRef)
      activeGateRef.current = {
        sessionId: nextSessionId,
        shownAt: null,
      }
      setGateState({
        viewState: 'none',
        isHoldingPreviousContent: true,
      })
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null
        const activeGate = activeGateRef.current
        const latestInput = latestInputRef.current
        if (
          activeGate === null
          || activeGate.sessionId !== nextSessionId
          || latestInput.sessionId !== nextSessionId
          || latestInput.persistedHistoryViewState !== 'loading'
        ) {
          return
        }

        activeGate.shownAt = Date.now()
        setGateState({
          viewState: 'loading',
          isHoldingPreviousContent: false,
        })
      }, SWITCHED_HISTORY_LOADING_DELAY_MS)
      previousSessionIdRef.current = nextSessionId
      return
    }

    const activeGate = activeGateRef.current
    if (activeGate !== null) {
      if (nextSessionId !== activeGate.sessionId) {
        clearHistoryLoadingGateTimer(showTimerRef)
        clearHistoryLoadingGateTimer(hideTimerRef)
        activeGateRef.current = null
        setGateState({
          viewState: input.persistedHistoryViewState,
          isHoldingPreviousContent: false,
        })
        previousSessionIdRef.current = nextSessionId
        return
      }

      if (input.persistedHistoryViewState === 'loading') {
        clearHistoryLoadingGateTimer(hideTimerRef)
        setGateState({
          viewState: activeGate.shownAt === null ? 'none' : 'loading',
          isHoldingPreviousContent: activeGate.shownAt === null,
        })
        previousSessionIdRef.current = nextSessionId
        return
      }

      if (activeGate.shownAt === null) {
        clearHistoryLoadingGateTimer(showTimerRef)
        activeGateRef.current = null
        setGateState({
          viewState: input.persistedHistoryViewState,
          isHoldingPreviousContent: false,
        })
        previousSessionIdRef.current = nextSessionId
        return
      }

      const remainingVisibleMs = SWITCHED_HISTORY_LOADING_MIN_VISIBLE_MS - (Date.now() - activeGate.shownAt)
      if (remainingVisibleMs <= 0) {
        clearHistoryLoadingGateTimer(hideTimerRef)
        activeGateRef.current = null
        setGateState({
          viewState: input.persistedHistoryViewState,
          isHoldingPreviousContent: false,
        })
        previousSessionIdRef.current = nextSessionId
        return
      }

      if (hideTimerRef.current === null) {
        hideTimerRef.current = window.setTimeout(() => {
          hideTimerRef.current = null
          const currentGate = activeGateRef.current
          const latestInput = latestInputRef.current
          if (currentGate === null || currentGate.sessionId !== activeGate.sessionId) {
            return
          }

          activeGateRef.current = null
          setGateState({
            viewState: latestInput.persistedHistoryViewState,
            isHoldingPreviousContent: false,
          })
        }, remainingVisibleMs)
      }

      setGateState({
        viewState: 'loading',
        isHoldingPreviousContent: false,
      })
      previousSessionIdRef.current = nextSessionId
      return
    }

    setGateState({
      viewState: input.persistedHistoryViewState,
      isHoldingPreviousContent: false,
    })
    previousSessionIdRef.current = nextSessionId
  }, [input.persistedHistoryViewState, input.sessionHistory?.isPersistedThread, input.sessionId])

  return immediateSwitchedPersistedHistoryLoading
    ? {
        viewState: 'none',
        isHoldingPreviousContent: true,
      }
    : gateState
}
