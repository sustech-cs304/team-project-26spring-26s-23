import type { LucideIcon } from 'lucide-react'

import type { RuntimeToolDirectoryEntry } from '../features/copilot/chat-contract'

export type WorkspaceView = 'assistant' | 'capabilities' | 'files' | 'developer' | 'settings'
export type HubWorkspaceView = Exclude<WorkspaceView, 'assistant' | 'settings'>
export type AgentTypeId = string
export type SettingsSection =
  | 'model-service'
  | 'default-model'
  | 'general'
  | 'display'
  | 'data'
  | 'mcp'
  | 'search'
  | 'memory'
  | 'a​pi'
  | 'docs'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

export type ThemeMode = 'light' | 'dark'

export type ModelCapability = 'vision' | 'search' | 'reasoning' | 'tools' | 'rerank' | 'embedding'

export interface ProviderModelProfile {
  id: string
  modelId: string
  displayName: string
  groupName: string
  capabilities: ModelCapability[]
  supportsStreaming: boolean
  currency: string
  inputPrice: string
  outputPrice: string
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
  status: string
  icon: LucideIcon
  recommendedTools: string[]
  defaultModelPreference: string | null
}

export interface AssistantSessionCapabilities {
  capabilitiesVersion: string
  allAvailableTools: RuntimeToolDirectoryEntry[]
  recommendedToolsForAgent: string[]
  defaultEnabledTools: string[]
  toolSelectionMode: string
  defaultModelPreference: string | null
}

export interface AssistantSessionShell {
  sessionId: string
  boundAgent: AgentType
  createdAt: string
  updatedAt: string
  capabilities: AssistantSessionCapabilities
}

export interface SettingsNavItem {
  id: SettingsSection
  label: string
  icon: LucideIcon
}

export interface HubEntry {
  id: string
  title: string
}

export interface HubWorkspaceContent {
  eyebrow: string
  title: string
  panelTitle: string
  spotlightTitle: string
  highlights: string[]
  entries: HubEntry[]
}

export interface ProviderProfile {
  id: string
  name: string
  protocol: string
  endpoint: string
  a​piK​ey: string
  defaultModel: string
  fastModel: string
  fallbackModel: string
  organization: string
  region: string
  notes: string
  enabled: boolean
  isDefault: boolean
  availableModels: ProviderModelProfile[]
}
