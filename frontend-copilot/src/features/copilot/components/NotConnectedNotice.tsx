import type { CopilotConfigMissingField } from '../types'

export interface NotConnectedNoticeDetailItem {
  label: string
  value: string
}

export interface NotConnectedNoticeProps {
  title?: string
  description: string
  missingFields?: CopilotConfigMissingField[]
  details?: NotConnectedNoticeDetailItem[]
}

const missingFieldLabels: Record<CopilotConfigMissingField, string> = {
  runtimeUrl: 'Runtime URL（仅开发态可手填）',
  agentName: 'Agent 名称',
}

export function NotConnectedNotice({
  title = '尚未连接后端智能体',
  description,
  missingFields = [],
  details = [],
}: NotConnectedNoticeProps) {
  return (
    <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
      <p className="copilot-panel__eyebrow">Copilot</p>
      <h2 className="copilot-panel__title">{title}</h2>
      <p className="copilot-panel__description">{description}</p>

      {details.length > 0 && (
        <dl className="copilot-panel__details-grid">
          {details.map((detail) => (
            <div key={`${detail.label}:${detail.value}`}>
              <dt>{detail.label}</dt>
              <dd>{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {missingFields.length > 0 && (
        <div className="copilot-panel__details-block">
          <p className="copilot-panel__details-heading">当前仍缺少以下配置：</p>
          <ul className="copilot-panel__list">
            {missingFields.map((field) => (
              <li key={field}>{missingFieldLabels[field]}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
