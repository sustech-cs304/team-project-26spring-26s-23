import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
import {
  getApiReconnectOptions,
  getApiSettingsCopy,
} from '../locale'
import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'

import { HostConfigRuntimeOverrideCard } from './ConfigCenterPublicFieldCards'

interface ApiSettingsSectionProps {
  language: string
  bootstrap: CopilotBootstrapController
  apiBaseUrl: string
  apiReconnectMode: string
  healthPollingEnabled: boolean
  onApiBaseUrlChange: (value: string) => void
  onApiReconnectModeChange: (value: string) => void
  onHealthPollingEnabledChange: (value: boolean) => void
}

export function ApiSettingsSection({
  language,
  bootstrap,
  apiBaseUrl,
  apiReconnectMode,
  healthPollingEnabled,
  onApiBaseUrlChange,
  onApiReconnectModeChange,
  onHealthPollingEnabledChange,
}: ApiSettingsSectionProps) {
  const copy = getApiSettingsCopy(language)
  const apiReconnectOptions = getApiReconnectOptions(language)

  return (
    <div className="settings-page">
      <HostConfigRuntimeOverrideCard language={language} />

      <section className="settings-card settings-card--form">
        <div className="settings-card__header settings-card__header--spaced">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
          </div>
          <span className={`inline-badge ${resolveBootstrapBadgeClass(bootstrap.state)}`}>
            {formatBootstrapStatusLabel(bootstrap.state, language)}
          </span>
        </div>

        <div className="settings-stack">
          <div className="settings-card__header">
            <div>
              <h4 className="settings-card__title">{copy.summaryTitle}</h4>
            </div>
          </div>

          <div className="workspace-facts">
            <article className="workspace-fact">
              <span>{copy.currentStatusLabel}</span>
              <strong>{formatBootstrapStatusLabel(bootstrap.state, language)}</strong>
            </article>
            <article className="workspace-fact">
              <span>{copy.retryActionLabel}</span>
              <strong>{bootstrap.retrying ? copy.bootstrapRetryLabels.retrying : copy.bootstrapRetryLabels.idle}</strong>
            </article>
          </div>

          <div className="toolbar-actions">
            <button type="button" className="ghost-button" onClick={bootstrap.retry} disabled={bootstrap.retrying}>
              {bootstrap.retrying ? copy.retryingText : copy.retryIdleText}
            </button>
          </div>

          <div className="form-grid form-grid--two">
            <TextField
              label={copy.apiBaseUrlLabel}
              value={apiBaseUrl}
              onChange={onApiBaseUrlChange}
              placeholder="http://127.0.0.1:8000"
              type="url"
            />
            <SelectField
              label={copy.reconnectPolicyLabel}
              value={apiReconnectMode}
              options={apiReconnectOptions}
              onChange={onApiReconnectModeChange}
            />
          </div>

          <ToggleSwitch
            label={copy.healthPollingLabel}
            checked={healthPollingEnabled}
            onChange={onHealthPollingEnabledChange}
          />
        </div>
      </section>
    </div>
  )
}

function formatBootstrapStatusLabel(state: CopilotBootstrapState, language: string): string {
  const labels = getApiSettingsCopy(language).bootstrapStatusLabels

  switch (state.status) {
    case 'loading':
      return labels.loading
    case 'empty':
      return labels.empty
    case 'incomplete':
      return labels.incomplete
    case 'starting':
      return labels.starting
    case 'ready':
      return labels.ready
    case 'failed':
      return labels.failed
    case 'degraded':
      return labels.degraded
    case 'error':
      return labels.error
  }
}

function resolveBootstrapBadgeClass(state: CopilotBootstrapState): string {
  switch (state.status) {
    case 'ready':
      return 'inline-badge--success'
    case 'degraded':
    case 'starting':
    case 'loading':
      return 'inline-badge--primary'
    default:
      return 'inline-badge--warning'
  }
}
