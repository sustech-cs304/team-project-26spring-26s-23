/* eslint-disable react-refresh/only-export-components */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { ConfigCenterPublicTextFieldDefinition } from './config-center-public-field-definitions'
import { getConfigCenterPublicTextFieldStatusView } from './config-center-public-field-state'
import { useConfigCenterPublicTextField } from './useConfigCenterPublicField'

export function ConfigCenterPublicTextFieldCard({ definition }: { definition: ConfigCenterPublicTextFieldDefinition }) {
  const { state, updateDraftValue, commitDraftValue } = useConfigCenterPublicTextField(definition)
  const statusView = getConfigCenterPublicTextFieldStatusView(state)
  const canSave = state.status !== 'loading' && state.status !== 'saving' && state.dirty

  return (
    <section className="settings-card settings-card--form" aria-label={definition.cardTitle}>
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">{definition.cardTitle}</h3>
        </div>
        <span className={`inline-badge ${statusView.badgeClassName}`}>{statusView.badgeLabel}</span>
      </div>

      <div className="settings-stack">
        <label className="form-field" htmlFor={definition.fieldId}>
          <span className="form-field__meta">
            <span className="form-field__label">{definition.label}</span>
          </span>
          <input
            id={definition.fieldId}
            className="text-input"
            type={definition.inputType ?? 'text'}
            value={state.draftValue}
            placeholder={definition.placeholder}
            disabled={state.status === 'loading' || state.status === 'saving'}
            onChange={(event) => updateDraftValue(event.target.value)}
            onBlur={() => {
              void commitDraftValue()
            }}
            onKeyDown={(event) => handleConfigCenterPublicTextFieldKeyDown(event, commitDraftValue)}
          />
        </label>

        <div className="toolbar-actions">
          <button
            type="button"
            className="primary-button"
            disabled={!canSave}
            onClick={() => {
              void commitDraftValue()
            }}
          >
            保存
          </button>
        </div>

        <p className="form-field__description" role={statusView.role}>
          {statusView.detail}
        </p>
      </div>
    </section>
  )
}

export function handleConfigCenterPublicTextFieldKeyDown(
  event: ReactKeyboardEvent<HTMLInputElement>,
  commitDraftValue: () => Promise<void>,
) {
  if (event.key !== 'Enter') {
    return
  }

  event.preventDefault()
  void commitDraftValue()
}
