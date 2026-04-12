import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'

import { apiReconnectOptions } from './config'
import { HostConfigRuntimeOverrideCard } from './ConfigCenterPublicFieldCards'

interface ApiSettingsSectionProps {
  bootstrap: CopilotBootstrapController
  apiBaseUrl: string
  apiReconnectMode: string
  healthPollingEnabled: boolean
  onApiBaseUrlChange: (value: string) => void
  onApiReconnectModeChange: (value: string) => void
  onHealthPollingEnabledChange: (value: boolean) => void
}

export function ApiSettingsSection({
  bootstrap,
  apiBaseUrl,
  apiReconnectMode,
  healthPollingEnabled,
  onApiBaseUrlChange,
  onApiReconnectModeChange,
  onHealthPollingEnabledChange,
}: ApiSettingsSectionProps) {
  return (
    <div className="settings-page">
      <HostConfigRuntimeOverrideCard />

      <section className="settings-card settings-card--form">
        <div className="settings-card__header settings-card__header--spaced">
          <div>
            <h3 className="settings-card__title">API 服务器</h3>
          </div>
          <span className={`inline-badge ${resolveBootstrapBadgeClass(bootstrap.state)}`}>
            {formatBootstrapStatusLabel(bootstrap.state)}
          </span>
        </div>

        <div className="settings-stack">
          <div className="settings-card__header">
            <div>
              <h4 className="settings-card__title">根层启动摘要</h4>
            </div>
          </div>

          <div className="workspace-facts">
            <article className="workspace-fact">
              <span>当前状态</span>
              <strong>{formatBootstrapStatusLabel(bootstrap.state)}</strong>
            </article>
            <article className="workspace-fact">
              <span>重试动作</span>
              <strong>{bootstrap.retrying ? '根层重试中' : '由根层统一持有'}</strong>
            </article>
          </div>

          <div className="toolbar-actions">
            <button type="button" className="ghost-button" onClick={bootstrap.retry} disabled={bootstrap.retrying}>
              {bootstrap.retrying ? '正在重试…' : '重试读取运行态'}
            </button>
          </div>

          <div className="form-grid form-grid--two">
            <TextField
              label="后端地址"
              value={apiBaseUrl}
              onChange={onApiBaseUrlChange}
              placeholder="http://127.0.0.1:8000"
              type="url"
            />
            <SelectField
              label="重连策略"
              value={apiReconnectMode}
              options={apiReconnectOptions}
              onChange={onApiReconnectModeChange}
            />
          </div>

          <ToggleSwitch
            label="启用健康检查轮询"
            checked={healthPollingEnabled}
            onChange={onHealthPollingEnabledChange}
          />
        </div>
      </section>
    </div>
  )
}

function formatBootstrapStatusLabel(state: CopilotBootstrapState): string {
  switch (state.status) {
    case 'loading':
      return '根层读取中'
    case 'empty':
      return '尚未配置'
    case 'incomplete':
      return '配置缺失'
    case 'starting':
      return '宿主启动中'
    case 'ready':
      return '运行态已就绪'
    case 'failed':
      return '宿主启动失败'
    case 'degraded':
      return '运行态降级'
    case 'error':
      return '读取失败'
  }
}

function resolveBootstrapBadgeClass(state: CopilotBootstrapState): string {
  switch (state.status) {
    case 'ready':
      return 'inline-badge--success'
    case 'degraded':
    case 'starting':
    case 'loading':
      return 'inline-badge--primary'
    default:
      return 'inline-badge--warning'
  }
}
