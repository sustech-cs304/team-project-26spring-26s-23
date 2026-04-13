import { Pencil, Trash2 } from 'lucide-react'

import type { ModelCapability, ProviderModelProfile } from '../types'
import { modelCapabilityOptions } from './config'

interface ProviderModelListPanelProps {
  availableModels: ProviderModelProfile[]
  canEditModels: boolean
  description?: string
  onOpenCreateModelEditor: () => void
  onOpenModelEditor: (index: number) => void
  onRemoveModel: (index: number) => void
}

export function ProviderModelListPanel({
  availableModels,
  canEditModels,
  description,
  onOpenCreateModelEditor,
  onOpenModelEditor,
  onRemoveModel,
}: ProviderModelListPanelProps) {
  return (
    <section className="settings-card settings-card--form">
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">模型列表管理</h3>
          {description ? <p className="settings-card__subtitle">{description}</p> : null}
        </div>
        <span className="inline-badge">{availableModels.length} 个模型</span>
      </div>

      <div className="settings-stack">
        <div className="model-list-shell">
          {availableModels.length > 0 ? (
            availableModels.map((model: ProviderModelProfile, index: number) => {
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
                      disabled={!canEditModels}
                      onClick={() => onOpenModelEditor(index)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--danger"
                      title={`删除 ${modelDisplayName}`}
                      aria-label={`删除模型 ${modelDisplayName}`}
                      disabled={!canEditModels}
                      onClick={() => onRemoveModel(index)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              )
            })
          ) : (
            <div className="model-list-empty">
              {canEditModels ? '当前服务还没有可用模型。点击下方按钮添加第一个模型。' : '当前模型列表暂不可编辑。'}
            </div>
          )}
        </div>

        <button
          type="button"
          className="secondary-button secondary-button--subtle"
          disabled={!canEditModels}
          onClick={onOpenCreateModelEditor}
        >
          添加模型
        </button>
      </div>
    </section>
  )
}
