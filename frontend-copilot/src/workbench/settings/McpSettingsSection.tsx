import { getMcpSettingsCopy, getToolPermissionOptions } from '../locale'
import { SelectField, ToggleSwitch } from '../components/FormFields'

interface McpSettingsSectionProps {
  language: string
  toolPermissionMode: string
  mcpAutoDiscoveryEnabled: boolean
  onToolPermissionModeChange: (value: string) => void
  onMcpAutoDiscoveryEnabledChange: (value: boolean) => void
}

export function McpSettingsSection({
  language,
  toolPermissionMode,
  mcpAutoDiscoveryEnabled,
  onToolPermissionModeChange,
  onMcpAutoDiscoveryEnabledChange,
}: McpSettingsSectionProps) {
  const copy = getMcpSettingsCopy(language)
  const toolPermissionOptions = getToolPermissionOptions(language)
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
            <SelectField
              label={copy.permissionStrategyLabel}
              value={toolPermissionMode}
              options={toolPermissionOptions}
              onChange={onToolPermissionModeChange}
            />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label={copy.autoDiscoveryLabel}
              checked={mcpAutoDiscoveryEnabled}
              onChange={onMcpAutoDiscoveryEnabledChange}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
