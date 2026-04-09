import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from 'react'

import type { AgentType, AssistantSessionShell, ModelRouteRef } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import { loadSettingsWorkspaceState } from '../../workbench/settings/workspace-state'
import {
  cancelRuntimeRun,
  getRuntimeThinkingCapability,
  RuntimeRequestError,
  type RuntimeModelRoute,
  type RuntimeThinkingCapability,
} from './chat-contract'
import { CopilotPanelShell } from './CopilotPanelShell'
import {
  applyModelSelectionToComposerDraft,
  buildRuntimeDebugSummary,
  buildRuntimeThinkingCapabilityFromError,
  buildSessionDebugSummary,
  createComposerDraftFromSession,
  createEmptyComposerDraft,
  syncComposerDraftThinkingSelection,
  type CopilotChatComposerDraft,
} from './copilot-chat-helpers'
import {
  buildCopilotMessageListItems,
  resolveCopilotAssistantPlaceholderState,
  type CopilotMessageListItem,
} from './run-segment-view-model'
import {
  createCopilotModelCatalog,
  getCopilotModelById,
  resolveCopilotPreferredModelId,
  type CopilotModelOption,
} from './model-picker'
import {
  createIdleCopilotRunState,
  dispatchCopilotMessage,
  getCopilotSendDisabledReason,
  orchestrateCopilotSend,
} from './copilot-send-controller'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import { useCopilotComposerResize } from './useCopilotComposerResize'
import type { CopilotBootstrapState, CopilotRunState } from './types'
import './copilot.css'

interface CopilotChatPanelProps {
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

export function CopilotChatPanel({
  state,
  retrying,
  retry,
  selectedAgent,
  sessionShell,
  directoryState,
  sessionStatus,
  sessionError,
  sendMessage = dispatchCopilotMessage,
  cancelRun = cancelRuntimeRun,
  getThinkingCapability = getRuntimeThinkingCapability,
  loadWorkspaceState = loadSettingsWorkspaceState,
}: CopilotChatPanelProps) {
  const [composerDraft, setComposerDraft] = useState<CopilotChatComposerDraft>(createEmptyComposerDraft)
  const [conversation, setConversation] = useState<CopilotMessageListItem[]>([])
  const [runState, setRunState] = useState<CopilotRunState>(createIdleCopilotRunState)
  const [thinkingCapability, setThinkingCapability] = useState<RuntimeThinkingCapability | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
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
  const sessionToolSnapshot = sessionShell === null
    ? ''
    : sessionShell.capabilities.allAvailableTools
      .map((tool) => `${tool.toolId}:${tool.kind}:${tool.availability}`)
      .join('|')
  const sessionRecommendedSnapshot = sessionShell === null
    ? ''
    : sessionShell.capabilities.recommendedToolsForAgent.join('|')
  const sessionDefaultEnabledSnapshot = sessionShell === null
    ? ''
    : sessionShell.capabilities.defaultEnabledTools.join('|')

  const runtimeDebugSummary = useMemo(() => {
    if (!isCopilotConnectableState(state)) {
      return null
    }

    return buildRuntimeDebugSummary({
      state,
      directoryState,
      selectedAgent,
    })
  }, [directoryState.status, selectedAgent?.id, selectedAgent?.label, state])

  const sessionDebugSummary = useMemo(
    () => (sessionShell === null ? null : buildSessionDebugSummary(sessionShell)),
    [
      sessionDefaultEnabledSnapshot,
      sessionIdentity,
      sessionRecommendedSnapshot,
      sessionShell?.boundAgent.id,
      sessionShell?.capabilities.toolSelectionMode,
      sessionToolSnapshot,
    ],
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
  const effectiveComposerDraft = useMemo(
    () => resolveComposerDraftModelSelection(composerDraft, modelCatalog.models, thinkingCapability),
    [composerDraft, modelCatalog.models, thinkingCapability],
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
          && current.thinkingLevelIntent === null
          ? current
          : {
              ...current,
              selectedModelId: '',
              selectedModelRoute: null,
              thinkingLevelIntent: null,
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
                thinkingLevelIntent: null,
              }
        }

        if (!selectedModel.available) {
          return current.selectedModelId === selectedModel.selectionValue
            && current.selectedModelRoute === null
            && current.thinkingLevelIntent === null
            ? current
            : {
                ...current,
                selectedModelId: selectedModel.selectionValue,
                selectedModelRoute: null,
                thinkingLevelIntent: null,
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
              thinkingLevelIntent: null,
            }
      }

      if (current.selectedModelId.trim() !== '') {
        return current.selectedModelRoute === null && current.thinkingLevelIntent === null
          ? current
          : {
              ...current,
              selectedModelRoute: null,
              thinkingLevelIntent: null,
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
    if (!workspaceStateLoaded || !isCopilotConnectableState(state) || sessionShell === null || effectiveComposerDraft.selectedModelRoute === null) {
      setThinkingCapability(null)
      return
    }

    let cancelled = false
    const selectedModelRoute = effectiveComposerDraft.selectedModelRoute
    const thinkingCapabilityOverride = selectedModelOption?.thinkingCapabilityOverride ?? null
    setThinkingCapability(null)

    void (async () => {
      try {
        const response = await getThinkingCapability({
          runtimeUrl: state.runtimeUrl,
          sessionId: sessionShell.sessionId,
          modelRoute: selectedModelRoute,
          thinkingCapabilityOverride: thinkingCapabilityOverride as Record<string, unknown> | null,
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
          route: effectiveComposerDraft.selectedModelRoute,
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
    effectiveComposerDraft.selectedModelRoute,
    getThinkingCapability,
    selectedModelOption?.thinkingCapabilityOverride,
    sessionShell,
    state,
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

  return (
    <section className="copilot-panel" data-testid="copilot-chat-panel">
      <CopilotPanelShell
        state={state}
        retrying={retrying}
        onRetry={retry}
        selectedAgent={selectedAgent}
        sessionShell={sessionShell}
        directoryState={directoryState}
        sessionStatus={sessionStatus}
        sessionError={sessionError}
        sendError={sendError}
        modelGroups={modelCatalog.groups}
        thinkingCapability={thinkingCapability}
        composerDraft={effectiveComposerDraft}
        onComposerDraftChange={setComposerDraft}
        onSend={handleSend}
        onCancelCurrentRun={handleCancelCurrentRun}
        sendStatus={sendStatus}
        canCancelSend={canCancelSend}
        sendDisabledReason={sendDisabledReason}
        conversation={projectedConversation}
        assistantPlaceholder={assistantPlaceholder}
        composerInputRef={composerInputRef}
        composerHeight={composerHeight}
        onComposerResizeStart={onComposerResizeStart}
      />
    </section>
  )
}

function isSameModelRoute(left: RuntimeModelRoute | null, right: RuntimeModelRoute): boolean {
  if (left === null) {
    return false
  }

  return isSameModelRouteRef(left.routeRef ?? null, right.routeRef ?? null)
    && (left.catalogRevision?.trim() ?? '') === (right.catalogRevision?.trim() ?? '')
}

function resolveComposerDraftModelSelection(
  draft: CopilotChatComposerDraft,
  models: CopilotModelOption[],
  thinkingCapability: RuntimeThinkingCapability | null,
): CopilotChatComposerDraft {
  if (draft.selectedModelId.trim() === '') {
    return draft.selectedModelRoute === null && draft.thinkingLevelIntent === null
      ? draft
      : {
          ...draft,
          selectedModelRoute: null,
          thinkingLevelIntent: null,
        }
  }

  const matchedModel = getCopilotModelById(draft.selectedModelId, models)
  if (matchedModel === null) {
    return draft.selectedModelRoute === null && draft.thinkingLevelIntent === null
      ? draft
      : {
          ...draft,
          selectedModelRoute: null,
          thinkingLevelIntent: null,
        }
  }

  if (!matchedModel.available) {
    return draft.selectedModelId === matchedModel.selectionValue
      && draft.selectedModelRoute === null
      && draft.thinkingLevelIntent === null
      ? draft
      : {
          ...draft,
          selectedModelId: matchedModel.selectionValue,
          selectedModelRoute: null,
          thinkingLevelIntent: null,
        }
  }

  if (
    draft.selectedModelId === matchedModel.selectionValue
    && isSameModelRoute(draft.selectedModelRoute, matchedModel.route)
  ) {
    if (thinkingCapability === null) {
      return draft
    }

    return syncComposerDraftThinkingSelection(draft, {
      modelRoute: matchedModel.route,
      thinkingCapability,
    })
  }

  return applyModelSelectionToComposerDraft(draft, {
    modelId: matchedModel.selectionValue,
    modelRoute: matchedModel.route,
  })
}

function isSameModelRouteRef(left: ModelRouteRef | null, right: ModelRouteRef | null): boolean {
  return left !== null
    && right !== null
    && left.routeKind === right.routeKind
    && left.profileId === right.profileId
    && left.modelId === right.modelId
}

function clearAbortController(
  ref: MutableRefObject<AbortController | null>,
  controller: AbortController,
) {
  if (ref.current === controller) {
    ref.current = null
  }
}
