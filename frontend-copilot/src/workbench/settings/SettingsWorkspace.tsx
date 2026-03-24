import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
import { settingsItems } from '../config'
import { SelectField, TextareaField, TextField, ToggleSwitch } from '../components/FormFields'
import type { ProviderProfile, SelectOption, SettingsSection } from '../types'
import {
  apiReconnectOptions,
  backupCycleOptions,
  compressionOptions,
  docsFormatOptions,
  fontSizeOptions,
  initialProviderProfiles,
  languageOptions,
  memoryStrategyOptions,
  protocolOptions,
  proxyModeOptions,
  resultCountOptions,
  searchEngineOptions,
  themeOptions,
  toolPermissionOptions,
  densityOptions,
} from './config'

interface SettingsWorkspaceProps {
  bootstrap: CopilotBootstrapController
}

export function SettingsWorkspace({ bootstrap }: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('model-service')
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(initialProviderProfiles)
  const [activeProviderId, setActiveProviderId] = useState<string>(initialProviderProfiles[0]?.id ?? '')
  const [providerQuery, setProviderQuery] = useState('')

  const [language, setLanguage] = useState('zh-CN')
  const [proxyMode, setProxyMode] = useState('system')
  const [spellCheckEnabled, setSpellCheckEnabled] = useState(true)
  const [assistantNotificationsEnabled, setAssistantNotificationsEnabled] = useState(false)
  const [backupEnabled, setBackupEnabled] = useState(true)

  const [themeMode, setThemeMode] = useState('light')
  const [fontSize, setFontSize] = useState('medium')
  const [density, setDensity] = useState('compact')
  const [animationsEnabled, setAnimationsEnabled] = useState(true)

  const [dataPath, setDataPath] = useState('D:/workspace/copilot-data')
  const [backupCycle, setBackupCycle] = useState('daily')
  const [launchSyncEnabled, setLaunchSyncEnabled] = useState(true)

  const [searchEngine, setSearchEngine] = useState('google')
  const [searchResultCount, setSearchResultCount] = useState('8')
  const [compressionMode, setCompressionMode] = useState('summary')
  const [safeSearchEnabled, setSafeSearchEnabled] = useState(true)

  const [memoryStrategy, setMemoryStrategy] = useState('session-longterm')
  const [memoryCleanupEnabled, setMemoryCleanupEnabled] = useState(true)

  const [mcpAutoDiscoveryEnabled, setMcpAutoDiscoveryEnabled] = useState(true)
  const [toolPermissionMode, setToolPermissionMode] = useState('manual')
  const [mcpSandboxEnabled, setMcpSandboxEnabled] = useState(false)

  const [apiReconnectMode, setApiReconnectMode] = useState('exponential')
  const [healthPollingEnabled, setHealthPollingEnabled] = useState(true)
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:8000')

  const [docsFormat, setDocsFormat] = useState('markdown')
  const [outputDirectory, setOutputDirectory] = useState('D:/workspace/exports')
  const [autoFileNameEnabled, setAutoFileNameEnabled] = useState(true)

  const activeSettingsItem = useMemo(
    () => settingsItems.find((item) => item.id === activeSection) ?? settingsItems[0],
    [activeSection],
  )

  const activeProvider = useMemo(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0],
    [activeProviderId, providerProfiles],
  )

  const filteredProviderProfiles = useMemo(() => {
    const keyword = providerQuery.trim().toLowerCase()

    if (!keyword) {
      return providerProfiles
    }

    return providerProfiles.filter((profile) => {
      return (
        profile.name.toLowerCase().includes(keyword)
        || profile.endpoint.toLowerCase().includes(keyword)
        || profile.defaultModel.toLowerCase().includes(keyword)
      )
    })
  }, [providerProfiles, providerQuery])

  const providerModelOptions = useMemo<SelectOption[]>(() => {
    return activeProvider.availableModels.map((model) => ({
      value: model,
      label: model,
      hint: '服务商模型预设',
    }))
  }, [activeProvider.availableModels])

  const allModelOptions = useMemo<SelectOption[]>(() => {
    const models = Array.from(new Set(providerProfiles.flatMap((profile) => profile.availableModels)))

    return models.map((model) => ({
      value: model,
      label: model,
      hint: '模型候选项',
    }))
  }, [providerProfiles])

  const [primaryAssistantModel, setPrimaryAssistantModel] = useState(
    initialProviderProfiles[0]?.defaultModel ?? '',
  )
  const [fastAssistantModel, setFastAssistantModel] = useState(initialProviderProfiles[0]?.fastModel ?? '')
  const [translationModel, setTranslationModel] = useState(
    initialProviderProfiles[1]?.defaultModel ?? initialProviderProfiles[0]?.defaultModel ?? '',
  )
  const [fallbackEnabled, setFallbackEnabled] = useState(true)

  const updateActiveProvider = (patch: Partial<ProviderProfile>) => {
    setProviderProfiles((previous) =>
      previous.map((profile) => {
        if (profile.id === activeProviderId) {
          return { ...profile, ...patch }
        }

        if (patch.isDefault === true) {
          return { ...profile, isDefault: false }
        }

        return profile
      }),
    )
  }

  const handleAddProvider = () => {
    const nextProvider = createCustomProvider(providerProfiles.length + 1)

    setProviderProfiles((previous) => [...previous, nextProvider])
    setProviderQuery('')
    setActiveProviderId(nextProvider.id)
  }

  return (
    <section className="workspace-stage settings-workspace" aria-label="设置工作区">
      <aside className="workspace-panel settings-panel" aria-label="设置导航列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">设置</p>
          <h1 className="panel-head__title">全局设置目录</h1>
          <p className="panel-head__subtitle">通过左侧主图标栏进入的独立布局，不复用助手与话题的语义。</p>
        </header>

        <ul className="settings-nav-list">
          {settingsItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeSection

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`settings-nav-item${active ? ' settings-nav-item--active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={16} className="settings-nav-item__icon" />
                  <span className="settings-nav-item__body">
                    <span className="settings-nav-item__title">{item.label}</span>
                    <span className="settings-nav-item__subtitle">{item.description}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <main className="workspace-main" aria-label="设置主内容区">
        <header className="workspace-main__header">
          <div>
            <p className="workspace-main__eyebrow">当前设置页</p>
            <h2 className="workspace-main__title">{activeSettingsItem.label}</h2>
            <p className="workspace-main__subtitle">{activeSettingsItem.description}</p>
          </div>
          <span className="workspace-badge">设置布局</span>
        </header>

        <section className="workspace-main__content workspace-main__content--flush workspace-main__content--settings">
          {(() => {
            switch (activeSection) {
              case 'model-service':
                return (
                  <div className="settings-page settings-page--split">
                    <section className="settings-card">
                      <div className="settings-card__header settings-card__header--spaced">
                        <div>
                          <h3 className="settings-card__title">模型服务商</h3>
                          <p className="settings-card__subtitle">左侧选择服务商，右侧编辑完整接入信息与默认模型。</p>
                        </div>
                        <button type="button" className="secondary-button" onClick={handleAddProvider}>
                          <Plus size={14} />
                          <span>添加</span>
                        </button>
                      </div>

                      <div className="search-box search-box--input">
                        <input
                          type="text"
                          className="search-box__input"
                          value={providerQuery}
                          placeholder="搜索服务商、地址或模型..."
                          onChange={(event) => setProviderQuery(event.target.value)}
                        />
                      </div>

                      <ul className="provider-list provider-list--interactive">
                        {filteredProviderProfiles.map((profile) => {
                          const active = profile.id === activeProvider.id

                          return (
                            <li key={profile.id}>
                              <button
                                type="button"
                                className={`provider-card${active ? ' provider-card--active' : ''}`}
                                onClick={() => setActiveProviderId(profile.id)}
                              >
                                <span className="provider-card__title-row">
                                  <span className="provider-card__title">{profile.name}</span>
                                  <span
                                    className={`inline-badge${profile.enabled ? ' inline-badge--success' : ''}`}
                                  >
                                    {profile.enabled ? '启用中' : '已停用'}
                                  </span>
                                </span>
                                <span className="provider-card__meta-row">
                                  {profile.isDefault ? (
                                    <span className="inline-badge inline-badge--primary">默认</span>
                                  ) : null}
                                  <span className="provider-card__meta">
                                    {
                                      protocolOptions.find((option) => option.value === profile.protocol)?.label
                                      ?? profile.protocol
                                    }
                                  </span>
                                </span>
                                <span className="provider-card__description">{profile.endpoint}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>

                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header settings-card__header--spaced">
                        <div>
                          <h3 className="settings-card__title">服务详情</h3>
                          <p className="settings-card__subtitle">面向前端展示完整配置能力，字段均可点击、切换与编辑。</p>
                        </div>
                        <div className="toolbar-actions">
                          <button type="button" className="ghost-button">
                            测试连接
                          </button>
                          <button type="button" className="primary-button">
                            保存配置
                          </button>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <TextField
                            label="服务商名称"
                            description="显示在左侧列表中的名称"
                            value={activeProvider.name}
                            onChange={(value) => updateActiveProvider({ name: value })}
                            placeholder="输入服务商名称"
                          />
                          <SelectField
                            label="协议类型"
                            description="控制请求的接口风格与参数格式"
                            value={activeProvider.protocol}
                            options={protocolOptions}
                            onChange={(value) => updateActiveProvider({ protocol: value })}
                          />
                          <TextField
                            label="API 地址"
                            description="支持自定义 Base URL 或代理网关"
                            value={activeProvider.endpoint}
                            onChange={(value) => updateActiveProvider({ endpoint: value })}
                            placeholder="https://api.example.com/v1"
                            type="url"
                          />
                          <TextField
                            label="默认模型 ID"
                            description="直接填写完整模型名称"
                            value={activeProvider.defaultModel}
                            onChange={(value) => updateActiveProvider({ defaultModel: value })}
                            placeholder="例如 openai/gpt-4.1"
                          />
                          <TextField
                            label="API 密钥"
                            description="前端仅展示占位，可继续接 Electron 持久化"
                            value={activeProvider.apiKey}
                            onChange={(value) => updateActiveProvider({ apiKey: value })}
                            placeholder="输入访问密钥"
                            type="password"
                          />
                          <TextField
                            label="组织 / 项目"
                            description="适配带组织隔离的服务商"
                            value={activeProvider.organization}
                            onChange={(value) => updateActiveProvider({ organization: value })}
                            placeholder="例如 team-project-26spring"
                          />
                          <SelectField
                            label="快速模型"
                            description="用于轻量任务或快速响应"
                            value={activeProvider.fastModel}
                            options={providerModelOptions}
                            onChange={(value) => updateActiveProvider({ fastModel: value })}
                          />
                          <SelectField
                            label="回退模型"
                            description="主模型不可用时的兜底策略"
                            value={activeProvider.fallbackModel}
                            options={providerModelOptions}
                            onChange={(value) => updateActiveProvider({ fallbackModel: value })}
                          />
                          <TextField
                            label="区域 / 机房"
                            description="用于区分本地、校园或公网服务"
                            value={activeProvider.region}
                            onChange={(value) => updateActiveProvider({ region: value })}
                            placeholder="例如 CN-North / Local"
                          />
                        </div>

                        <TextareaField
                          label="备注与扩展配置"
                          description="展示自定义 Header、路由说明或使用备注"
                          value={activeProvider.notes}
                          onChange={(value) => updateActiveProvider({ notes: value })}
                          placeholder="输入补充说明"
                        />

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="启用当前服务商"
                            description="关闭后保留配置，但不参与模型路由"
                            checked={activeProvider.enabled}
                            onChange={(checked) => updateActiveProvider({ enabled: checked })}
                          />
                          <ToggleSwitch
                            label="设为默认服务商"
                            description="置顶为全局默认模型服务入口"
                            checked={activeProvider.isDefault}
                            onChange={(checked) => updateActiveProvider({ isDefault: checked })}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'default-model':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">默认模型路由</h3>
                          <p className="settings-card__subtitle">通过下拉选择不同任务的首选模型，保留点击展开与选择反馈。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="主助手模型"
                            description="用于大多数正式对话与推理任务"
                            value={primaryAssistantModel}
                            options={allModelOptions}
                            onChange={setPrimaryAssistantModel}
                          />
                          <SelectField
                            label="快速执行模型"
                            description="用于轻量生成或预检查"
                            value={fastAssistantModel}
                            options={allModelOptions}
                            onChange={setFastAssistantModel}
                          />
                          <SelectField
                            label="翻译与改写模型"
                            description="面向压缩、润色与翻译场景"
                            value={translationModel}
                            options={allModelOptions}
                            onChange={setTranslationModel}
                          />
                        </div>

                        <ToggleSwitch
                          label="允许自动回退模型"
                          description="当主模型不可达时自动切换到备用模型"
                          checked={fallbackEnabled}
                          onChange={setFallbackEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'general':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">常规设置</h3>
                          <p className="settings-card__subtitle">使用真实可交互的开关与下拉框，模拟后续可持久化的设置体验。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="界面语言"
                            description="控制 UI 文案语言"
                            value={language}
                            options={languageOptions}
                            onChange={setLanguage}
                          />
                          <SelectField
                            label="代理模式"
                            description="控制联网请求的网络出口策略"
                            value={proxyMode}
                            options={proxyModeOptions}
                            onChange={setProxyMode}
                          />
                        </div>

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="拼写检查"
                            description="输入时即时提示拼写错误"
                            checked={spellCheckEnabled}
                            onChange={setSpellCheckEnabled}
                          />
                          <ToggleSwitch
                            label="助手消息通知"
                            description="任务完成或需要关注时显示提醒"
                            checked={assistantNotificationsEnabled}
                            onChange={setAssistantNotificationsEnabled}
                          />
                          <ToggleSwitch
                            label="自动备份"
                            description="定期保存核心设置与工作区状态"
                            checked={backupEnabled}
                            onChange={setBackupEnabled}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'display':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">显示设置</h3>
                          <p className="settings-card__subtitle">默认切换到浅色风格，同时保留主题、字号与动画等显示选项。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="主题"
                            description="控制整体配色模式"
                            value={themeMode}
                            options={themeOptions}
                            onChange={setThemeMode}
                          />
                          <SelectField
                            label="字号"
                            description="调整整体阅读尺寸"
                            value={fontSize}
                            options={fontSizeOptions}
                            onChange={setFontSize}
                          />
                          <SelectField
                            label="界面密度"
                            description="紧凑或舒适的布局间距"
                            value={density}
                            options={densityOptions}
                            onChange={setDensity}
                          />
                        </div>

                        <ToggleSwitch
                          label="启用微动画"
                          description="为开关、按钮与下拉选择保留轻量反馈动画"
                          checked={animationsEnabled}
                          onChange={setAnimationsEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'data':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">数据设置</h3>
                          <p className="settings-card__subtitle">用于展示本地存储目录、备份周期与启动同步策略。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <TextField
                            label="数据目录"
                            description="保存会话缓存、索引与设置文件"
                            value={dataPath}
                            onChange={setDataPath}
                            placeholder="输入本地目录"
                          />
                          <SelectField
                            label="备份周期"
                            description="控制自动备份的执行频率"
                            value={backupCycle}
                            options={backupCycleOptions}
                            onChange={setBackupCycle}
                          />
                        </div>

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="启用自动备份"
                            description="到期后自动生成新的备份快照"
                            checked={backupEnabled}
                            onChange={setBackupEnabled}
                          />
                          <ToggleSwitch
                            label="启动时同步"
                            description="应用启动后自动刷新本地缓存与索引"
                            checked={launchSyncEnabled}
                            onChange={setLaunchSyncEnabled}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'mcp':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">MCP 服务器</h3>
                          <p className="settings-card__subtitle">管理工具发现、调用权限与沙箱策略。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="工具权限策略"
                            description="控制外部能力调用前的确认方式"
                            value={toolPermissionMode}
                            options={toolPermissionOptions}
                            onChange={setToolPermissionMode}
                          />
                        </div>

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="自动发现 MCP 服务"
                            description="在启动时主动扫描已注册的服务端"
                            checked={mcpAutoDiscoveryEnabled}
                            onChange={setMcpAutoDiscoveryEnabled}
                          />
                          <ToggleSwitch
                            label="启用沙箱保护"
                            description="对高风险能力启用更严格的隔离策略"
                            checked={mcpSandboxEnabled}
                            onChange={setMcpSandboxEnabled}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'search':
                return (
                  <div className="settings-page settings-page--split settings-page--balanced">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">搜索服务商</h3>
                          <p className="settings-card__subtitle">使用下拉选择默认搜索引擎与结果规模。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <SelectField
                          label="默认搜索引擎"
                          description="优先使用的联网搜索服务"
                          value={searchEngine}
                          options={searchEngineOptions}
                          onChange={setSearchEngine}
                        />
                        <SelectField
                          label="结果数量"
                          description="控制默认返回结果条数"
                          value={searchResultCount}
                          options={resultCountOptions}
                          onChange={setSearchResultCount}
                        />
                      </div>
                    </section>

                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">网络搜索配置</h3>
                          <p className="settings-card__subtitle">控制内容压缩方式与安全搜索策略。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <SelectField
                          label="压缩方式"
                          description="决定搜索结果进入上下文前的压缩规则"
                          value={compressionMode}
                          options={compressionOptions}
                          onChange={setCompressionMode}
                        />
                        <ToggleSwitch
                          label="启用安全搜索"
                          description="尽量过滤明显不合适的搜索结果"
                          checked={safeSearchEnabled}
                          onChange={setSafeSearchEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'memory':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">全局记忆</h3>
                          <p className="settings-card__subtitle">配置长期记忆范围与自动清理行为。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <SelectField
                          label="记忆策略"
                          description="决定哪些上下文会被长期保留"
                          value={memoryStrategy}
                          options={memoryStrategyOptions}
                          onChange={setMemoryStrategy}
                        />
                        <ToggleSwitch
                          label="自动清理陈旧记忆"
                          description="定期清理长时间未使用的记忆条目"
                          checked={memoryCleanupEnabled}
                          onChange={setMemoryCleanupEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'api':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header settings-card__header--spaced">
                        <div>
                          <h3 className="settings-card__title">API 服务器</h3>
                          <p className="settings-card__subtitle">展示基础后端地址、健康检查与自动重连配置，并显示根层启动状态摘要。</p>
                        </div>
                        <span className={`inline-badge ${resolveBootstrapBadgeClass(bootstrap.state)}`}>
                          {formatBootstrapStatusLabel(bootstrap.state)}
                        </span>
                      </div>

                      <div className="settings-stack">
                        <div className="settings-card__header">
                          <div>
                            <h4 className="settings-card__title">根层启动摘要</h4>
                            <p className="settings-card__subtitle">
                              当前设置工作区直接消费来自根装配层的状态，不再各自重复读取运行态。
                            </p>
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
                            description="未来可对接实际 Pydantic AI 或代理网关"
                            value={apiBaseUrl}
                            onChange={setApiBaseUrl}
                            placeholder="http://127.0.0.1:8000"
                            type="url"
                          />
                          <SelectField
                            label="重连策略"
                            description="控制异常断开后的重试节奏"
                            value={apiReconnectMode}
                            options={apiReconnectOptions}
                            onChange={setApiReconnectMode}
                          />
                        </div>

                        <ToggleSwitch
                          label="启用健康检查轮询"
                          description="后台定时检查运行时连接状态"
                          checked={healthPollingEnabled}
                          onChange={setHealthPollingEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'docs':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">文档处理</h3>
                          <p className="settings-card__subtitle">控制导出格式、输出目录与文件命名规则。</p>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="默认导出格式"
                            description="文档生成后的默认格式"
                            value={docsFormat}
                            options={docsFormatOptions}
                            onChange={setDocsFormat}
                          />
                          <TextField
                            label="输出目录"
                            description="文档导出时的默认落盘目录"
                            value={outputDirectory}
                            onChange={setOutputDirectory}
                            placeholder="输入导出目录"
                          />
                        </div>

                        <ToggleSwitch
                          label="自动生成文件名"
                          description="导出时自动附带日期与标题摘要"
                          checked={autoFileNameEnabled}
                          onChange={setAutoFileNameEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )
            }
          })()}
        </section>
      </main>
    </section>
  )
}

function createCustomProvider(index: number): ProviderProfile {
  return {
    id: `custom-provider-${index}`,
    name: `Custom Provider ${index}`,
    protocol: 'custom-rest',
    endpoint: 'https://api.example.com/v1',
    apiKey: '',
    defaultModel: 'custom-model',
    fastModel: 'custom-model-fast',
    fallbackModel: 'custom-model-fallback',
    organization: '',
    region: 'Custom',
    notes: '新添加的占位服务商，可在右侧继续补全完整配置。',
    enabled: true,
    isDefault: false,
    availableModels: ['custom-model', 'custom-model-fast', 'custom-model-fallback'],
  }
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
