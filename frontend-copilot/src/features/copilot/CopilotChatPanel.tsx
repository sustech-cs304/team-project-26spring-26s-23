import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import type { AssistantAgentDirectoryState } from '../../workbench/assistant/AssistantWorkspace'
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
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
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
}: CopilotChatPanelProps) {
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
      })}
    </section>
  )
}

function renderCopilotPanelContent(
  state: CopilotBootstrapState,
  actions: {
    retrying: boolean
    onRetry: () => void
    selectedAgent: AgentType | null
    sessionShell: AssistantSessionShell | null
    directoryState: AssistantAgentDirectoryState
    sessionStatus: 'idle' | 'creating' | 'error'
    sessionError: string | null
  },
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
  actions: {
    selectedAgent: AgentType | null
    sessionShell: AssistantSessionShell | null
    directoryState: AssistantAgentDirectoryState
    sessionStatus: 'idle' | 'creating' | 'error'
    sessionError: string | null
  },
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

function renderSessionContent(actions: {
  selectedAgent: AgentType | null
  sessionShell: AssistantSessionShell | null
  directoryState: AssistantAgentDirectoryState
  sessionStatus: 'idle' | 'creating' | 'error'
  sessionError: string | null
}) {
  if (actions.directoryState.status === 'loading' || actions.directoryState.status === 'idle') {
    return (
      <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
        <p className="copilot-panel__eyebrow">Session Shell</p>
        <h2 className="copilot-panel__title">正在准备智能体目录</h2>
        <p className="copilot-panel__description">
          主入口正在等待后端 [`agents/list`](backend/app/copilot_runtime/contracts.py:14) 返回目录数据。
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
          请选择智能体并创建会话。当前主聊天入口已经切到 [`session/create`](backend/app/copilot_runtime/contracts.py:15) 语义，不再使用旧全局 agentName 自动进入聊天。
        </p>
        <ul className="copilot-panel__list">
          <li>当前选择：{actions.selectedAgent.label}</li>
          <li>会话创建状态：{formatSessionStatus(actions.sessionStatus)}</li>
          <li>消息发送将在下一阶段接入 [`message/send`](backend/app/copilot_runtime/contracts.py:17)。</li>
          <li>当前不会静默回落到旧 Provider 消息路径。</li>
        </ul>
        {actions.sessionError !== null && (
          <pre className="copilot-panel__error">{actions.sessionError}</pre>
        )}
      </section>
    )
  }

  return (
    <section className="copilot-panel__card copilot-panel__card--ready" aria-live="polite" data-testid="chat-session-shell-ready">
      <p className="copilot-panel__eyebrow">Session Shell</p>
      <h2 className="copilot-panel__title">当前会话已绑定智能体</h2>
      <p className="copilot-panel__description">
        会话已通过 [`session/create`](backend/app/copilot_runtime/contracts.py:15) 创建成功。该壳层当前只负责持有 `sessionId + boundAgent`，消息发送将在下一阶段接入。
      </p>
      <dl className="copilot-panel__details-grid">
        <div>
          <dt>Session ID</dt>
          <dd>{actions.sessionShell.sessionId}</dd>
        </div>
        <div>
          <dt>Bound Agent</dt>
          <dd>{actions.sessionShell.boundAgent.label}</dd>
        </div>
        <div>
          <dt>默认模型偏好</dt>
          <dd>{actions.sessionShell.defaultModelPreference ?? '未提供'}</dd>
        </div>
        <div>
          <dt>推荐工具数</dt>
          <dd>{String(actions.sessionShell.recommendedTools.length)}</dd>
        </div>
      </dl>
      <div className="copilot-panel__details-block">
        <p className="copilot-panel__details-heading">下一阶段占位</p>
        <ul className="copilot-panel__list">
          <li>下一阶段将在此处接入 [`message/send`](backend/app/copilot_runtime/contracts.py:17)。</li>
          <li>本阶段不会渲染旧 `threadId`/旧 Provider 聊天表面。</li>
          <li>当前不会出现“新会话 shell 外面继续包旧消息入口”的混合方案。</li>
        </ul>
      </div>
      {actions.sessionError !== null && (
        <pre className="copilot-panel__error">{actions.sessionError}</pre>
      )}
    </section>
  )
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
