import { SelectField } from '../components/FormFields'
import type { ThemeMode } from '../types'

import { themeOptions } from './config'

interface DisplaySettingsSectionProps {
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
}

function isThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export function DisplaySettingsSection({ themeMode, onThemeModeChange }: DisplaySettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">显示设置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid">
            <SelectField
              label="主题"
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
