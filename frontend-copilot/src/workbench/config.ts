import {
  Brain,
  CalendarDays,
  Database,
  FileText,
  FolderOpen,
  Link2,
  MessageSquare,
  Monitor,
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
  { id: 'sustech', label: 'SUSTech', icon: School },
  { id: 'developer', label: '日历', icon: CalendarDays },
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
  { id: 'api', label: 'API 服务器', icon: ServerCog },
  { id: 'search', label: '搜索设置', icon: Database },
  { id: 'mcp', label: 'MCP 设置', icon: Workflow },
  { id: 'docs', label: '文档处理', icon: FileText },
  { id: 'external-source', label: '外部源', icon: Link2 },
]

export const hubWorkspaceContent: Record<HubWorkspaceView, HubWorkspaceContent> = {
  developer: {
    eyebrow: '日历工作台',
    title: '统一日历与时间轴',
    panelTitle: '事件源筛选',
    spotlightTitle: '统一事件视图',
    highlights: ['全部', 'bb', '课程', '自定义'],
    entries: [
      { id: 'calendar-all', title: '全部' },
      { id: 'calendar-bb', title: 'bb' },
      { id: 'calendar-course', title: '课程' },
      { id: 'calendar-custom', title: '自定义' },
    ],
    sections: [
      { id: 'calendar-timeline', title: '时间轴视图' },
      { id: 'calendar-list', title: '列表视图' },
      { id: 'calendar-summary', title: '事件概览' },
    ],
  },
}

const hubWorkspaceViews: HubWorkspaceView[] = ['developer']

export function isHubWorkspaceView(view: WorkspaceView): view is HubWorkspaceView {
  return hubWorkspaceViews.includes(view as HubWorkspaceView)
}
