import { Pencil, Trash2 } from 'lucide-react'

import { getModelCapabilityOptions, getProviderModelListCopy } from '../locale'
import type { ModelCapability, ProviderModelProfile } from '../types'

interface ProviderModelListPanelProps {
  language: string
  availableModels: ProviderModelProfile[]
  canEditModels: boolean
  description?: string
  onOpenCreateModelEditor: () => void
  onOpenModelEditor: (index: number) => void
  onRemoveModel: (index: number) => void
}

export function ProviderModelListPanel({
  language,
  availableModels,
  canEditModels,
  description,
  onOpenCreateModelEditor,
  onOpenModelEditor,
  onRemoveModel,
}: ProviderModelListPanelProps) {
  const copy = getProviderModelListCopy(language)
  const capabilityOptions = getModelCapabilityOptions(language)

  return (
    <section className="settings-card settings-card--form">
      <div className="settings-card__header settings-card__header--spaced">
        <div>
          <h3 className="settings-card__title">{copy.title}</h3>
          {description ? <p className="settings-card__subtitle">{description}</p> : null}
        </div>
        <span className="inline-badge">{availableModels.length}{copy.countSuffix}</span>
      </div>

      <div className="settings-stack">
        <div className="model-list-shell">
          {availableModels.length > 0 ? (
            availableModels.map((model: ProviderModelProfile, index: number) => {
              const modelDisplayName = model.displayName || copy.unnamedModel
              const modelIdentifier = model.modelId || copy.missingModelId

              return (
                <article key={model.id} className="model-list-row">
                  <div className="model-list-row__main">
                    <span className="model-list-row__name" title={modelDisplayName}>
                      {modelDisplayName}
                    </span>
                    <span className="model-list-row__id" title={modelIdentifier}>
                      {modelIdentifier}
                    </span>
                    <div className="model-capability-list model-capability-list--compact" aria-label={copy.capabilityAriaLabel}>
                      {model.capabilities.length > 0 ? (
                        model.capabilities.map((capability: ModelCapability) => {
                          const option = capabilityOptions.find((item) => item.value === capability)

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
                        <span className="model-capability-chip model-capability-chip--empty">{copy.emptyCapabilities}</span>
                      )}
                    </div>
                  </div>

                  <div className="model-list-row__actions">
                    <button
                      type="button"
                      className="icon-button"
                      title={copy.editModelTitle(modelDisplayName)}
                      aria-label={copy.editModelAriaLabel(modelDisplayName)}
                      disabled={!canEditModels}
                      onClick={() => onOpenModelEditor(index)}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--danger"
                      title={copy.deleteModelTitle(modelDisplayName)}
                      aria-label={copy.deleteModelAriaLabel(modelDisplayName)}
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
              {canEditModels ? copy.emptyEditable : copy.emptyReadonly}
            </div>
          )}
        </div>

        <button
          type="button"
          className="secondary-button secondary-button--subtle"
          disabled={!canEditModels}
          onClick={onOpenCreateModelEditor}
        >
          {copy.addModelButton}
        </button>
      </div>
    </section>
  )
}
