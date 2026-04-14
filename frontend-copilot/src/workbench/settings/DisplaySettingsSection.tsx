import { getDisplaySettingsCopy, getThemeOptions } from '../locale'
import { SelectField } from '../components/FormFields'
import type { ThemeMode } from '../types'

interface DisplaySettingsSectionProps {
  language: string
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
}

function isThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export function DisplaySettingsSection({ language, themeMode, onThemeModeChange }: DisplaySettingsSectionProps) {
  const copy = getDisplaySettingsCopy(language)
  const themeOptions = getThemeOptions(language)

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid">
            <SelectField
              label={copy.themeLabel}
              value={themeMode}
              options={themeOptions}
              onChange={(value) => {
                if (isThemeMode(value)) {
                  onThemeModeChange(value)
                }
              }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
