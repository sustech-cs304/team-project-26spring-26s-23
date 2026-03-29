import { SelectField } from '../components/FormFields'

import { compressionOptions, resultCountOptions, searchEngineOptions } from './config'

interface SearchSettingsSectionProps {
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  onSearchEngineChange: (value: string) => void
  onSearchResultCountChange: (value: string) => void
  onCompressionModeChange: (value: string) => void
}

export function SearchSettingsSection({
  searchEngine,
  searchResultCount,
  compressionMode,
  onSearchEngineChange,
  onSearchResultCountChange,
  onCompressionModeChange,
}: SearchSettingsSectionProps) {
  return (
    <div className="settings-page settings-page--split settings-page--balanced">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">搜索服务商</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField label="默认搜索引擎" value={searchEngine} options={searchEngineOptions} onChange={onSearchEngineChange} />
          <SelectField label="结果数量" value={searchResultCount} options={resultCountOptions} onChange={onSearchResultCountChange} />
        </div>
      </section>

      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">网络搜索配置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField label="压缩方式" value={compressionMode} options={compressionOptions} onChange={onCompressionModeChange} />
        </div>
      </section>
    </div>
  )
}
