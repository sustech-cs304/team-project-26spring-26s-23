import { X } from 'lucide-react'
import { useRef } from 'react'

import { getExternalSourcesCopy } from '../locale'
import { isWakeupIcsText, normalizeWakeupIcsText } from './wakeup-ics-text'

export type WakeupDialogState =
  | { status: 'failure'; error?: string }
  | { status: 'success'; parsed: number }
  | null

export interface ExternalSourcesSectionDomain {
  wakeupShareLink: string
  wakeupDialogState: WakeupDialogState
  onWakeupShareLinkChange: (value: string) => void
  onWakeupLinkParse: (value?: string) => void | Promise<void>
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
  } = externalSources

  const copy = getExternalSourcesCopy(language)
  const importInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="settings-stack">
            <input
              ref={importInputRef}
              type="file"
              accept=".ics,text/calendar"
              style={{ display: 'none' }}
              aria-label={copy.importIcsAriaLabel}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) {
                  return
                }
                const reader = new FileReader()
                reader.onload = () => {
                  const text = typeof reader.result === 'string' ? reader.result : ''
                  const normalizedText = normalizeWakeupIcsText(text)
                  onWakeupShareLinkChange(normalizedText)
                  void onWakeupLinkParse(normalizedText)
                  event.target.value = ''
                }
                reader.onerror = () => {
                  event.target.value = ''
                }
                reader.readAsText(file)
              }}
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                importInputRef.current?.click()
              }}
            >
              {copy.importIcsButton}
            </button>
          </div>
          <p className="settings-card__hint">
            {isWakeupIcsText(wakeupShareLink) ? copy.icsLoadedHint : copy.icsEmptyHint}
          </p>
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
                <p data-testid="wakeup-parse-failure">
                  {copy.parseFailureText}
                  {wakeupDialogState.error ? `${copy.parseFailureSeparator}${wakeupDialogState.error}` : ''}
                </p>
              ) : (
                <div className="settings-stack" data-testid="wakeup-parse-success">
                  <p>{copy.importSuccessText(wakeupDialogState.parsed)}</p>
                  <button type="button" className="primary-button" onClick={onWakeupDialogClose}>
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
