import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'

import { docsFormatOptions } from './config'

interface DocsSettingsSectionProps {
  docsFormat: string
  outputDirectory: string
  autoFileNameEnabled: boolean
  onDocsFormatChange: (value: string) => void
  onOutputDirectoryChange: (value: string) => void
  onAutoFileNameEnabledChange: (value: boolean) => void
}

export function DocsSettingsSection({
  docsFormat,
  outputDirectory,
  autoFileNameEnabled,
  onDocsFormatChange,
  onOutputDirectoryChange,
  onAutoFileNameEnabledChange,
}: DocsSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">文档处理</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField label="默认导出格式" value={docsFormat} options={docsFormatOptions} onChange={onDocsFormatChange} />
            <TextField
              label="输出目录"
              value={outputDirectory}
              onChange={onOutputDirectoryChange}
              placeholder="输入导出目录"
            />
          </div>

          <ToggleSwitch
            label="自动生成文件名"
            checked={autoFileNameEnabled}
            onChange={onAutoFileNameEnabledChange}
          />
        </div>
      </section>
    </div>
  )
}
