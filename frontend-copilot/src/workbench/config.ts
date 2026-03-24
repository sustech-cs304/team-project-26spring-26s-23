import {
  Brain,
  Code2,
  Database,
  FileText,
  FolderOpen,
  MemoryStick,
  MessageSquare,
  Monitor,
  PlugZap,
  Search,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Workflow,
} from 'lucide-react'

import type {
  AgentType,
  AgentTypeId,
  ConversationItem,
  HubWorkspaceContent,
  HubWorkspaceView,
  RailItem,
  SettingsNavItem,
  WorkspaceView,
} from './types'

export const railPrimaryItems: RailItem[] = [
  { id: 'assistant', label: '助手', icon: MessageSquare },
  { id: 'capabilities', label: '能力', icon: Sparkles },
  { id: 'files', label: '文件', icon: FolderOpen },
  { id: 'developer', label: '开发', icon: Code2 },
]

export const railSecondaryItems: RailItem[] = [{ id: 'settings', label: '设置', icon: Settings }]

export const agentTypes: AgentType[] = [
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

export const conversationsByAgent: Record<AgentTypeId, ConversationItem[]> = {
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

export const settingsItems: SettingsNavItem[] = [
  { id: 'model-service', label: '模型服务', description: '供应商、地址与鉴权信息', icon: ServerCog },
  { id: 'default-model', label: '默认模型', description: '设置主模型与快捷模型', icon: Brain },
  { id: 'general', label: '常规设置', description: '语言、代理与通知行为', icon: SlidersHorizontal },
  { id: 'display', label: '显示设置', description: '主题、字体与缩放参数', icon: Monitor },
  { id: 'data', label: '数据设置', description: '本地数据目录与备份策略', icon: Database },
  { id: 'mcp', label: 'MCP 服务器', description: '外部工具与服务接入状态', icon: PlugZap },
  { id: 'search', label: '网络搜索', description: '搜索引擎与结果压缩规则', icon: Search },
  { id: 'memory', label: '全局记忆', description: '长期记忆与清理策略', icon: MemoryStick },
  { id: 'api', label: 'API 服务器', description: '后端服务健康检查与重连', icon: Workflow },
  { id: 'docs', label: '文档处理', description: '导入导出与文档格式偏好', icon: FileText },
]

export const hubWorkspaceContent: Record<HubWorkspaceView, HubWorkspaceContent> = {
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

const hubWorkspaceViews: HubWorkspaceView[] = ['capabilities', 'files', 'developer']

export function isHubWorkspaceView(view: WorkspaceView): view is HubWorkspaceView {
  return hubWorkspaceViews.includes(view as HubWorkspaceView)
}
