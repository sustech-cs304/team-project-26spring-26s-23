import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'
import type { ThemeMode } from '../types'
import {
  apiReconnectOptions,
  backupCycleOptions,
  compressionOptions,
  docsFormatOptions,
  languageOptions,
  memoryStrategyOptions,
  proxyModeOptions,
  resultCountOptions,
  searchEngineOptions,
  themeOptions,
  toolPermissionOptions,
} from './config'
import { HostConfigRuntimeOverrideCard } from './ConfigCenterPublicFieldCards'

interface GeneralSettingsSectionProps {
  language: string
  proxyMode: string
  assistantNotificationsEnabled: boolean
  backupEnabled: boolean
  onLanguageChange: (value: string) => void
  onProxyModeChange: (value: string) => void
  onAssistantNotificationsEnabledChange: (value: boolean) => void
  onBackupEnabledChange: (value: boolean) => void
}

interface DisplaySettingsSectionProps {
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
}

interface DataSettingsSectionProps {
  dataPath: string
  backupCycle: string
  backupEnabled: boolean
  launchSyncEnabled: boolean
  onDataPathChange: (value: string) => void
  onBackupCycleChange: (value: string) => void
  onBackupEnabledChange: (value: boolean) => void
  onLaunchSyncEnabledChange: (value: boolean) => void
}

interface McpSettingsSectionProps {
  toolPermissionMode: string
  mcpAutoDiscoveryEnabled: boolean
  onToolPermissionModeChange: (value: string) => void
  onMcpAutoDiscoveryEnabledChange: (value: boolean) => void
}

interface SearchSettingsSectionProps {
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  onSearchEngineChange: (value: string) => void
  onSearchResultCountChange: (value: string) => void
  onCompressionModeChange: (value: string) => void
}

interface MemorySettingsSectionProps {
  memoryStrategy: string
  memoryCleanupEnabled: boolean
  onMemoryStrategyChange: (value: string) => void
  onMemoryCleanupEnabledChange: (value: boolean) => void
}

interface ApiSettingsSectionProps {
  bootstrap: CopilotBootstrapController
  apiBaseUrl: string
  apiReconnectMode: string
  healthPollingEnabled: boolean
  onApiBaseUrlChange: (value: string) => void
  onApiReconnectModeChange: (value: string) => void
  onHealthPollingEnabledChange: (value: boolean) => void
}

interface DocsSettingsSectionProps {
  docsFormat: string
  outputDirectory: string
  autoFileNameEnabled: boolean
  onDocsFormatChange: (value: string) => void
  onOutputDirectoryChange: (value: string) => void
  onAutoFileNameEnabledChange: (value: boolean) => void
}

function isThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

export function GeneralSettingsSection({
  language,
  proxyMode,
  assistantNotificationsEnabled,
  backupEnabled,
  onLanguageChange,
  onProxyModeChange,
  onAssistantNotificationsEnabledChange,
  onBackupEnabledChange,
}: GeneralSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">常规设置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField label="界面语言" value={language} options={languageOptions} onChange={onLanguageChange} />
            <SelectField label="代理模式" value={proxyMode} options={proxyModeOptions} onChange={onProxyModeChange} />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label="助手消息通知"
              checked={assistantNotificationsEnabled}
              onChange={onAssistantNotificationsEnabledChange}
            />
            <ToggleSwitch label="自动备份" checked={backupEnabled} onChange={onBackupEnabledChange} />
          </div>
        </div>
      </section>
    </div>
  )
}

export function DisplaySettingsSection({ themeMode, onThemeModeChange }: DisplaySettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">显示设置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid">
            <SelectField
              label="主题"
              value={themeMode}
              options={themeOptions}
              onChange={(value) => {
                if (isThemeMode(value)) {
                  onThemeModeChange(value)
                }
              }}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export function DataSettingsSection({
  dataPath,
  backupCycle,
  backupEnabled,
  launchSyncEnabled,
  onDataPathChange,
  onBackupCycleChange,
  onBackupEnabledChange,
  onLaunchSyncEnabledChange,
}: DataSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">数据设置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <TextField
              label="数据目录"
              value={dataPath}
              onChange={onDataPathChange}
              placeholder="输入本地目录"
            />
            <SelectField label="备份周期" value={backupCycle} options={backupCycleOptions} onChange={onBackupCycleChange} />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch label="启用自动备份" checked={backupEnabled} onChange={onBackupEnabledChange} />
            <ToggleSwitch label="启动时同步" checked={launchSyncEnabled} onChange={onLaunchSyncEnabledChange} />
          </div>
        </div>
      </section>
    </div>
  )
}

export function McpSettingsSection({
  toolPermissionMode,
  mcpAutoDiscoveryEnabled,
  onToolPermissionModeChange,
  onMcpAutoDiscoveryEnabledChange,
}: McpSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">MCP 服务器</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField
              label="工具权限策略"
              value={toolPermissionMode}
              options={toolPermissionOptions}
              onChange={onToolPermissionModeChange}
            />
          </div>

          <div className="toggle-grid">
            <ToggleSwitch
              label="自动发现 MCP 服务"
              checked={mcpAutoDiscoveryEnabled}
              onChange={onMcpAutoDiscoveryEnabledChange}
            />
          </div>
        </div>
      </section>
    </div>
  )
}

export function SearchSettingsSection({
  searchEngine,
  searchResultCount,
  compressionMode,
  onSearchEngineChange,
  onSearchResultCountChange,
  onCompressionModeChange,
}: SearchSettingsSectionProps) {
  return (
    <div className="settings-page settings-page--split settings-page--balanced">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">搜索服务商</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField label="默认搜索引擎" value={searchEngine} options={searchEngineOptions} onChange={onSearchEngineChange} />
          <SelectField label="结果数量" value={searchResultCount} options={resultCountOptions} onChange={onSearchResultCountChange} />
        </div>
      </section>

      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">网络搜索配置</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField label="压缩方式" value={compressionMode} options={compressionOptions} onChange={onCompressionModeChange} />
        </div>
      </section>
    </div>
  )
}

export function MemorySettingsSection({
  memoryStrategy,
  memoryCleanupEnabled,
  onMemoryStrategyChange,
  onMemoryCleanupEnabledChange,
}: MemorySettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">全局记忆</h3>
          </div>
        </div>

        <div className="settings-stack">
          <SelectField
            label="记忆策略"
            value={memoryStrategy}
            options={memoryStrategyOptions}
            onChange={onMemoryStrategyChange}
          />
          <ToggleSwitch
            label="自动清理陈旧记忆"
            checked={memoryCleanupEnabled}
            onChange={onMemoryCleanupEnabledChange}
          />
        </div>
      </section>
    </div>
  )
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
            <button
              type="button"
              className="ghost-button"
              onClick={bootstrap.retry}
              disabled={bootstrap.retrying}
            >
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

export function DocsSettingsSection({
  docsFormat,
  outputDirectory,
  autoFileNameEnabled,
  onDocsFormatChange,
  onOutputDirectoryChange,
  onAutoFileNameEnabledChange,
}: DocsSettingsSectionProps) {
  return (
    <div className="settings-page">
      <section className="settings-card settings-card--form">
        <div className="settings-card__header">
          <div>
            <h3 className="settings-card__title">文档处理</h3>
          </div>
        </div>

        <div className="settings-stack">
          <div className="form-grid form-grid--two">
            <SelectField label="默认导出格式" value={docsFormat} options={docsFormatOptions} onChange={onDocsFormatChange} />
            <TextField
              label="输出目录"
              value={outputDirectory}
              onChange={onOutputDirectoryChange}
              placeholder="输入导出目录"
            />
          </div>

          <ToggleSwitch
            label="自动生成文件名"
            checked={autoFileNameEnabled}
            onChange={onAutoFileNameEnabledChange}
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
