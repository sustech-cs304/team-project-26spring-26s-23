import { SelectField, TextField } from '../components/FormFields'
import { ProviderModelListPanel } from './ProviderModelListPanel'
import { ProviderSecretPanel } from './ProviderSecretPanel'
import type { ProviderProfileDetailsDomain } from './ProviderProfilesSectionDomain'
import {
  buildProviderTypeSelectionPatch,
  createProviderTypeSelectOptions,
  resolveProviderAuthFieldState,
  resolveProviderBaseUrlFieldState,
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
  const providerTypeValue = (activeProviderDetail.providerId ?? activeProviderDetail.protocol).trim()
  const baseUrlValue = activeProviderDetail.baseUrl ?? activeProviderDetail.endpoint

  return (
    <>
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">服务信息</h3>
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

          <div className="form-grid form-grid--two">
            <TextField
              label="显示名称"
              value={activeProviderDetail.name}
              onChange={(value) => onUpdateActiveProvider({ name: value, displayName: value })}
              placeholder="输入服务商名称"
              inputTestId="provider-display-name-input"
            />
            <SelectField
              label="服务类型"
              value={providerTypeValue}
              options={providerTypeOptions}
              onChange={(value) => onUpdateActiveProvider(buildProviderTypeSelectionPatch(activeProviderDetail, value))}
              triggerTestId="provider-type-select-trigger"
            />
            <TextField
              label="服务地址"
              description={providerBaseUrlFieldState.description}
              value={baseUrlValue}
              onChange={(value) => onUpdateActiveProvider({ baseUrl: value, endpoint: value })}
              placeholder={providerBaseUrlFieldState.placeholder}
              type="url"
              containerClassName="form-field--full"
              disabled={!providerBaseUrlFieldState.editable}
              inputTestId="provider-base-url-input"
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

