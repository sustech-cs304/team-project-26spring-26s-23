import { SelectField, TextareaField, TextField } from '../components/FormFields'
import { protocolOptions } from './config'
import { ProviderModelListPanel } from './ProviderModelListPanel'
import { ProviderSecretPanel } from './ProviderSecretPanel'
import type { ProviderProfileDetailsDomain } from './ProviderProfilesSectionDomain'

interface ProviderProfileDetailsProps {
  detail: ProviderProfileDetailsDomain
}

export function ProviderProfileDetails({ detail }: ProviderProfileDetailsProps) {
  const {
    activeProviderDetail,
    activeProviderApiKeyDraft,
    apiKeyVisible,
    apiKeyFeedback,
    onUpdateActiveProvider,
    onProviderApiKeyDraftChange,
    onPersistProviderApiKeyDraft,
    onToggleApiKeyVisibility,
    onCopyApiKey,
    onOpenCreateModelEditor,
    onOpenModelEditor,
    onRemoveModel,
  } = detail

  return (
    <>
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">服务商基础信息</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <TextField
              label="服务商名称"
              value={activeProviderDetail.name}
              onChange={(value) => onUpdateActiveProvider({ name: value })}
              placeholder="输入服务商名称"
            />
            <SelectField
              label="端点类型"
              value={activeProviderDetail.protocol}
              options={protocolOptions}
              onChange={(value) => onUpdateActiveProvider({ protocol: value })}
            />
            <TextField
              label="API 地址"
              value={activeProviderDetail.endpoint}
              onChange={(value) => onUpdateActiveProvider({ endpoint: value })}
              placeholder="https://api.example.com/v1"
              type="url"
              containerClassName="form-field--full"
            />
            <ProviderSecretPanel
              providerId={activeProviderDetail.id}
              hasApiKey={activeProviderDetail.hasApiKey}
              apiKeyDraft={activeProviderApiKeyDraft}
              apiKeyVisible={apiKeyVisible}
              apiKeyFeedback={apiKeyFeedback}
              onApiKeyDraftChange={onProviderApiKeyDraftChange}
              onPersistApiKeyDraft={onPersistProviderApiKeyDraft}
              onToggleApiKeyVisibility={onToggleApiKeyVisibility}
              onCopyApiKey={onCopyApiKey}
            />
          </div>

          <TextareaField
            label="备注与扩展配置"
            value={activeProviderDetail.notes}
            onChange={(value) => onUpdateActiveProvider({ notes: value })}
            placeholder="输入补充说明"
          />
        </div>
      </section>

      <ProviderModelListPanel
        availableModels={activeProviderDetail.availableModels}
        onOpenCreateModelEditor={onOpenCreateModelEditor}
        onOpenModelEditor={onOpenModelEditor}
        onRemoveModel={onRemoveModel}
      />
    </>
  )
}
