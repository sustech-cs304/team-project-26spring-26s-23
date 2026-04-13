import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type SetStateAction,
} from 'react'

import { getCopilotChatCopy } from '../../workbench/locale'
import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import { CopilotComposerShell } from './composer/CopilotComposerShell'
import { CopilotMessagesShell } from './messages/CopilotMessagesShell'
import { CopilotRuntimeStateShell } from './CopilotRuntimeStateShell'
import { ErrorDetailOverlay } from './ErrorDetailOverlay'
import {
  buildErrorDetailOverlayViewModel,
  type CopilotErrorDetailSource,
  type ErrorDetailOverlayViewModel,
} from './error-detail-overlay-view-model'
import {
  createCopilotTransientErrorState,
  type CopilotChatComposerDraft,
  type CopilotTransientErrorState,
} from './copilot-chat-helpers'
import type {
  CopilotAssistantPlaceholderState,
  CopilotMessageListItem,
} from './run-segment-view-model'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import type { CopilotModelGroup } from './model-picker'
import type { RuntimeThinkingCapability } from './thread-run-contract'
import type { CopilotBootstrapState, CopilotConnectableState } from './types'

export interface CopilotPanelShellProps {
  language?: string
  state: CopilotBootstrapState
  retrying: boolean
  onRetry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
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

type ConnectableCopilotPanelShellProps = Omit<CopilotPanelShellProps, 'state'> & {
  state: CopilotConnectableState
  onOpenErrorDetail: (errorDetail: CopilotErrorDetailSource, trigger: HTMLButtonElement | null) => void
}

export function CopilotPanelShell(props: CopilotPanelShellProps) {
  const [selectedErrorDetail, setSelectedErrorDetail] = useState<ErrorDetailOverlayViewModel | null>(null)
  const errorDetailTriggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isCopilotConnectableState(props.state) || props.sessionShell === null) {
      setSelectedErrorDetail(null)
      errorDetailTriggerRef.current = null
    }
  }, [props.sessionShell, props.state])

  const handleOpenErrorDetail = (
    errorDetail: CopilotErrorDetailSource,
    trigger: HTMLButtonElement | null,
  ) => {
    errorDetailTriggerRef.current = trigger
    setSelectedErrorDetail(buildErrorDetailOverlayViewModel(errorDetail))
  }

  const handleCloseErrorDetail = () => {
    setSelectedErrorDetail(null)
    const trigger = errorDetailTriggerRef.current
    errorDetailTriggerRef.current = null

    if (trigger !== null) {
      requestAnimationFrame(() => {
        trigger.focus()
      })
    }
  }

  if (!isCopilotConnectableState(props.state)) {
    return (
      <CopilotRuntimeStateShell
        state={props.state}
        retrying={props.retrying}
        onRetry={props.onRetry}
      />
    )
  }

  return (
    <>
      {renderSessionShell({
        ...props,
        state: props.state,
        onOpenErrorDetail: handleOpenErrorDetail,
      })}
      <ErrorDetailOverlay
        viewModel={selectedErrorDetail}
        onClose={handleCloseErrorDetail}
      />
    </>
  )
}

function renderSessionShell(props: ConnectableCopilotPanelShellProps) {
  const hasAvailableModels = props.modelGroups.some((group) => group.models.length > 0)
  const copy = getCopilotChatCopy(props.language ?? 'zh-CN')

  if (props.directoryState.status === 'loading' || props.directoryState.status === 'idle') {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">{copy.panel.eyebrow}</p>
        <h2 className="copilot-panel__title">{copy.panel.loadingAgentsTitle}</h2>
        <p className="copilot-panel__description">
          {copy.panel.loadingAgentsDescription}
        </p>
      </section>
    )
  }

  if (props.directoryState.status === 'error') {
    return (
      <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
        <p className="copilot-panel__eyebrow">{copy.panel.eyebrow}</p>
        <h2 className="copilot-panel__title">{copy.panel.loadAgentsFailedTitle}</h2>
        <p className="copilot-panel__description">
          {copy.panel.loadAgentsFailedDescription}
        </p>
      </section>
    )
  }

  if (props.selectedAgent === null) {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">{copy.panel.eyebrow}</p>
        <h2 className="copilot-panel__title">{copy.panel.noAgentsTitle}</h2>
        <p className="copilot-panel__description">
          {copy.panel.noAgentsDescription}
        </p>
      </section>
    )
  }

  if (props.sessionShell === null) {
    return (
      <section className="copilot-panel__inline-placeholder" aria-live="polite" data-testid="chat-session-placeholder">
        <p className="copilot-panel__inline-placeholder-text">{copy.panel.sessionPlaceholder}</p>
        {props.sessionError !== null && (
          <p className="copilot-panel__error">{copy.panel.sessionCreateError}</p>
        )}
      </section>
    )
  }

  return (
    <section className="copilot-chat-workspace" aria-live="polite" data-testid="chat-session-shell-ready">
      <section className="copilot-chat" data-testid="chat-send-shell">
        <CopilotMessagesShell
          language={props.language}
          conversation={props.conversation}
          assistantPlaceholder={props.assistantPlaceholder}
          models={props.modelGroups.flatMap((group) => group.models)}
          transientError={props.sendError ?? createTransientSessionError(props.sessionError)}
          onOpenErrorDetail={props.onOpenErrorDetail}
          emptyState={hasAvailableModels
            ? null
            : {
                title: copy.panel.noModelTitle,
                description: copy.panel.noModelDescription,
              }}
        />
        <CopilotComposerShell
          language={props.language}
          capabilities={props.sessionShell.capabilities}
          modelGroups={props.modelGroups}
          thinkingCapability={props.thinkingCapability}
          draft={props.composerDraft}
          onDraftChange={props.onComposerDraftChange}
          onSubmit={props.onSend}
          onCancel={props.onCancelCurrentRun}
          sendStatus={props.sendStatus}
          canCancel={props.canCancelSend}
          sendDisabledReason={props.sendDisabledReason}
          composerInputRef={props.composerInputRef}
          composerHeight={props.composerHeight}
          onResizeStart={props.onComposerResizeStart}
        />
      </section>
    </section>
  )
}

function createTransientSessionError(sessionError: string | null): CopilotTransientErrorState | null {
  const trimmedSessionError = sessionError?.trim() ?? ''

  return trimmedSessionError === ''
    ? null
    : createCopilotTransientErrorState({
        message: trimmedSessionError,
      })
}
