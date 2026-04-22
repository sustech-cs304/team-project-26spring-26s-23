import { AlertCircle, LoaderCircle, Wrench } from 'lucide-react'

import type { ManagedRuntimeStatus } from '../../../electron/managed-runtime/types'
import type { ManagedRuntimeStatusViewModel } from './managed-runtime-view-model'

interface ManagedRuntimeStatusButtonProps {
  viewModel: ManagedRuntimeStatusViewModel | null
  loading: boolean
  busy: boolean
  open: boolean
  error: string | null
  onToggle: () => void
  onInstallOrRepair: () => void | Promise<void>
}

export function ManagedRuntimeStatusButton({
  viewModel,
  loading,
  busy,
  open,
  error,
  onToggle,
  onInstallOrRepair,
}: ManagedRuntimeStatusButtonProps) {
  const summary = viewModel?.summary ?? '读取 MCP 环境状态中'
  const label = viewModel?.overallLabel ?? (loading ? '加载中' : '未知')

  return (
    <div className="managed-runtime-status-shell">
      <button
        type="button"
        className={`secondary-button secondary-button--subtle managed-runtime-status-button managed-runtime-status-button--${viewModel?.overallStatus ?? 'loading'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="managed-runtime-status-panel"
        onClick={onToggle}
      >
        <span className={`managed-runtime-status-indicator managed-runtime-status-indicator--${viewModel?.overallStatus ?? 'loading'}`}>
          {loading || busy ? <LoaderCircle size={14} className="managed-runtime-status-button__spinner" /> : resolveStatusIcon(viewModel?.overallStatus)}
        </span>
        <span className="managed-runtime-status-button__copy">
          <span className="managed-runtime-status-button__title">环境状态</span>
          <span className="managed-runtime-status-button__summary">{label} · {summary}</span>
        </span>
      </button>

      {open ? (
        <section
          id="managed-runtime-status-panel"
          className="managed-runtime-status-panel"
          role="region"
          aria-label="MCP 托管运行时状态"
          data-testid="managed-runtime-status-panel"
        >
          <header className="managed-runtime-status-panel__header">
            <div>
              <p className="managed-runtime-status-panel__eyebrow">MCP 托管环境</p>
              <h3 className="managed-runtime-status-panel__title">{label}</h3>
              <p className="managed-runtime-status-panel__description">{summary}</p>
            </div>
            <button
              type="button"
              className="secondary-button secondary-button--subtle"
              disabled={busy}
              onClick={() => void onInstallOrRepair()}
            >
              {busy ? '处理中…' : (viewModel?.actionLabel ?? '一键安装/修复')}
            </button>
          </header>

          {error ? (
            <p className="managed-runtime-status-panel__error" role="alert">{error}</p>
          ) : null}

          <div className="managed-runtime-status-panel__cards">
            {viewModel?.families.map((family) => (
              <article
                key={family.family}
                className={`managed-runtime-family-card managed-runtime-family-card--${family.status}`}
              >
                <div className="managed-runtime-family-card__header">
                  <div>
                    <h4 className="managed-runtime-family-card__title">{family.title}</h4>
                    <p className="managed-runtime-family-card__description">{family.description}</p>
                  </div>
                  <span className={`managed-runtime-family-card__status managed-runtime-family-card__status--${family.status}`}>
                    {family.statusLabel}
                  </span>
                </div>

                <dl className="managed-runtime-family-card__details">
                  <div>
                    <dt>固定版本</dt>
                    <dd>{family.pinnedVersion}</dd>
                  </div>
                  <div>
                    <dt>当前版本</dt>
                    <dd>{family.activeVersion ?? '尚未激活'}</dd>
                  </div>
                  <div>
                    <dt>最近校验</dt>
                    <dd>{family.lastVerificationSummary ?? '暂无'}</dd>
                  </div>
                  <div>
                    <dt>最近安装</dt>
                    <dd>{family.lastInstalledAtLabel ?? '暂无'}</dd>
                  </div>
                  <div>
                    <dt>最近修复</dt>
                    <dd>{family.lastRepairedAtLabel ?? '暂无'}</dd>
                  </div>
                  <div>
                    <dt>最近错误</dt>
                    <dd>{family.lastErrorSummary ?? '暂无'}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function resolveStatusIcon(status: ManagedRuntimeStatus | undefined) {
  switch (status) {
    case 'ready':
      return <Wrench size={14} />
    case 'broken':
    case 'missing':
    case 'outdated':
      return <AlertCircle size={14} />
    case 'installing':
    default:
      return <LoaderCircle size={14} className="managed-runtime-status-button__spinner" />
  }
}
