import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'

import { backupCycleOptions } from './config'

interface DataSettingsSectionProps {
  dataPath: string
  backupCycle: string
  backupEnabled: boolean
  launchSyncEnabled: boolean
  onDataPathChange: (value: string) => void
  onBackupCycleChange: (value: string) => void
  onBackupEnabledChange: (value: boolean) => void
  onLaunchSyncEnabledChange: (value: boolean) => void
}

export function DataSettingsSection({
  dataPath,
  backupCycle,
  backupEnabled,
  launchSyncEnabled,
  onDataPathChange,
  onBackupCycleChange,
  onBackupEnabledChange,
  onLaunchSyncEnabledChange,
}: DataSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">数据设置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <TextField
              label="数据目录"
              value={dataPath}
              onChange={onDataPathChange}
              placeholder="输入本地目录"
            />
            <SelectField label="备份周期" value={backupCycle} options={backupCycleOptions} onChange={onBackupCycleChange} />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch label="启用自动备份" checked={backupEnabled} onChange={onBackupEnabledChange} />
            <ToggleSwitch label="启动时同步" checked={launchSyncEnabled} onChange={onLaunchSyncEnabledChange} />
          </div>
        </div>
      </section>
    </div>
  )
}
