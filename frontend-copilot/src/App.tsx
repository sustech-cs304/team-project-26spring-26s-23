import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  Check,
  ChevronDown,
  Code2,
  Database,
  FileText,
  FolderOpen,
  MemoryStick,
  MessageSquare,
  Monitor,
  PlugZap,
  Plus,
  Search,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
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
  | 'memory'
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
  description: string
  meta: string
}

type HubWorkspaceContent = {
  eyebrow: string
  title: string
  subtitle: string
  panelTitle: string
  panelSubtitle: string
  spotlightTitle: string
  spotlightDescription: string
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
    subtitle: '集中展示当前工作区可调用的能力域与基础接入状态。',
    panelTitle: '能力分组',
    panelSubtitle: '适合后续扩展成可检索、可开关的能力目录。',
    spotlightTitle: '工具调用与能力编排',
    spotlightDescription: '在这里组织网页抓取、浏览器自动化、本地命令与 MCP 工具能力。',
    highlights: ['MCP 服务器接入', '网页抓取与浏览器自动化', '项目内检索与本地命令执行'],
    entries: [
      {
        id: 'capability-mcp',
        title: 'MCP 扩展能力',
        description: '统一查看 Tavily、Fetch、Puppeteer 等外部服务的可用性。',
        meta: '适合展示工具在线状态与权限范围',
      },
      {
        id: 'capability-web',
        title: '联网搜索与抓取',
        description: '聚合联网搜索、抓取页面、提取正文等常用浏览能力。',
        meta: '后续可扩展配额、缓存与来源筛选',
      },
      {
        id: 'capability-local',
        title: '本地项目操作',
        description: '关联工作区搜索、命令执行、文件修改与验证流程。',
        meta: '适合在桌面端集中呈现可审计操作',
      },
    ],
  },
  files: {
    eyebrow: '文件工作区',
    title: '知识文件与资料入口',
    subtitle: '展示课程文档、导入资料与对话上下文附件的整理视图。',
    panelTitle: '文件分区',
    panelSubtitle: '适合承载资料列表、标签与索引入口。',
    spotlightTitle: '课程资料与上下文挂载',
    spotlightDescription: '后续可以在这里接入文档索引、附件管理与检索增强。',
    highlights: ['课程资料库', '会话附件管理', '知识索引与标签'],
    entries: [
      {
        id: 'files-courseware',
        title: '课程课件目录',
        description: '按课程聚合讲义、实验文档与下载资料。',
        meta: '适合扩展按学期/课程筛选',
      },
      {
        id: 'files-notes',
        title: '个人笔记区',
        description: '集中展示复习提纲、总结文档与对话导出内容。',
        meta: '可与长期记忆或搜索索引联动',
      },
      {
        id: 'files-attachments',
        title: '对话附件',
        description: '按会话管理上传文件、截图与生成产物。',
        meta: '后续可补拖拽上传与引用历史',
      },
    ],
  },
  developer: {
    eyebrow: '开发工作台',
    title: '开发任务与联调面板',
    subtitle: '为代码生成、验证命令与集成测试预留独立工作区。',
    panelTitle: '开发活动',
    panelSubtitle: '适合承载任务列表、构建状态与代码上下文。',
    spotlightTitle: '代码实现与验证流程',
    spotlightDescription: '在这里聚合构建日志、提交记录、校验入口与任务状态。',
    highlights: ['任务队列', '构建与测试反馈', '提交与发布记录'],
    entries: [
      {
        id: 'dev-tasks',
        title: '实现任务看板',
        description: '串联待办、进行中与已验证任务，便于逐步交付。',
        meta: '适合补充状态变迁与责任人信息',
      },
      {
        id: 'dev-builds',
        title: '构建与验证',
        description: '呈现 TypeScript 检查、Vite 构建与运行状态。',
        meta: '可扩展失败详情与历史对比',
      },
      {
        id: 'dev-history',
        title: '变更历史',
        description: '集中查看近期提交、分支状态与工作区差异摘要。',
        meta: '适合补充提交粒度与发布流水线信息',
      },
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

const proxyModeOptions: SelectOption[] = [
  { value: 'system', label: '系统代理', hint: '跟随操作系统网络配置' },
  { value: 'direct', label: '直连', hint: '不经过代理' },
  { value: 'manual', label: '手动配置', hint: '指定代理地址与端口' },
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

const densityOptions: SelectOption[] = [
  { value: 'compact', label: '紧凑', hint: '更专业克制的间距' },
  { value: 'comfortable', label: '舒适', hint: '默认显示密度' },
]

const backupCycleOptions: SelectOption[] = [
  { value: 'every-launch', label: '每次启动', hint: '启动即备份' },
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

const memoryStrategyOptions: SelectOption[] = [
  { value: 'session-only', label: '仅会话内', hint: '不保留长期记忆' },
  { value: 'session-longterm', label: '会话 + 长期记忆', hint: '推荐通用模式' },
  { value: 'project-centric', label: '项目优先', hint: '按项目沉淀上下文' },
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
    notes: '适合统一接入多家模型，后续可按成本切换路由。',
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
    notes: '面向校园网络环境的占位服务商配置。',
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
    notes: '用于未来直连自建后端或本地代理网关。',
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

  const activeSettingsItem = useMemo(
    () => settingsItems.find((item) => item.id === activeSection) ?? settingsItems[0],
    [activeSection],
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
              <p className="panel-head__subtitle">按智能体能力域组织，不与具体会话混用。</p>
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
                        <span className="assistant-card__meta">{agent.shortLabel}</span>
                        <span className="assistant-card__description">{agent.description}</span>
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
              <p className="panel-head__subtitle">展示当前智能体类型下的会话与主题切换。</p>
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
                      <span className="topic-card__summary">{conversation.summary}</span>
                      <span className="topic-card__meta">
                        <span>{conversation.updatedAt}</span>
                        <span className={`status-pill status-pill--${conversation.status}`}>
                          {conversation.status === 'active'
                            ? '进行中'
                            : conversation.status === 'attention'
                              ? '需关注'
                              : '已归档'}
                        </span>
                      </span>
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
              </div>
              <span className="workspace-badge">设置布局</span>
            </header>

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
          <p className="panel-head__subtitle">{content.panelSubtitle}</p>
        </header>

        <ul className="hub-list">
          {content.entries.map((entry) => (
            <li key={entry.id}>
              <article className="hub-list__item">
                <h2 className="hub-list__title">{entry.title}</h2>
                <p className="hub-list__description">{entry.description}</p>
                <p className="hub-list__meta">{entry.meta}</p>
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
            <p className="workspace-main__subtitle">{content.subtitle}</p>
          </div>
          <span className="workspace-badge">占位工作区</span>
        </header>

        <section className="workspace-main__content">
          <div className="hub-main-grid">
            <section className="hub-card hub-card--highlight">
              <p className="hub-card__eyebrow">工作区定位</p>
              <h3 className="hub-card__title">{content.spotlightTitle}</h3>
              <p className="hub-card__description">{content.spotlightDescription}</p>
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
                <p className="hub-card__eyebrow">模块占位</p>
                <h3 className="hub-card__title">{entry.title}</h3>
                <p className="hub-card__description">{entry.description}</p>
                <p className="hub-card__meta">{entry.meta}</p>
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
        profile.name.toLowerCase().includes(keyword) ||
        profile.endpoint.toLowerCase().includes(keyword) ||
        profile.defaultModel.toLowerCase().includes(keyword)
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
      notes: '新添加的占位服务商，可在右侧继续补全完整配置。',
      enabled: true,
      isDefault: false,
      availableModels: ['custom-model', 'custom-model-fast', 'custom-model-fallback'],
    }

    setProviderProfiles((previous) => [...previous, nextProvider])
    setProviderQuery('')
    setActiveProviderId(nextProvider.id)
  }

  switch (section) {
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
  const containerRef = useRef<HTMLDivElement | null>(null)

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

  return (
    <div ref={containerRef} className={`form-field${open ? ' form-field--open' : ''}`}>
      <div className="form-field__meta">
        <span className="form-field__label">{label}</span>
        {description ? <p className="form-field__description">{description}</p> : null}
      </div>

      <button
        type="button"
        className={`select-trigger${open ? ' select-trigger--open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="select-trigger__copy">
          <span className="select-trigger__value">{selectedOption?.label ?? placeholder ?? '请选择'}</span>
          {selectedOption?.hint ? <span className="select-trigger__hint">{selectedOption.hint}</span> : null}
        </span>
        <ChevronDown size={16} className="select-trigger__icon" />
      </button>

      <div className={`select-dropdown${open ? ' select-dropdown--open' : ''}`} role="listbox">
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
