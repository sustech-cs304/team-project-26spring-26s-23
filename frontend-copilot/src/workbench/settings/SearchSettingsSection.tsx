import {
  getCompressionOptions,
  getResultCountOptions,
  getSearchSettingsCopy,
} from '../locale'
import { SelectField } from '../components/FormFields'

import { searchEngineOptions } from './config'

interface SearchSettingsSectionProps {
  language: string
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  onSearchEngineChange: (value: string) => void
  onSearchResultCountChange: (value: string) => void
  onCompressionModeChange: (value: string) => void
}

export function SearchSettingsSection({
  language,
  searchEngine,
  searchResultCount,
  compressionMode,
  onSearchEngineChange,
  onSearchResultCountChange,
  onCompressionModeChange,
}: SearchSettingsSectionProps) {
  const copy = getSearchSettingsCopy(language)
  const resultCountOptions = getResultCountOptions(language)
  const compressionOptions = getCompressionOptions(language)
  return (
    <div className="settings-page settings-page--split settings-page--balanced">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.providerTitle}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField label={copy.defaultEngineLabel} value={searchEngine} options={searchEngineOptions} onChange={onSearchEngineChange} />
          <SelectField label={copy.resultCountLabel} value={searchResultCount} options={resultCountOptions} onChange={onSearchResultCountChange} />
        </div>
      </section>

      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.configTitle}</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField label={copy.compressionLabel} value={compressionMode} options={compressionOptions} onChange={onCompressionModeChange} />
        </div>
      </section>
    </div>
  )
}
