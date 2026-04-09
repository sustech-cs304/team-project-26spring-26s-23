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
}

export function DefaultModelRoutesSection({ defaultModels }: DefaultModelRoutesSectionProps) {
  const {
    primaryAssistantModel,
    fastAssistantModel,
    allModelOptions,
    onPrimaryAssistantModelChange,
    onFastAssistantModelChange,
  } = defaultModels

  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">默认模型路由</h3>
            <p className="settings-card__subtitle">默认模型已改为按 profile + model 组合选择并保存稳定 route ref，不再依赖全局裸 modelId 的模糊匹配。</p>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField
              label="主助手模型"
              description="选择具体的 provider profile 与模型组合。禁用项表示 legacy、unsupported 或 catalog-only provider。"
              value={primaryAssistantModel}
              options={allModelOptions}
              onChange={onPrimaryAssistantModelChange}
              placeholder="请选择默认路由"
              triggerTestId="primary-default-model-trigger"
            />
            <SelectField
              label="快速执行模型"
              description="保存语义与主助手模型一致，均以 route ref 为准。"
              value={fastAssistantModel}
              options={allModelOptions}
              onChange={onFastAssistantModelChange}
              placeholder="请选择默认路由"
              triggerTestId="fast-default-model-trigger"
            />
          </div>
        </div>
      </section>
    </div>
  )
}
