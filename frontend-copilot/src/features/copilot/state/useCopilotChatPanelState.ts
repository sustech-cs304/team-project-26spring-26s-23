import {
  useCallback,
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

import {
  createEmptyComposerAttachmentsState,
  revokeComposerAttachmentPreviewUrls,
} from '../attachments/state'
import type { CopilotComposerAttachmentsState } from '../attachments/types'
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
import { resolveRuntimeToolApproval } from '../tool-approval'
import { appendCopilotDebugLog, isCopilotDebugModeEnabled } from '../debug-mode-log'

const DEBUG_LOG_CATEGORY = 'copilot-chat-panel'
import {
  expirePendingCopilotInlineFormSegments,
  markCopilotInlineFormSubmitted,
} from '../run-segment-reducer'
import {
  applyModelSelectionToComposerDraft,
  buildRuntimeToolPermissionPolicy,
  buildRuntimeDebugSummary,
  buildRuntimeThinkingCapabilityFromError,
  buildSessionDebugSummary,
  type CopilotChatComposerDraft,
  type CopilotTransientErrorState,
} from '../copilot-chat-helpers'
import { sanitizeEnabledToolIds } from '../tool-picker'
import {
  resolvePersistedHistoryDrift,
  type PersistedHistoryDriftSummary,
} from '../persisted-history-drift'
import {
  buildPersistedConversationFromHistory,
  getPersistedInlineFormRebuildability,
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
import {
  resolveCopilotThreadRuntimeControllerState as resolveCopilotSessionTransientState,
  updateCopilotThreadRuntimeControllerStateRecord as updateCopilotSessionTransientState,
  type CopilotThreadRuntimeControllerState as CopilotSessionTransientState,
} from '../thread-runtime-controller'
import { useAssistantMessageNotification } from '../useAssistantMessageNotification'
import { useCopilotComposerResize } from '../useCopilotComposerResize'
import type { CopilotBootstrapState, CopilotRunState } from '../types'
import {
  isSameModelRoute,
  resolveComposerDraftModelSelection,
  resolveDisplayedThinkingCapability,
  resolveSelectedComposerModelRoute,
} from './CopilotChatPanelViewModel'

export interface CopilotChatPanelShellProps {
  language?: string
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
  persistedSelectedRunConversationPending?: boolean
  renderLoadingSkeleton?: boolean
  messageSurfaceVisible?: boolean
  sendMessage?: typeof dispatchCopilotMessage
  cancelRun?: typeof cancelRuntimeRun
  getThinkingCapability?: typeof getRuntimeThinkingCapability
  loadWorkspaceState?: typeof loadSettingsWorkspaceState
  runtimeControllerBySessionId?: Record<string, CopilotSessionTransientState>
  setRuntimeControllerBySessionId?: Dispatch<SetStateAction<Record<string, CopilotSessionTransientState>>>
}

export interface CopilotChatPanelState {
  sendError: CopilotTransientErrorState | null
  modelGroups: CopilotModelGroup[]
  thinkingCapability: RuntimeThinkingCapability | null
  composerDraft: CopilotChatComposerDraft
  composerAttachments: CopilotComposerAttachmentsState
  toolPermissionPolicy: Parameters<typeof buildRuntimeToolPermissionPolicy>[0]['policy']
  onComposerDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onComposerAttachmentsChange: Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
  onSend: (event: FormEvent<HTMLFormElement>) => void
  onSubmitInlineForm: (input: {
    toolCallId: string
    formId: string
    summary: string
    structuredPayload: Record<string, unknown>
    values: Record<string, string | number | boolean>
  }) => Promise<void>
  onCancelCurrentRun: () => void
  onResolveToolApproval: (input: {
    runId: string
    toolCallId: string
    decision: 'approved' | 'rejected'
  }) => Promise<void>
  sendStatus: 'idle' | 'sending'
  canCancelSend: boolean
  sendDisabledReason: string | null
  composerLockedReason: string | null
  historyDrift: PersistedHistoryDriftSummary | null
  historyRebindAcknowledged: boolean
  onAcknowledgeHistoryRebind: () => void
  persistedSelectedRunConversationSource: PersistedConversationSource
  persistedSelectedRunConversationPending: boolean
  hasTransientConversation: boolean
  conversation: CopilotMessageListItem[]
  assistantPlaceholder: CopilotAssistantPlaceholderState
  runtimeUrl: string | null
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onComposerResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}


// This hook orchestrates workspace settings, session transient state, model
// selection, conversation computation, thinking capability queries, and send
// actions. Each domain is tightly coupled; extracting sub-hooks would require
// excessive parameter threading and duplicate closure captures.
// eslint-disable-next-line max-lines-per-function
export function useCopilotChatPanelState({
  language = 'zh-CN',
  state,
  selectedAgent,
  sessionShell,
  directoryState,
  sessionHistory = null,
  onSessionRunSettled,
  sendMessage = dispatchCopilotMessage,
  cancelRun = cancelRuntimeRun,
  getThinkingCapability = getRuntimeThinkingCapability,
  loadWorkspaceState = loadSettingsWorkspaceState,
  runtimeControllerBySessionId,
  setRuntimeControllerBySessionId,
}: CopilotChatPanelShellProps): CopilotChatPanelState {
  const [internalTransientStateBySessionId, setInternalTransientStateBySessionId] = useState<Record<string, CopilotSessionTransientState>>({})
  const transientStateBySessionId = runtimeControllerBySessionId ?? internalTransientStateBySessionId
  const setTransientStateBySessionId = setRuntimeControllerBySessionId ?? setInternalTransientStateBySessionId
  const [assistantNotificationsEnabled, setAssistantNotificationsEnabled] = useState(false)
  const [workspaceProviderProfiles, setWorkspaceProviderProfiles] = useState<Parameters<typeof createCopilotModelCatalog>[0]>([])
  const [workspacePrimaryModel, setWorkspacePrimaryModel] = useState('')
  const [workspacePrimaryModelRoute, setWorkspacePrimaryModelRoute] = useState<ModelRouteRef | null>(null)
  const [workspaceToolPermissionPolicy, setWorkspaceToolPermissionPolicy] = useState<Parameters<typeof buildRuntimeToolPermissionPolicy>[0]['policy']>(null)
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const { composerHeight, onComposerResizeStart } = useCopilotComposerResize()
  const transientStateBySessionIdRef = useRef<Record<string, CopilotSessionTransientState>>({})
  const previousSessionIdRef = useRef<string | null>(null)

  const activeSessionId = sessionShell?.sessionId ?? null
  const activeTransientState = useMemo(
    () => resolveCopilotSessionTransientState(transientStateBySessionId, activeSessionId),
    [activeSessionId, transientStateBySessionId],
  )
  const composerDraft = activeTransientState.composerDraft
  const composerAttachments = activeTransientState.composerAttachments
  const conversation = activeTransientState.conversation
  const runState = activeTransientState.runState
  const thinkingCapability = activeTransientState.thinkingCapability
  const sendError = activeTransientState.sendError
  const historyRebindAcknowledged = activeTransientState.historyRebindAcknowledged

  const updateSessionTransientStateById = useCallback((
    sessionId: string | null | undefined,
    updater: (state: CopilotSessionTransientState) => CopilotSessionTransientState,
  ) => {
    const normalizedSessionId = sessionId?.trim() ?? ''
    if (normalizedSessionId === '') {
      return
    }

    setTransientStateBySessionId((current) => updateCopilotSessionTransientState(current, normalizedSessionId, updater))
  }, [setTransientStateBySessionId])

  const setActiveSessionTransientState = useCallback((
    updater: (state: CopilotSessionTransientState) => CopilotSessionTransientState,
  ) => {
    updateSessionTransientStateById(activeSessionId, updater)
  }, [activeSessionId, updateSessionTransientStateById])

  const setComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>> = useCallback((value) => {
    setActiveSessionTransientState((sessionState) => {
      const nextComposerDraft = typeof value === 'function' ? value(sessionState.composerDraft) : value
      return nextComposerDraft === sessionState.composerDraft
        ? sessionState
        : {
            ...sessionState,
            composerDraft: nextComposerDraft,
          }
    })
  }, [setActiveSessionTransientState])

  const setComposerAttachments: Dispatch<SetStateAction<CopilotComposerAttachmentsState>> = useCallback((value) => {
    setActiveSessionTransientState((sessionState) => {
      const nextComposerAttachments = typeof value === 'function'
        ? value(sessionState.composerAttachments)
        : value
      return nextComposerAttachments === sessionState.composerAttachments
        ? sessionState
        : {
            ...sessionState,
            composerAttachments: nextComposerAttachments,
          }
    })
  }, [setActiveSessionTransientState])

  const setThinkingCapability: Dispatch<SetStateAction<RuntimeThinkingCapability | null>> = useCallback((value) => {
    setActiveSessionTransientState((sessionState) => {
      const nextThinkingCapability = typeof value === 'function'
        ? value(sessionState.thinkingCapability)
        : value
      return nextThinkingCapability === sessionState.thinkingCapability
        ? sessionState
        : {
            ...sessionState,
            thinkingCapability: nextThinkingCapability,
          }
    })
  }, [setActiveSessionTransientState])

  const setHistoryRebindAcknowledged: Dispatch<SetStateAction<boolean>> = useCallback((value) => {
    setActiveSessionTransientState((sessionState) => {
      const nextHistoryRebindAcknowledged = typeof value === 'function'
        ? value(sessionState.historyRebindAcknowledged)
        : value
      return nextHistoryRebindAcknowledged === sessionState.historyRebindAcknowledged
        ? sessionState
        : {
            ...sessionState,
            historyRebindAcknowledged: nextHistoryRebindAcknowledged,
          }
    })
  }, [setActiveSessionTransientState])

  const activeAbortController = activeTransientState.activeAbortController

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
  const pendingHistorySyncRunId = activeTransientState.pendingHistorySyncRunId
  const persistedHandoffConversationBuildResult = useMemo(
    () => pendingHistorySyncRunId === null
      ? {
          conversation: [],
          selectedRunConversationSource: 'none' as const,
        }
      : buildPersistedConversationFromHistory(sessionHistory, {
          runId: pendingHistorySyncRunId,
        }),
    [pendingHistorySyncRunId, sessionHistory],
  )
  const persistedHandoffConversation = persistedHandoffConversationBuildResult.conversation
  const persistedHandoffConversationSource = persistedHandoffConversationBuildResult.selectedRunConversationSource
  const hasRenderablePersistedSelectedConversation = useMemo(
    () => persistedConversation.length > 0,
    [persistedConversation],
  )
  const hasSufficientPersistedSelectedConversationForActiveRun = useMemo(
    () => hasSufficientPersistedConversationForRun({
      conversation: persistedConversation,
      runId: runState.runId,
      runPhase: runState.phase,
      sessionHistory,
      runState,
    }),
    [persistedConversation, runState, sessionHistory],
  )
  const hasRenderablePersistedHandoffConversation = useMemo(
    () => pendingHistorySyncRunId !== null && persistedHandoffConversation.length > 0,
    [pendingHistorySyncRunId, persistedHandoffConversation],
  )
  const persistedHandoffConversationWaitReason = useMemo(
    () => resolvePersistedConversationHandoffWaitReason({
      conversation: persistedHandoffConversation,
      pendingRunId: pendingHistorySyncRunId,
      runState,
      sessionHistory,
    }),
    [pendingHistorySyncRunId, persistedHandoffConversation, runState, sessionHistory],
  )
  const persistedSelectedRunConversationPending = useMemo(() => (
    sessionHistory !== null
    && sessionHistory.isPersistedThread === true
    && sessionHistory.detailStatus === 'ready'
    && sessionHistory.selectedRunId !== null
    && !hasRenderablePersistedSelectedConversation
    && sessionHistory.replayStatus !== 'error'
    && sessionHistory.replayStatus !== 'ready'
  ), [hasRenderablePersistedSelectedConversation, sessionHistory])
  // Determines whether to render transient conversation over persisted history.
  // Multi-branch decision tree with tightly coupled boolean predicates.
  // eslint-disable-next-line complexity
  const shouldRenderTransientConversation = useMemo(() => {
    if (runState.phase !== 'idle' && runState.threadId !== sessionShell?.sessionId) {
      return false
    }

    if (sessionHistory === null || sessionHistory.detailStatus !== 'ready') {
      return conversation.length > 0 || runState.phase !== 'idle'
    }

    if (
      runState.phase === 'starting'
      || runState.phase === 'streaming'
    ) {
      return true
    }

    const runId = runState.runId?.trim() ?? ''
    if (conversation.length > 0 && runId === '') {
      return true
    }

    if (runId === '') {
      return false
    }

    const persistedRunIds = new Set(sessionHistory.runSummaries.map((runSummary) => runSummary.runId))
    if (!persistedRunIds.has(runId)) {
      return true
    }

    if (sessionHistory.selectedRunId !== runId) {
      const hasProtectedTransientRunForActiveSession = runState.threadId === sessionShell?.sessionId
        && (
          runState.phase === 'awaiting_input'
          || runState.phase === 'completed'
          || runState.phase === 'failed'
          || runState.phase === 'cancelled'
        )
      return hasProtectedTransientRunForActiveSession
        ? pendingHistorySyncRunId === runId || !hasRenderablePersistedSelectedConversation
        : false
    }

    return !hasSufficientPersistedSelectedConversationForActiveRun
  }, [
    conversation.length,
    hasRenderablePersistedSelectedConversation,
    hasSufficientPersistedSelectedConversationForActiveRun,
    pendingHistorySyncRunId,
    runState.phase,
    runState.runId,
    runState.threadId,
    sessionHistory,
    sessionShell?.sessionId,
  ])
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
  const composerLockedReason = useMemo(() => null, [])
  const sendStatus = runState.phase === 'starting' || runState.phase === 'streaming'
    ? 'sending'
    : 'idle'
  const canCancelSend = activeAbortController !== null && sendStatus === 'sending'
  const historyDrift = useMemo(
    () => sessionHistory?.selectedRunId === null
      ? null
      : resolvePersistedHistoryDrift(sessionHistory),
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
    if (sessionShell === null) {
      return
    }

    setTransientStateBySessionId((current) => updateCopilotSessionTransientState(
      current,
      sessionShell.sessionId,
      (sessionState) => sessionState,
      { capabilities: sessionShell.capabilities },
    ))
  }, [sessionIdentity, sessionShell, setTransientStateBySessionId])

  useEffect(() => {
    setHistoryRebindAcknowledged(false)
  }, [historyDriftResetKey, setHistoryRebindAcknowledged])

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
        && sessionRunState.phase !== 'awaiting_input'
      ) {
        continue
      }

      const runId = sessionRunState.runId?.trim() ?? ''
      const settledSessionId = sessionRunState.threadId?.trim() ?? ''
      if (runId === '' || settledSessionId === '' || transientState.lastSettledRunId === runId) {
        continue
      }

      const tracksPendingHistorySync = sessionId === settledSessionId
      updateSessionTransientStateById(sessionId, (sessionState) => ({
        ...sessionState,
        lastSettledRunId: runId,
        pendingHistorySyncRunId: tracksPendingHistorySync ? runId : sessionState.pendingHistorySyncRunId,
        pendingHistorySyncLogKey: tracksPendingHistorySync ? null : sessionState.pendingHistorySyncLogKey,
      }))

      appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'run-settled-pending-history-sync', {
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
    updateSessionTransientStateById,
  ])

  // Pending history sync wait → commit loop. Multiple session-bound
  // conditions share memoized values; extracting would scatter state.
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity
  useEffect(() => {
    const sessionId = sessionShell?.sessionId?.trim() ?? ''
    if (sessionId === '') {
      return
    }

    const pendingRunId = activeTransientState.pendingHistorySyncRunId
    if (pendingRunId === null) {
      if (activeTransientState.pendingHistorySyncLogKey !== null) {
        updateSessionTransientStateById(sessionId, (sessionState) => ({
          ...sessionState,
          pendingHistorySyncLogKey: null,
        }))
      }
      return
    }

    const waitReason = sessionHistory === null
      ? 'missing-session-history'
      : sessionHistory.detailStatus !== 'ready'
        ? 'detail-not-ready'
        : !sessionHistory.runSummaries.some((runSummary) => runSummary.runId === pendingRunId)
          ? 'handoff-run-missing-from-detail'
          : persistedHandoffConversationWaitReason

    if (waitReason !== null) {
      const logKey = [
        pendingRunId,
        waitReason,
        sessionHistory?.selectedRunId ?? '',
        sessionHistory?.detailStatus ?? '',
        hasRenderablePersistedHandoffConversation ? 'renderable' : 'empty',
      ].join('::')
      if (activeTransientState.pendingHistorySyncLogKey !== logKey) {
        updateSessionTransientStateById(sessionId, (sessionState) => ({
          ...sessionState,
          pendingHistorySyncLogKey: logKey,
        }))
        appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'pending-history-sync-waiting', {
          sessionId,
          pendingRunId,
          selectedRunId: sessionHistory?.selectedRunId ?? null,
          detailStatus: sessionHistory?.detailStatus ?? null,
          replayStatus: sessionHistory?.replayStatus ?? null,
          transientRunId: runState.runId,
          transientRunPhase: runState.phase,
          persistedConversationLength: persistedConversation.length,
          persistedConversationSource: persistedSelectedRunConversationSource,
          persistedHandoffConversationLength: persistedHandoffConversation.length,
          persistedHandoffConversationSource,
          hasRenderablePersistedHandoffConversation,
          waitReason,
        })
      }
      return
    }

    const readySessionHistory = sessionHistory
    if (readySessionHistory === null) {
      return
    }

    appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'pending-history-sync-committed', {
      sessionId,
      pendingRunId,
      selectedRunId: readySessionHistory.selectedRunId,
      persistedConversationLength: persistedConversation.length,
      persistedConversationSource: persistedSelectedRunConversationSource,
      persistedHandoffConversationLength: persistedHandoffConversation.length,
      persistedHandoffConversationSource,
    })
    updateSessionTransientStateById(sessionId, (sessionState) => ({
      ...sessionState,
      pendingHistorySyncRunId: null,
      pendingHistorySyncLogKey: null,
      conversation: [],
      runState: sessionState.runState.runId === pendingRunId ? createIdleCopilotRunState() : sessionState.runState,
    }))
  }, [
    activeTransientState.pendingHistorySyncLogKey,
    activeTransientState.pendingHistorySyncRunId,
    debugModeEnabled,
    hasRenderablePersistedHandoffConversation,
    persistedHandoffConversationWaitReason,
    persistedConversation.length,
    persistedHandoffConversation.length,
    persistedHandoffConversationSource,
    persistedSelectedRunConversationSource,
    runState.phase,
    runState.runId,
    sessionHistory,
    sessionShell?.sessionId,
    updateSessionTransientStateById,
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
        setAssistantNotificationsEnabled(result.state.general.assistantNotificationsEnabled)
        setWorkspaceToolPermissionPolicy(result.state.mcp.toolPermissionPolicy)
        setWorkspaceStateLoaded(true)
        return
      }

      setWorkspaceProviderProfiles([])
      setWorkspacePrimaryModel('')
      setWorkspacePrimaryModelRoute(null)
      setAssistantNotificationsEnabled(false)
      setWorkspaceToolPermissionPolicy(null)
      setWorkspaceStateLoaded(true)
    })()

    return () => {
      cancelled = true
    }
  }, [loadWorkspaceState])

  useEffect(() => {
    return () => {
      for (const sessionState of Object.values(transientStateBySessionIdRef.current)) {
        sessionState.activeAbortController?.abort()
      }
    }
  }, [])

  useEffect(() => {
    if (!workspaceStateLoaded || sessionShell === null) {
      return
    }

    setComposerDraft((current) => {
      const enabledTools = sanitizeEnabledToolIds({
        selectedToolIds: current.enabledTools,
        tools: sessionShell.capabilities.allAvailableTools,
        policy: workspaceToolPermissionPolicy,
      })

      return haveSameOrderedStrings(current.enabledTools, enabledTools)
        ? current
        : {
            ...current,
            enabledTools,
          }
    })
  }, [sessionShell, setComposerDraft, workspaceStateLoaded, workspaceToolPermissionPolicy])

  useEffect(() => {
    if (!workspaceStateLoaded) {
      return
    }

    // Multi-path model selection resolver: provider overrides, workspace
    // defaults, draft fallback. Each branch handles a distinct selection
    // scenario with its own validity checks.
    // eslint-disable-next-line complexity, sonarjs/cognitive-complexity
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
    setComposerDraft,
  ])

  useEffect(() => {
    const previousSessionId = previousSessionIdRef.current
    const previousTransientState = resolveCopilotSessionTransientState(transientStateBySessionIdRef.current, previousSessionId)
    const nextSessionId = sessionShell?.sessionId ?? null
    const nextTransientState = resolveCopilotSessionTransientState(transientStateBySessionIdRef.current, nextSessionId)

    appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'session-switch-retained-transient', {
      previousSessionId,
      nextSessionId,
      previousTransientConversationLength: previousTransientState.conversation.length,
      previousRunStatePhase: previousTransientState.runState.phase,
      previousRunStateRunId: previousTransientState.runState.runId,
      previousPendingHistorySyncRunId: previousTransientState.pendingHistorySyncRunId,
      nextTransientConversationLength: nextTransientState.conversation.length,
      nextRunStatePhase: nextTransientState.runState.phase,
      nextRunStateRunId: nextTransientState.runState.runId,
      nextPendingHistorySyncRunId: nextTransientState.pendingHistorySyncRunId,
    })
    previousSessionIdRef.current = nextSessionId
    if (nextSessionId !== null) {
      setTransientStateBySessionId((current) => updateCopilotSessionTransientState(
        current,
        nextSessionId,
        (sessionState) => sessionState,
      ))
    }
  }, [debugModeEnabled, sessionShell?.sessionId, setTransientStateBySessionId])

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

        appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'thinking-capability-query-failed', {
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
    setThinkingCapability,
  ])

  useEffect(() => {
    if (runtimeDebugSummary !== null) {
      appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'runtime-summary', runtimeDebugSummary)
    }
  }, [debugModeEnabled, runtimeDebugSummary])

  useEffect(() => {
    if (sessionDebugSummary !== null) {
      appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'session-summary', sessionDebugSummary)
    }
  }, [debugModeEnabled, sessionDebugSummary])

  useEffect(() => {
    appendCopilotDebugLog(debugModeEnabled, DEBUG_LOG_CATEGORY, 'conversation-source-evaluated', {
      sessionId: sessionShell?.sessionId ?? null,
      selectedRunId: sessionHistory?.selectedRunId ?? null,
      pendingHistorySyncRunId,
      persistedConversationLength: persistedConversation.length,
      persistedConversationSource: persistedSelectedRunConversationSource,
      persistedSelectedRunConversationPending,
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
      historyDriftVisible: historyDrift !== null,
      historyViewMode: sessionHistory?.selectedRunId === null
        ? 'thread-timeline'
        : persistedSelectedRunConversationSource,
    })
  }, [
    conversation.length,
    debugModeEnabled,
    hasRenderablePersistedSelectedConversation,
    hasTransientConversation,
    historyDrift,
    pendingHistorySyncRunId,
    persistedConversation.length,
    persistedSelectedRunConversationPending,
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

  useAssistantMessageNotification({
    language,
    notificationsEnabled: assistantNotificationsEnabled,
    runState,
  })

  const baseSendDisabledReason = useMemo(
    () => getCopilotSendDisabledReason({
      state,
      sessionShell,
      runState,
      composerDraft: effectiveComposerDraft,
      hasAttachments: composerAttachments.items.length > 0,
      hasConfiguredModels,
      hasAvailableModels,
      selectedModelOption,
    }),
    [
      composerAttachments.items.length,
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

  const createBoundSessionDispatchers = useCallback((boundSessionId: string | null) => {
    const setBoundRunState: Dispatch<SetStateAction<CopilotRunState>> = (value) => {
      updateSessionTransientStateById(boundSessionId, (sessionState) => {
        const nextRunState = typeof value === 'function' ? value(sessionState.runState) : value
        return nextRunState === sessionState.runState
          ? sessionState
          : {
              ...sessionState,
              runState: nextRunState,
            }
      })
    }

    const setBoundConversation: Dispatch<SetStateAction<CopilotMessageListItem[]>> = (value) => {
      updateSessionTransientStateById(boundSessionId, (sessionState) => {
        const nextConversation = typeof value === 'function' ? value(sessionState.conversation) : value
        return nextConversation === sessionState.conversation
          ? sessionState
          : {
              ...sessionState,
              conversation: nextConversation,
            }
      })
    }

    const setBoundSendError: Dispatch<SetStateAction<CopilotTransientErrorState | null>> = (value) => {
      updateSessionTransientStateById(boundSessionId, (sessionState) => {
        const nextSendError = typeof value === 'function' ? value(sessionState.sendError) : value
        return nextSendError === sessionState.sendError
          ? sessionState
          : {
              ...sessionState,
              sendError: nextSendError,
            }
      })
    }

    const setBoundComposerDraft: Dispatch<SetStateAction<CopilotChatComposerDraft>> = (value) => {
      updateSessionTransientStateById(boundSessionId, (sessionState) => {
        const nextComposerDraft = typeof value === 'function' ? value(sessionState.composerDraft) : value
        return nextComposerDraft === sessionState.composerDraft
          ? sessionState
          : {
              ...sessionState,
              composerDraft: nextComposerDraft,
            }
      })
    }

    const setBoundComposerAttachments: Dispatch<SetStateAction<CopilotComposerAttachmentsState>> = (value) => {
      updateSessionTransientStateById(boundSessionId, (sessionState) => {
        const nextComposerAttachments = typeof value === 'function'
          ? value(sessionState.composerAttachments)
          : value
        return nextComposerAttachments === sessionState.composerAttachments
          ? sessionState
          : {
              ...sessionState,
              composerAttachments: nextComposerAttachments,
            }
      })
    }

    return {
      setBoundRunState,
      setBoundConversation,
      setBoundSendError,
      setBoundComposerDraft,
      setBoundComposerAttachments,
    }
  }, [updateSessionTransientStateById])

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (historyDrift?.requiresExplicitRebind === true && !historyRebindAcknowledged) {
      return
    }

    const abortController = new AbortController()
    const boundSessionId = sessionShell?.sessionId ?? null
    const {
      setBoundRunState,
      setBoundConversation,
      setBoundSendError,
      setBoundComposerDraft,
      setBoundComposerAttachments,
    } = createBoundSessionDispatchers(boundSessionId)
    const attachmentsSnapshot = composerAttachments.items.slice()

    setBoundComposerAttachments((current) => {
      revokeComposerAttachmentPreviewUrls(current.items)
      return createEmptyComposerAttachmentsState()
    })

    updateSessionTransientStateById(boundSessionId, (sessionState) => (
      sessionState.activeAbortController === abortController
        ? sessionState
        : {
            ...sessionState,
            activeAbortController: abortController,
          }
    ))

    try {
      await orchestrateCopilotSend({
        state,
        sessionShell,
        composerDraft: effectiveComposerDraft,
        attachments: attachmentsSnapshot,
        runState: expirePendingCopilotInlineFormSegments(runState),
        hasConfiguredModels,
        hasAvailableModels,
        selectedModelOption,
        composerInputRef,
        sendMessage,
        debugModeEnabled: isCopilotConnectableState(state) ? state.bootstrapFields.debugModeEnabled : false,
        setRunState: setBoundRunState,
        setSendError: setBoundSendError,
        setComposerDraft: setBoundComposerDraft,
        setConversation: setBoundConversation,
        signal: abortController.signal,
        thinkingCapabilityOverride: (selectedModelOption?.thinkingCapabilityOverride ?? null) as Record<string, unknown> | null,
        toolPermissionPolicy: workspaceToolPermissionPolicy,
      })
    } finally {
      updateSessionTransientStateById(boundSessionId, (sessionState) => (
        sessionState.activeAbortController === abortController
          ? {
              ...sessionState,
              activeAbortController: null,
            }
          : sessionState
      ))
    }
  }

  const handleSubmitInlineForm: CopilotChatPanelState['onSubmitInlineForm'] = async (input) => {
    if (historyDrift?.requiresExplicitRebind === true && !historyRebindAcknowledged) {
      throw new Error('历史线程依赖已变化，请先显式重新绑定当前配置后再继续。')
    }

    const abortController = new AbortController()
    const boundSessionId = sessionShell?.sessionId ?? null
    const {
      setBoundRunState,
      setBoundConversation,
      setBoundSendError,
      setBoundComposerDraft,
    } = createBoundSessionDispatchers(boundSessionId)
    const submittedRunState = markCopilotInlineFormSubmitted(runState, {
      toolCallId: input.toolCallId,
      values: input.values,
      submittedPayload: input.structuredPayload,
    })

    updateSessionTransientStateById(boundSessionId, (sessionState) => ({
      ...sessionState,
      activeAbortController: abortController,
    }))

    try {
      await orchestrateCopilotSend({
        state,
        sessionShell,
        composerDraft: effectiveComposerDraft,
        runState: submittedRunState,
        hasConfiguredModels,
        hasAvailableModels,
        selectedModelOption,
        composerInputRef,
        sendMessage,
        debugModeEnabled: isCopilotConnectableState(state) ? state.bootstrapFields.debugModeEnabled : false,
        setRunState: setBoundRunState,
        setSendError: setBoundSendError,
        setComposerDraft: setBoundComposerDraft,
        setConversation: setBoundConversation,
        signal: abortController.signal,
        thinkingCapabilityOverride: (selectedModelOption?.thinkingCapabilityOverride ?? null) as Record<string, unknown> | null,
        toolPermissionPolicy: workspaceToolPermissionPolicy,
        messageOverride: {
          content: input.summary,
          structuredPayload: input.structuredPayload,
        },
        clearComposerOnSend: false,
      })
    } finally {
      updateSessionTransientStateById(boundSessionId, (sessionState) => (
        sessionState.activeAbortController === abortController
          ? {
              ...sessionState,
              activeAbortController: null,
            }
          : sessionState
      ))
    }
  }

  const handleCancelCurrentRun = () => {
    const abortController = activeAbortController
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

  const handleResolveToolApproval: CopilotChatPanelState['onResolveToolApproval'] = async (input) => {
    if (!isCopilotConnectableState(state)) {
      throw new Error('runtime_unavailable')
    }

    await resolveRuntimeToolApproval({
      runtimeUrl: state.runtimeUrl,
      runId: input.runId,
      toolCallId: input.toolCallId,
      decision: input.decision,
    })
  }

  return {
    sendError,
    modelGroups: modelCatalog.groups,
    thinkingCapability: effectiveThinkingCapability,
    composerDraft: effectiveComposerDraft,
    composerAttachments,
    toolPermissionPolicy: workspaceToolPermissionPolicy,
    onComposerDraftChange: setComposerDraft,
    onComposerAttachmentsChange: setComposerAttachments,
    onSend: handleSend,
    onSubmitInlineForm: handleSubmitInlineForm,
    onCancelCurrentRun: handleCancelCurrentRun,
    onResolveToolApproval: handleResolveToolApproval,
    sendStatus,
    canCancelSend,
    sendDisabledReason,
    composerLockedReason,
    historyDrift,
    historyRebindAcknowledged,
    persistedSelectedRunConversationSource,
    persistedSelectedRunConversationPending,
    onAcknowledgeHistoryRebind: () => {
      setHistoryRebindAcknowledged(true)
    },
    hasTransientConversation,
    conversation: projectedConversation,
    assistantPlaceholder,
    runtimeUrl: isCopilotConnectableState(state) ? state.runtimeUrl : null,
    composerInputRef,
    composerHeight,
    onComposerResizeStart,
  }
}

export function hasPendingInlineFormSegment(runState: CopilotRunState): boolean {
  return runState.segments.some((segment) => segment.kind === 'inline-form' && segment.formState === 'pending')
}

function haveSameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function hasSufficientPersistedConversationForRun(input: {
  conversation: CopilotMessageListItem[]
  runId: string | null
  runPhase: CopilotRunState['phase']
  sessionHistory: AssistantSessionHistoryState | null
  runState: CopilotRunState
}): boolean {
  if (input.conversation.length === 0) {
    return false
  }

  if (input.runPhase === 'awaiting_input') {
    if (!hasPendingInlineFormSegment(input.runState)) {
      return true
    }

    return getPersistedInlineFormRebuildability(input.sessionHistory, {
      runId: input.runId,
    }).hasPendingInlineForm
  }

  if (input.runPhase !== 'failed' && input.runPhase !== 'cancelled') {
    return true
  }

  return hasPersistedTerminalForRunPhase({
    conversation: input.conversation,
    runId: input.runId,
    terminalPhase: input.runPhase,
  })
}

export function resolvePersistedConversationHandoffWaitReason(input: {
  conversation: CopilotMessageListItem[]
  pendingRunId: string | null
  runState: CopilotRunState
  sessionHistory: AssistantSessionHistoryState | null
}): string | null {
  if (input.conversation.length === 0) {
    return 'persisted-handoff-run-empty'
  }

  const pendingRunId = input.pendingRunId?.trim() ?? ''
  if (pendingRunId === '' || input.runState.runId !== pendingRunId) {
    return null
  }

  if (input.runState.phase === 'awaiting_input' && hasPendingInlineFormSegment(input.runState)) {
    return getPersistedInlineFormRebuildability(input.sessionHistory, {
      runId: pendingRunId,
    }).hasPendingInlineForm
      ? null
      : 'awaiting-input-inline-form-missing-from-handoff'
  }

  if (input.runState.phase === 'failed' || input.runState.phase === 'cancelled') {
    return hasPersistedTerminalForRunPhase({
      conversation: input.conversation,
      runId: pendingRunId,
      terminalPhase: input.runState.phase,
    })
      ? null
      : `${input.runState.phase}-terminal-missing-from-handoff`
  }

  return null
}

function hasPersistedTerminalForRunPhase(input: {
  conversation: CopilotMessageListItem[]
  runId: string | null
  terminalPhase: 'failed' | 'cancelled'
}): boolean {
  const normalizedRunId = input.runId?.trim() ?? ''
  if (normalizedRunId === '') {
    return false
  }

  return input.conversation.some((item) => (
    item.kind === 'terminal'
    && item.runId === normalizedRunId
    && item.terminalPhase === input.terminalPhase
  ))
}
