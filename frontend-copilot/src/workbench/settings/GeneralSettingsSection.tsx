import { SelectField, ToggleSwitch } from '../components/FormFields'

import { languageOptions, proxyModeOptions } from './config'

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
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">常规设置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField label="界面语言" value={language} options={languageOptions} onChange={onLanguageChange} />
            <SelectField label="代理模式" value={proxyMode} options={proxyModeOptions} onChange={onProxyModeChange} />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label="助手消息通知"
              checked={assistantNotificationsEnabled}
              onChange={onAssistantNotificationsEnabledChange}
            />
            <ToggleSwitch label="自动备份" checked={backupEnabled} onChange={onBackupEnabledChange} />
            <ToggleSwitch
              label="启用调试模式"
              description="显示运行诊断，并让新的聊天运行自动开启后端 runtime chain debug 日志。"
              checked={debugModeEnabled}
              onChange={onDebugModeEnabledChange}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
