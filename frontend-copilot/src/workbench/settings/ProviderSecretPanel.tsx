import { Copy, Eye, EyeOff } from 'lucide-react'

interface ProviderSecretPanelProps {
  providerId: string
  visible: boolean
  label: string
  description: string
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

  return (
    <label className="form-field form-field--full" htmlFor="provider-api-key-input">
      <span className="form-field__meta">
        <span className="form-field__label">{label}</span>
        <span className="form-field__description">{description}</span>
      </span>
      <span className="text-input-shell">
        <input
          id="provider-api-key-input"
          data-testid="provider-api-key-input"
          className="text-input text-input-shell__input"
          type={apiKeyVisible ? 'text' : 'password'}
          value={apiKeyDraft}
          placeholder={placeholder || (hasApiKey ? '已配置，输入新密钥以替换' : '输入访问密钥')}
          onChange={(event) => onApiKeyDraftChange(providerId, event.target.value)}
          onBlur={() => {
            void onPersistApiKeyDraft(providerId)
          }}
        />
        <span className="text-input-shell__actions">
          <button
            type="button"
            className="icon-button icon-button--compact"
            aria-label={apiKeyVisible ? '隐藏 API 密钥' : '查看 API 密钥原文'}
            title={apiKeyVisible ? '隐藏 API 密钥' : '查看 API 密钥原文'}
            data-testid="provider-api-key-visibility-toggle"
            onClick={onToggleApiKeyVisibility}
          >
            {apiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="icon-button icon-button--compact"
            aria-label="复制 API 密钥原文"
            title="复制 API 密钥原文"
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
          className={`form-field__feedback${apiKeyFeedback.startsWith('已复制') || apiKeyFeedback.startsWith('已自动保存') || apiKeyFeedback.startsWith('已清除') ? ' form-field__feedback--success' : ' form-field__feedback--warning'}`}
          data-testid="provider-api-key-feedback"
          role="status"
        >
          {apiKeyFeedback}
        </span>
      ) : null}
    </label>
  )
}
