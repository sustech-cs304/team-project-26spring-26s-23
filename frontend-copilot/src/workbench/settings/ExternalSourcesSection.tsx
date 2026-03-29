import { Link2, X } from 'lucide-react'

export type WakeupDialogState =
  | { status: 'failure' }
  | { status: 'success' }
  | null

interface ExternalSourcesSectionProps {
  wakeupShareLink: string
  wakeupDialogState: WakeupDialogState
  onWakeupShareLinkChange: (value: string) => void
  onWakeupLinkParse: () => void | Promise<void>
  onWakeupDialogClose: () => void
  onWakeupConflictChoice: () => void
}

export function ExternalSourcesSection({
  wakeupShareLink,
  wakeupDialogState,
  onWakeupShareLinkChange,
  onWakeupLinkParse,
  onWakeupDialogClose,
  onWakeupConflictChoice,
}: ExternalSourcesSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">WakeUP 课程群同步</h3>
          </div>
        </div>

        <div className="settings-stack">
          <label className="form-field form-field--full">
            <span className="form-field__meta">
              <span className="form-field__label">WakeUP 分享链接</span>
            </span>
            <span className="text-input-shell">
              <input
                data-testid="wakeup-share-link-input"
                className="text-input text-input-shell__input"
                type="text"
                value={wakeupShareLink}
                placeholder="输入 WakeUP 分享链接"
                onChange={(event) => onWakeupShareLinkChange(event.target.value)}
              />
              <span className="text-input-shell__actions">
                <button
                  type="button"
                  className="icon-button icon-button--compact"
                  data-testid="wakeup-parse-button"
                  aria-label="解析链接"
                  onClick={() => {
                    void onWakeupLinkParse()
                  }}
                >
                  <Link2 size={14} />
                </button>
              </span>
            </span>
          </label>
        </div>
      </section>

      {wakeupDialogState ? (
        <div className="model-editor-backdrop" role="presentation" onClick={onWakeupDialogClose}>
          <section
            className="model-editor-modal model-editor-modal--compact"
            role="dialog"
            aria-modal="true"
            aria-label="WakeUP 链接解析"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="model-editor-modal__header">
              <div>
                <h3 className="settings-card__title">解析链接</h3>
              </div>
              <button
                type="button"
                className="model-editor-modal__close"
                aria-label="关闭解析弹窗"
                onClick={onWakeupDialogClose}
              >
                <X size={14} />
              </button>
            </div>

            <div className="model-editor-modal__body">
              {wakeupDialogState.status === 'failure' ? (
                <p data-testid="wakeup-parse-failure">解析未成功</p>
              ) : (
                <div className="settings-stack" data-testid="wakeup-parse-success">
                  <button type="button" className="secondary-button" onClick={onWakeupConflictChoice}>
                    保留 WakeUP版本
                  </button>
                  <button type="button" className="secondary-button" onClick={onWakeupConflictChoice}>
                    保留 TIS 版本
                  </button>
                  <button type="button" className="primary-button" onClick={onWakeupConflictChoice}>
                    尝试智能解析
                  </button>
                  <button type="button" className="ghost-button" onClick={onWakeupDialogClose}>
                    取消
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
