import type { CopilotConfigMissingField } from '../types'

export interface NotConnectedNoticeProps {
  description: string
  missingFields?: CopilotConfigMissingField[]
}

const missingFieldLabels: Record<CopilotConfigMissingField, string> = {
  runtimeUrl: 'Runtime URL',
  agentName: 'Agent 名称',
}

export function NotConnectedNotice({
  description,
  missingFields = [],
}: NotConnectedNoticeProps) {
  return (
    <section className="copilot-panel__card copilot-panel__card--notice" aria-live="polite">
      <p className="copilot-panel__eyebrow">Copilot</p>
      <h2 className="copilot-panel__title">尚未连接后端智能体</h2>
      <p className="copilot-panel__description">{description}</p>

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
