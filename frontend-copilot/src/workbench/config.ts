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
      updatedAt: '刚刚更新',
    },
    {
      id: 'general-exam-review',
      title: '算法复习提纲整理',
      updatedAt: '20 分钟前',
    },
    {
      id: 'general-java-notes',
      title: 'Java 类型系统速查',
      updatedAt: '昨天',
    },
  ],
  blackboard: [
    {
      id: 'bb-announcement-digest',
      title: '公告摘要与待办',
      updatedAt: '5 分钟前',
    },
    {
      id: 'bb-grades-check',
      title: '成绩波动检查',
      updatedAt: '今天上午',
    },
    {
      id: 'bb-assignment-plan',
      title: '作业截止时间排程',
      updatedAt: '昨天',
    },
  ],
  tis: [
    {
      id: 'tis-course-selection',
      title: '选课冲突排查',
      updatedAt: '12 分钟前',
    },
    {
      id: 'tis-training-plan',
      title: '培养方案缺口分析',
      updatedAt: '昨天',
    },
    {
      id: 'tis-calendar-sync',
      title: '学期日程同步确认',
      updatedAt: '2 天前',
    },
  ],
}

export const settingsItems: SettingsNavItem[] = [
  { id: 'model-service', label: '模型服务', icon: ServerCog },
  { id: 'default-model', label: '默认模型', icon: Brain },
  { id: 'general', label: '常规设置', icon: SlidersHorizontal },
  { id: 'display', label: '显示设置', icon: Monitor },
  { id: 'data', label: '数据设置', icon: Database },
  { id: 'mcp', label: 'MCP 服务器', icon: PlugZap },
  { id: 'search', label: '网络搜索', icon: Search },
  { id: 'memory', label: '全局记忆', icon: MemoryStick },
  { id: 'api', label: 'API 服务器', icon: Workflow },
  { id: 'docs', label: '文档处理', icon: FileText },
]

export const hubWorkspaceContent: Record<HubWorkspaceView, HubWorkspaceContent> = {
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

const hubWorkspaceViews: HubWorkspaceView[] = ['capabilities', 'files', 'developer']

export function isHubWorkspaceView(view: WorkspaceView): view is HubWorkspaceView {
  return hubWorkspaceViews.includes(view as HubWorkspaceView)
}
