import { SelectField } from '../components/FormFields'
import type { SelectOption } from '../types'

interface DefaultModelRoutesSectionProps {
  primaryAssistantModel: string
  fastAssistantModel: string
  allModelOptions: SelectOption[]
  onPrimaryAssistantModelChange: (value: string) => void
  onFastAssistantModelChange: (value: string) => void
}

export function DefaultModelRoutesSection({
  primaryAssistantModel,
  fastAssistantModel,
  allModelOptions,
  onPrimaryAssistantModelChange,
  onFastAssistantModelChange,
}: DefaultModelRoutesSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">默认模型路由</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField
              label="主助手模型"
              value={primaryAssistantModel}
              options={allModelOptions}
              onChange={onPrimaryAssistantModelChange}
            />
            <SelectField
              label="快速执行模型"
              value={fastAssistantModel}
              options={allModelOptions}
              onChange={onFastAssistantModelChange}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
