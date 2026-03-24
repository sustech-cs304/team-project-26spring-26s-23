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
}

export function CopilotChatPanel({ state, retrying, retry }: CopilotChatPanelProps) {
  return (
    <section className="copilot-panel">
      <header className="copilot-panel__header">
        <div>
          <p className="copilot-panel__eyebrow">Copilot Feature</p>
          <h1 className="copilot-panel__heading">聊天面板骨架</h1>
        </div>
        <span className={`copilot-panel__status copilot-panel__status--${state.status}`}>
          {statusLabels[state.status]}
        </span>
      </header>

      {renderCopilotPanelContent(state, {
        retrying,
        onRetry: retry,
      })}
    </section>
  )
}

function renderCopilotPanelContent(
  state: CopilotBootstrapState,
  actions: {
    retrying: boolean
    onRetry: () => void
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
      )

    case 'ready':
      return (
        <section className="copilot-panel__card copilot-panel__card--ready" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">Copilot 连接入口已就绪</h2>
          <p className="copilot-panel__description">
            当前连接优先使用宿主管理的 hosted backend；仅当宿主未提供可用地址且处于开发态时，才会回落到显式 dev override。CopilotKit 注入路径保持不变。
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
          <div className="copilot-panel__placeholder">
            <p className="copilot-panel__placeholder-label">后续接入占位</p>
            <p className="copilot-panel__placeholder-text">
              真实对话区将在后续 Provider 注入与 runtime 集成阶段继续收口；本阶段已改为由根装配层统一决定连接状态、Provider 注入与有效 runtime URL。
            </p>
          </div>
        </section>
      )
  }
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

function formatAgentNameSource(source: 'settings' | 'missing'): string {
  switch (source) {
    case 'settings':
      return '本地设置'
    case 'missing':
      return '未提供'
  }
}

function formatModeSummary(diagnostics: CopilotDiagnosticsSummary): string {
  return `${diagnostics.mode}（${diagnostics.modeSource === 'resolved' ? '已解析' : '预期'}）`
}
