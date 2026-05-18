import { getGeneralSettingsCopy, getLanguageOptions } from '../locale'
import { SelectField, ToggleSwitch } from '../components/FormFields'

interface GeneralSettingsSectionProps {
  language: string
  assistantNotificationsEnabled: boolean
  debugModeEnabled: boolean
  onLanguageChange: (value: string) => void
  onAssistantNotificationsEnabledChange: (value: boolean) => void
  onDebugModeEnabledChange: (value: boolean) => void
}

export function GeneralSettingsSection({
  language,
  assistantNotificationsEnabled,
  debugModeEnabled,
  onLanguageChange,
  onAssistantNotificationsEnabledChange,
  onDebugModeEnabledChange,
}: GeneralSettingsSectionProps) {
  const copy = getGeneralSettingsCopy(language)
  const languageOptions = getLanguageOptions(language)

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
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label={copy.notificationsLabel}
              checked={assistantNotificationsEnabled}
              onChange={onAssistantNotificationsEnabledChange}
            />
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
