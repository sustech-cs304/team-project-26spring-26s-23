import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from 'react'

import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import { loadSettingsWorkspaceState } from '../../workbench/settings/workspace-state'
import {
  cancelRuntimeRun,
  sendRuntimeMessage,
  type RuntimeModelRoute,
} from './chat-contract'
import { CopilotPanelShell } from './CopilotPanelShell'
import {
  applyModelSelectionToComposerDraft,
  buildRuntimeDebugSummary,
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
  resolveCopilotPreferredModelId,
  type CopilotModelOption,
} from './model-picker'
import {
  createIdleCopilotRunState,
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
  sendMessage?: typeof sendRuntimeMessage
  cancelRun?: typeof cancelRuntimeRun
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
  sendMessage = sendRuntimeMessage,
  cancelRun = cancelRuntimeRun,
  loadWorkspaceState = loadSettingsWorkspaceState,
}: CopilotChatPanelProps) {
  const [composerDraft, setComposerDraft] = useState<CopilotChatComposerDraft>(createEmptyComposerDraft)
  const [conversation, setConversation] = useState<CopilotMessageListItem[]>([])
  const [runState, setRunState] = useState<CopilotRunState>(createIdleCopilotRunState)
  const [sendError, setSendError] = useState<string | null>(null)
  const [workspaceProviderProfiles, setWorkspaceProviderProfiles] = useState<Parameters<typeof createCopilotModelCatalog>[0]>([])
  const [workspacePrimaryModel, setWorkspacePrimaryModel] = useState('')
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
      sessionShell?.capabilities.defaultModelPreference,
      sessionShell?.capabilities.toolSelectionMode,
      sessionToolSnapshot,
    ],
  )

  const modelCatalog = useMemo(
    () => createCopilotModelCatalog(workspaceProviderProfiles),
    [workspaceProviderProfiles],
  )
  const preferredWorkspaceModelId = useMemo(
    () => resolveCopilotPreferredModelId({
      preferredModelId: workspacePrimaryModel,
      models: modelCatalog.models,
    }),
    [modelCatalog.models, workspacePrimaryModel],
  )
  const preferredWorkspaceModel = useMemo(
    () => modelCatalog.models.find((model) => (
      model.id === preferredWorkspaceModelId || model.modelId === preferredWorkspaceModelId
    )) ?? null,
    [modelCatalog.models, preferredWorkspaceModelId],
  )
  const hasAvailableModels = modelCatalog.models.length > 0
  const effectiveComposerDraft = useMemo(
    () => resolveComposerDraftModelSelection(composerDraft, modelCatalog.models),
    [composerDraft, modelCatalog.models],
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
      setSendError(null)
      return
    }

    setComposerDraft(createComposerDraftFromSession(sessionShell))
    setRunState(createIdleCopilotRunState())
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
        setWorkspaceStateLoaded(true)
        return
      }

      setWorkspaceProviderProfiles([])
      setWorkspacePrimaryModel('')
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
      if (!hasAvailableModels) {
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

      const selectedModel = modelCatalog.models.find((model) => (
        model.id === current.selectedModelId || model.modelId === current.selectedModelId
      ))
      if (selectedModel !== undefined) {
        if (
          current.selectedModelId === selectedModel.id
          && isSameModelRoute(current.selectedModelRoute, selectedModel.route)
        ) {
          return syncComposerDraftThinkingSelection(current, {
            modelRoute: selectedModel.route,
            thinkingCapability: selectedModel.thinkingCapability,
          })
        }

        return applyModelSelectionToComposerDraft(current, {
          modelId: selectedModel.id,
          modelRoute: selectedModel.route,
          thinkingCapability: selectedModel.thinkingCapability,
        })
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

      if (preferredWorkspaceModel === null) {
        return syncComposerDraftThinkingSelection(current, {
          modelRoute: current.selectedModelRoute,
          thinkingCapability: null,
        })
      }

      return applyModelSelectionToComposerDraft(current, {
        modelId: preferredWorkspaceModel.id,
        modelRoute: preferredWorkspaceModel.route,
        thinkingCapability: preferredWorkspaceModel.thinkingCapability,
      })
    })
  }, [hasAvailableModels, modelCatalog.models, preferredWorkspaceModel, workspaceStateLoaded])

  useEffect(() => {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    setConversation([])
    setRunState(createIdleCopilotRunState())
    setSendError(null)
  }, [sessionShell?.sessionId])

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
      hasAvailableModels,
    }),
    [effectiveComposerDraft, hasAvailableModels, runState, sessionShell, state],
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
        hasAvailableModels,
        composerInputRef,
        sendMessage,
        debugModeEnabled: isCopilotConnectableState(state) ? state.bootstrapFields.debugModeEnabled : false,
        setRunState,
        setSendError,
        setComposerDraft,
        setConversation,
        signal: abortController.signal,
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

  return left.providerProfileId === right.providerProfileId
    && left.snapshot.provider === right.snapshot.provider
    && left.snapshot.endpointType === right.snapshot.endpointType
    && left.snapshot.baseUrl === right.snapshot.baseUrl
    && left.snapshot.modelId === right.snapshot.modelId
}

function resolveComposerDraftModelSelection(
  draft: CopilotChatComposerDraft,
  models: CopilotModelOption[],
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

  const matchedModel = models.find((model) => (
    model.id === draft.selectedModelId || model.modelId === draft.selectedModelId
  ))
  if (matchedModel === undefined) {
    return draft.selectedModelRoute === null && draft.thinkingLevelIntent === null
      ? draft
      : {
          ...draft,
          selectedModelRoute: null,
          thinkingLevelIntent: null,
        }
  }

  if (
    draft.selectedModelId === matchedModel.id
    && isSameModelRoute(draft.selectedModelRoute, matchedModel.route)
  ) {
    return syncComposerDraftThinkingSelection(draft, {
      modelRoute: matchedModel.route,
      thinkingCapability: matchedModel.thinkingCapability,
    })
  }

  return applyModelSelectionToComposerDraft(draft, {
    modelId: matchedModel.id,
    modelRoute: matchedModel.route,
    thinkingCapability: matchedModel.thinkingCapability,
  })
}

function clearAbortController(
  ref: MutableRefObject<AbortController | null>,
  controller: AbortController,
) {
  if (ref.current === controller) {
    ref.current = null
  }
}
