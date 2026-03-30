import { SelectField, ToggleSwitch } from '../components/FormFields'

import { toolPermissionOptions } from './config'

interface McpSettingsSectionProps {
  toolPermissionMode: string
  mcpAutoDiscoveryEnabled: boolean
  onToolPermissionModeChange: (value: string) => void
  onMcpAutoDiscoveryEnabledChange: (value: boolean) => void
}

export function McpSettingsSection({
  toolPermissionMode,
  mcpAutoDiscoveryEnabled,
  onToolPermissionModeChange,
  onMcpAutoDiscoveryEnabledChange,
}: McpSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">MCP 服务器</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField
              label="工具权限策略"
              value={toolPermissionMode}
              options={toolPermissionOptions}
              onChange={onToolPermissionModeChange}
            />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label="自动发现 MCP 服务"
              checked={mcpAutoDiscoveryEnabled}
              onChange={onMcpAutoDiscoveryEnabledChange}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
