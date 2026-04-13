import { getGeneralSettingsCopy, getProxyModeOptions } from '../locale'
import { SelectField, ToggleSwitch } from '../components/FormFields'

import { languageOptions } from './config'

interface GeneralSettingsSectionProps {
  language: string
  proxyMode: string
  assistantNotificationsEnabled: boolean
  backupEnabled: boolean
  debugModeEnabled: boolean
  onLanguageChange: (value: string) => void
  onProxyModeChange: (value: string) => void
  onAssistantNotificationsEnabledChange: (value: boolean) => void
  onBackupEnabledChange: (value: boolean) => void
  onDebugModeEnabledChange: (value: boolean) => void
}

export function GeneralSettingsSection({
  language,
  proxyMode,
  assistantNotificationsEnabled,
  backupEnabled,
  debugModeEnabled,
  onLanguageChange,
  onProxyModeChange,
  onAssistantNotificationsEnabledChange,
  onBackupEnabledChange,
  onDebugModeEnabledChange,
}: GeneralSettingsSectionProps) {
  const copy = getGeneralSettingsCopy(language)
  const proxyModeOptions = getProxyModeOptions(language)

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField label={copy.languageLabel} value={language} options={languageOptions} onChange={onLanguageChange} />
            <SelectField label={copy.proxyModeLabel} value={proxyMode} options={proxyModeOptions} onChange={onProxyModeChange} />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label={copy.notificationsLabel}
              checked={assistantNotificationsEnabled}
              onChange={onAssistantNotificationsEnabledChange}
            />
            <ToggleSwitch label={copy.backupLabel} checked={backupEnabled} onChange={onBackupEnabledChange} />
            <ToggleSwitch
              label={copy.debugModeLabel}
              description={copy.debugModeDescription}
              checked={debugModeEnabled}
              onChange={onDebugModeEnabledChange}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
