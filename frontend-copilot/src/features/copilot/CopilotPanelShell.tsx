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
import type {
  CopilotChatComposerDraft,
  CopilotConversationTurn,
} from './copilot-chat-helpers'
import { isCopilotConnectableState } from './copilot-panel-diagnostics'
import type { CopilotModelGroup } from './model-picker'
import type { CopilotBootstrapState } from './types'

export interface CopilotPanelShellProps {
  state: CopilotBootstrapState
  retrying: boolean
  onRetry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
  modelGroups: CopilotModelGroup[]
  composerDraft: CopilotChatComposerDraft
  onComposerDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSend: (event: FormEvent<HTMLFormElement>) => void
  sendStatus: 'idle' | 'sending'
  sendDisabledReason: string | null
  conversation: CopilotConversationTurn[]
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onComposerResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
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

  return renderSessionShell(props)
}

function renderSessionShell(props: CopilotPanelShellProps) {
  const hasAvailableModels = props.modelGroups.some((group) => group.models.length > 0)

  if (props.directoryState.status === 'loading' || props.directoryState.status === 'idle') {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">Session Shell</p>
        <h2 className="copilot-panel__title">正在准备智能体目录</h2>
        <p className="copilot-panel__description">
          主入口正在等待后端 agents/list 返回目录数据。
        </p>
      </section>
    )
  }

  if (props.directoryState.status === 'error') {
    return (
      <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
        <p className="copilot-panel__eyebrow">Session Shell</p>
        <h2 className="copilot-panel__title">后端智能体目录加载失败</h2>
        <p className="copilot-panel__description">
          当前主入口只认后端目录为真源，因此不会回落到本地静态智能体列表。
        </p>
        <pre className="copilot-panel__error">{props.directoryState.error}</pre>
      </section>
    )
  }

  if (props.selectedAgent === null) {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">Session Shell</p>
        <h2 className="copilot-panel__title">后端目录中暂无可选智能体</h2>
        <p className="copilot-panel__description">
          当前未拿到可用于创建会话的智能体条目，因此消息区保持占位，不会静默走旧路径。
        </p>
      </section>
    )
  }

  if (props.sessionShell === null) {
    return (
      <section className="copilot-panel__inline-placeholder" aria-live="polite" data-testid="chat-session-placeholder">
        <p className="copilot-panel__inline-placeholder-text">可在左侧选择智能体与新建会话</p>
        {props.sessionError !== null && (
          <pre className="copilot-panel__error">{props.sessionError}</pre>
        )}
      </section>
    )
  }

  return (
    <section className="copilot-chat-workspace" aria-live="polite" data-testid="chat-session-shell-ready">
      <section className="copilot-chat" data-testid="chat-send-shell">
        <CopilotMessageList
          conversation={props.conversation}
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
          draft={props.composerDraft}
          onDraftChange={props.onComposerDraftChange}
          onSubmit={props.onSend}
          sendStatus={props.sendStatus}
          sendDisabledReason={props.sendDisabledReason}
          sessionError={props.sessionError}
          composerInputRef={props.composerInputRef}
          composerHeight={props.composerHeight}
          onResizeStart={props.onComposerResizeStart}
        />
      </section>
    </section>
  )
}
