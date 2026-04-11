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
          <h2 className="copilot-panel__title">正在准备服务连接</h2>
          <p className="copilot-panel__description">
            请稍候，准备完成后即可开始聊天。
          </p>
        </section>
      )

    case 'error':
      return (
        <section className="copilot-panel__card copilot-panel__card--error" aria-live="assertive">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">读取连接状态失败</h2>
          <p className="copilot-panel__description">
            当前无法读取服务连接状态，请稍后重试。
          </p>
          <pre className="copilot-panel__error">{state.error}</pre>
        </section>
      )

    case 'empty':
      return (
        <NotConnectedNotice
          title="尚未连接服务"
          description="请先完成服务连接配置，然后再开始聊天。"
          missingFields={state.missingFields}
          details={buildCopilotRuntimeDetails(state)}
        />
      )

    case 'incomplete':
      return (
        <NotConnectedNotice
          title="连接信息不完整"
          description="请先补全所需配置，然后再开始聊天。"
          missingFields={state.missingFields}
          details={buildCopilotRuntimeDetails(state)}
        />
      )

    case 'starting':
      return (
        <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
          <p className="copilot-panel__eyebrow">Copilot</p>
          <h2 className="copilot-panel__title">正在连接服务</h2>
          <p className="copilot-panel__description">
            请稍候，连接成功后即可继续使用。
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
          <h2 className="copilot-panel__title">连接服务失败</h2>
          <p className="copilot-panel__description">
            当前无法连接服务，请检查设置后重试。
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
              {retrying ? '正在重试…' : '重试连接'}
            </button>
          </div>
        </section>
      )
  }
}
