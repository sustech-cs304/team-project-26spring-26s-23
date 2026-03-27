import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/AssistantWorkspace'
import {
  RuntimeRequestError,
  sendRuntimeMessage,
  type RuntimeMessageSendResponse,
} from './chat-contract'
import type { CopilotBootstrapState, CopilotConfigState, CopilotDiagnosticsSummary } from './types'
import { NotConnectedNotice } from './components/NotConnectedNotice'
import './copilot.css'

const statusLabels: Record<CopilotBootstrapState['status'], string> = {
  loading: '读取中',
  empty: '未配置',
  incomplete: '配置缺失',
  starting: '启动中',
  ready: '已连接',
  failed: '启动失败',
  degraded: '运行降级',
  error: '读取失败',
}

export interface CopilotChatComposerDraft {
  messageText: string
  model: string
  enabledTools: string[]
  requestOptionsText: string
}

export interface RuntimeMessageSendInput {
  runtimeUrl: string
  sessionId: string
  agent: string
  message: {
    role: 'user'
    content: string
  }
  model: string
  enabledTools: string[]
  requestOptions: Record<string, unknown>
}

interface CopilotConversationTurn {
  id: string
  kind: 'user' | 'assistant' | 'error'
  title: string
  content: string
  resolvedModelId?: string
  resolvedToolIds?: string[]
  requestOptions?: Record<string, unknown>
}

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
  sendError: string | null
  conversation: CopilotConversationTurn[]
}

interface RenderMessageShellActions {
  sessionShell: AssistantSessionShell
  sessionError: string | null
  composerDraft: CopilotChatComposerDraft
  onComposerDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onSend: (event: FormEvent<HTMLFormElement>) => void
  sendStatus: 'idle' | 'sending'
  sendDisabledReason: string | null
  sendError: string | null
  conversation: CopilotConversationTurn[]
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
  const [sendError, setSendError] = useState<string | null>(null)

  const sessionIdentity = sessionShell === null
    ? null
    : `${sessionShell.sessionId}:${sessionShell.capabilities.capabilitiesVersion}`

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

    try {
      const response = await sendMessage(runtimeInput)
      setConversation((current) => [
        ...current,
        createUserTurn(trimmedMessage),
        createAssistantTurn(response),
      ])
      setComposerDraft((current) => ({
        ...current,
        messageText: '',
      }))
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
    }
  }

  return (
    <section className="copilot-panel">
      <header className="copilot-panel__header">
        <div>
          <p className="copilot-panel__eyebrow">Copilot Feature</p>
          <h1 className="copilot-panel__heading">Session-First Chat Shell</h1>
        </div>
        <span className={`copilot-panel__status copilot-panel__status--${state.status}`}>
          {statusLabels[state.status]}
        </span>
      </header>

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
        sendError,
        conversation,
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
  state: Extract<CopilotBootstrapState, { status: 'ready' | 'degraded' }>,
  actions: RenderPanelActions,
  tone: 'ready' | 'warning',
) {
  const selectedAgent = actions.selectedAgent
  const sessionShell = actions.sessionShell

  return (
    <>
      <section className={`copilot-panel__card copilot-panel__card--${tone}`} aria-live="polite">
        <p className="copilot-panel__eyebrow">Copilot</p>
        <h2 className="copilot-panel__title">主聊天入口已切到会话优先壳层</h2>
        <p className="copilot-panel__description">
          当前入口先拉取后端智能体目录，再由用户显式创建会话。旧全局 agentName 与旧 Provider 路径不再驱动主聊天入口。
        </p>
        <dl className="copilot-panel__details-grid">
          <div>
            <dt>当前 Runtime URL</dt>
            <dd>{state.runtimeUrl}</dd>
          </div>
          <div>
            <dt>Runtime 来源</dt>
            <dd>{formatRuntimeSource(state.runtimeSource)}</dd>
          </div>
          <div>
            <dt>目录状态</dt>
            <dd>{formatDirectoryStatus(actions.directoryState.status)}</dd>
          </div>
          <div>
            <dt>已选智能体</dt>
            <dd>{selectedAgent?.label ?? '尚未选择'}</dd>
          </div>
          <div>
            <dt>当前会话</dt>
            <dd>{sessionShell?.sessionId ?? '尚未创建'}</dd>
          </div>
          <div>
            <dt>运行模式</dt>
            <dd>{formatModeSummary(state.diagnostics)}</dd>
          </div>
        </dl>
      </section>

      {renderSessionContent(actions)}
    </>
  )
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
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite" data-testid="chat-session-placeholder">
        <p className="copilot-panel__eyebrow">Session Shell</p>
        <h2 className="copilot-panel__title">尚未创建会话</h2>
        <p className="copilot-panel__description">
          请选择智能体并创建会话。当前主聊天入口已经切到 session/create 语义，不再使用旧全局 agentName 自动进入聊天。
        </p>
        <ul className="copilot-panel__list">
          <li>当前选择：{actions.selectedAgent.label}</li>
          <li>会话创建状态：{formatSessionStatus(actions.sessionStatus)}</li>
          <li>会话创建成功后会立即拉取 capabilities/get 能力面。</li>
          <li>消息发送只会从新的 session-first message/send 路径进入。</li>
          <li>当前不会静默回落到旧 Provider 消息路径。</li>
        </ul>
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
    sendError: actions.sendError,
    conversation: actions.conversation,
  })
}

function renderMessageSendShell(actions: RenderMessageShellActions) {
  const sessionShell = actions.sessionShell
  const capabilities = sessionShell.capabilities

  return (
    <section className="copilot-panel__card copilot-panel__card--ready" aria-live="polite" data-testid="chat-session-shell-ready">
      <p className="copilot-panel__eyebrow">Session Shell</p>
      <h2 className="copilot-panel__title">当前会话已接入 request-scoped message/send 闭环</h2>
      <p className="copilot-panel__description">
        当前会话已通过 session/create 创建成功，并紧接着读取 capabilities/get。发送时会显式带上 sessionId、消息内容、会话绑定智能体校验值、消息级模型、enabledTools 与最小 requestOptions。
      </p>
      <dl className="copilot-panel__details-grid">
        <div>
          <dt>Session ID</dt>
          <dd>{sessionShell.sessionId}</dd>
        </div>
        <div>
          <dt>Bound Agent</dt>
          <dd>{sessionShell.boundAgent.label}</dd>
        </div>
        <div>
          <dt>Capabilities Version</dt>
          <dd>{capabilities.capabilitiesVersion}</dd>
        </div>
        <div>
          <dt>默认模型偏好</dt>
          <dd>{capabilities.defaultModelPreference ?? '未提供'}</dd>
        </div>
      </dl>
      <div className="copilot-panel__details-block">
        <p className="copilot-panel__details-heading">总体可用工具集合（后端能力面真源）</p>
        <ul className="copilot-panel__list">
          {capabilities.allAvailableTools.map((tool) => (
            <li key={tool.toolId}>
              <strong>{tool.toolId}</strong>
              {' · '}
              {tool.displayName ?? '未提供显示名'}
              {' · '}
              {tool.kind}
              {' · '}
              {tool.availability}
            </li>
          ))}
        </ul>
      </div>
      <div className="copilot-panel__details-block">
        <p className="copilot-panel__details-heading">当前默认启用来源</p>
        <ul className="copilot-panel__list">
          <li>当前 boundAgent：{sessionShell.boundAgent.id}</li>
          <li>默认模型来源：{capabilities.defaultModelPreference ?? '未提供'}</li>
          <li>默认启用 toolId：{formatToolIdList(capabilities.defaultEnabledTools)}</li>
          <li>recommendedTools 只作为默认来源，不构成硬限制。</li>
        </ul>
      </div>

      <section className="copilot-chat" data-testid="chat-send-shell">
        <div className="copilot-chat__meta">
          <div className="copilot-chat__meta-item">
            <span className="copilot-chat__meta-label">当前校验 Agent</span>
            <span className="copilot-chat__meta-value">{sessionShell.boundAgent.id}</span>
          </div>
          <div className="copilot-chat__meta-item">
            <span className="copilot-chat__meta-label">当前发送模型</span>
            <span className="copilot-chat__meta-value">{actions.composerDraft.model || '未填写'}</span>
          </div>
          <div className="copilot-chat__meta-item">
            <span className="copilot-chat__meta-label">当前启用工具</span>
            <span className="copilot-chat__meta-value">{formatToolIdList(actions.composerDraft.enabledTools)}</span>
          </div>
        </div>

        <div className="copilot-chat__stream">
          {actions.conversation.length === 0
            ? (
                <div className="copilot-chat__empty">
                  <p className="copilot-chat__empty-title">当前尚未发送消息</p>
                  <p className="copilot-chat__empty-text">
                    下面的最小 UI 会直接走新的 message/send 契约，不会再接回旧 Provider 或旧全局 agentName 发送路径。
                  </p>
                </div>
              )
            : actions.conversation.map((turn) => (
                <article
                  key={turn.id}
                  className={`copilot-chat__message copilot-chat__message--${turn.kind}`}
                >
                  <p className="copilot-chat__message-label">{turn.title}</p>
                  <p className="copilot-chat__message-text">{turn.content}</p>
                  {turn.kind === 'assistant' && (
                    <ul className="copilot-panel__list copilot-chat__message-list">
                      <li>resolvedModelId：{turn.resolvedModelId ?? '未返回'}</li>
                      <li>resolvedToolIds：{formatToolIdList(turn.resolvedToolIds ?? [])}</li>
                      <li>requestOptions：{formatRequestOptions(turn.requestOptions ?? {})}</li>
                    </ul>
                  )}
                </article>
              ))}
        </div>

        <form className="copilot-chat__composer" onSubmit={actions.onSend}>
          <label className="copilot-panel__field-group">
            <span className="copilot-chat__composer-label">消息内容</span>
            <textarea
              className="copilot-chat__composer-input"
              name="messageText"
              value={actions.composerDraft.messageText}
              onChange={(event) => {
                const nextValue = event.currentTarget.value
                actions.onComposerDraftChange((current) => ({
                  ...current,
                  messageText: nextValue,
                }))
              }}
              placeholder="输入当前会话中的用户消息内容"
              disabled={actions.sendStatus === 'sending'}
            />
          </label>

          <div className="copilot-panel__form-grid">
            <label className="copilot-panel__field-group">
              <span className="copilot-chat__composer-label">消息级模型</span>
              <input
                className="copilot-panel__field-input"
                name="model"
                value={actions.composerDraft.model}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value
                  actions.onComposerDraftChange((current) => ({
                    ...current,
                    model: nextValue,
                  }))
                }}
                placeholder={capabilities.defaultModelPreference ?? '例如 openai/gpt-4.1'}
                disabled={actions.sendStatus === 'sending'}
              />
              <span className="copilot-panel__field-hint">
                默认值来自当前 capabilities.defaultModelPreference，而不是旧全局 backendExposed.model。
              </span>
            </label>

            <label className="copilot-panel__field-group">
              <span className="copilot-chat__composer-label">requestOptions（JSON 对象）</span>
              <textarea
                className="copilot-panel__field-input copilot-panel__field-input--code"
                name="requestOptions"
                value={actions.composerDraft.requestOptionsText}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value
                  actions.onComposerDraftChange((current) => ({
                    ...current,
                    requestOptionsText: nextValue,
                  }))
                }}
                placeholder="{}"
                disabled={actions.sendStatus === 'sending'}
              />
              <span className="copilot-panel__field-hint">
                本阶段只保留最小透传结构；留空会按空对象发送。
              </span>
            </label>
          </div>

          <div className="copilot-panel__details-block">
            <p className="copilot-panel__details-heading">消息级 enabledTools</p>
            <p className="copilot-panel__description">
              推荐工具只用于初始化默认勾选；你可以在当前消息前临时切换任意 toolId，后端会继续按稳定 toolId 校验。
            </p>
            <div className="copilot-panel__checkbox-list">
              {capabilities.allAvailableTools.map((tool) => {
                const checked = actions.composerDraft.enabledTools.includes(tool.toolId)

                return (
                  <label key={tool.toolId} className="copilot-panel__checkbox-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={actions.sendStatus === 'sending'}
                      onChange={(event) => {
                        const nextChecked = event.currentTarget.checked
                        actions.onComposerDraftChange((current) => ({
                          ...current,
                          enabledTools: nextChecked
                            ? [...current.enabledTools, tool.toolId]
                            : current.enabledTools.filter((toolId) => toolId !== tool.toolId),
                        }))
                      }}
                    />
                    <span>
                      <strong>{tool.toolId}</strong>
                      {' · '}
                      {tool.displayName ?? '未提供显示名'}
                      {' · '}
                      {tool.availability}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          {actions.sendError !== null && (
            <p className="copilot-panel__error" role="alert">{actions.sendError}</p>
          )}

          <div className="copilot-chat__composer-actions">
            <p className="copilot-chat__composer-hint">
              发送时会显式提交 sessionId、agent 校验值、message、model、enabledTools 与 requestOptions。
            </p>
            <button
              type="submit"
              className="copilot-panel__button"
              disabled={actions.sendDisabledReason !== null}
              title={actions.sendDisabledReason ?? '发送消息'}
            >
              {actions.sendStatus === 'sending' ? '发送中…' : '发送消息'}
            </button>
          </div>
        </form>
      </section>

      {actions.sessionError !== null && (
        <pre className="copilot-panel__error">{actions.sessionError}</pre>
      )}
    </section>
  )
}

export function createComposerDraftFromSession(sessionShell: AssistantSessionShell): CopilotChatComposerDraft {
  return {
    messageText: '',
    model: sessionShell.capabilities.defaultModelPreference ?? '',
    enabledTools: [...sessionShell.capabilities.defaultEnabledTools],
    requestOptionsText: '{}',
  }
}

export function buildRuntimeMessageSendInput(input: {
  runtimeUrl: string
  sessionShell: AssistantSessionShell
  draft: CopilotChatComposerDraft
  requestOptions: Record<string, unknown>
}): RuntimeMessageSendInput {
  return {
    runtimeUrl: input.runtimeUrl,
    sessionId: input.sessionShell.sessionId,
    agent: input.sessionShell.boundAgent.id,
    message: {
      role: 'user',
      content: input.draft.messageText.trim(),
    },
    model: input.draft.model.trim(),
    enabledTools: dedupeToolIds(input.draft.enabledTools),
    requestOptions: { ...input.requestOptions },
  }
}

export function parseRequestOptionsText(requestOptionsText: string): Record<string, unknown> {
  const trimmed = requestOptionsText.trim()
  if (trimmed === '') {
    return {}
  }

  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('requestOptions 必须是 JSON 对象。')
  }

  return { ...(parsed as Record<string, unknown>) }
}

export function formatRuntimeMessageSendError(error: unknown): string {
  if (error instanceof RuntimeRequestError) {
    switch (error.code) {
      case 'agent_mismatch':
        return `agent_mismatch：当前消息携带的 agent 校验值与会话绑定智能体不一致。${error.message}`
      case 'tool_not_found':
        return `tool_not_found：本次消息启用了后端未注册的 toolId。${error.message}`
      case 'tool_unavailable':
        return `tool_unavailable：本次消息请求的工具当前不可用。${error.message}`
      case 'invalid_request':
        return `invalid_request：消息请求结构无效。${error.message}`
      case 'capabilities_version_stale':
        return `capabilities_version_stale：当前能力面版本已过期，需要重新拉取 capabilities 后再发。${error.message}`
      default:
        return error.message
    }
  }

  return error instanceof Error ? error.message : String(error)
}

function createEmptyComposerDraft(): CopilotChatComposerDraft {
  return {
    messageText: '',
    model: '',
    enabledTools: [],
    requestOptionsText: '{}',
  }
}

function createUserTurn(content: string): CopilotConversationTurn {
  return {
    id: `user:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'user',
    title: '用户消息',
    content,
  }
}

function createAssistantTurn(response: RuntimeMessageSendResponse): CopilotConversationTurn {
  return {
    id: `assistant:${response.sessionId}:${Math.random().toString(36).slice(2)}`,
    kind: 'assistant',
    title: '助手响应',
    content: response.assistantMessage.content,
    resolvedModelId: response.resolvedModelId,
    resolvedToolIds: [...response.resolvedToolIds],
    requestOptions: { ...response.requestOptions },
  }
}

function createErrorTurn(content: string): CopilotConversationTurn {
  return {
    id: `error:${content}:${Math.random().toString(36).slice(2)}`,
    kind: 'error',
    title: '发送失败',
    content,
  }
}

function dedupeToolIds(toolIds: string[]): string[] {
  const uniqueToolIds = new Set<string>()

  for (const toolId of toolIds) {
    const normalizedToolId = toolId.trim()
    if (normalizedToolId !== '') {
      uniqueToolIds.add(normalizedToolId)
    }
  }

  return [...uniqueToolIds]
}

function formatRequestOptions(requestOptions: Record<string, unknown>): string {
  return JSON.stringify(requestOptions)
}

function formatRequestOptionsError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

function formatRuntimeSource(source: 'hosted' | 'dev-override' | 'none'): string {
  switch (source) {
    case 'hosted':
      return '宿主管理'
    case 'dev-override':
      return '开发态 override'
    case 'none':
      return '暂无有效来源'
  }
}

function formatModeSummary(diagnostics: CopilotDiagnosticsSummary): string {
  return `${diagnostics.mode}（${diagnostics.modeSource === 'resolved' ? '已解析' : '预期'}）`
}

function formatToolIdList(toolIds: string[]): string {
  return toolIds.length === 0 ? '空集合' : toolIds.join(', ')
}

function formatDirectoryStatus(status: AssistantAgentDirectoryState['status']): string {
  switch (status) {
    case 'idle':
      return '未开始'
    case 'loading':
      return '加载中'
    case 'ready':
      return '已就绪'
    case 'error':
      return '加载失败'
  }
}

function formatSessionStatus(status: 'idle' | 'creating' | 'error'): string {
  switch (status) {
    case 'idle':
      return '待创建'
    case 'creating':
      return '创建中'
    case 'error':
      return '创建失败'
  }
}
