import { SelectField, TextareaField, TextField } from '../components/FormFields'
import type { ProviderProfile } from '../types'
import { protocolOptions } from './config'
import { ProviderModelEditorDialog } from './ProviderModelEditorDialog'
import { ProviderModelListPanel } from './ProviderModelListPanel'
import { ProviderSecretPanel } from './ProviderSecretPanel'
import type { ModelEditorState } from './provider-profiles'

interface ProviderProfileDetailsProps {
  activeProviderDetail: ProviderProfile
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  onUpdateActiveProvider: (patch: Partial<ProviderProfile>) => void
  onProviderApiKeyDraftChange: (providerId: string, value: string) => void
  onPersistProviderApiKeyDraft: (providerId: string) => void | Promise<void>
  onToggleApiKeyVisibility: () => void
  onCopyApiKey: () => void | Promise<void>
  onOpenCreateModelEditor: () => void
  onOpenModelEditor: (index: number) => void
  onRemoveModel: (index: number) => void
  onCloseModelEditor: () => void
  onModelEditorSave: () => void
  onModelEditorStateChange: (patch: Partial<ModelEditorState>) => void
  onToggleModelCapability: (capability: ModelEditorState['capabilities'][number]) => void
  onClearModelEditorError: () => void
}

export function ProviderProfileDetails({
  activeProviderDetail,
  activeProviderApiKeyDraft,
  apiKeyVisible,
  apiKeyFeedback,
  modelEditorState,
  modelEditorError,
  onUpdateActiveProvider,
  onProviderApiKeyDraftChange,
  onPersistProviderApiKeyDraft,
  onToggleApiKeyVisibility,
  onCopyApiKey,
  onOpenCreateModelEditor,
  onOpenModelEditor,
  onRemoveModel,
  onCloseModelEditor,
  onModelEditorSave,
  onModelEditorStateChange,
  onToggleModelCapability,
  onClearModelEditorError,
}: ProviderProfileDetailsProps) {
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
            />
            <TextField
              label="默认模型 ID"
              value={activeProviderDetail.defaultModel}
              onChange={(value) => onUpdateActiveProvider({ defaultModel: value })}
              placeholder="例如 openai/gpt-4.1"
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

      <ProviderModelEditorDialog
        modelEditorState={modelEditorState}
        modelEditorError={modelEditorError}
        onClose={onCloseModelEditor}
        onSave={onModelEditorSave}
        onStateChange={onModelEditorStateChange}
        onToggleCapability={onToggleModelCapability}
        onClearError={onClearModelEditorError}
      />
    </>
  )
}
