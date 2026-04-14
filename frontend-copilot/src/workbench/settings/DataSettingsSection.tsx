import { getBackupCycleOptions, getDataSettingsCopy } from '../locale'
import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'

interface DataSettingsSectionProps {
  language: string
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
  language,
  dataPath,
  backupCycle,
  backupEnabled,
  launchSyncEnabled,
  onDataPathChange,
  onBackupCycleChange,
  onBackupEnabledChange,
  onLaunchSyncEnabledChange,
}: DataSettingsSectionProps) {
  const copy = getDataSettingsCopy(language)
  const backupCycleOptions = getBackupCycleOptions(language)
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
            <TextField
              label={copy.dataPathLabel}
              value={dataPath}
              onChange={onDataPathChange}
              placeholder={copy.dataPathPlaceholder}
            />
            <SelectField label={copy.backupCycleLabel} value={backupCycle} options={backupCycleOptions} onChange={onBackupCycleChange} />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch label={copy.backupEnabledLabel} checked={backupEnabled} onChange={onBackupEnabledChange} />
            <ToggleSwitch label={copy.launchSyncLabel} checked={launchSyncEnabled} onChange={onLaunchSyncEnabledChange} />
          </div>
        </div>
      </section>
    </div>
  )
}
