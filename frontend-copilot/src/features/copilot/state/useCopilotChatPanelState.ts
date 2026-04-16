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
import { loadSettingsWorkspaceState } from '../../../workbench/settings/workspace-state'
import {
  cancelRuntimeRun,
  getRuntimeThinkingCapability,
  RuntimeRequestError,
  type RuntimeThinkingCapability,
} from '../chat-contract'
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
import { useAssistantMessageNotification } from '../useAssistantMessageNotification'
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
  language?: string
  state: CopilotBootstrapState
  retrying: boolean
  retry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
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
  conversation: CopilotMessageListItem[]
  assistantPlaceholder: CopilotAssistantPlaceholderState
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onComposerResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

export function useCopilotChatPanelState({
  language = 'zh-CN',
  state,
  selectedAgent,
  sessionShell,
  directoryState,
  sendMessage = dispatchCopilotMessage,
  cancelRun = cancelRuntimeRun,
  getThinkingCapability = getRuntimeThinkingCapability,
  loadWorkspaceState = loadSettingsWorkspaceState,
}: CopilotChatPanelShellProps): CopilotChatPanelState {
  const [composerDraft, setComposerDraft] = useState<CopilotChatComposerDraft>(createEmptyComposerDraft)
  const [conversation, setConversation] = useState<CopilotMessageListItem[]>([])
  const [runState, setRunState] = useState<CopilotRunState>(createIdleCopilotRunState)
  const [thinkingCapability, setThinkingCapability] = useState<RuntimeThinkingCapability | null>(null)
  const [sendError, setSendError] = useState<CopilotTransientErrorState | null>(null)
  const [assistantNotificationsEnabled, setAssistantNotificationsEnabled] = useState(false)
  const [workspaceProviderProfiles, setWorkspaceProviderProfiles] = useState<Parameters<typeof createCopilotModelCatalog>[0]>([])
  const [workspacePrimaryModel, setWorkspacePrimaryModel] = useState('')
  const [workspacePrimaryModelRoute, setWorkspacePrimaryModelRoute] = useState<ModelRouteRef | null>(null)
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const { composerHeight, onComposerResizeStart } = useCopilotComposerResize()
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  const sessionIdentity = sessionShell === null
    ? null
    : `${sessionShell.sessionId}:${sessionShell.capabilities.capabilitiesVersion}`

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
  const projectedConversation = useMemo(
    () => buildCopilotMessageListItems({
      history: conversation,
      runState,
    }),
    [conversation, runState],
  )
  const assistantPlaceholder = useMemo(
    () => resolveCopilotAssistantPlaceholderState(runState),
    [runState],
  )
  const sendStatus = runState.phase === 'starting' || runState.phase === 'streaming' ? 'sending' : 'idle'
  const canCancelSend = activeAbortControllerRef.current !== null && sendStatus === 'sending'

  useEffect(() => {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null

    if (sessionShell === null) {
      setComposerDraft(createEmptyComposerDraft())
      setRunState(createIdleCopilotRunState())
      setThinkingCapability(null)
      setSendError(null)
      return
    }

    setComposerDraft(createComposerDraftFromSession(sessionShell))
    setRunState(createIdleCopilotRunState())
    setThinkingCapability(null)
    setSendError(null)
  }, [sessionIdentity, sessionShell])

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
        setWorkspaceStateLoaded(true)
        return
      }

      setWorkspaceProviderProfiles([])
      setWorkspacePrimaryModel('')
      setWorkspacePrimaryModelRoute(null)
      setAssistantNotificationsEnabled(false)
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
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    setConversation([])
    setRunState(createIdleCopilotRunState())
    setThinkingCapability(null)
    setSendError(null)
  }, [sessionShell?.sessionId])

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

        console.debug('[copilot-chat-shell] thinking-capability-query-failed', {
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
      console.debug('[copilot-chat-shell] runtime-summary', runtimeDebugSummary)
    }
  }, [runtimeDebugSummary])

  useEffect(() => {
    if (sessionDebugSummary !== null) {
      console.debug('[copilot-chat-shell] session-summary', sessionDebugSummary)
    }
  }, [sessionDebugSummary])

  useAssistantMessageNotification({
    language,
    notificationsEnabled: assistantNotificationsEnabled,
    runState,
  })

  const sendDisabledReason = useMemo(
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

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const abortController = new AbortController()
    activeAbortControllerRef.current = abortController

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
        setRunState,
        setSendError,
        setComposerDraft,
        setConversation,
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
    conversation: projectedConversation,
    assistantPlaceholder,
    composerInputRef,
    composerHeight,
    onComposerResizeStart,
  }
}
