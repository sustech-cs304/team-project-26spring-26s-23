import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  Code2,
  Database,
  FileText,
  FolderOpen,
  MessageSquare,
  Monitor,
  Pencil,
  PlugZap,
  Plus,
  Search,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
  type LucideIcon,
} from 'lucide-react'

import { CopilotChatPanel } from './features/copilot/CopilotChatPanel'
import './App.css'

type WorkspaceView = 'assistant' | 'capabilities' | 'files' | 'developer' | 'settings'
type HubWorkspaceView = Exclude<WorkspaceView, 'assistant' | 'settings'>
type AgentTypeId = 'general' | 'blackboard' | 'tis'
type SettingsSection =
  | 'model-service'
  | 'default-model'
  | 'general'
  | 'display'
  | 'data'
  | 'mcp'
  | 'search'
  | 'api'
  | 'docs'

type SelectOption = {
  value: string
  label: string
  hint?: string
}

type RailItem = {
  id: WorkspaceView
  label: string
  icon: LucideIcon
}

type AgentType = {
  id: AgentTypeId
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

type ConversationItem = {
  id: string
  title: string
  summary: string
  updatedAt: string
  status: 'active' | 'idle' | 'attention'
}

type SettingsNavItem = {
  id: SettingsSection
  label: string
  icon: LucideIcon
}

type HubEntry = {
  id: string
  title: string
}

type HubWorkspaceContent = {
  eyebrow: string
  title: string
  panelTitle: string
  spotlightTitle: string
  highlights: string[]
  entries: HubEntry[]
}

type ProviderProfile = {
  id: string
  name: string
  protocol: string
  endpoint: string
  apiKey: string
  defaultModel: string
  fastModel: string
  fallbackModel: string
  organization: string
  region: string
  notes: string
  enabled: boolean
  isDefault: boolean
  availableModels: string[]
}

type ModelCapability = 'vision' | 'search' | 'reasoning' | 'tools' | 'rerank' | 'embedding'

type ModelEditorDraft = {
  displayName: string
  groupName: string
  capabilities: ModelCapability[]
  supportsStreaming: boolean
  currency: string
  inputPrice: string
  outputPrice: string
}

type ModelEditorState = ModelEditorDraft & {
  index: number
  modelId: string
  advancedOpen: boolean
  isNew: boolean
}

type SelectFieldProps = {
  label: string
  description?: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  placeholder?: string
}

type TextFieldProps = {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'password' | 'url'
}

type TextareaFieldProps = {
  label: string
  description?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

type ToggleSwitchProps = {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

const railPrimaryItems: RailItem[] = [
  { id: 'assistant', label: '助手', icon: MessageSquare },
  { id: 'capabilities', label: '能力', icon: Sparkles },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'developer', label: '开发', icon: Code2 },
]

const railSecondaryItems: RailItem[] = [{ id: 'settings', label: '设置', icon: Settings }]

const agentTypes: AgentType[] = [
  {
    id: 'general',
    label: '通用助手',
    shortLabel: 'General',
    description: '面向开放式问答、写作协作与通用推理任务。',
    icon: Brain,
  },
  {
    id: 'blackboard',
    label: 'Blackboard',
    shortLabel: 'Blackboard',
    description: '聚焦课程公告、作业、成绩与 Blackboard 数据检索。',
    icon: Database,
  },
  {
    id: 'tis',
    label: 'TIS',
    shortLabel: 'Teaching Information System',
    description: '聚焦教学信息系统、选课安排与培养方案查询。',
    icon: Workflow,
  },
]

const conversationsByAgent: Record<AgentTypeId, ConversationItem[]> = {
  general: [
    {
      id: 'general-project-sync',
      title: '课程项目阶段总结',
      summary: '梳理本周里程碑、风险点与下一阶段交付顺序。',
      updatedAt: '刚刚更新',
      status: 'active',
    },
    {
      id: 'general-exam-review',
      title: '算法复习提纲整理',
      summary: '汇总贪心、最短路与复杂度分析的复习要点。',
      updatedAt: '20 分钟前',
      status: 'idle',
    },
    {
      id: 'general-java-notes',
      title: 'Java 类型系统速查',
      summary: '补齐类型擦除、泛型边界与反射相关概念。',
      updatedAt: '昨天',
      status: 'idle',
    },
  ],
  blackboard: [
    {
      id: 'bb-announcement-digest',
      title: '公告摘要与待办',
      summary: '聚合课程公告并自动提取需要跟进的事项。',
      updatedAt: '5 分钟前',
      status: 'active',
    },
    {
      id: 'bb-grades-check',
      title: '成绩波动检查',
      summary: '对比最近一次同步结果，定位异常课程分数变动。',
      updatedAt: '今天上午',
      status: 'attention',
    },
    {
      id: 'bb-assignment-plan',
      title: '作业截止时间排程',
      summary: '整合 Blackboard 作业清单并生成本周完成顺序。',
      updatedAt: '昨天',
      status: 'idle',
    },
  ],
  tis: [
    {
      id: 'tis-course-selection',
      title: '选课冲突排查',
      summary: '检查课程时间冲突、容量状态与备选方案。',
      updatedAt: '12 分钟前',
      status: 'active',
    },
    {
      id: 'tis-training-plan',
      title: '培养方案缺口分析',
      summary: '对照毕业要求标记当前学分与课程类型缺口。',
      updatedAt: '昨天',
      status: 'idle',
    },
    {
      id: 'tis-calendar-sync',
      title: '学期日程同步确认',
      summary: '核对教学周、考试周与个人日历同步状态。',
      updatedAt: '2 天前',
      status: 'idle',
    },
  ],
}

const settingsItems: SettingsNavItem[] = [
  { id: 'model-service', label: '模型服务', icon: ServerCog },
  { id: 'default-model', label: '默认模型', icon: Brain },
  { id: 'general', label: '常规设置', icon: SlidersHorizontal },
  { id: 'display', label: '显示设置', icon: Monitor },
  { id: 'data', label: '数据设置', icon: Database },
  { id: 'mcp', label: 'MCP 服务器', icon: PlugZap },
  { id: 'search', label: '网络搜索', icon: Search },
  { id: 'api', label: 'API 服务器', icon: Workflow },
  { id: 'docs', label: '文档处理', icon: FileText },
]

const hubWorkspaceContent: Record<HubWorkspaceView, HubWorkspaceContent> = {
  capabilities: {
    eyebrow: '能力中心',
    title: '已接入能力与工具栈',
    panelTitle: '能力分组',
    spotlightTitle: '工具调用与能力编排',
    highlights: ['MCP 服务器接入', '网页抓取与浏览器自动化', '项目内检索与本地命令执行'],
    entries: [
      { id: 'capability-mcp', title: 'MCP 扩展能力' },
      { id: 'capability-web', title: '联网搜索与抓取' },
      { id: 'capability-local', title: '本地项目操作' },
    ],
  },
  files: {
    eyebrow: '文件工作区',
    title: '知识文件与资料入口',
    panelTitle: '文件分区',
    spotlightTitle: '课程资料与上下文挂载',
    highlights: ['课程资料库', '会话附件管理', '知识索引与标签'],
    entries: [
      { id: 'files-courseware', title: '课程课件目录' },
      { id: 'files-notes', title: '个人笔记区' },
      { id: 'files-attachments', title: '对话附件' },
    ],
  },
  developer: {
    eyebrow: '开发工作台',
    title: '开发任务与联调面板',
    panelTitle: '开发活动',
    spotlightTitle: '代码实现与验证流程',
    highlights: ['任务队列', '构建与测试反馈', '提交与发布记录'],
    entries: [
      { id: 'dev-tasks', title: '实现任务看板' },
      { id: 'dev-builds', title: '构建与验证' },
      { id: 'dev-history', title: '变更历史' },
    ],
  },
}

const protocolOptions: SelectOption[] = [
  { value: 'openai-compatible', label: 'OpenAI Compatible', hint: '兼容 Chat Completions / Responses 风格' },
  { value: 'anthropic', label: 'Anthropic', hint: 'Claude 风格消息协议' },
  { value: 'gemini', label: 'Gemini', hint: 'Google Gemini API 风格' },
  { value: 'custom-rest', label: 'Custom REST', hint: '自定义后端代理或网关' },
]

const languageOptions: SelectOption[] = [
  { value: 'zh-CN', label: '简体中文', hint: '界面与默认文案' },
  { value: 'en-US', label: 'English', hint: '英文界面' },
]

const themeOptions: SelectOption[] = [
  { value: 'light', label: '浅色', hint: '推荐办公环境使用' },
  { value: 'system', label: '跟随系统', hint: '与系统主题同步' },
  { value: 'dark', label: '深色', hint: '夜间使用' },
]

const fontSizeOptions: SelectOption[] = [
  { value: 'small', label: '小', hint: '更高信息密度' },
  { value: 'medium', label: '中', hint: '默认阅读尺寸' },
  { value: 'large', label: '大', hint: '增强可读性' },
]

const backupCycleOptions: SelectOption[] = [
  { value: 'every-launch', label: '启动时', hint: '应用启动时执行备份' },
  { value: 'daily', label: '每天', hint: '适合常规使用' },
  { value: 'weekly', label: '每周', hint: '减少磁盘占用' },
]

const toolPermissionOptions: SelectOption[] = [
  { value: 'manual', label: '逐次确认', hint: '每次调用前询问' },
  { value: 'trusted', label: '受信能力自动允许', hint: '对已信任服务自动放行' },
  { value: 'strict', label: '严格手动', hint: '任何外部调用都需确认' },
]

const searchEngineOptions: SelectOption[] = [
  { value: 'google', label: 'Google', hint: '通用搜索体验' },
  { value: 'bing', label: 'Bing', hint: '适合综合网页搜索' },
  { value: 'baidu', label: 'Baidu', hint: '偏中文内容' },
]

const resultCountOptions: SelectOption[] = [
  { value: '5', label: '5 条', hint: '更聚焦' },
  { value: '8', label: '8 条', hint: '默认推荐' },
  { value: '12', label: '12 条', hint: '覆盖更多来源' },
]

const compressionOptions: SelectOption[] = [
  { value: 'summary', label: '摘要压缩', hint: '优先提炼关键结论' },
  { value: 'balanced', label: '平衡模式', hint: '保留适量原文细节' },
  { value: 'none', label: '不压缩', hint: '返回更多原始内容' },
]

const apiReconnectOptions: SelectOption[] = [
  { value: 'exponential', label: '指数退避', hint: '稳定优先' },
  { value: 'fixed', label: '固定间隔', hint: '节奏可预期' },
  { value: 'manual', label: '仅手动重连', hint: '避免后台自动请求' },
]

const docsFormatOptions: SelectOption[] = [
  { value: 'markdown', label: 'Markdown', hint: '推荐默认格式' },
  { value: 'html', label: 'HTML', hint: '便于直接展示' },
  { value: 'pdf', label: 'PDF', hint: '适合归档分享' },
]

const modelCapabilityOptions: Array<{ value: ModelCapability; label: string }> = [
  { value: 'vision', label: '视觉' },
  { value: 'search', label: '联网' },
  { value: 'reasoning', label: '推理' },
  { value: 'tools', label: '工具' },
  { value: 'rerank', label: '重排' },
  { value: 'embedding', label: '嵌入' },
]

const currencyOptions: SelectOption[] = [
  { value: 'usd', label: '美元（USD）', hint: '常见海外模型计价' },
  { value: 'cny', label: '人民币（CNY）', hint: '适合本地或代理服务' },
  { value: 'credits', label: '积分（Credits）', hint: '用于平台积分制计费' },
]

function titleCaseToken(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatModelDisplayName(modelId: string) {
  const normalized = modelId.trim()

  if (!normalized) {
    return '未命名模型'
  }

  const leaf = normalized.split('/').pop() ?? normalized

  return titleCaseToken(leaf)
}

function formatModelGroupName(modelId: string, providerName: string) {
  const normalized = modelId.trim()

  if (!normalized) {
    return providerName
  }

  const vendor = normalized.includes('/') ? normalized.split('/')[0] : providerName

  return titleCaseToken(vendor)
}

function getDefaultModelCapabilities(modelId: string): ModelCapability[] {
  const normalized = modelId.toLowerCase()
  const capabilities: ModelCapability[] = []

  if (/(gpt|gemini|claude|vision|vl)/.test(normalized)) {
    capabilities.push('vision')
  }

  if (/(search|web)/.test(normalized)) {
    capabilities.push('search')
  }

  if (/(embed)/.test(normalized)) {
    capabilities.push('embedding')
  }

  if (/(rerank)/.test(normalized)) {
    capabilities.push('rerank')
  }

  if (/(reason|think|claude|gpt|gemini)/.test(normalized)) {
    capabilities.push('reasoning')
  }

  if (/(tool|agent|gpt|gemini|claude)/.test(normalized)) {
    capabilities.push('tools')
  }

  if (capabilities.length === 0) {
    capabilities.push('reasoning')
  }

  return Array.from(new Set(capabilities))
}

function createModelEditorDraft(modelId: string, providerName: string): ModelEditorDraft {
  return {
    displayName: formatModelDisplayName(modelId),
    groupName: formatModelGroupName(modelId, providerName),
    capabilities: getDefaultModelCapabilities(modelId),
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
  }
}

function createEmptyModelEditorState(providerName: string, index: number): ModelEditorState {
  return {
    index,
    modelId: '',
    displayName: '',
    groupName: providerName,
    capabilities: ['reasoning', 'tools'],
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
    advancedOpen: false,
    isNew: true,
  }
}

function buildInitialModelDrafts(providers: ProviderProfile[]): Record<string, ModelEditorDraft[]> {
  return Object.fromEntries(
    providers.map((provider) => [
      provider.id,
      provider.availableModels.map((modelId) => createModelEditorDraft(modelId, provider.name)),
    ]),
  )
}

const initialProviderProfiles: ProviderProfile[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai-compatible',
    endpoint: 'https://openrouter.ai/api/v1',
    apiKey: '',
    defaultModel: 'openai/gpt-4.1',
    fastModel: 'openai/gpt-4.1-mini',
    fallbackModel: 'anthropic/claude-3.7-sonnet',
    organization: 'team-project-26spring',
    region: 'Global',
    notes: '统一接入多种模型服务，便于集中管理。',
    enabled: true,
    isDefault: true,
    availableModels: ['openai/gpt-4.1', 'openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet'],
  },
  {
    id: 'baill-openai',
    name: 'BaiLiOpenAI',
    protocol: 'openai-compatible',
    endpoint: 'https://api.baili.example.com/v1',
    apiKey: '',
    defaultModel: 'baili-chat-pro',
    fastModel: 'baili-chat-lite',
    fallbackModel: 'baili-reasoner',
    organization: 'school-lab',
    region: 'CN-North',
    notes: '适合校园网络环境下使用。',
    enabled: true,
    isDefault: false,
    availableModels: ['baili-chat-pro', 'baili-chat-lite', 'baili-reasoner'],
  },
  {
    id: 'custom-gateway',
    name: 'Campus Gateway',
    protocol: 'custom-rest',
    endpoint: 'http://127.0.0.1:8080/api/copilot',
    apiKey: '',
    defaultModel: 'campus-general-agent',
    fastModel: 'campus-fast-agent',
    fallbackModel: 'campus-summary-agent',
    organization: 'local-dev',
    region: 'Local',
    notes: '用于本地或校内部署的代理服务。',
    enabled: false,
    isDefault: false,
    availableModels: ['campus-general-agent', 'campus-fast-agent', 'campus-summary-agent'],
  },
]

function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>('assistant')
  const [activeAgentType, setActiveAgentType] = useState<AgentTypeId>('general')
  const [activeConversationId, setActiveConversationId] = useState<string>(
    conversationsByAgent.general[0]?.id ?? '',
  )
  const [activeSection, setActiveSection] = useState<SettingsSection>('model-service')

  const activeAgent = useMemo(
    () => agentTypes.find((item) => item.id === activeAgentType) ?? agentTypes[0],
    [activeAgentType],
  )

  const currentConversations = useMemo(
    () => conversationsByAgent[activeAgentType],
    [activeAgentType],
  )

  const activeConversation = useMemo(
    () =>
      currentConversations.find((item) => item.id === activeConversationId) ?? currentConversations[0],
    [activeConversationId, currentConversations],
  )

  const handleSelectAgent = (agentId: AgentTypeId) => {
    setActiveAgentType(agentId)
    setActiveConversationId(conversationsByAgent[agentId][0]?.id ?? '')
  }

  return (
    <div className="workbench-shell">
      <aside className="workbench-rail" aria-label="主图标栏">
        {railPrimaryItems.map((item) => {
          const Icon = item.icon
          const active = activeWorkspace === item.id

          return (
            <button
              key={item.id}
              type="button"
              className={`rail-button${active ? ' rail-button--active' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => setActiveWorkspace(item.id)}
            >
              <Icon size={18} className="rail-button__icon" />
            </button>
          )
        })}

        <div className="rail-spacer" />

        {railSecondaryItems.map((item) => {
          const Icon = item.icon
          const active = activeWorkspace === item.id

          return (
            <button
              key={item.id}
              type="button"
              className={`rail-button${active ? ' rail-button--active' : ''}`}
              title={item.label}
              aria-label={item.label}
              aria-pressed={active}
              onClick={() => setActiveWorkspace(item.id)}
            >
              <Icon size={18} className="rail-button__icon" />
            </button>
          )
        })}
      </aside>

      {activeWorkspace === 'assistant' ? (
        <section className="workspace-stage conversation-workspace" aria-label="助手工作区">
          <aside className="workspace-panel assistant-panel" aria-label="助手类型列">
            <header className="panel-head">
              <p className="panel-head__eyebrow">助手</p>
              <h1 className="panel-head__title">固定智能体类型</h1>
            </header>

            <ul className="assistant-list">
              {agentTypes.map((agent) => {
                const Icon = agent.icon
                const active = agent.id === activeAgentType

                return (
                  <li key={agent.id}>
                    <button
                      type="button"
                      className={`assistant-card${active ? ' assistant-card--active' : ''}`}
                      onClick={() => handleSelectAgent(agent.id)}
                    >
                      <span className="assistant-card__icon-wrap">
                        <Icon size={18} className="assistant-card__icon" />
                      </span>
                      <span className="assistant-card__body">
                        <span className="assistant-card__title">{agent.label}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <aside className="workspace-panel topic-panel" aria-label="话题列">
            <header className="panel-head">
              <p className="panel-head__eyebrow">话题</p>
              <h2 className="panel-head__title">{activeAgent.label}</h2>
            </header>

            <button type="button" className="new-thread-button">
              <span>＋</span>
              <span>新建话题</span>
            </button>

            <ul className="topic-list topic-list--detailed">
              {currentConversations.map((conversation) => {
                const active = conversation.id === activeConversation?.id

                return (
                  <li key={conversation.id}>
                    <button
                      type="button"
                      className={`topic-card${active ? ' topic-card--active' : ''}`}
                      onClick={() => setActiveConversationId(conversation.id)}
                    >
                      <span className="topic-card__title">{conversation.title}</span>
                      <span className="topic-card__meta">{conversation.updatedAt}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <main className="workspace-main" aria-label="会话主内容区">
            <header className="workspace-main__header">
              <div>
                <p className="workspace-main__eyebrow">当前会话</p>
                <h2 className="workspace-main__title">{activeConversation?.title ?? '未选择话题'}</h2>
                <p className="workspace-main__subtitle">
                  {activeAgent.label} · {activeConversation?.updatedAt ?? '等待选择话题'}
                </p>
              </div>
              <span className="workspace-badge">{activeAgent.shortLabel}</span>
            </header>

            <section className="workspace-hero">
              <div className="workspace-hero__copy">
                <p className="workspace-hero__eyebrow">工作区摘要</p>
                <h3 className="workspace-hero__title">已切换到 {activeAgent.label} 工作区</h3>
                <p className="workspace-hero__text">
                  从左侧选择固定智能体类型与其下的话题，在右侧进入对话与配置上下文。整体布局保持稳定，设置入口会独立切换到完整设置工作区。
                </p>
              </div>

              <div className="workspace-facts">
                <article className="workspace-fact">
                  <span>当前智能体</span>
                  <strong>{activeAgent.description}</strong>
                </article>
                <article className="workspace-fact">
                  <span>会话数量</span>
                  <strong>{currentConversations.length} 个主题会话</strong>
                </article>
                <article className="workspace-fact">
                  <span>运行时状态</span>
                  <strong>继续沿用现有 Copilot 配置判断与未连接提示逻辑</strong>
                </article>
              </div>
            </section>

            <section className="workspace-chat-shell">
              <CopilotChatPanel />
            </section>
          </main>
        </section>
      ) : activeWorkspace === 'settings' ? (
        <section className="workspace-stage settings-workspace" aria-label="设置工作区">
          <aside className="workspace-panel settings-panel" aria-label="设置导航列">
            <header className="panel-head">
              <p className="panel-head__eyebrow">设置</p>
              <h1 className="panel-head__title">全局设置目录</h1>
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
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <main className="workspace-main" aria-label="设置主内容区">
            <section className="workspace-main__content workspace-main__content--flush workspace-main__content--settings">
              <SettingsPlaceholder section={activeSection} />
            </section>
          </main>
        </section>
      ) : (
        <HubWorkspace view={activeWorkspace} />
      )}
    </div>
  )
}

function HubWorkspace({ view }: { view: HubWorkspaceView }) {
  const content = hubWorkspaceContent[view]

  return (
    <section className="workspace-stage hub-workspace" aria-label={`${content.title}工作区`}>
      <aside className="workspace-panel hub-panel" aria-label={`${content.title}侧栏`}>
        <header className="panel-head">
          <p className="panel-head__eyebrow">{content.eyebrow}</p>
          <h1 className="panel-head__title">{content.panelTitle}</h1>
        </header>

        <ul className="hub-list">
          {content.entries.map((entry) => (
            <li key={entry.id}>
              <article className="hub-list__item">
                <h2 className="hub-list__title">{entry.title}</h2>
              </article>
            </li>
          ))}
        </ul>
      </aside>

      <main className="workspace-main" aria-label={`${content.title}主内容区`}>
        <header className="workspace-main__header">
          <div>
            <p className="workspace-main__eyebrow">{content.eyebrow}</p>
            <h2 className="workspace-main__title">{content.title}</h2>
          </div>
        </header>

        <section className="workspace-main__content">
          <div className="hub-main-grid">
            <section className="hub-card hub-card--highlight">
              <h3 className="hub-card__title">{content.spotlightTitle}</h3>
              <div className="hub-chip-row">
                {content.highlights.map((highlight) => (
                  <span key={highlight} className="hub-chip">
                    {highlight}
                  </span>
                ))}
              </div>
            </section>

            {content.entries.map((entry) => (
              <section key={entry.id} className="hub-card">
                <h3 className="hub-card__title">{entry.title}</h3>
              </section>
            ))}
          </div>
        </section>
      </main>
    </section>
  )
}

function SettingsPlaceholder({ section }: { section: SettingsSection }) {
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(initialProviderProfiles)
  const [activeProviderId, setActiveProviderId] = useState<string>(initialProviderProfiles[0]?.id ?? '')
  const [providerQuery, setProviderQuery] = useState('')

  const [language, setLanguage] = useState('zh-CN')
  const [assistantNotificationsEnabled, setAssistantNotificationsEnabled] = useState(false)
  const [backupEnabled, setBackupEnabled] = useState(true)

  const [themeMode, setThemeMode] = useState('light')
  const [fontSize, setFontSize] = useState('medium')

  const [dataPath, setDataPath] = useState('')
  const [backupCycle, setBackupCycle] = useState('daily')

  const [searchEngine, setSearchEngine] = useState('google')
  const [searchResultCount, setSearchResultCount] = useState('8')
  const [compressionMode, setCompressionMode] = useState('summary')

  const [mcpAutoDiscoveryEnabled, setMcpAutoDiscoveryEnabled] = useState(true)
  const [toolPermissionMode, setToolPermissionMode] = useState('manual')
  const [mcpSandboxEnabled, setMcpSandboxEnabled] = useState(false)

  const [apiReconnectMode, setApiReconnectMode] = useState('exponential')
  const [healthPollingEnabled, setHealthPollingEnabled] = useState(true)
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:8000')

  const [docsFormat, setDocsFormat] = useState('markdown')
  const [outputDirectory, setOutputDirectory] = useState('D:/workspace/exports')
  const [autoFileNameEnabled, setAutoFileNameEnabled] = useState(true)

  const [modelDraftsByProvider, setModelDraftsByProvider] = useState<Record<string, ModelEditorDraft[]>>(
    () => buildInitialModelDrafts(initialProviderProfiles),
  )
  const [modelEditorState, setModelEditorState] = useState<ModelEditorState | null>(null)

  const activeProvider = useMemo(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0],
    [activeProviderId, providerProfiles],
  )

  const activeProviderModelDrafts = useMemo(
    () =>
      modelDraftsByProvider[activeProviderId] ??
      activeProvider.availableModels.map((modelId) => createModelEditorDraft(modelId, activeProvider.name)),
    [activeProvider, activeProviderId, modelDraftsByProvider],
  )

  useEffect(() => {
    setModelEditorState(null)
  }, [activeProviderId])

  const filteredProviderProfiles = useMemo(() => {
    const keyword = providerQuery.trim().toLowerCase()

    if (!keyword) {
      return providerProfiles
    }

    return providerProfiles.filter((profile) => {
      return (
        profile.name.toLowerCase().includes(keyword) ||
        profile.endpoint.toLowerCase().includes(keyword) ||
        profile.defaultModel.toLowerCase().includes(keyword)
      )
    })
  }, [providerProfiles, providerQuery])

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
    const nextIndex = providerProfiles.length + 1
    const nextProvider: ProviderProfile = {
      id: `custom-provider-${nextIndex}`,
      name: `Custom Provider ${nextIndex}`,
      protocol: 'custom-rest',
      endpoint: 'https://api.example.com/v1',
      apiKey: '',
      defaultModel: 'custom-model',
      fastModel: 'custom-model-fast',
      fallbackModel: 'custom-model-fallback',
      organization: '',
      region: 'Custom',
      notes: '',
      enabled: true,
      isDefault: false,
      availableModels: ['custom-model', 'custom-model-fast', 'custom-model-fallback'],
    }

    setProviderProfiles((previous) => [...previous, nextProvider])
    setModelDraftsByProvider((previous) => ({
      ...previous,
      [nextProvider.id]: nextProvider.availableModels.map((modelId) =>
        createModelEditorDraft(modelId, nextProvider.name),
      ),
    }))
    setProviderQuery('')
    setActiveProviderId(nextProvider.id)
    setModelEditorState(null)
  }

  const updateActiveProviderModels = (updater: (models: string[]) => string[]) => {
    setProviderProfiles((previous) =>
      previous.map((profile) => {
        if (profile.id !== activeProviderId) {
          return profile
        }

        return {
          ...profile,
          availableModels: updater(profile.availableModels),
        }
      }),
    )
  }

  const updateActiveProviderModelDrafts = (updater: (drafts: ModelEditorDraft[]) => ModelEditorDraft[]) => {
    setModelDraftsByProvider((previous) => ({
      ...previous,
      [activeProviderId]: updater(
        previous[activeProviderId] ??
          activeProvider.availableModels.map((modelId) => createModelEditorDraft(modelId, activeProvider.name)),
      ),
    }))
  }

  const handleOpenCreateModelEditor = () => {
    setModelEditorState(createEmptyModelEditorState(activeProvider.name, activeProvider.availableModels.length))
  }

  const handleOpenModelEditor = (index: number) => {
    const currentModelId = activeProvider.availableModels[index] ?? ''
    const currentDraft =
      activeProviderModelDrafts[index] ?? createModelEditorDraft(currentModelId, activeProvider.name)

    setModelEditorState({
      index,
      modelId: currentModelId,
      displayName: currentDraft.displayName,
      groupName: currentDraft.groupName,
      capabilities: currentDraft.capabilities,
      supportsStreaming: currentDraft.supportsStreaming,
      currency: currentDraft.currency,
      inputPrice: currentDraft.inputPrice,
      outputPrice: currentDraft.outputPrice,
      advancedOpen: false,
      isNew: false,
    })
  }

  const handleCloseModelEditor = () => {
    setModelEditorState(null)
  }

  const handleToggleModelCapability = (capability: ModelCapability) => {
    setModelEditorState((previous) => {
      if (!previous) {
        return previous
      }

      const capabilities = previous.capabilities.includes(capability)
        ? previous.capabilities.filter((item) => item !== capability)
        : [...previous.capabilities, capability]

      return {
        ...previous,
        capabilities,
      }
    })
  }

  const handleSaveModel = () => {
    if (!modelEditorState) {
      return
    }

    const nextModelId = modelEditorState.modelId.trim()

    if (!nextModelId) {
      return
    }

    const nextDraft: ModelEditorDraft = {
      displayName: modelEditorState.displayName.trim() || formatModelDisplayName(nextModelId),
      groupName: modelEditorState.groupName.trim() || formatModelGroupName(nextModelId, activeProvider.name),
      capabilities:
        modelEditorState.capabilities.length > 0 ? modelEditorState.capabilities : ['reasoning'],
      supportsStreaming: modelEditorState.supportsStreaming,
      currency: modelEditorState.currency,
      inputPrice: modelEditorState.inputPrice,
      outputPrice: modelEditorState.outputPrice,
    }

    if (modelEditorState.isNew) {
      updateActiveProviderModels((models) => [...models, nextModelId])
      updateActiveProviderModelDrafts((drafts) => [...drafts, nextDraft])
    } else {
      updateActiveProviderModels((models) =>
        models.map((model, modelIndex) => (modelIndex === modelEditorState.index ? nextModelId : model)),
      )
      updateActiveProviderModelDrafts((drafts) =>
        drafts.map((draft, draftIndex) => (draftIndex === modelEditorState.index ? nextDraft : draft)),
      )
    }

    setModelEditorState(null)
  }

  const handleRemoveModel = (index: number) => {
    updateActiveProviderModels((models) => models.filter((_, modelIndex) => modelIndex !== index))
    updateActiveProviderModelDrafts((drafts) => drafts.filter((_, draftIndex) => draftIndex !== index))
    setModelEditorState(null)
  }

  switch (section) {
    case 'model-service':
      return (
        <div className="settings-page settings-page--split">
          <section className="settings-card">
            <div className="settings-card__header settings-card__header--spaced">
              <div>
                <h3 className="settings-card__title">模型服务商</h3>
                <p className="settings-card__subtitle">左侧选择服务商，右侧查看基础信息与模型列表。</p>
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
                            protocolOptions.find((option) => option.value === profile.protocol)?.label ??
                            profile.protocol
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

          <div className="settings-detail-column">
            <section className="settings-card settings-card--form">
              <div className="settings-card__header">
                <div>
                  <h3 className="settings-card__title">服务商基础信息</h3>
                  <p className="settings-card__subtitle">编辑当前服务商的接入信息、默认模型与备注。</p>
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
                    description="填写服务商接口地址或代理网关地址"
                    value={activeProvider.endpoint}
                    onChange={(value) => updateActiveProvider({ endpoint: value })}
                    placeholder="https://api.example.com/v1"
                    type="url"
                  />
                  <TextField
                    label="默认模型 ID"
                    description="填写该服务商默认使用的模型 ID"
                    value={activeProvider.defaultModel}
                    onChange={(value) => updateActiveProvider({ defaultModel: value })}
                    placeholder="例如 openai/gpt-4.1"
                  />
                  <TextField
                    label="API 密钥"
                    description="填写对应服务商提供的访问密钥"
                    value={activeProvider.apiKey}
                    onChange={(value) => updateActiveProvider({ apiKey: value })}
                    placeholder="输入访问密钥"
                    type="password"
                  />
                </div>

                <TextareaField
                  label="备注与扩展配置"
                  description="补充自定义请求头、路由说明或使用备注"
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

            <section className="settings-card settings-card--form">
              <div className="settings-card__header settings-card__header--spaced">
                <div>
                  <h3 className="settings-card__title">模型列表管理</h3>
                  <p className="settings-card__subtitle">集中查看当前服务商模型，并通过图标快速编辑或删除。</p>
                </div>
                <span className="inline-badge">{activeProvider.availableModels.length} 个模型</span>
              </div>

              <div className="settings-stack">
                <div className="model-list-shell">
                  {activeProvider.availableModels.length > 0 ? (
                    activeProvider.availableModels.map((modelId, index) => {
                      const modelDraft =
                        activeProviderModelDrafts[index] ?? createModelEditorDraft(modelId, activeProvider.name)
                      const modelDisplayName = modelDraft.displayName || '未命名模型'
                      const modelIdentifier = modelId || '未填写模型 ID'

                      return (
                        <article key={`${activeProvider.id}-model-${index}`} className="model-list-row">
                          <div className="model-list-row__main">
                            <span className="model-list-row__name" title={modelDisplayName}>
                              {modelDisplayName}
                            </span>
                            <span className="model-list-row__id" title={modelIdentifier}>
                              {modelIdentifier}
                            </span>
                            <div className="model-capability-list model-capability-list--compact" aria-label="支持特性">
                              {modelDraft.capabilities.length > 0 ? (
                                modelDraft.capabilities.map((capability) => {
                                  const option = modelCapabilityOptions.find((item) => item.value === capability)

                                  return (
                                    <span
                                      key={`${activeProvider.id}-${index}-${capability}`}
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
                              onClick={() => handleOpenModelEditor(index)}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="icon-button icon-button--danger"
                              title={`删除 ${modelDisplayName}`}
                              aria-label={`删除模型 ${modelDisplayName}`}
                              onClick={() => handleRemoveModel(index)}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </article>
                      )
                    })
                  ) : (
                    <div className="model-list-empty">当前服务商还没有可用模型。点击下方按钮添加第一个模型。</div>
                  )}
                </div>

                <button
                  type="button"
                  className="secondary-button secondary-button--subtle"
                  onClick={handleOpenCreateModelEditor}
                >
                  添加模型
                </button>
              </div>
            </section>

            {modelEditorState ? (
              <div className="model-editor-backdrop" role="presentation" onClick={handleCloseModelEditor}>
                <section
                  className="model-editor-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label={modelEditorState.isNew ? '添加模型' : '编辑模型'}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="model-editor-modal__header">
                    <div>
                      <h3 className="settings-card__title">
                        {modelEditorState.isNew ? '添加模型' : '编辑模型'}
                      </h3>
                      <p className="settings-card__subtitle">填写模型名称、特性与价格信息。</p>
                    </div>
                    <button
                      type="button"
                      className="model-editor-modal__close"
                      aria-label="关闭模型编辑弹层"
                      onClick={handleCloseModelEditor}
                    >
                      ×
                    </button>
                  </div>

                  <div className="model-editor-modal__body">
                    <div className="form-grid form-grid--two">
                      <TextField
                        label="模型 ID"
                        description="用于请求路由与默认模型引用"
                        value={modelEditorState.modelId}
                        onChange={(value) =>
                          setModelEditorState((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  modelId: value,
                                }
                              : previous,
                          )
                        }
                        placeholder="例如 google/gemini-2.5-pro"
                      />
                      <TextField
                        label="模型名称"
                        description="显示在模型列表中的名称"
                        value={modelEditorState.displayName}
                        onChange={(value) =>
                          setModelEditorState((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  displayName: value,
                                }
                              : previous,
                          )
                        }
                        placeholder="例如 Gemini 2.5 Pro"
                      />
                    </div>

                    <div className="model-editor-section">
                      <div className="model-editor-section__header">
                        <span className="form-field__label">模型类型</span>
                        <p className="form-field__description">选择需要展示在列表中的能力标签。</p>
                      </div>

                      <div className="model-capability-picker">
                        {modelCapabilityOptions.map((option) => {
                          const active = modelEditorState.capabilities.includes(option.value)

                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`model-capability-button model-capability-button--${option.value}${active ? ' model-capability-button--active' : ''}`}
                              onClick={() => handleToggleModelCapability(option.value)}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <div className="model-editor-advanced">
                      <button
                        type="button"
                        className="ghost-button model-editor-advanced__toggle"
                        onClick={() =>
                          setModelEditorState((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  advancedOpen: !previous.advancedOpen,
                                }
                              : previous,
                          )
                        }
                      >
                        {modelEditorState.advancedOpen ? '收起更多设置' : '更多设置'}
                      </button>

                      {modelEditorState.advancedOpen ? (
                        <div className="model-editor-section">
                          <div className="form-grid form-grid--pricing">
                            <SelectField
                              label="币种"
                              description="用于标记价格信息的计价币种"
                              value={modelEditorState.currency}
                              options={currencyOptions}
                              onChange={(value) =>
                                setModelEditorState((previous) =>
                                  previous
                                    ? {
                                        ...previous,
                                        currency: value,
                                      }
                                    : previous,
                                )
                              }
                            />
                            <TextField
                              label="输入价格"
                              description="按每百万 Token 估算"
                              value={modelEditorState.inputPrice}
                              onChange={(value) =>
                                setModelEditorState((previous) =>
                                  previous
                                    ? {
                                        ...previous,
                                        inputPrice: value,
                                      }
                                    : previous,
                                )
                              }
                              placeholder="0.50"
                            />
                            <TextField
                              label="输出价格"
                              description="按每百万 Token 估算"
                              value={modelEditorState.outputPrice}
                              onChange={(value) =>
                                setModelEditorState((previous) =>
                                  previous
                                    ? {
                                        ...previous,
                                        outputPrice: value,
                                      }
                                    : previous,
                                )
                              }
                              placeholder="3.00"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="model-editor-modal__footer">
                    <button type="button" className="secondary-button" onClick={handleCloseModelEditor}>
                      取消
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={handleSaveModel}
                      disabled={!modelEditorState.modelId.trim()}
                    >
                      保存
                    </button>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </div>
      )

    case 'default-model':
      return (
        <div className="settings-page">
          <section className="settings-card settings-card--form">
            <div className="settings-card__header">
              <div>
                <h3 className="settings-card__title">默认模型路由</h3>
                <p className="settings-card__subtitle">为常用任务选择默认模型。</p>
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
              </div>
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
                <p className="settings-card__subtitle">管理界面语言、消息提醒与自动备份。</p>
              </div>
            </div>

            <div className="settings-stack">
              <div className="form-grid">
                <SelectField
                  label="界面语言"
                  description="控制界面文案语言"
                  value={language}
                  options={languageOptions}
                  onChange={setLanguage}
                />
              </div>

              <div className="toggle-grid">
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
                <p className="settings-card__subtitle">调整主题与阅读字号。</p>
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
              </div>
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
                <p className="settings-card__subtitle">设置数据目录与自动备份频率。</p>
              </div>
            </div>

            <div className="settings-stack">
              <div className="form-grid form-grid--two">
                <TextField
                  label="数据目录"
                  description="默认无需更改；留空时使用应用默认位置"
                  value={dataPath}
                  onChange={setDataPath}
                  placeholder="默认无需更改"
                />
                <SelectField
                  label="备份周期"
                  description="选择自动备份的执行频率"
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
                <p className="settings-card__subtitle">选择默认搜索引擎与返回结果数量。</p>
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
                <p className="settings-card__subtitle">控制搜索结果进入上下文前的压缩方式。</p>
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
                <p className="settings-card__subtitle">展示基础后端地址、健康检查与自动重连配置。</p>
              </div>
              <span className="inline-badge inline-badge--warning">占位：未连接</span>
            </div>

            <div className="settings-stack">
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
}

function SelectField({ label, description, value, options, onChange, placeholder }: SelectFieldProps) {
  const [open, setOpen] = useState(false)
  const [dropdownDirection, setDropdownDirection] = useState<'down' | 'up'>('down')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const selectedOption = options.find((option) => option.value === value)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  const handleToggleOpen = () => {
    setOpen((previous) => {
      const nextOpen = !previous

      if (nextOpen && triggerRef.current) {
        const triggerRect = triggerRef.current.getBoundingClientRect()
        const spaceBelow = window.innerHeight - triggerRect.bottom
        const spaceAbove = triggerRect.top
        const estimatedDropdownHeight = Math.min(Math.max(options.length, 1) * 56 + 12, 240)
        const shouldOpenUp = spaceBelow < estimatedDropdownHeight && spaceAbove > spaceBelow

        setDropdownDirection(shouldOpenUp ? 'up' : 'down')
      }

      return nextOpen
    })
  }

  return (
    <div ref={containerRef} className={`form-field${open ? ' form-field--open' : ''}`}>
      <div className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <p className="form-field__description">{description}</p> : null}
      </div>

      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger${open ? ' select-trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={handleToggleOpen}
      >
        <span className="select-trigger__copy">
          <span className="select-trigger__value">{selectedOption?.label ?? placeholder ?? '请选择'}</span>
          {selectedOption?.hint ? <span className="select-trigger__hint">{selectedOption.hint}</span> : null}
        </span>
        <ChevronDown size={16} className="select-trigger__icon" />
      </button>

      <div
        className={`select-dropdown${open ? ' select-dropdown--open' : ''}${dropdownDirection === 'up' ? ' select-dropdown--top' : ''}`}
        role="listbox"
      >
        {options.map((option) => {
          const active = option.value === value

          return (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={active}
              className={`select-option${active ? ' select-option--active' : ''}`}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span className="select-option__copy">
                <span className="select-option__label">{option.label}</span>
                {option.hint ? <span className="select-option__hint">{option.hint}</span> : null}
              </span>
              {active ? <Check size={16} className="select-option__check" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TextField({
  label,
  description,
  value,
  onChange,
  placeholder,
  type = 'text',
}: TextFieldProps) {
  return (
    <label className="form-field">
      <span className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <span className="form-field__description">{description}</span> : null}
      </span>
      <input
        className="text-input"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function TextareaField({ label, description, value, onChange, placeholder }: TextareaFieldProps) {
  return (
    <label className="form-field">
      <span className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <span className="form-field__description">{description}</span> : null}
      </span>
      <textarea
        className="text-input text-input--textarea"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function ToggleSwitch({ label, description, checked, onChange }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle-row${checked ? ' toggle-row--checked' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-row__copy">
        <span className="toggle-row__label">{label}</span>
        <span className="toggle-row__description">{description}</span>
      </span>
      <span className="toggle-row__track">
        <span className="toggle-row__thumb" />
      </span>
    </button>
  )
}

export default App
