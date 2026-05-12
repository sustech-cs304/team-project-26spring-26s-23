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
    applyHistoryLoadingGateTransition({
      previousSessionId: previousSessionIdRef.current,
      nextSessionId: input.sessionId,
      isPersistedThread: input.sessionHistory?.isPersistedThread === true,
      persistedHistoryViewState: input.persistedHistoryViewState,
      activeGateRef,
      latestInputRef,
      showTimerRef,
      hideTimerRef,
      setGateState,
    })
    previousSessionIdRef.current = input.sessionId
  }, [input.persistedHistoryViewState, input.sessionHistory?.isPersistedThread, input.sessionId])

  return immediateSwitchedPersistedHistoryLoading
    ? {
        viewState: 'none',
        isHoldingPreviousContent: true,
      }
    : gateState
}

function applyHistoryLoadingGateTransition(input: {
  previousSessionId: string | null
  nextSessionId: string | null
  isPersistedThread: boolean
  persistedHistoryViewState: PersistedHistoryViewState
  activeGateRef: MutableRefObject<{ sessionId: string; shownAt: number | null } | null>
  latestInputRef: MutableRefObject<{
    sessionId: string | null
    sessionHistory: AssistantSessionHistoryState | null | undefined
    persistedHistoryViewState: PersistedHistoryViewState
  }>
  showTimerRef: MutableRefObject<number | null>
  hideTimerRef: MutableRefObject<number | null>
  setGateState: (value: PersistedHistorySwitchLoadingGateResult) => void
}) {
  const {
    previousSessionId,
    nextSessionId,
    isPersistedThread,
    persistedHistoryViewState,
    activeGateRef,
    latestInputRef,
    showTimerRef,
    hideTimerRef,
    setGateState,
  } = input

  const isSwitchedPersistedHistoryLoading = previousSessionId !== null
    && nextSessionId !== null
    && previousSessionId !== nextSessionId
    && isPersistedThread
    && persistedHistoryViewState === 'loading'

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
    return
  }

  completeActiveGateTransition({
    activeGateRef,
    nextSessionId,
    persistedHistoryViewState,
    latestInputRef,
    showTimerRef,
    hideTimerRef,
    setGateState,
  })
}

function completeActiveGateTransition(input: {
  activeGateRef: MutableRefObject<{ sessionId: string; shownAt: number | null } | null>
  nextSessionId: string | null
  persistedHistoryViewState: PersistedHistoryViewState
  latestInputRef: MutableRefObject<{
    sessionId: string | null
    persistedHistoryViewState: PersistedHistoryViewState
  }>
  showTimerRef: MutableRefObject<number | null>
  hideTimerRef: MutableRefObject<number | null>
  setGateState: (value: PersistedHistorySwitchLoadingGateResult) => void
}) {
  const activeGate = input.activeGateRef.current
  if (activeGate !== null) {
    resolveActiveGateState({
      activeGate,
      nextSessionId: input.nextSessionId,
      persistedHistoryViewState: input.persistedHistoryViewState,
      latestInputRef: input.latestInputRef,
      showTimerRef: input.showTimerRef,
      hideTimerRef: input.hideTimerRef,
      setGateState: input.setGateState,
      activeGateRef: input.activeGateRef,
    })
    return
  }

  input.setGateState({
    viewState: input.persistedHistoryViewState,
    isHoldingPreviousContent: false,
  })
}

function resolveActiveGateState(input: {
  activeGate: { sessionId: string; shownAt: number | null }
  nextSessionId: string | null
  persistedHistoryViewState: PersistedHistoryViewState
  latestInputRef: MutableRefObject<{
    sessionId: string | null
    persistedHistoryViewState: PersistedHistoryViewState
  }>
  showTimerRef: MutableRefObject<number | null>
  hideTimerRef: MutableRefObject<number | null>
  setGateState: (value: PersistedHistorySwitchLoadingGateResult) => void
  activeGateRef: MutableRefObject<{ sessionId: string; shownAt: number | null } | null>
}) {
  const {
    activeGate,
    nextSessionId,
    persistedHistoryViewState,
    latestInputRef,
    showTimerRef,
    hideTimerRef,
    setGateState,
    activeGateRef,
  } = input

  if (nextSessionId !== activeGate.sessionId) {
    clearHistoryLoadingGateTimer(showTimerRef)
    clearHistoryLoadingGateTimer(hideTimerRef)
    activeGateRef.current = null
    setGateState({
      viewState: persistedHistoryViewState,
      isHoldingPreviousContent: false,
    })
    return
  }

  if (persistedHistoryViewState === 'loading') {
    clearHistoryLoadingGateTimer(hideTimerRef)
    setGateState({
      viewState: activeGate.shownAt === null ? 'none' : 'loading',
      isHoldingPreviousContent: activeGate.shownAt === null,
    })
    return
  }

  if (activeGate.shownAt === null) {
    clearHistoryLoadingGateTimer(showTimerRef)
    activeGateRef.current = null
    setGateState({
      viewState: persistedHistoryViewState,
      isHoldingPreviousContent: false,
    })
    return
  }

  const remainingVisibleMs = SWITCHED_HISTORY_LOADING_MIN_VISIBLE_MS - (Date.now() - activeGate.shownAt)
  if (remainingVisibleMs <= 0) {
    clearHistoryLoadingGateTimer(hideTimerRef)
    activeGateRef.current = null
    setGateState({
      viewState: persistedHistoryViewState,
      isHoldingPreviousContent: false,
    })
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
}
