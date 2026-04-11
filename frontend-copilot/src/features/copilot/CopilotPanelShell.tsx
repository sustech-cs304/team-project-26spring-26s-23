import type {
  Dispatch,
  FormEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
  SetStateAction,
} from 'react'

import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import { CopilotComposer } from './CopilotComposer'
import { CopilotMessageList } from './CopilotMessageList'
import { CopilotRuntimeStateShell } from './CopilotRuntimeStateShell'
import type { CopilotChatComposerDraft } from './copilot-chat-helpers'
import type {
  CopilotAssistantPlaceholderState,
  CopilotMessageListItem,
} from './run-segment-view-model'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import type { CopilotModelGroup } from './model-picker'
import type { RuntimeThinkingCapability } from './thread-run-contract'
import type { CopilotBootstrapState, CopilotConnectableState } from './types'

export interface CopilotPanelShellProps {
  state: CopilotBootstrapState
  retrying: boolean
  onRetry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
  sendError: string | null
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
}

export function CopilotPanelShell(props: CopilotPanelShellProps) {
  if (!isCopilotConnectableState(props.state)) {
    return (
      <CopilotRuntimeStateShell
        state={props.state}
        retrying={props.retrying}
        onRetry={props.onRetry}
      />
    )
  }

  return renderSessionShell({
    ...props,
    state: props.state,
  })
}

function renderSessionShell(props: ConnectableCopilotPanelShellProps) {
  const hasAvailableModels = props.modelGroups.some((group) => group.models.length > 0)

  if (props.directoryState.status === 'loading' || props.directoryState.status === 'idle') {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">Copilot</p>
        <h2 className="copilot-panel__title">正在加载助手列表</h2>
        <p className="copilot-panel__description">
          请稍候，加载完成后即可开始聊天。
        </p>
      </section>
    )
  }

  if (props.directoryState.status === 'error') {
    return (
      <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
        <p className="copilot-panel__eyebrow">Copilot</p>
        <h2 className="copilot-panel__title">加载助手列表失败</h2>
        <p className="copilot-panel__description">
          当前无法获取可用助手，请稍后重试。
        </p>
      </section>
    )
  }

  if (props.selectedAgent === null) {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">Copilot</p>
        <h2 className="copilot-panel__title">暂无可用助手</h2>
        <p className="copilot-panel__description">
          请检查连接状态，或稍后再试。
        </p>
      </section>
    )
  }

  if (props.sessionShell === null) {
    return (
      <section className="copilot-panel__inline-placeholder" aria-live="polite" data-testid="chat-session-placeholder">
        <p className="copilot-panel__inline-placeholder-text">可在左侧选择助手并新建会话</p>
        {props.sessionError !== null && (
          <p className="copilot-panel__error">当前无法创建会话，请重试。</p>
        )}
      </section>
    )
  }

  return (
    <section className="copilot-chat-workspace" aria-live="polite" data-testid="chat-session-shell-ready">
      <section className="copilot-chat" data-testid="chat-send-shell">
        <CopilotMessageList
          conversation={props.conversation}
          assistantPlaceholder={props.assistantPlaceholder}
          models={props.modelGroups.flatMap((group) => group.models)}
          transientError={props.sendError ?? props.sessionError}
          emptyState={hasAvailableModels
            ? null
            : {
                title: '尚未配置模型',
                description: '请先前往设置页添加模型服务商和模型。',
              }}
        />
        <CopilotComposer
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
