import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'

import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import { loadSettingsWorkspaceState } from '../../workbench/settings/workspace-state'
import {
  sendRuntimeMessage,
  type RuntimeModelRoute,
} from './chat-contract'
import { CopilotPanelShell } from './CopilotPanelShell'
import {
  buildRuntimeDebugSummary,
  buildSessionDebugSummary,
  createComposerDraftFromSession,
  createEmptyComposerDraft,
  type CopilotChatComposerDraft,
  type CopilotConversationTurn,
} from './copilot-chat-helpers'
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
  loadWorkspaceState = loadSettingsWorkspaceState,
}: CopilotChatPanelProps) {
  const [composerDraft, setComposerDraft] = useState<CopilotChatComposerDraft>(createEmptyComposerDraft)
  const [conversation, setConversation] = useState<CopilotConversationTurn[]>([])
  const [runState, setRunState] = useState<CopilotRunState>(createIdleCopilotRunState)
  const [sendError, setSendError] = useState<string | null>(null)
  const [workspaceProviderProfiles, setWorkspaceProviderProfiles] = useState<Parameters<typeof createCopilotModelCatalog>[0]>([])
  const [workspacePrimaryModel, setWorkspacePrimaryModel] = useState('')
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const { composerHeight, onComposerResizeStart } = useCopilotComposerResize()

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
  const sendStatus = runState.phase === 'starting' || runState.phase === 'streaming' ? 'sending' : 'idle'

  useEffect(() => {
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
    if (!workspaceStateLoaded) {
      return
    }

    setComposerDraft((current) => {
      if (!hasAvailableModels) {
        return current.selectedModelId === '' && current.selectedModelRoute === null
          ? current
          : {
              ...current,
              selectedModelId: '',
              selectedModelRoute: null,
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
          return current
        }

        return {
          ...current,
          selectedModelId: selectedModel.id,
          selectedModelRoute: cloneRuntimeModelRoute(selectedModel.route),
        }
      }

      if (current.selectedModelId.trim() !== '') {
        return current.selectedModelRoute === null
          ? current
          : {
              ...current,
              selectedModelRoute: null,
            }
      }

      if (preferredWorkspaceModel === null) {
        return current
      }

      return {
        ...current,
        selectedModelId: preferredWorkspaceModel.id,
        selectedModelRoute: cloneRuntimeModelRoute(preferredWorkspaceModel.route),
      }
    })
  }, [hasAvailableModels, modelCatalog.models, preferredWorkspaceModel, workspaceStateLoaded])

  useEffect(() => {
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
    await orchestrateCopilotSend({
      state,
      sessionShell,
      composerDraft: effectiveComposerDraft,
      runState,
      hasAvailableModels,
      composerInputRef,
      sendMessage,
      setRunState,
      setSendError,
      setComposerDraft,
      setConversation,
    })
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
        sendStatus={sendStatus}
        sendDisabledReason={sendDisabledReason}
        conversation={conversation}
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
    return draft.selectedModelRoute === null
      ? draft
      : {
          ...draft,
          selectedModelRoute: null,
        }
  }

  const matchedModel = models.find((model) => (
    model.id === draft.selectedModelId || model.modelId === draft.selectedModelId
  ))
  if (matchedModel === undefined) {
    return draft.selectedModelRoute === null
      ? draft
      : {
          ...draft,
          selectedModelRoute: null,
        }
  }

  if (
    draft.selectedModelId === matchedModel.id
    && isSameModelRoute(draft.selectedModelRoute, matchedModel.route)
  ) {
    return draft
  }

  return {
    ...draft,
    selectedModelId: matchedModel.id,
    selectedModelRoute: cloneRuntimeModelRoute(matchedModel.route),
  }
}

function cloneRuntimeModelRoute(route: RuntimeModelRoute): RuntimeModelRoute {
  return {
    providerProfileId: route.providerProfileId,
    snapshot: {
      provider: route.snapshot.provider,
      endpointType: route.snapshot.endpointType,
      baseUrl: route.snapshot.baseUrl,
      modelId: route.snapshot.modelId,
    },
  }
}
