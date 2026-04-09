import { SelectField, TextField } from '../components/FormFields'
import { ProviderModelListPanel } from './ProviderModelListPanel'
import { ProviderSecretPanel } from './ProviderSecretPanel'
import type { ProviderProfileDetailsDomain } from './ProviderProfilesSectionDomain'
import {
  buildProviderTypeSelectionPatch,
  createProviderTypeSelectOptions,
  resolveProviderAuthFieldState,
  resolveProviderBaseUrlFieldState,
  resolveProviderCapabilitySummary,
  resolveProviderModelEditingAvailability,
  resolveProviderStatusNotice,
} from './settings-workspace-provider-helpers'

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

  const providerTypeOptions = createProviderTypeSelectOptions(activeProviderDetail)
  const providerStatusNotice = resolveProviderStatusNotice(activeProviderDetail)
  const providerAuthFieldState = resolveProviderAuthFieldState(activeProviderDetail)
  const providerBaseUrlFieldState = resolveProviderBaseUrlFieldState(activeProviderDetail)
  const providerModelEditingAvailability = resolveProviderModelEditingAvailability(activeProviderDetail)
  const defaultModelOptions = createProviderDefaultModelOptions(activeProviderDetail)
  const extensionNotice = resolveProviderExtensionNotice(activeProviderDetail)
  const providerTypeValue = (activeProviderDetail.providerId ?? activeProviderDetail.protocol).trim()
  const baseUrlValue = activeProviderDetail.baseUrl ?? activeProviderDetail.endpoint

  return (
    <>
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">服务商基础信息</h3>
            <p className="settings-card__subtitle">{resolveProviderCapabilitySummary(activeProviderDetail)}</p>
          </div>
        </div>

        <div className="settings-stack">
          {providerStatusNotice ? (
            <div
              className={`provider-status-banner provider-status-banner--${providerStatusNotice.tone}`}
              data-testid="provider-status-banner"
            >
              <strong>{providerStatusNotice.title}</strong>
              <span>{providerStatusNotice.description}</span>
            </div>
          ) : null}

          {extensionNotice ? (
            <div className="provider-status-banner provider-status-banner--info" data-testid="provider-extension-banner">
              <strong>已保留扩展字段</strong>
              <span>{extensionNotice}</span>
            </div>
          ) : null}

          <div className="form-grid form-grid--two">
            <TextField
              label="显示名称"
              description="用户自定义的 profile 名称。"
              value={activeProviderDetail.name}
              onChange={(value) => onUpdateActiveProvider({ name: value, displayName: value })}
              placeholder="输入服务商名称"
              inputTestId="provider-display-name-input"
            />
            <SelectField
              label="Provider 类型"
              description="Provider 类型、运行状态与基础语义均来自统一 catalog。"
              value={providerTypeValue}
              options={providerTypeOptions}
              onChange={(value) => onUpdateActiveProvider(buildProviderTypeSelectionPatch(activeProviderDetail, value))}
              triggerTestId="provider-type-select-trigger"
            />
            <TextField
              label="Base URL"
              description={providerBaseUrlFieldState.description}
              value={baseUrlValue}
              onChange={(value) => onUpdateActiveProvider({ baseUrl: value, endpoint: value })}
              placeholder={providerBaseUrlFieldState.placeholder}
              type="url"
              disabled={!providerBaseUrlFieldState.editable}
              inputTestId="provider-base-url-input"
            />
            <SelectField
              label="默认模型"
              description="默认模型保存为当前 profile 内的 modelId；全局默认路由另在“默认模型路由”中按 profile + model 选择。"
              value={activeProviderDetail.defaultModel}
              options={defaultModelOptions}
              onChange={(value) => onUpdateActiveProvider({ defaultModel: value, defaultModelId: value })}
              placeholder="先在下方模型列表中添加模型"
              triggerTestId="provider-default-model-trigger"
            />
            <ProviderSecretPanel
              providerId={activeProviderDetail.id}
              visible={providerAuthFieldState.visible}
              label={providerAuthFieldState.label}
              description={providerAuthFieldState.description}
              hasApiKey={activeProviderDetail.hasApiKey}
              apiKeyDraft={activeProviderApiKeyDraft}
              apiKeyVisible={apiKeyVisible}
              apiKeyFeedback={apiKeyFeedback}
              placeholder={providerAuthFieldState.placeholder}
              onApiKeyDraftChange={onProviderApiKeyDraftChange}
              onPersistApiKeyDraft={onPersistProviderApiKeyDraft}
              onToggleApiKeyVisibility={onToggleApiKeyVisibility}
              onCopyApiKey={onCopyApiKey}
            />
          </div>
        </div>
      </section>

      <ProviderModelListPanel
        availableModels={activeProviderDetail.availableModels}
        canEditModels={providerModelEditingAvailability.canEditModels}
        description={providerModelEditingAvailability.description}
        onOpenCreateModelEditor={onOpenCreateModelEditor}
        onOpenModelEditor={onOpenModelEditor}
        onRemoveModel={onRemoveModel}
      />
    </>
  )
}

function createProviderDefaultModelOptions(detail: ProviderProfileDetailsDomain['activeProviderDetail']) {
  const options = detail.availableModels.map((model) => ({
    value: model.modelId,
    label: model.displayName.trim() || model.modelId,
    hint: model.displayName.trim() && model.displayName.trim() !== model.modelId ? model.modelId : undefined,
  }))

  const currentValue = detail.defaultModel.trim()
  if (currentValue === '' || options.some((option) => option.value === currentValue)) {
    return options
  }

  return [
    {
      value: currentValue,
      label: `已保留旧值 · ${currentValue}`,
      hint: '当前默认模型不在模型列表中，请重新选择或保留为兼容数据。',
    },
    ...options,
  ]
}

function resolveProviderExtensionNotice(detail: ProviderProfileDetailsDomain['activeProviderDetail']): string | null {
  const extensionEntries = Object.entries(detail.extensions ?? {})
  const legacyFieldValues = [detail.organization, detail.region, detail.notes]
    .map((value) => value.trim())
    .filter((value) => value !== '')

  if (extensionEntries.length === 0 && legacyFieldValues.length === 0) {
    return null
  }

  return 'organization / region / notes 及扩展字典仍会在保存链路中透传保留，本阶段设置页不额外提供复杂编辑 UI。'
}
