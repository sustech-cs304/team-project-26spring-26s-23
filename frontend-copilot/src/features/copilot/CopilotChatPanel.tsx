import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

import { useCopilotChatInternal, useCopilotContext } from '@copilotkit/react-core'
import type { Message as CopilotMessage } from '@copilotkit/shared'

import { RecoverableErrorBoundary } from '../../components/RecoverableErrorBoundary'
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

interface CopilotChatPanelProps {
  state: CopilotBootstrapState
  retrying: boolean
  retry: () => void
  threadId: string
}

export function CopilotChatPanel({ state, retrying, retry, threadId }: CopilotChatPanelProps) {
  return (
    <section className="copilot-panel">
      <header className="copilot-panel__header">
        <div>
          <p className="copilot-panel__eyebrow">Copilot Feature</p>
          <h1 className="copilot-panel__heading">最小聊天面板</h1>
        </div>
        <span className={`copilot-panel__status copilot-panel__status--${state.status}`}>
          {statusLabels[state.status]}
        </span>
      </header>

      {renderCopilotPanelContent(state, {
        retrying,
        onRetry: retry,
        threadId,
      })}
    </section>
  )
}

function renderCopilotPanelContent(
  state: CopilotBootstrapState,
  actions: {
    retrying: boolean
    onRetry: () => void
    threadId: string
  },
) {
  switch (state.status) {
    case 'loading':
      return (
        <section className="copilot-panel__card" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">正在等待根层完成运行态装配</h2>
          <p className="copilot-panel__description">
            聊天面板不再自行读取配置或运行时；当前仅消费来自根装配层的统一状态与动作。
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
          description="当前既没有可用的宿主运行时地址，也没有开发态覆盖地址。开发态下可继续使用手填 runtime URL 作为外接联调覆盖；正式宿主管理链路则会在后端 ready 后自动提供地址。"
          missingFields={state.missingFields}
          details={buildSharedDetails(state)}
        />
      )

    case 'incomplete':
      return (
        <NotConnectedNotice
          title="连接信息仍不完整"
          description="宿主运行态与本地设置已由根层统一读取，但当前缺少继续接入 CopilotKit 所需的最小字段。若宿主尚未提供 runtime URL，正式模式需要等待 hosted backend ready；开发态则可显式填写 override。"
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
            当前由 Electron 主进程托管 hosted backend；Renderer 不再自行猜测地址，而是等待宿主进入 ready 后提供有效 runtime URL。
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
            当前未拿到可用的 hosted backend 运行地址。界面仅展示最小失败摘要，不暴露 token、spawn 参数或底层文件访问能力。
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
      return (
        <>
          <section className="copilot-panel__card copilot-panel__card--warning" aria-live="polite">
            <p className="copilot-panel__eyebrow">Copilot</p>
            <h2 className="copilot-panel__title">宿主运行态已降级</h2>
            <p className="copilot-panel__description">
              Hosted backend 曾成功提供运行地址，但当前记录到异常退出或降级。若保留的 runtime URL 仍可连接，CopilotKit 仍会继续使用；同时请关注宿主诊断摘要。
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
          </section>
          <ConnectedChatMount threadId={actions.threadId} />
        </>
      )

    case 'ready':
      return (
        <>
          <section className="copilot-panel__card copilot-panel__card--ready" aria-live="polite">
            <p className="copilot-panel__eyebrow">Copilot</p>
            <h2 className="copilot-panel__title">Copilot 连接入口已就绪</h2>
            <p className="copilot-panel__description">
              当前连接优先使用宿主管理的 hosted backend；仅当宿主未提供可用地址且处于开发态时，才会回落到显式 dev override。CopilotKit 注入路径保持不变，当前工作区会把所选会话 ID 作为 threadId 继续传入聊天区。
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
                <dt>Agent 名称</dt>
                <dd>{state.agentName}</dd>
              </div>
              <div>
                <dt>Agent 来源</dt>
                <dd>{formatAgentNameSource(state.agentNameSource)}</dd>
              </div>
              <div>
                <dt>存储状态</dt>
                <dd>{state.storageState}</dd>
              </div>
              <div>
                <dt>运行模式</dt>
                <dd>{formatModeSummary(state.diagnostics)}</dd>
              </div>
            </dl>
          </section>
          <ConnectedChatMount threadId={actions.threadId} />
        </>
      )
  }
}

function ConnectedChatMount({ threadId }: { threadId: string }) {
  return (
    <RecoverableErrorBoundary
      resetKeys={[threadId]}
      fallback={({ error, reset }) => (
        <section className="copilot-chat" aria-label="聊天区域异常">
          <div className="copilot-chat__stream">
            <article className="copilot-chat__message copilot-chat__message--error" role="alert">
              <p className="copilot-chat__message-label">聊天运行时错误</p>
              <p className="copilot-chat__message-text">{formatThrownError(error)}</p>
              <button type="button" className="copilot-panel__button" onClick={reset}>
                重新挂载聊天区域
              </button>
            </article>
          </div>
        </section>
      )}
    >
      <ConnectedChatSurface threadId={threadId} />
    </RecoverableErrorBoundary>
  )
}

function ConnectedChatSurface({ threadId }: { threadId: string }) {
  const {
    bannerError,
    setBannerError,
    setThreadId: setCopilotThreadId,
    threadId: currentThreadId,
  } = useCopilotContext()
  const { messages, sendMessage, isLoading, isAvailable, reset } = useCopilotChatInternal()
  const [draft, setDraft] = useState('')
  const resetRef = useRef(reset)
  const setBannerErrorRef = useRef(setBannerError)
  const setCopilotThreadIdRef = useRef(setCopilotThreadId)
  const lastAppliedThreadIdRef = useRef<string | null>(null)

  useEffect(() => {
    resetRef.current = reset
  }, [reset])

  useEffect(() => {
    setBannerErrorRef.current = setBannerError
  }, [setBannerError])

  useEffect(() => {
    setCopilotThreadIdRef.current = setCopilotThreadId
  }, [setCopilotThreadId])

  useEffect(() => {
    if (lastAppliedThreadIdRef.current === threadId) {
      return
    }

    lastAppliedThreadIdRef.current = threadId
    setDraft('')
    setBannerErrorRef.current(null)
    resetRef.current()
    setCopilotThreadIdRef.current(threadId)
  }, [threadId])

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role === 'user' || message.role === 'assistant'),
    [messages],
  )

  const activeThreadId = currentThreadId || threadId

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const content = draft.trim()
    if (content.length === 0 || isLoading || !isAvailable) {
      return
    }

    setBannerError(null)
    setDraft('')
    await sendMessage(createUserTextMessage(content))
  }

  return (
    <section className="copilot-chat" aria-label="Copilot 聊天区">
      <div className="copilot-chat__meta">
        <span className="copilot-chat__meta-item">
          <span className="copilot-chat__meta-label">当前 threadId</span>
          <code className="copilot-chat__meta-value">{activeThreadId}</code>
        </span>
        <span
          className={`copilot-chat__availability copilot-chat__availability--${isAvailable ? 'available' : 'pending'}`}
        >
          {isLoading ? '回复生成中' : isAvailable ? '聊天已连接' : '聊天连接中'}
        </span>
      </div>

      <div className="copilot-chat__stream" data-testid="copilot-chat-stream">
        {visibleMessages.length === 0 && !isLoading && bannerError === null && (
          <div className="copilot-chat__empty">
            <p className="copilot-chat__empty-title">最小聊天已挂载</p>
            <p className="copilot-chat__empty-text">
              当前会话已把工作台所选话题 ID 绑定为 threadId。发送第一条消息后，后端将以同一 thread_id 继续维护上下文。
            </p>
          </div>
        )}

        {visibleMessages.map((message, index) => {
          const isUser = message.role === 'user'
          const text = extractMessageText(message)

          return (
            <article
              key={message.id ?? `${message.role}:${index}`}
              className={`copilot-chat__message copilot-chat__message--${isUser ? 'user' : 'assistant'}`}
            >
              <p className="copilot-chat__message-label">{isUser ? 'You' : 'Assistant'}</p>
              <p className="copilot-chat__message-text">{text}</p>
            </article>
          )
        })}

        {isLoading && (
          <article className="copilot-chat__message copilot-chat__message--assistant copilot-chat__message--pending">
            <p className="copilot-chat__message-label">Assistant</p>
            <p className="copilot-chat__message-text">正在生成回复…</p>
          </article>
        )}

        {bannerError !== null && (
          <article className="copilot-chat__message copilot-chat__message--error" role="alert">
            <p className="copilot-chat__message-label">运行时错误</p>
            <p className="copilot-chat__message-text">{bannerError.message}</p>
          </article>
        )}
      </div>

      <form className="copilot-chat__composer" onSubmit={handleSubmit}>
        <label className="copilot-chat__composer-label" htmlFor="copilot-chat-input">
          发送消息
        </label>
        <textarea
          id="copilot-chat-input"
          className="copilot-chat__composer-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isAvailable ? '输入要发送给 Copilot 的内容…' : '聊天运行时连接中，暂不可发送消息'}
          rows={3}
          disabled={isLoading || !isAvailable}
        />
        <div className="copilot-chat__composer-actions">
          <span className="copilot-chat__composer-hint">
            {bannerError !== null ? '错误已以内联红色消息显示；修复后可继续在当前线程重试。' : '当前仅支持最小纯文本聊天 MVP。'}
          </span>
          <button
            type="submit"
            className="copilot-panel__button"
            disabled={isLoading || !isAvailable || draft.trim().length === 0}
          >
            {isLoading ? '回复生成中…' : '发送消息'}
          </button>
        </div>
      </form>
    </section>
  )
}

function createUserTextMessage(content: string): CopilotMessage {
  return {
    id: createClientMessageId(),
    role: 'user',
    content,
  } as CopilotMessage
}

function createClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `copilot-msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function extractMessageText(message: CopilotMessage): string {
  const content = (message as { content?: unknown }).content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text
        }

        return ''
      })
      .filter((part) => part.length > 0)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    if ('text' in content && typeof content.text === 'string') {
      return content.text
    }

    if ('content' in content && typeof content.content === 'string') {
      return content.content
    }
  }

  return '[暂不支持的消息内容]'
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
    {
      label: 'Agent 来源',
      value: formatAgentNameSource(state.agentNameSource),
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

function formatAgentNameSource(source: 'config-center' | 'missing'): string {
  switch (source) {
    case 'config-center':
      return '配置中心'
    case 'missing':
      return '未提供'
  }
}

function formatModeSummary(diagnostics: CopilotDiagnosticsSummary): string {
  return `${diagnostics.mode}（${diagnostics.modeSource === 'resolved' ? '已解析' : '预期'}）`
}

function formatThrownError(error: Error): string {
  return error.message || String(error)
}
