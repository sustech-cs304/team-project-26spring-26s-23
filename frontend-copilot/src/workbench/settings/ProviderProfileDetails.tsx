import { getProviderDetailsCopy } from '../locale'
import { SelectField, TextField } from '../components/FormFields'
import { ProviderModelListPanel } from './ProviderModelListPanel'
import { ProviderSecretPanel } from './ProviderSecretPanel'
import type { ProviderProfileDetailsDomain } from './ProviderProfilesSectionDomain'
import {
  buildProviderTypeSelectionPatch,
  createProviderTypeSelectOptions,
  resolveProviderAuthFieldState,
  resolveProviderBaseUrlFieldState,
  resolveProviderBaseUrlValidationMessage,
  resolveProviderModelEditingAvailability,
  resolveProviderStatusNotice,
} from './settings-workspace-provider-helpers'

interface ProviderProfileDetailsProps {
  detail: ProviderProfileDetailsDomain
  language: string
}

export function ProviderProfileDetails({ detail, language }: ProviderProfileDetailsProps) {
  const {
    activeProviderDetail,
    activeProviderPreviewModelId,
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

  const copy = getProviderDetailsCopy(language)
  const providerTypeOptions = createProviderTypeSelectOptions(activeProviderDetail, language)
  const providerStatusNotice = resolveProviderStatusNotice(activeProviderDetail, language)
  const providerAuthFieldState = resolveProviderAuthFieldState(activeProviderDetail, language)
  const providerBaseUrlFieldState = resolveProviderBaseUrlFieldState(activeProviderDetail, {
    previewModelId: activeProviderPreviewModelId,
    language,
  })
  const providerBaseUrlValidationMessage = resolveProviderBaseUrlValidationMessage(activeProviderDetail, language)
  const providerModelEditingAvailability = resolveProviderModelEditingAvailability(activeProviderDetail, language)
  const providerTypeValue = (activeProviderDetail.providerId ?? activeProviderDetail.protocol).trim()
  const baseUrlValue = activeProviderDetail.baseUrl ?? activeProviderDetail.endpoint

  return (
    <>
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.serviceInfoTitle}</h3>
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
              label={copy.displayNameLabel}
              value={activeProviderDetail.name}
              onChange={(value) => onUpdateActiveProvider({ name: value, displayName: value })}
              placeholder={copy.displayNamePlaceholder}
              inputTestId="provider-display-name-input"
            />
            <SelectField
              label={copy.providerTypeLabel}
              value={providerTypeValue}
              options={providerTypeOptions}
              onChange={(value) => onUpdateActiveProvider(buildProviderTypeSelectionPatch(activeProviderDetail, value))}
              triggerTestId="provider-type-select-trigger"
            />
            <TextField
              label={copy.serviceAddressLabel}
              description={providerBaseUrlFieldState.description}
              feedback={providerBaseUrlValidationMessage ?? undefined}
              value={baseUrlValue}
              onChange={(value) => onUpdateActiveProvider({ baseUrl: value, endpoint: value })}
              placeholder={providerBaseUrlFieldState.placeholder}
              type="url"
              containerClassName="form-field--full"
              disabled={!providerBaseUrlFieldState.editable}
              invalid={providerBaseUrlValidationMessage !== null}
              inputTestId="provider-base-url-input"
              feedbackTestId="provider-base-url-feedback"
            />
            <ProviderSecretPanel
              providerId={activeProviderDetail.id}
              language={language}
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
        language={language}
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

