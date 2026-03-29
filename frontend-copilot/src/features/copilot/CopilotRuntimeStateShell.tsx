import { NotConnectedNotice } from './components/NotConnectedNotice'
import {
  buildCopilotRuntimeDetails,
  canRetryCopilotRuntime,
  formatCopilotFailureSummary,
} from './copilot-panel-diagnostics'
import type { CopilotBootstrapState } from './types'

interface CopilotRuntimeStateShellProps {
  state: Extract<
    CopilotBootstrapState,
    { status: 'loading' | 'error' | 'empty' | 'incomplete' | 'starting' | 'failed' }
  >
  retrying: boolean
  onRetry: () => void
}

export function CopilotRuntimeStateShell({
  state,
  retrying,
  onRetry,
}: CopilotRuntimeStateShellProps) {
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
          details={buildCopilotRuntimeDetails(state)}
        />
      )

    case 'incomplete':
      return (
        <NotConnectedNotice
          title="连接信息仍不完整"
          description="宿主运行态与本地设置已由根层统一读取，但当前缺少继续访问后端目录所需的最小字段。这里不再把旧全局 agentName 视为聊天必填项。"
          missingFields={state.missingFields}
          details={buildCopilotRuntimeDetails(state)}
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
            {buildCopilotRuntimeDetails(state).map((detail) => (
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
            {buildCopilotRuntimeDetails(state).map((detail) => (
              <div key={`${detail.label}:${detail.value}`}>
                <dt>{detail.label}</dt>
                <dd>{detail.value}</dd>
              </div>
            ))}
          </dl>
          {state.diagnostics.failure && (
            <pre className="copilot-panel__error">{formatCopilotFailureSummary(state.diagnostics)}</pre>
          )}
          <div className="copilot-panel__actions">
            <button
              type="button"
              className="copilot-panel__button"
              onClick={onRetry}
              disabled={retrying || !canRetryCopilotRuntime(state)}
            >
              {retrying ? '正在重试…' : '重试启动宿主后端'}
            </button>
          </div>
        </section>
      )
  }
}
