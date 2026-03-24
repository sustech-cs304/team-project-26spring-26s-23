import type { LucideIcon } from 'lucide-react'

export type WorkspaceView = 'assistant' | 'capabilities' | 'files' | 'developer' | 'settings'
export type HubWorkspaceView = Exclude<WorkspaceView, 'assistant' | 'settings'>
export type AgentTypeId = 'general' | 'blackboard' | 'tis'
export type SettingsSection =
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

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

export interface RailItem {
  id: WorkspaceView
  label: string
  icon: LucideIcon
}

export interface AgentType {
  id: AgentTypeId
  label: string
  shortLabel: string
  description: string
  icon: LucideIcon
}

export interface ConversationItem {
  id: string
  title: string
  summary: string
  updatedAt: string
  status: 'active' | 'idle' | 'attention'
}

export interface SettingsNavItem {
  id: SettingsSection
  label: string
  description: string
  icon: LucideIcon
}

export interface HubEntry {
  id: string
  title: string
  description: string
  meta: string
}

export interface HubWorkspaceContent {
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

export interface ProviderProfile {
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
