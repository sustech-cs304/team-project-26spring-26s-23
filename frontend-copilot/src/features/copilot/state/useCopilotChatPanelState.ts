import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from 'react'

import type {
  AgentType,
  AssistantSessionShell,
  ModelRouteRef,
} from '../../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../../workbench/assistant/assistant-workspace-controller'
import type { AssistantSessionHistoryState } from '../../../workbench/assistant/assistant-history-state'
import { loadSettingsWorkspaceState } from '../../../workbench/settings/workspace-state'
import {
  cancelRuntimeRun,
  getRuntimeThinkingCapability,
  RuntimeRequestError,
  type RuntimeThinkingCapability,
} from '../chat-contract'
import { appendCopilotDebugLog, isCopilotDebugModeEnabled } from '../debug-mode-log'
import {
  applyModelSelectionToComposerDraft,
  buildRuntimeDebugSummary,
  buildRuntimeThinkingCapabilityFromError,
  buildSessionDebugSummary,
  createComposerDraftFromSession,
  createEmptyComposerDraft,
  type CopilotChatComposerDraft,
  type CopilotTransientErrorState,
} from '../copilot-chat-helpers'
import {
  resolvePersistedHistoryDrift,
  type PersistedHistoryDriftSummary,
} from '../persisted-history-drift'
import {
  buildPersistedConversationFromHistory,
  type PersistedConversationSource,
} from '../persisted-history-view-model'
import {
  buildCopilotMessageListItems,
  resolveCopilotAssistantPlaceholderState,
  type CopilotAssistantPlaceholderState,
  type CopilotMessageListItem,
} from '../run-segment-view-model'
import {
  createCopilotModelCatalog,
  getCopilotModelById,
  resolveCopilotPreferredModelId,
  type CopilotModelGroup,
} from '../model-picker'
import {
  createIdleCopilotRunState,
  dispatchCopilotMessage,
  getCopilotSendDisabledReason,
  orchestrateCopilotSend,
} from '../copilot-send-controller'
import { isCopilotConnectableState } from '../copilot-panel-diagnostics'
import { useCopilotComposerResize } from '../useCopilotComposerResize'
import type { CopilotBootstrapState, CopilotRunState } from '../types'
import {
  clearAbortController,
  isSameModelRoute,
  resolveComposerDraftModelSelection,
  resolveDisplayedThinkingCapability,
  resolveSelectedComposerModelRoute,
} from './CopilotChatPanelViewModel'

export interface CopilotChatPanelShellProps {
  state: CopilotBootstrapState
  retrying: boolean
  retry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
  sessionHistory?: AssistantSessionHistoryState | null
  historyRestoreError?: string | null
  retrySessionHistory?: () => void
  selectSessionHistoryRun?: (runId: string | null) => void
  onSessionRunSettled?: (runId: string | null, sessionId: string | null) => void
  sendMessage?: typeof dispatchCopilotMessage
  cancelRun?: typeof cancelRuntimeRun
  getThinkingCapability?: typeof getRuntimeThinkingCapability
  loadWorkspaceState?: typeof loadSettingsWorkspaceState
}

export interface CopilotChatPanelState {
  sendError: CopilotTransientErrorState | null
  modelGroups: CopilotModelGroup[]
  thinkingCapability: RuntimeThinkingCapability | null
  composerDraft: CopilotChatComposerDraft
  onComposerDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSend: (event: FormEvent<HTMLFormElement>) => void
  onCancelCurrentRun: () => void
  sendStatus: 'idle' | 'sending'
  canCancelSend: boolean
  sendDisabledReason: string | null
  historyDrift: PersistedHistoryDriftSummary | null
  historyRebindAcknowledged: boolean
  onAcknowledgeHistoryRebind: () => void
  persistedSelectedRunConversationSource: PersistedConversationSource
  hasTransientConversation: boolean
  conversation: CopilotMessageListItem[]
  assistantPlaceholder: CopilotAssistantPlaceholderState
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onComposerResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

interface CopilotSessionTransientState {
  conversation: CopilotMessageListItem[]
  runState: CopilotRunState
}

const EMPTY_COPILOT_SESSION_TRANSIENT_STATE: CopilotSessionTransientState = {
  conversation: [],
  runState: createIdleCopilotRunState(),
}

function resolveCopilotSessionTransientState(
  stateBySessionId: Record<string, CopilotSessionTransientState>,
  sessionId: string | null | undefined,
): CopilotSessionTransientState {
  if (sessionId === null || sessionId === undefined || sessionId.trim() === '') {
    return EMPTY_COPILOT_SESSION_TRANSIENT_STATE
  }

  return stateBySessionId[sessionId] ?? EMPTY_COPILOT_SESSION_TRANSIENT_STATE
}

function updateCopilotSessionTransientState(
  stateBySessionId: Record<string, CopilotSessionTransientState>,
  sessionId: string,
  updater: (state: CopilotSessionTransientState) => CopilotSessionTransientState,
): Record<string, CopilotSessionTransientState> {
  const currentState = resolveCopilotSessionTransientState(stateBySessionId, sessionId)
  const nextState = updater(currentState)
  if (nextState === currentState) {
    return stateBySessionId
  }

  return {
    ...stateBySessionId,
    [sessionId]: nextState,
  }
}

export function useCopilotChatPanelState({
  state,
  selectedAgent,
  sessionShell,
  directoryState,
  sessionHistory = null,
  selectSessionHistoryRun,
  onSessionRunSettled,
  sendMessage = dispatchCopilotMessage,
  cancelRun = cancelRuntimeRun,
  getThinkingCapability = getRuntimeThinkingCapability,
  loadWorkspaceState = loadSettingsWorkspaceState,
}: CopilotChatPanelShellProps): CopilotChatPanelState {
  const [composerDraft, setComposerDraft] = useState<CopilotChatComposerDraft>(createEmptyComposerDraft)
  const [transientStateBySessionId, setTransientStateBySessionId] = useState<Record<string, CopilotSessionTransientState>>({})
  const [thinkingCapability, setThinkingCapability] = useState<RuntimeThinkingCapability | null>(null)
  const [sendError, setSendError] = useState<CopilotTransientErrorState | null>(null)
  const [workspaceProviderProfiles, setWorkspaceProviderProfiles] = useState<Parameters<typeof createCopilotModelCatalog>[0]>([])
  const [workspacePrimaryModel, setWorkspacePrimaryModel] = useState('')
  const [workspacePrimaryModelRoute, setWorkspacePrimaryModelRoute] = useState<ModelRouteRef | null>(null)
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const { composerHeight, onComposerResizeStart } = useCopilotComposerResize()
  const activeAbortControllerRef = useRef<AbortController | null>(null)
  const [historyRebindAcknowledged, setHistoryRebindAcknowledged] = useState(false)
  const pendingHistorySyncRunIdBySessionRef = useRef<Record<string, string | null>>({})
  const lastSettledRunIdBySessionRef = useRef<Record<string, string | null>>({})
  const pendingHistorySyncLogKeyBySessionRef = useRef<Record<string, string | null>>({})
  const transientStateBySessionIdRef = useRef<Record<string, CopilotSessionTransientState>>({})
  const previousSessionIdRef = useRef<string | null>(null)

  const activeSessionId = sessionShell?.sessionId ?? null
  const activeTransientState = useMemo(
    () => resolveCopilotSessionTransientState(transientStateBySessionId, activeSessionId),
    [activeSessionId, transientStateBySessionId],
  )
  const conversation = activeTransientState.conversation
  const runState = activeTransientState.runState

  const sessionIdentity = sessionShell === null
    ? null
    : `${sessionShell.sessionId}:${sessionShell.capabilities.capabilitiesVersion}`

  const debugModeEnabled = isCopilotDebugModeEnabled(state)

  const runtimeDebugSummary = useMemo(() => {
    if (!isCopilotConnectableState(state)) {
      return null
    }

    return buildRuntimeDebugSummary({
      state,
      directoryState,
      selectedAgent,
    })
  }, [directoryState, selectedAgent, state])

  const sessionDebugSummary = useMemo(
    () => (sessionShell === null ? null : buildSessionDebugSummary(sessionShell)),
    [sessionShell],
  )

  const modelCatalog = useMemo(
    () => createCopilotModelCatalog(workspaceProviderProfiles),
    [workspaceProviderProfiles],
  )
  const preferredWorkspaceModelId = useMemo(
    () => workspacePrimaryModelRoute === null
      ? ''
      : resolveCopilotPreferredModelId({
          preferredModelId: workspacePrimaryModel,
          preferredModelRouteRef: workspacePrimaryModelRoute,
          models: modelCatalog.models,
        }),
    [
      modelCatalog.models,
      workspacePrimaryModel,
      workspacePrimaryModelRoute,
    ],
  )
  const preferredWorkspaceModel = useMemo(
    () => getCopilotModelById(preferredWorkspaceModelId, modelCatalog.models),
    [modelCatalog.models, preferredWorkspaceModelId],
  )
  const hasConfiguredModels = modelCatalog.models.length > 0
  const hasAvailableModels = modelCatalog.models.some((model) => model.available)
  const selectedModelRouteFromDraft = useMemo(
    () => resolveSelectedComposerModelRoute(composerDraft, modelCatalog.models),
    [composerDraft, modelCatalog.models],
  )
  const effectiveThinkingCapability = useMemo(
    () => resolveDisplayedThinkingCapability({
      queriedCapability: thinkingCapability,
      runState,
      selectedModelRoute: selectedModelRouteFromDraft,
    }),
    [runState, selectedModelRouteFromDraft, thinkingCapability],
  )
  const effectiveComposerDraft = useMemo(
    () => resolveComposerDraftModelSelection(composerDraft, modelCatalog.models, effectiveThinkingCapability),
    [composerDraft, effectiveThinkingCapability, modelCatalog.models],
  )
  const selectedModelOption = useMemo(
    () => getCopilotModelById(effectiveComposerDraft.selectedModelId, modelCatalog.models),
    [effectiveComposerDraft.selectedModelId, modelCatalog.models],
  )
  const persistedConversationBuildResult = useMemo(
    () => buildPersistedConversationFromHistory(sessionHistory),
    [sessionHistory],
  )
  const persistedConversation = persistedConversationBuildResult.conversation
  const persistedSelectedRunConversationSource = persistedConversationBuildResult.selectedRunConversationSource
  const hasRenderablePersistedSelectedConversation = useMemo(
    () => persistedConversation.length > 0,
    [persistedConversation],
  )
  const shouldRenderTransientConversation = useMemo(() => {
    if (runState.phase !== 'idle' && runState.threadId !== sessionShell?.sessionId) {
      return false
    }

    if (sessionHistory === null || sessionHistory.detailStatus !== 'ready') {
      return conversation.length > 0 || runState.phase !== 'idle'
    }

    if (runState.phase === 'starting' || runState.phase === 'streaming') {
      return true
    }

    if (conversation.length > 0 && runState.runId === null) {
      return true
    }

    const runId = runState.runId?.trim() ?? ''
    if (runId === '') {
      return false
    }

    const persistedRunIds = new Set(sessionHistory.runSummaries.map((runSummary) => runSummary.runId))
    if (!persistedRunIds.has(runId)) {
      return true
    }

    if (sessionHistory.selectedRunId !== runId) {
      return false
    }

    return !hasRenderablePersistedSelectedConversation
  }, [conversation.length, hasRenderablePersistedSelectedConversation, runState.phase, runState.runId, runState.threadId, sessionHistory, sessionShell?.sessionId])
  const hasTransientConversation = useMemo(
    () => shouldRenderTransientConversation && (conversation.length > 0 || runState.phase !== 'idle'),
    [conversation.length, runState.phase, shouldRenderTransientConversation],
  )
  const projectedConversation = useMemo(
    () => [
      ...persistedConversation,
      ...buildCopilotMessageListItems({
        history: shouldRenderTransientConversation ? conversation : [],
        runState: shouldRenderTransientConversation ? runState : createIdleCopilotRunState(),
      }),
    ],
    [conversation, persistedConversation, runState, shouldRenderTransientConversation],
  )
  const assistantPlaceholder = useMemo(
    () => resolveCopilotAssistantPlaceholderState(runState),
    [runState],
  )
  const sendStatus = runState.phase === 'starting' || runState.phase === 'streaming' ? 'sending' : 'idle'
  const canCancelSend = activeAbortControllerRef.current !== null && sendStatus === 'sending'
  const historyDrift = useMemo(
    () => resolvePersistedHistoryDrift(sessionHistory),
    [sessionHistory],
  )
  const historyDriftResetKey = useMemo(
    () => [
      sessionShell?.sessionId ?? '',
      sessionHistory?.selectedRunId ?? '',
      historyDrift?.historicalModelId ?? '',
      historyDrift?.historicalToolIds.join('|') ?? '',
      historyDrift?.historicalThinkingSummary ?? '',
      historyDrift?.warnings.map((warning) => warning.code).join('|') ?? '',
      historyDrift?.requiresExplicitRebind === true ? '1' : '0',
    ].join('::'),
    [historyDrift, sessionHistory?.selectedRunId, sessionShell?.sessionId],
  )

  useEffect(() => {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null

    if (sessionShell === null) {
      setComposerDraft(createEmptyComposerDraft())
      setThinkingCapability(null)
      setSendError(null)
      return
    }

    setComposerDraft(createComposerDraftFromSession(sessionShell))
    setThinkingCapability(null)
    setSendError(null)
  }, [sessionIdentity, sessionShell])

  useEffect(() => {
    setHistoryRebindAcknowledged(false)
  }, [historyDriftResetKey])

  useEffect(() => {
    transientStateBySessionIdRef.current = transientStateBySessionId
  }, [transientStateBySessionId])

  useEffect(() => {
    for (const [sessionId, transientState] of Object.entries(transientStateBySessionId)) {
      const sessionRunState = transientState.runState
      if (
        sessionRunState.phase !== 'completed'
        && sessionRunState.phase !== 'failed'
        && sessionRunState.phase !== 'cancelled'
      ) {
        continue
      }

      const runId = sessionRunState.runId?.trim() ?? ''
      const settledSessionId = sessionRunState.threadId?.trim() ?? ''
      if (runId === '' || settledSessionId === '' || lastSettledRunIdBySessionRef.current[sessionId] === runId) {
        continue
      }

      lastSettledRunIdBySessionRef.current[sessionId] = runId
      const tracksPendingHistorySync = sessionId === settledSessionId
      if (tracksPendingHistorySync) {
        pendingHistorySyncRunIdBySessionRef.current[sessionId] = runId
        pendingHistorySyncLogKeyBySessionRef.current[sessionId] = null
      }

      appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'run-settled-pending-history-sync', {
        sessionId: settledSessionId,
        transientSessionId: sessionId,
        activeSessionId: sessionShell?.sessionId ?? null,
        runId,
        runPhase: sessionRunState.phase,
        detailStatus: settledSessionId === sessionShell?.sessionId ? sessionHistory?.detailStatus ?? null : null,
        selectedRunId: settledSessionId === sessionShell?.sessionId ? sessionHistory?.selectedRunId ?? null : null,
        tracksPendingHistorySync,
      })
      onSessionRunSettled?.(runId, settledSessionId)
    }
  }, [
    debugModeEnabled,
    onSessionRunSettled,
    sessionHistory?.detailStatus,
    sessionHistory?.selectedRunId,
    sessionShell?.sessionId,
    transientStateBySessionId,
  ])

  useEffect(() => {
    const sessionId = sessionShell?.sessionId?.trim() ?? ''
    if (sessionId === '') {
      return
    }

    const pendingRunId = pendingHistorySyncRunIdBySessionRef.current[sessionId] ?? null
    if (pendingRunId === null) {
      pendingHistorySyncLogKeyBySessionRef.current[sessionId] = null
      return
    }

    const waitReason = sessionHistory === null
      ? 'missing-session-history'
      : sessionHistory.detailStatus !== 'ready'
        ? 'detail-not-ready'
        : sessionHistory.selectedRunId !== pendingRunId
          ? 'selected-run-mismatch'
          : !sessionHistory.runSummaries.some((runSummary) => runSummary.runId === pendingRunId)
            ? 'selected-run-missing-from-detail'
            : !hasRenderablePersistedSelectedConversation
              ? 'persisted-selected-run-empty'
              : null

    if (waitReason !== null) {
      const logKey = [
        pendingRunId,
        waitReason,
        sessionHistory?.selectedRunId ?? '',
        sessionHistory?.detailStatus ?? '',
        hasRenderablePersistedSelectedConversation ? 'renderable' : 'empty',
      ].join('::')
      if (pendingHistorySyncLogKeyBySessionRef.current[sessionId] !== logKey) {
        pendingHistorySyncLogKeyBySessionRef.current[sessionId] = logKey
        appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'pending-history-sync-waiting', {
          sessionId,
          pendingRunId,
          selectedRunId: sessionHistory?.selectedRunId ?? null,
          detailStatus: sessionHistory?.detailStatus ?? null,
          replayStatus: sessionHistory?.replayStatus ?? null,
          persistedConversationLength: persistedConversation.length,
          persistedConversationSource: persistedSelectedRunConversationSource,
          waitReason,
        })
      }
      return
    }

    pendingHistorySyncLogKeyBySessionRef.current[sessionId] = null
    const readySessionHistory = sessionHistory
    if (readySessionHistory === null) {
      return
    }

    appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'pending-history-sync-committed', {
      sessionId,
      pendingRunId,
      selectedRunId: readySessionHistory.selectedRunId,
      persistedConversationLength: persistedConversation.length,
      persistedConversationSource: persistedSelectedRunConversationSource,
    })
    pendingHistorySyncRunIdBySessionRef.current[sessionId] = null
    setTransientStateBySessionId((current) => updateCopilotSessionTransientState(current, sessionId, (sessionState) => ({
      ...sessionState,
      conversation: [],
      runState: sessionState.runState.runId === pendingRunId ? createIdleCopilotRunState() : sessionState.runState,
    })))
  }, [
    debugModeEnabled,
    hasRenderablePersistedSelectedConversation,
    persistedConversation.length,
    persistedSelectedRunConversationSource,
    sessionHistory,
    sessionShell?.sessionId,
  ])

  useEffect(() => {
    if (selectSessionHistoryRun === undefined || sessionHistory === null || sessionHistory.selectedRunId === null) {
      return
    }

    if (runState.threadId !== sessionShell?.sessionId) {
      return
    }

    if (runState.phase === 'starting' || runState.phase === 'streaming') {
      return
    }

    if (runState.runId === null || runState.runId === sessionHistory.selectedRunId) {
      return
    }

    appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'persisted-selection-preempted-transient', {
      sessionId: sessionShell?.sessionId ?? null,
      transientRunId: runState.runId,
      selectedRunId: sessionHistory.selectedRunId,
      persistedConversationLength: persistedConversation.length,
      persistedConversationSource: persistedSelectedRunConversationSource,
    })
    if (sessionShell !== null) {
      setTransientStateBySessionId((current) => updateCopilotSessionTransientState(current, sessionShell.sessionId, (sessionState) => ({
        ...sessionState,
        conversation: [],
        runState: createIdleCopilotRunState(),
      })))
    }
  }, [
    debugModeEnabled,
    persistedConversation.length,
    persistedSelectedRunConversationSource,
    runState.phase,
    runState.runId,
    runState.threadId,
    selectSessionHistoryRun,
    sessionHistory,
    sessionShell?.sessionId,
  ])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await loadWorkspaceState()

      if (cancelled) {
        return
      }

      if (result.ok) {
        setWorkspaceProviderProfiles(result.state.providerProfiles)
        setWorkspacePrimaryModel(result.state.defaultModelRouting.primaryAssistantModel)
        setWorkspacePrimaryModelRoute(result.state.defaultModelRouting.primaryAssistantModelRoute ?? null)
        setWorkspaceStateLoaded(true)
        return
      }

      setWorkspaceProviderProfiles([])
      setWorkspacePrimaryModel('')
      setWorkspacePrimaryModelRoute(null)
      setWorkspaceStateLoaded(true)
    })()

    return () => {
      cancelled = true
    }
  }, [loadWorkspaceState])

  useEffect(() => {
    return () => {
      activeAbortControllerRef.current?.abort()
      activeAbortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!workspaceStateLoaded) {
      return
    }

    setComposerDraft((current) => {
      if (!hasConfiguredModels) {
        return current.selectedModelId === ''
          && current.selectedModelRoute === null
          && current.thinkingSelection === null
          ? current
          : {
              ...current,
              selectedModelId: '',
              selectedModelRoute: null,
              thinkingSelection: null,
            }
      }

      const shouldPreferWorkspaceModel = current.selectedModelRoute === null && preferredWorkspaceModel !== null
      const selectedModel = getCopilotModelById(current.selectedModelId, modelCatalog.models)
      if (selectedModel !== null) {
        if (
          shouldPreferWorkspaceModel
          && current.selectedModelId !== preferredWorkspaceModel.selectionValue
        ) {
          return preferredWorkspaceModel.available
            ? applyModelSelectionToComposerDraft(current, {
                modelId: preferredWorkspaceModel.selectionValue,
                modelRoute: preferredWorkspaceModel.route,
              })
            : {
                ...current,
                selectedModelId: preferredWorkspaceModel.selectionValue,
                selectedModelRoute: null,
                thinkingSelection: null,
              }
        }

        if (!selectedModel.available) {
          return current.selectedModelId === selectedModel.selectionValue
            && current.selectedModelRoute === null
            && current.thinkingSelection === null
            ? current
            : {
                ...current,
                selectedModelId: selectedModel.selectionValue,
                selectedModelRoute: null,
                thinkingSelection: null,
              }
        }

        if (
          current.selectedModelId === selectedModel.selectionValue
          && isSameModelRoute(current.selectedModelRoute, selectedModel.route)
        ) {
          return current
        }

        return applyModelSelectionToComposerDraft(current, {
          modelId: selectedModel.selectionValue,
          modelRoute: selectedModel.route,
        })
      }

      if (preferredWorkspaceModel !== null) {
        return preferredWorkspaceModel.available
          ? applyModelSelectionToComposerDraft(current, {
              modelId: preferredWorkspaceModel.selectionValue,
              modelRoute: preferredWorkspaceModel.route,
            })
          : {
              ...current,
              selectedModelId: preferredWorkspaceModel.selectionValue,
              selectedModelRoute: null,
              thinkingSelection: null,
            }
      }

      if (current.selectedModelId.trim() !== '') {
        return current.selectedModelRoute === null && current.thinkingSelection === null
          ? current
          : {
              ...current,
              selectedModelRoute: null,
              thinkingSelection: null,
            }
      }

      return current
    })
  }, [
    hasConfiguredModels,
    modelCatalog.models,
    preferredWorkspaceModel,
    workspacePrimaryModelRoute,
    workspaceStateLoaded,
  ])

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current
    const previousTransientState = resolveCopilotSessionTransientState(transientStateBySessionIdRef.current, previousSessionId)
    const nextSessionId = sessionShell?.sessionId ?? null
    const nextTransientState = resolveCopilotSessionTransientState(transientStateBySessionIdRef.current, nextSessionId)

    appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'session-switch-retained-transient', {
      previousSessionId,
      nextSessionId,
      previousTransientConversationLength: previousTransientState.conversation.length,
      previousRunStatePhase: previousTransientState.runState.phase,
      previousRunStateRunId: previousTransientState.runState.runId,
      previousPendingHistorySyncRunId: previousSessionId === null
        ? null
        : pendingHistorySyncRunIdBySessionRef.current[previousSessionId] ?? null,
      nextTransientConversationLength: nextTransientState.conversation.length,
      nextRunStatePhase: nextTransientState.runState.phase,
      nextRunStateRunId: nextTransientState.runState.runId,
      nextPendingHistorySyncRunId: nextSessionId === null
        ? null
        : pendingHistorySyncRunIdBySessionRef.current[nextSessionId] ?? null,
    })
    previousSessionIdRef.current = nextSessionId
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    setThinkingCapability(null)
    setSendError(null)
  }, [debugModeEnabled, sessionShell?.sessionId])

  useEffect(() => {
    const selectedModelRoute = selectedModelRouteFromDraft

    if (!workspaceStateLoaded || !isCopilotConnectableState(state) || sessionShell === null || selectedModelRoute === null) {
      setThinkingCapability(null)
      return
    }

    let cancelled = false
    const thinkingCapabilityOverride = selectedModelOption?.thinkingCapabilityOverride ?? null
    setThinkingCapability(null)

    void (async () => {
      try {
        const response = await getThinkingCapability({
          runtimeUrl: state.runtimeUrl,
          sessionId: sessionShell.sessionId,
          modelRoute: selectedModelRoute,
          thinkingCapabilityOverride,
        })

        if (!cancelled) {
          setThinkingCapability(response.capability)
        }
      } catch (error) {
        if (cancelled) {
          return
        }

        appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'thinking-capability-query-failed', {
          sessionId: sessionShell.sessionId,
          modelId: effectiveComposerDraft.selectedModelId,
          route: selectedModelRoute,
          error: error instanceof Error ? error.message : String(error),
        })
        setThinkingCapability(
          error instanceof RuntimeRequestError
            ? buildRuntimeThinkingCapabilityFromError({
                error,
                modelRoute: selectedModelRoute,
              })
            : null,
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    debugModeEnabled,
    effectiveComposerDraft.selectedModelId,
    getThinkingCapability,
    selectedModelOption?.thinkingCapabilityOverride,
    sessionShell,
    state,
    selectedModelRouteFromDraft,
    workspaceStateLoaded,
  ])

  useEffect(() => {
    if (runtimeDebugSummary !== null) {
      appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'runtime-summary', runtimeDebugSummary)
    }
  }, [debugModeEnabled, runtimeDebugSummary])

  useEffect(() => {
    if (sessionDebugSummary !== null) {
      appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'session-summary', sessionDebugSummary)
    }
  }, [debugModeEnabled, sessionDebugSummary])

  useEffect(() => {
    appendCopilotDebugLog(debugModeEnabled, 'copilot-chat-panel', 'conversation-source-evaluated', {
      sessionId: sessionShell?.sessionId ?? null,
      selectedRunId: sessionHistory?.selectedRunId ?? null,
      persistedConversationLength: persistedConversation.length,
      persistedConversationSource: persistedSelectedRunConversationSource,
      hasRenderablePersistedSelectedConversation,
      shouldRenderTransientConversation,
      hasTransientConversation,
      transientConversationLength: conversation.length,
      runStatePhase: runState.phase,
      runStateRunId: runState.runId,
      detailStatus: sessionHistory?.detailStatus ?? null,
      replayStatus: sessionHistory?.replayStatus ?? null,
      timelineItemCount: sessionHistory?.timelineItems.length ?? 0,
      runSummaryCount: sessionHistory?.runSummaries.length ?? 0,
    })
  }, [
    conversation.length,
    debugModeEnabled,
    hasRenderablePersistedSelectedConversation,
    hasTransientConversation,
    persistedConversation.length,
    persistedSelectedRunConversationSource,
    runState.phase,
    runState.runId,
    sessionHistory?.detailStatus,
    sessionHistory?.replayStatus,
    sessionHistory?.runSummaries.length,
    sessionHistory?.selectedRunId,
    sessionHistory?.timelineItems.length,
    sessionShell?.sessionId,
    shouldRenderTransientConversation,
  ])

  const baseSendDisabledReason = useMemo(
    () => getCopilotSendDisabledReason({
      state,
      sessionShell,
      runState,
      composerDraft: effectiveComposerDraft,
      hasConfiguredModels,
      hasAvailableModels,
      selectedModelOption,
    }),
    [
      effectiveComposerDraft,
      hasAvailableModels,
      hasConfiguredModels,
      runState,
      selectedModelOption,
      sessionShell,
      state,
    ],
  )
  const sendDisabledReason = useMemo(() => {
    if (baseSendDisabledReason !== null) {
      return baseSendDisabledReason
    }

    if (
      sessionHistory?.isPersistedThread === true
      && sessionShell?.capabilities.capabilitiesVersion === 'history-shell'
    ) {
      if (sessionHistory.capabilitiesStatus === 'loading' || sessionHistory.capabilitiesStatus === 'idle') {
        return '正在恢复历史线程能力，请稍候。'
      }

      if (sessionHistory.capabilitiesStatus === 'error') {
        return '历史线程能力恢复失败，请重试后再发送。'
      }
    }

    if (historyDrift?.requiresExplicitRebind === true && !historyRebindAcknowledged) {
      return '历史线程依赖已变化，请先显式重新绑定当前配置后再继续。'
    }

    return null
  }, [baseSendDisabledReason, historyDrift, historyRebindAcknowledged, sessionHistory, sessionShell])

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (historyDrift?.requiresExplicitRebind === true && !historyRebindAcknowledged) {
      return
    }

    const abortController = new AbortController()
    activeAbortControllerRef.current = abortController
    const boundSessionId = sessionShell?.sessionId ?? null
    const setBoundRunState: Dispatch<SetStateAction<CopilotRunState>> = (value) => {
      if (boundSessionId === null) {
        return
      }

      setTransientStateBySessionId((current) => updateCopilotSessionTransientState(current, boundSessionId, (sessionState) => {
        const nextRunState = typeof value === 'function' ? value(sessionState.runState) : value
        return nextRunState === sessionState.runState
          ? sessionState
          : {
              ...sessionState,
              runState: nextRunState,
            }
      }))
    }
    const setBoundConversation: Dispatch<SetStateAction<CopilotMessageListItem[]>> = (value) => {
      if (boundSessionId === null) {
        return
      }

      setTransientStateBySessionId((current) => updateCopilotSessionTransientState(current, boundSessionId, (sessionState) => {
        const nextConversation = typeof value === 'function' ? value(sessionState.conversation) : value
        return nextConversation === sessionState.conversation
          ? sessionState
          : {
              ...sessionState,
              conversation: nextConversation,
            }
      }))
    }

    try {
      await orchestrateCopilotSend({
        state,
        sessionShell,
        composerDraft: effectiveComposerDraft,
        runState,
        hasConfiguredModels,
        hasAvailableModels,
        selectedModelOption,
        composerInputRef,
        sendMessage,
        debugModeEnabled: isCopilotConnectableState(state) ? state.bootstrapFields.debugModeEnabled : false,
        setRunState: setBoundRunState,
        setSendError,
        setComposerDraft,
        setConversation: setBoundConversation,
        signal: abortController.signal,
        thinkingCapabilityOverride: (selectedModelOption?.thinkingCapabilityOverride ?? null) as Record<string, unknown> | null,
      })
    } finally {
      clearAbortController(activeAbortControllerRef, abortController)
    }
  }

  const handleCancelCurrentRun = () => {
    const abortController = activeAbortControllerRef.current
    if (abortController === null) {
      return
    }

    if (isCopilotConnectableState(state) && runState.runId !== null) {
      void cancelRun({
        runtimeUrl: state.runtimeUrl,
        runId: runState.runId,
      }).catch(() => undefined).finally(() => {
        abortController.abort()
      })
      return
    }

    abortController.abort()
  }

  return {
    sendError,
    modelGroups: modelCatalog.groups,
    thinkingCapability: effectiveThinkingCapability,
    composerDraft: effectiveComposerDraft,
    onComposerDraftChange: setComposerDraft,
    onSend: handleSend,
    onCancelCurrentRun: handleCancelCurrentRun,
    sendStatus,
    canCancelSend,
    sendDisabledReason,
    historyDrift,
    historyRebindAcknowledged,
    persistedSelectedRunConversationSource,
    onAcknowledgeHistoryRebind: () => {
      setHistoryRebindAcknowledged(true)
    },
    hasTransientConversation,
    conversation: projectedConversation,
    assistantPlaceholder,
    composerInputRef,
    composerHeight,
    onComposerResizeStart,
  }
}
