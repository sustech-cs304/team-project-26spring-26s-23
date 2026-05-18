import { useEffect, useState } from 'react'
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
  const [renderPanel, setRenderPanel] = useState(open)
  const [panelVisible, setPanelVisible] = useState(open)
  const [copiedFamily, setCopiedFamily] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setRenderPanel(true)
      const frame = window.requestAnimationFrame(() => {
        setPanelVisible(true)
      })

      return () => window.cancelAnimationFrame(frame)
    }

    setPanelVisible(false)
    const timeout = window.setTimeout(() => {
      setRenderPanel(false)
    }, 140)

    return () => window.clearTimeout(timeout)
  }, [open])

  useEffect(() => {
    if (copiedFamily === null) {
      return undefined
    }

    const timeout = window.setTimeout(() => {
      setCopiedFamily(null)
    }, 1600)

    return () => window.clearTimeout(timeout)
  }, [copiedFamily])

  const handleCopyPath = async (family: string, launcherPath: string) => {
    if (!navigator.clipboard?.writeText) {
      return
    }

    await navigator.clipboard.writeText(launcherPath)
    setCopiedFamily(family)
  }

  const buttonSummary = viewModel?.families
    .map((family) => `${family.title} ${family.statusLabel}`)
    .join(' · ') ?? summary

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
          <span className="managed-runtime-status-button__summary">{label} · {buttonSummary}</span>
        </span>
      </button>

      {renderPanel ? (
        <section
          id="managed-runtime-status-panel"
          className={`managed-runtime-status-panel ${panelVisible ? 'managed-runtime-status-panel--open' : 'managed-runtime-status-panel--closing'}`}
          role="region"
          aria-label="MCP 托管运行时状态"
          data-testid="managed-runtime-status-panel"
          aria-hidden={!open}
        >
          <header className="managed-runtime-status-panel__header">
            <div>
              <p className="managed-runtime-status-panel__eyebrow">MCP 托管环境</p>
              <h3 className="managed-runtime-status-panel__title">{label}</h3>
              <p className="managed-runtime-status-panel__description">{summary}</p>
            </div>
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
                  </div>
                  <span className={`managed-runtime-family-card__status managed-runtime-family-card__status--${family.status}`}>
                    {family.statusLabel}
                  </span>
                </div>

                <dl className="managed-runtime-family-card__details">
                  <div>
                    <dt>当前版本</dt>
                    <dd>{family.activeVersion ?? '尚未激活'}</dd>
                  </div>
                </dl>

                <div className="managed-runtime-family-card__actions">
                  <button
                    type="button"
                    className="secondary-button secondary-button--subtle managed-runtime-family-card__action"
                    disabled={busy}
                    onClick={() => void onInstallOrRepair()}
                  >
                    {busy ? '处理中…' : (viewModel?.actionLabel ?? '一键安装/修复')}
                  </button>

                  {family.launcherPath ? (
                    <button
                      type="button"
                      className="secondary-button secondary-button--subtle managed-runtime-family-card__copy"
                      onClick={() => void handleCopyPath(family.family, family.launcherPath as string)}
                      title={family.launcherPath}
                      aria-label={`复制 ${family.title} 引用路径`}
                    >
                      {copiedFamily === family.family ? '已复制路径' : '复制路径'}
                    </button>
                  ) : null}
                </div>
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
