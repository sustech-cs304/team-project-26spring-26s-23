import { getDocsFormatOptions, getDocsSettingsCopy } from '../locale'
import { SelectField } from '../components/FormFields'

interface DocsSettingsSectionProps {
  language: string
  docsFormat: string
  onDocsFormatChange: (value: string) => void
}

export function DocsSettingsSection({
  language,
  docsFormat,
  onDocsFormatChange,
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
          </div>
        </div>
      </section>
    </div>
  )
}
