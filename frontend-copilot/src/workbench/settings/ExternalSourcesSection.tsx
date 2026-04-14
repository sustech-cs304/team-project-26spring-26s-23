import { Link2, X } from 'lucide-react'

import { getExternalSourcesCopy } from '../locale'

export type WakeupDialogState =
  | { status: 'failure' }
  | { status: 'success' }
  | null

export interface ExternalSourcesSectionDomain {
  wakeupShareLink: string
  wakeupDialogState: WakeupDialogState
  onWakeupShareLinkChange: (value: string) => void
  onWakeupLinkParse: () => void | Promise<void>
  onWakeupDialogClose: () => void
  onWakeupConflictChoice: () => void
}

interface ExternalSourcesSectionProps {
  externalSources: ExternalSourcesSectionDomain
  language: string
}

export function ExternalSourcesSection({ externalSources, language }: ExternalSourcesSectionProps) {
  const {
    wakeupShareLink,
    wakeupDialogState,
    onWakeupShareLinkChange,
    onWakeupLinkParse,
    onWakeupDialogClose,
    onWakeupConflictChoice,
  } = externalSources

  const copy = getExternalSourcesCopy(language)

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <label className="form-field form-field--full">
            <span className="form-field__meta">
              <span className="form-field__label">{copy.linkLabel}</span>
            </span>
            <span className="text-input-shell">
              <input
                data-testid="wakeup-share-link-input"
                className="text-input text-input-shell__input"
                type="text"
                value={wakeupShareLink}
                placeholder={copy.linkPlaceholder}
                onChange={(event) => onWakeupShareLinkChange(event.target.value)}
              />
              <span className="text-input-shell__actions">
                <button
                  type="button"
                  className="icon-button icon-button--compact"
                  data-testid="wakeup-parse-button"
                  aria-label={copy.parseLinkAriaLabel}
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
            aria-label={copy.dialogAriaLabel}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="model-editor-modal__header">
              <div>
                <h3 className="settings-card__title">{copy.dialogTitle}</h3>
              </div>
              <button
                type="button"
                className="model-editor-modal__close"
                aria-label={copy.closeDialogAriaLabel}
                onClick={onWakeupDialogClose}
              >
                <X size={14} />
              </button>
            </div>

            <div className="model-editor-modal__body">
              {wakeupDialogState.status === 'failure' ? (
                <p data-testid="wakeup-parse-failure">{copy.parseFailureText}</p>
              ) : (
                <div className="settings-stack" data-testid="wakeup-parse-success">
                  <button type="button" className="secondary-button" onClick={onWakeupConflictChoice}>
                    {copy.keepWakeupButton}
                  </button>
                  <button type="button" className="secondary-button" onClick={onWakeupConflictChoice}>
                    {copy.keepTisButton}
                  </button>
                  <button type="button" className="primary-button" onClick={onWakeupConflictChoice}>
                    {copy.smartResolveButton}
                  </button>
                  <button type="button" className="ghost-button" onClick={onWakeupDialogClose}>
                    {copy.cancelButton}
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
