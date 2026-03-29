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

import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/assistant-workspace-controller'
import {
  sendRuntimeMessage,
} from './chat-contract'
import { CopilotComposer } from './CopilotComposer'
import { CopilotMessageList } from './CopilotMessageList'
import {
  DEFAULT_COPILOT_COMPOSER_HEIGHT,
  buildRuntimeDebugSummary,
  buildRuntimeMessageSendInput,
  buildSessionDebugSummary,
  clampComposerHeight,
  createAssistantTurn,
  createComposerDraftFromSession,
  createEmptyComposerDraft,
  createErrorTurn,
  createUserTurn,
  formatModeSummary,
  formatRequestOptionsError,
  formatRuntimeSource,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  type CopilotChatComposerDraft,
  type CopilotConversationTurn,
} from './copilot-chat-helpers'
import type { CopilotBootstrapState, CopilotConfigState, CopilotDiagnosticsSummary } from './types'
import { NotConnectedNotice } from './components/NotConnectedNotice'
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
}

interface RenderPanelActions {
  retrying: boolean
  onRetry: () => void
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
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
}: CopilotChatPanelProps) {
  const [composerDraft, setComposerDraft] = useState<CopilotChatComposerDraft>(createEmptyComposerDraft)
  const [conversation, setConversation] = useState<CopilotConversationTurn[]>([])
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending'>('idle')
  const [, setSendError] = useState<string | null>(null)
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COPILOT_COMPOSER_HEIGHT)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const composerHeightRef = useRef(DEFAULT_COPILOT_COMPOSER_HEIGHT)
  const composerResizeCleanupRef = useRef<(() => void) | null>(null)

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

  useEffect(() => {
    composerHeightRef.current = composerHeight
  }, [composerHeight])

  useEffect(() => {
    return () => {
      composerResizeCleanupRef.current?.()
    }
  }, [])

  const sendDisabledReason = useMemo(() => {
    if (!isCopilotConnectableState(state)) {
      return '当前运行态未就绪，无法发送消息。'
    }

    if (sessionShell === null) {
      return '请先创建会话。'
    }

    if (sendStatus === 'sending') {
      return '当前消息仍在发送中。'
    }

    if (composerDraft.messageText.trim() === '') {
      return '请输入消息内容。'
    }

    if (composerDraft.model.trim() === '') {
      return '请提供本次发送要使用的模型 ID。'
    }

    return null
  }, [composerDraft.messageText, composerDraft.model, sendStatus, sessionShell, state])

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!isCopilotConnectableState(state) || sessionShell === null || sendStatus === 'sending') {
      return
    }

    const trimmedMessage = composerDraft.messageText.trim()
    if (trimmedMessage === '') {
      setSendError('请输入消息内容后再发送。')
      return
    }

    if (composerDraft.model.trim() === '') {
      setSendError('请提供本次发送要使用的模型 ID。')
      return
    }

    let requestOptions: Record<string, unknown>
    try {
      requestOptions = parseRequestOptionsText(composerDraft.requestOptionsText)
    } catch (error) {
      setSendError(formatRequestOptionsError(error))
      return
    }

    const runtimeInput = buildRuntimeMessageSendInput({
      runtimeUrl: state.runtimeUrl,
      sessionShell,
      draft: {
        ...composerDraft,
        messageText: trimmedMessage,
      },
      requestOptions,
    })

    setSendStatus('sending')
    setSendError(null)
    setComposerDraft((current) => ({
      ...current,
      messageText: '',
    }))
    if (composerInputRef.current !== null) {
      composerInputRef.current.value = ''
    }

    try {
      const response = await sendMessage(runtimeInput)
      setConversation((current) => [
        ...current,
        createUserTurn(trimmedMessage),
        createAssistantTurn(response),
      ])
    } catch (error) {
      const formattedError = formatRuntimeMessageSendError(error)
      setSendError(formattedError)
      setConversation((current) => [
        ...current,
        createUserTurn(trimmedMessage),
        createErrorTurn(formattedError),
      ])
    } finally {
      setSendStatus('idle')
      requestAnimationFrame(() => {
        composerInputRef.current?.focus()
      })
    }
  }

  const handleComposerResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    composerResizeCleanupRef.current?.()

    const startY = event.clientY
    const startHeight = composerHeightRef.current
    const previousUserSelect = document.body.style.userSelect

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = clampComposerHeight(startHeight + (startY - moveEvent.clientY))
      composerHeightRef.current = nextHeight
      setComposerHeight(nextHeight)
    }

    const stopResize = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
      document.body.style.userSelect = previousUserSelect
      composerResizeCleanupRef.current = null
    }

    composerResizeCleanupRef.current = stopResize
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)
  }

  return (
    <section className="copilot-panel" data-testid="copilot-chat-panel">
      {renderCopilotPanelContent(state, {
        retrying,
        onRetry: retry,
        selectedAgent,
        sessionShell,
        directoryState,
        sessionStatus,
        sessionError,
        composerDraft,
        onComposerDraftChange: setComposerDraft,
        onSend: handleSend,
        sendStatus,
        sendDisabledReason,
        conversation,
        composerInputRef,
        composerHeight,
        onComposerResizeStart: handleComposerResizeStart,
      })}
    </section>
  )
}

function renderCopilotPanelContent(
  state: CopilotBootstrapState,
  actions: RenderPanelActions,
) {
  switch (state.status) {
    case 'loading':
      return (
        <section className="copilot-panel__card" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">正在等待根层完成运行态装配</h2>
          <p className="copilot-panel__description">
            当前主入口只等待运行态，不再把旧全局 agent 作为聊天就绪前提。
          </p>
        </section>
      )

    case 'error':
      return (
        <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">读取运行态失败</h2>
          <p className="copilot-panel__description">
            当前无法从 Electron 预加载桥接读取运行态摘要。该状态与“后端未启动”不同，需优先检查 preload 与 IPC 链路。
          </p>
          <pre className="copilot-panel__error">{state.error}</pre>
        </section>
      )

    case 'empty':
      return (
        <NotConnectedNotice
          title="尚未获得可用运行时"
          description="当前既没有可用的宿主运行时地址，也没有开发态覆盖地址。主入口已切到 session-first 壳层，但仍需要 runtime URL 才能继续向后端拉取智能体目录。"
          missingFields={state.missingFields}
          details={buildSharedDetails(state)}
        />
      )

    case 'incomplete':
      return (
        <NotConnectedNotice
          title="连接信息仍不完整"
          description="宿主运行态与本地设置已由根层统一读取，但当前缺少继续访问后端目录所需的最小字段。这里不再把旧全局 agentName 视为聊天必填项。"
          missingFields={state.missingFields}
          details={buildSharedDetails(state)}
        />
      )

    case 'starting':
      return (
        <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">宿主正在启动本地后端</h2>
          <p className="copilot-panel__description">
            当前由 Electron 主进程托管 hosted backend；Renderer 只会在拿到有效 runtime URL 后继续拉取智能体目录与创建会话。
          </p>
          <dl className="copilot-panel__details-grid">
            {buildSharedDetails(state).map((detail) => (
              <div key={`${detail.label}:${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )

    case 'failed':
      return (
        <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">宿主启动后端失败</h2>
          <p className="copilot-panel__description">
            当前未拿到可用的 hosted backend 运行地址，因此无法继续进入“后端智能体目录 + 会话创建”主路径。
          </p>
          <dl className="copilot-panel__details-grid">
            {buildSharedDetails(state).map((detail) => (
              <div key={`${detail.label}:${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
          {state.diagnostics.failure && (
            <pre className="copilot-panel__error">{formatFailureSummary(state.diagnostics)}</pre>
          )}
          <div className="copilot-panel__actions">
            <button
              type="button"
              className="copilot-panel__button"
              onClick={actions.onRetry}
              disabled={actions.retrying || !canRetry(state)}
            >
              {actions.retrying ? '正在重试…' : '重试启动宿主后端'}
            </button>
          </div>
        </section>
      )

    case 'degraded':
      return renderConnectedShell(state, actions, 'warning')

    case 'ready':
      return renderConnectedShell(state, actions, 'ready')
  }
}

function renderConnectedShell(
  _state: Extract<CopilotBootstrapState, { status: 'ready' | 'degraded' }>,
  actions: RenderPanelActions,
  _tone: 'ready' | 'warning',
) {
  return renderSessionContent(actions)
}

function renderSessionContent(actions: RenderPanelActions) {
  if (actions.directoryState.status === 'loading' || actions.directoryState.status === 'idle') {
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

  if (actions.directoryState.status === 'error') {
    return (
      <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
        <p className="copilot-panel__eyebrow">Session Shell</p>
        <h2 className="copilot-panel__title">后端智能体目录加载失败</h2>
        <p className="copilot-panel__description">
          当前主入口只认后端目录为真源，因此不会回落到本地静态智能体列表。
        </p>
        <pre className="copilot-panel__error">{actions.directoryState.error}</pre>
      </section>
    )
  }

  if (actions.selectedAgent === null) {
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

  if (actions.sessionShell === null) {
    return (
      <section className="copilot-panel__inline-placeholder" aria-live="polite" data-testid="chat-session-placeholder">
        <p className="copilot-panel__inline-placeholder-text">可在左侧选择智能体与新建会话</p>
        {actions.sessionError !== null && (
          <pre className="copilot-panel__error">{actions.sessionError}</pre>
        )}
      </section>
    )
  }

  return renderMessageSendShell({
    sessionShell: actions.sessionShell,
    sessionError: actions.sessionError,
    composerDraft: actions.composerDraft,
    onComposerDraftChange: actions.onComposerDraftChange,
    onSend: actions.onSend,
    sendStatus: actions.sendStatus,
    sendDisabledReason: actions.sendDisabledReason,
    conversation: actions.conversation,
    composerInputRef: actions.composerInputRef,
    composerHeight: actions.composerHeight,
    onComposerResizeStart: actions.onComposerResizeStart,
  })
}

function renderMessageSendShell(actions: {
  sessionShell: AssistantSessionShell
  sessionError: string | null
  composerDraft: CopilotChatComposerDraft
  onComposerDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSend: (event: FormEvent<HTMLFormElement>) => void
  sendStatus: 'idle' | 'sending'
  sendDisabledReason: string | null
  conversation: CopilotConversationTurn[]
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onComposerResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}) {
  return (
    <section className="copilot-chat-workspace" aria-live="polite" data-testid="chat-session-shell-ready">
      <section className="copilot-chat" data-testid="chat-send-shell">
        <CopilotMessageList conversation={actions.conversation} />
        <CopilotComposer
          capabilities={actions.sessionShell.capabilities}
          draft={actions.composerDraft}
          onDraftChange={actions.onComposerDraftChange}
          onSubmit={actions.onSend}
          sendStatus={actions.sendStatus}
          sendDisabledReason={actions.sendDisabledReason}
          sessionError={actions.sessionError}
          composerInputRef={actions.composerInputRef}
          composerHeight={actions.composerHeight}
          onResizeStart={actions.onComposerResizeStart}
        />
      </section>
    </section>
  )
}

function isCopilotConnectableState(
  state: CopilotBootstrapState,
): state is Extract<CopilotBootstrapState, { status: 'ready' | 'degraded' }> {
  return state.status === 'ready' || state.status === 'degraded'
}

function buildSharedDetails(state: Exclude<CopilotConfigState, { status: 'error' }>): Array<{ label: string, value: string }> {
  const details = [
    {
      label: '宿主状态',
      value: state.diagnostics.hostedStatus,
    },
    {
      label: '运行模式',
      value: formatModeSummary(state.diagnostics),
    },
    {
      label: 'Runtime 来源',
      value: formatRuntimeSource(state.runtimeSource),
    },
  ]

  if (state.runtimeUrl !== null) {
    details.push({
      label: '当前 Runtime URL',
      value: state.runtimeUrl,
    })
  }

  if (state.diagnostics.failure !== null) {
    details.push({
      label: '失败摘要',
      value: `${state.diagnostics.failure.code} / ${state.diagnostics.failure.phase}`,
    })
  }

  return details
}

function formatFailureSummary(diagnostics: CopilotDiagnosticsSummary): string {
  const failure = diagnostics.failure

  if (failure === null) {
    return 'No hosted failure summary.'
  }

  const lines = [
    `状态：${diagnostics.hostedStatus}`,
    `模式：${formatModeSummary(diagnostics)}`,
    `失败代码：${failure.code}`,
    `阶段：${failure.phase}`,
    `消息：${failure.message}`,
  ]

  if (failure.exitCode !== null) {
    lines.push(`退出码：${failure.exitCode}`)
  }

  if (failure.signal !== null) {
    lines.push(`信号：${failure.signal}`)
  }

  lines.push(`可重试：${failure.retryable ? '是' : '否'}`)
  lines.push(`记录时间：${failure.timestamp}`)

  return lines.join('\n')
}

function canRetry(state: CopilotConfigState): boolean {
  return state.status === 'failed'
    && state.diagnostics.failure !== null
    && state.diagnostics.failure.retryable
}
