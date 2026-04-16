import { getConfigCenterPublicFieldCopy } from '../locale'
import type { ConfigCenterPublicTextFieldDefinition } from './config-center-public-field-definitions'
import { handleConfigCenterPublicTextFieldKeyDown } from './config-center-public-field-card-keydown'
import { getConfigCenterPublicTextFieldStatusView } from './config-center-public-field-state'
import { useConfigCenterPublicTextField } from './useConfigCenterPublicField'

export function ConfigCenterPublicTextFieldCard({
  definition,
  language = 'zh-CN',
}: {
  definition: ConfigCenterPublicTextFieldDefinition
  language?: string
}) {
  const { state, updateDraftValue, commitDraftValue } = useConfigCenterPublicTextField(definition)
  const copy = getConfigCenterPublicFieldCopy(language)
  const statusView = getConfigCenterPublicTextFieldStatusView(state, language)
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
            {copy.saveButton}
          </button>
        </div>

        <p className="form-field__description" role={statusView.role}>
          {statusView.detail}
        </p>
      </div>
    </section>
  )
}

