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
} from './model-picker'
import {
  getCopilotSendDisabledReason,
  orchestrateCopilotSend,
} from './copilot-send-controller'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import { useCopilotComposerResize } from './useCopilotComposerResize'
import type { CopilotBootstrapState } from './types'
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
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending'>('idle')
  const [, setSendError] = useState<string | null>(null)
  const [workspaceProviderProfiles, setWorkspaceProviderProfiles] = useState<Parameters<typeof createCopilotModelCatalog>[0]>([])
  const [workspacePrimaryModel, setWorkspacePrimaryModel] = useState('')
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

  useEffect(() => {
    if (sessionShell === null) {
      setComposerDraft(createEmptyComposerDraft())
      setSendStatus('idle')
      setSendError(null)
      return
    }

    setComposerDraft(createComposerDraftFromSession(sessionShell))
    setSendStatus('idle')
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
        return
      }

      setWorkspaceProviderProfiles([])
      setWorkspacePrimaryModel('')
    })()

    return () => {
      cancelled = true
    }
  }, [loadWorkspaceState])

  useEffect(() => {
    if (preferredWorkspaceModelId === '') {
      return
    }

    setComposerDraft((current) => current.model.trim() === ''
      ? {
          ...current,
          model: preferredWorkspaceModelId,
        }
      : current)
  }, [preferredWorkspaceModelId])

  useEffect(() => {
    setConversation([])
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
      sendStatus,
      composerDraft,
    }),
    [composerDraft, sendStatus, sessionShell, state],
  )

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await orchestrateCopilotSend({
      state,
      sessionShell,
      composerDraft,
      sendStatus,
      composerInputRef,
      sendMessage,
      setSendStatus,
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
        modelGroups={modelCatalog.groups}
        composerDraft={composerDraft}
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
