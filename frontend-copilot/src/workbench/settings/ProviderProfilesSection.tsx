import { Copy, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react'

import { SelectField, TextareaField, TextField } from '../components/FormFields'
import type { ModelCapability, ProviderModelProfile, ProviderProfile } from '../types'
import { modelCapabilityOptions, protocolOptions } from './config'
import { ProviderModelEditorDialog } from './ProviderModelEditorDialog'
import { ProviderProfileList } from './ProviderProfileList'
import type { ModelEditorState } from './provider-profiles'

interface ProviderProfilesSectionProps {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  activeProvider: ProviderProfile | null
  activeProviderDetail: ProviderProfile
  providerQuery: string
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  modelEditorState: ModelEditorState | null
  modelEditorError: string | null
  onProviderQueryChange: (value: string) => void
  onActiveProviderChange: (providerId: string) => void
  onAddProvider: () => void
  onReorderProviders: (providerId: string, nextIndex: number) => void
  onCopyProvider: (providerId: string) => void | Promise<void>
  onDeleteProvider: (providerId: string) => void | Promise<void>
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
  onToggleModelCapability: (capability: ModelCapability) => void
  onClearModelEditorError: () => void
}

export function ProviderProfilesSection({
  providerProfiles,
  activeProviderId,
  activeProvider,
  activeProviderDetail,
  providerQuery,
  activeProviderApiKeyDraft,
  apiKeyVisible,
  apiKeyFeedback,
  modelEditorState,
  modelEditorError,
  onProviderQueryChange,
  onActiveProviderChange,
  onAddProvider,
  onReorderProviders,
  onCopyProvider,
  onDeleteProvider,
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
}: ProviderProfilesSectionProps) {
  return (
    <div className="settings-page settings-page--split">
      <ProviderProfileList
        providerProfiles={providerProfiles}
        activeProviderId={activeProviderId}
        providerQuery={providerQuery}
        onProviderQueryChange={onProviderQueryChange}
        onActiveProviderChange={onActiveProviderChange}
        onAddProvider={onAddProvider}
        onCopyProvider={onCopyProvider}
        onDeleteProvider={onDeleteProvider}
        onReorderProviders={onReorderProviders}
      />

      <div className="settings-detail-column">
        {activeProvider ? (
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
                  <label className="form-field form-field--full" htmlFor="provider-api-key-input">
                    <span className="form-field__meta">
                      <span className="form-field__label">API 密钥</span>
                    </span>
                    <span className="text-input-shell">
                      <input
                        id="provider-api-key-input"
                        data-testid="provider-api-key-input"
                        className="text-input text-input-shell__input"
                        type={apiKeyVisible ? 'text' : 'password'}
                        value={activeProviderApiKeyDraft}
                        placeholder={activeProviderDetail.hasApiKey ? '已配置，输入新密钥以替换' : '输入访问密钥'}
                        onChange={(event) => onProviderApiKeyDraftChange(activeProviderDetail.id, event.target.value)}
                        onBlur={() => {
                          void onPersistProviderApiKeyDraft(activeProviderDetail.id)
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
                        className={`form-field__feedback${apiKeyFeedback.startsWith('已复制') ? ' form-field__feedback--success' : ' form-field__feedback--warning'}`}
                        data-testid="provider-api-key-feedback"
                        role="status"
                      >
                        {apiKeyFeedback}
                      </span>
                    ) : null}
                  </label>
                </div>

                <TextareaField
                  label="备注与扩展配置"
                  value={activeProviderDetail.notes}
                  onChange={(value) => onUpdateActiveProvider({ notes: value })}
                  placeholder="输入补充说明"
                />
              </div>
            </section>

            <section className="settings-card settings-card--form">
              <div className="settings-card__header settings-card__header--spaced">
                <div>
                  <h3 className="settings-card__title">模型列表管理</h3>
                </div>
                <span className="inline-badge">{activeProviderDetail.availableModels.length} 个模型</span>
              </div>

              <div className="settings-stack">
                <div className="model-list-shell">
                  {activeProviderDetail.availableModels.length > 0 ? (
                    activeProviderDetail.availableModels.map((model: ProviderModelProfile, index: number) => {
                      const modelDisplayName = model.displayName || '未命名模型'
                      const modelIdentifier = model.modelId || '未填写模型 ID'

                      return (
                        <article key={model.id} className="model-list-row">
                          <div className="model-list-row__main">
                            <span className="model-list-row__name" title={modelDisplayName}>
                              {modelDisplayName}
                            </span>
                            <span className="model-list-row__id" title={modelIdentifier}>
                              {modelIdentifier}
                            </span>
                            <div className="model-capability-list model-capability-list--compact" aria-label="支持特性">
                              {model.capabilities.length > 0 ? (
                                model.capabilities.map((capability: ModelCapability) => {
                                  const option = modelCapabilityOptions.find((item) => item.value === capability)

                                  return (
                                    <span
                                      key={`${model.id}-${capability}`}
                                      className={`model-capability-chip model-capability-chip--${capability}`}
                                    >
                                      {option?.label ?? capability}
                                    </span>
                                  )
                                })
                              ) : (
                                <span className="model-capability-chip model-capability-chip--empty">未标记特性</span>
                              )}
                            </div>
                          </div>

                          <div className="model-list-row__actions">
                            <button
                              type="button"
                              className="icon-button"
                              title={`编辑 ${modelDisplayName}`}
                              aria-label={`编辑模型 ${modelDisplayName}`}
                              onClick={() => onOpenModelEditor(index)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-button icon-button--danger"
                              title={`删除 ${modelDisplayName}`}
                              aria-label={`删除模型 ${modelDisplayName}`}
                              onClick={() => onRemoveModel(index)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </article>
                      )
                    })
                  ) : (
                    <div className="model-list-empty">当前服务商还没有可用模型。点击下方按钮添加第一个模型。</div>
                  )}
                </div>

                <button
                  type="button"
                  className="secondary-button secondary-button--subtle"
                  onClick={onOpenCreateModelEditor}
                >
                  添加模型
                </button>
              </div>
            </section>

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
        ) : (
          <section className="settings-card settings-card--empty">
            <p className="settings-empty-hint">可在左侧添加服务商信息</p>
          </section>
        )}
      </div>
    </div>
  )
}
