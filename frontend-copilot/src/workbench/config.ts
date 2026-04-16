import {
  Brain,
  Code2,
  Database,
  FileText,
  FolderOpen,
  Link2,
  MemoryStick,
  MessageSquare,
  Monitor,
  PlugZap,
  Search,
  School,
  ServerCog,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { RuntimeAgentDirectoryEntry } from '../features/copilot/chat-contract'
import {
  normalizeWorkbenchLanguage,
  type WorkbenchLanguage,
} from './locale'
import type {
  AgentType,
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

const agentIconsById: Record<string, LucideIcon> = {
  general: Brain,
  blackboard: Database,
  tis: Workflow,
}

const agentIconsByHint: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  database: Database,
  workflow: Workflow,
  brain: Brain,
}

const agentPresentationOverridesByLanguage: Record<WorkbenchLanguage, Record<string, { label: string, hint: string | null }>> = {
  'zh-CN': {
    general: {
      label: '通用智能体',
      hint: '默认使用所有工具',
    },
    default: {
      label: '通用智能体',
      hint: '默认使用所有工具',
    },
  },
  'en-US': {
    general: {
      label: 'General Agent',
      hint: 'Uses all tools by default',
    },
    default: {
      label: 'General Agent',
      hint: 'Uses all tools by default',
    },
  },
}

const missingAgentDescriptionByLanguage: Record<WorkbenchLanguage, string> = {
  'zh-CN': '后端目录未提供该智能体的描述。',
  'en-US': 'The runtime directory did not provide a description for this agent.',
}

export function enhanceRuntimeAgents(
  agents: RuntimeAgentDirectoryEntry[],
  language: string = 'zh-CN',
): AgentType[] {
  const locale = normalizeWorkbenchLanguage(language)

  return agents.map((agent) => {
    const presentation = resolveAgentPresentation(agent, locale)

    return {
      id: agent.agentId,
      label: presentation.label,
      shortLabel: presentation.shortLabel,
      description: agent.description ?? missingAgentDescriptionByLanguage[locale],
      hint: presentation.hint,
      status: agent.status,
      icon: resolveAgentIcon(agent),
      recommendedTools: [...agent.recommendedTools],
    }
  })
}

export function pickDefaultAgentId(input: {
  agents: AgentType[]
  defaultAgentId: string | null
  previousAgentId?: string | null
}): string | null {
  if (input.previousAgentId && input.agents.some((agent) => agent.id === input.previousAgentId)) {
    return input.previousAgentId
  }

  if (input.defaultAgentId && input.agents.some((agent) => agent.id === input.defaultAgentId)) {
    return input.defaultAgentId
  }

  return input.agents[0]?.id ?? null
}

function resolveAgentIcon(agent: RuntimeAgentDirectoryEntry): LucideIcon {
  if (agent.agentId in agentIconsById) {
    return agentIconsById[agent.agentId]!
  }

  if (agent.iconKey && agent.iconKey in agentIconsByHint) {
    return agentIconsByHint[agent.iconKey]!
  }

  return Sparkles
}

function resolveAgentPresentation(agent: RuntimeAgentDirectoryEntry, language: WorkbenchLanguage): {
  label: string
  shortLabel: string
  hint: string | null
} {
  const override = agentPresentationOverridesByLanguage[language][agent.agentId]
    ?? resolveAgentPresentationOverrideByDisplayName(agent.displayName, language)
  const resolvedLabel = override?.label ?? agent.displayName ?? agent.agentId

  return {
    label: resolvedLabel,
    shortLabel: override?.label ?? buildAgentShortLabel(agent),
    hint: override?.hint ?? null,
  }
}

function resolveAgentPresentationOverrideByDisplayName(
  displayName: string | null,
  language: WorkbenchLanguage,
): { label: string, hint: string | null } | null {
  if (displayName?.trim().toLowerCase() === 'default') {
    return agentPresentationOverridesByLanguage[language].default
  }

  return null
}

function buildAgentShortLabel(agent: RuntimeAgentDirectoryEntry): string {
  if (agent.displayName) {
    return agent.displayName
  }

  return agent.agentId
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

export const settingsItems: SettingsNavItem[] = [
  { id: 'sustech-info', label: 'SUSTech 信息', icon: School },
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
  { id: 'external-source', label: '外部源', icon: Link2 },
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
