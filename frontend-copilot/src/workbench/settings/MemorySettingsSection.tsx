import { getMemorySettingsCopy, getMemoryStrategyOptions } from '../locale'
import { SelectField, ToggleSwitch } from '../components/FormFields'

interface MemorySettingsSectionProps {
  language: string
  memoryStrategy: string
  memoryCleanupEnabled: boolean
  onMemoryStrategyChange: (value: string) => void
  onMemoryCleanupEnabledChange: (value: boolean) => void
}

export function MemorySettingsSection({
  language,
  memoryStrategy,
  memoryCleanupEnabled,
  onMemoryStrategyChange,
  onMemoryCleanupEnabledChange,
}: MemorySettingsSectionProps) {
  const copy = getMemorySettingsCopy(language)
  const memoryStrategyOptions = getMemoryStrategyOptions(language)

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField
            label={copy.strategyLabel}
            value={memoryStrategy}
            options={memoryStrategyOptions}
            onChange={onMemoryStrategyChange}
          />
          <ToggleSwitch
            label={copy.cleanupLabel}
            checked={memoryCleanupEnabled}
            onChange={onMemoryCleanupEnabledChange}
          />
        </div>
      </section>
    </div>
  )
}
