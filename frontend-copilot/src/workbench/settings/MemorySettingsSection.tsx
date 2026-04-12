import { SelectField, ToggleSwitch } from '../components/FormFields'

import { memoryStrategyOptions } from './config'

interface MemorySettingsSectionProps {
  memoryStrategy: string
  memoryCleanupEnabled: boolean
  onMemoryStrategyChange: (value: string) => void
  onMemoryCleanupEnabledChange: (value: boolean) => void
}

export function MemorySettingsSection({
  memoryStrategy,
  memoryCleanupEnabled,
  onMemoryStrategyChange,
  onMemoryCleanupEnabledChange,
}: MemorySettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">全局记忆</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField
            label="记忆策略"
            value={memoryStrategy}
            options={memoryStrategyOptions}
            onChange={onMemoryStrategyChange}
          />
          <ToggleSwitch
            label="自动清理陈旧记忆"
            checked={memoryCleanupEnabled}
            onChange={onMemoryCleanupEnabledChange}
          />
        </div>
      </section>
    </div>
  )
}
