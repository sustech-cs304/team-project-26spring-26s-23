import { getDefaultModelRoutesCopy } from '../locale'
import { SelectField } from '../components/FormFields'
import type { SelectOption } from '../types'

export interface DefaultModelRoutesSectionDomain {
  primaryAssistantModel: string
  fastAssistantModel: string
  allModelOptions: SelectOption[]
  onPrimaryAssistantModelChange: (value: string) => void
  onFastAssistantModelChange: (value: string) => void
}

interface DefaultModelRoutesSectionProps {
  defaultModels: DefaultModelRoutesSectionDomain
  language: string
}

export function DefaultModelRoutesSection({ defaultModels, language }: DefaultModelRoutesSectionProps) {
  const {
    primaryAssistantModel,
    fastAssistantModel,
    allModelOptions,
    onPrimaryAssistantModelChange,
    onFastAssistantModelChange,
  } = defaultModels

  const copy = getDefaultModelRoutesCopy(language)

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">{copy.title}</h3>
            <p className="settings-card__subtitle">{copy.subtitle}</p>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField
              label={copy.primaryLabel}
              description={copy.primaryDescription}
              value={primaryAssistantModel}
              options={allModelOptions}
              onChange={onPrimaryAssistantModelChange}
              placeholder={copy.placeholder}
              triggerTestId="primary-default-model-trigger"
            />
            <SelectField
              label={copy.fastLabel}
              description={copy.fastDescription}
              value={fastAssistantModel}
              options={allModelOptions}
              onChange={onFastAssistantModelChange}
              placeholder={copy.placeholder}
              triggerTestId="fast-default-model-trigger"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
