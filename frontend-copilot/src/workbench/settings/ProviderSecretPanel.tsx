import { Copy, Eye, EyeOff } from 'lucide-react'

import { getProviderSecretCopy } from '../locale'

interface ProviderSecretPanelProps {
  providerId: string
  language: string
  visible: boolean
  label: string
  description?: string
  hasApiKey: boolean
  apiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  placeholder: string
  onApiKeyDraftChange: (providerId: string, value: string) => void
  onPersistApiKeyDraft: (providerId: string) => void | Promise<void>
  onToggleApiKeyVisibility: () => void
  onCopyApiKey: () => void | Promise<void>
}

export function ProviderSecretPanel({
  providerId,
  language,
  visible,
  label,
  description,
  hasApiKey,
  apiKeyDraft,
  apiKeyVisible,
  apiKeyFeedback,
  placeholder,
  onApiKeyDraftChange,
  onPersistApiKeyDraft,
  onToggleApiKeyVisibility,
  onCopyApiKey,
}: ProviderSecretPanelProps) {
  if (!visible) {
    return null
  }

  const copy = getProviderSecretCopy(language)
  const isSuccessFeedback = apiKeyFeedback !== null
    && copy.successPrefixes.some((prefix: string) => apiKeyFeedback.startsWith(prefix))

  return (
    <label className="form-field form-field--full" htmlFor="provider-api-key-input">
      <span className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <span className="form-field__description">{description}</span> : null}
      </span>
      <span className="text-input-shell">
        <input
          id="provider-api-key-input"
          data-testid="provider-api-key-input"
          className="text-input text-input-shell__input"
          type={apiKeyVisible ? 'text' : 'password'}
          value={apiKeyDraft}
          placeholder={placeholder || (hasApiKey ? copy.configuredPlaceholder : copy.emptyPlaceholder)}
          onChange={(event) => onApiKeyDraftChange(providerId, event.target.value)}
          onBlur={() => {
            void onPersistApiKeyDraft(providerId)
          }}
        />
        <span className="text-input-shell__actions">
          <button
            type="button"
            className="icon-button icon-button--compact"
            aria-label={apiKeyVisible ? copy.hideApiKey : copy.showApiKey}
            title={apiKeyVisible ? copy.hideApiKey : copy.showApiKey}
            data-testid="provider-api-key-visibility-toggle"
            onClick={onToggleApiKeyVisibility}
          >
            {apiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="icon-button icon-button--compact"
            aria-label={copy.copyApiKey}
            title={copy.copyApiKey}
            data-testid="provider-api-key-copy"
            onClick={() => {
              void onCopyApiKey()
            }}
          >
            <Copy size={14} />
          </button>
        </span>
      </span>
      {apiKeyFeedback ? (
        <span
          className={`form-field__feedback${isSuccessFeedback ? ' form-field__feedback--success' : ' form-field__feedback--warning'}`}
          data-testid="provider-api-key-feedback"
          role="status"
        >
          {apiKeyFeedback}
        </span>
      ) : null}
    </label>
  )
}
