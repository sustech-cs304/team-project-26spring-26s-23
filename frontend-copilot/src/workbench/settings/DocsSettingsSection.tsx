import { getDocsFormatOptions, getDocsSettingsCopy } from '../locale'
import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'

interface DocsSettingsSectionProps {
  language: string
  docsFormat: string
  outputDirectory: string
  autoFileNameEnabled: boolean
  onDocsFormatChange: (value: string) => void
  onOutputDirectoryChange: (value: string) => void
  onAutoFileNameEnabledChange: (value: boolean) => void
}

export function DocsSettingsSection({
  language,
  docsFormat,
  outputDirectory,
  autoFileNameEnabled,
  onDocsFormatChange,
  onOutputDirectoryChange,
  onAutoFileNameEnabledChange,
}: DocsSettingsSectionProps) {
  const copy = getDocsSettingsCopy(language)
  const docsFormatOptions = getDocsFormatOptions(language)

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
            <SelectField label={copy.formatLabel} value={docsFormat} options={docsFormatOptions} onChange={onDocsFormatChange} />
            <TextField
              label={copy.outputDirectoryLabel}
              value={outputDirectory}
              onChange={onOutputDirectoryChange}
              placeholder={copy.outputDirectoryPlaceholder}
            />
          </div>

          <ToggleSwitch
            label={copy.autoFileNameLabel}
            checked={autoFileNameEnabled}
            onChange={onAutoFileNameEnabledChange}
          />
        </div>
      </section>
    </div>
  )
}
