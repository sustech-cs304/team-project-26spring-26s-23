import type { LucideIcon } from 'lucide-react'

import type { RuntimeToolDirectoryEntry } from '../features/copilot/chat-contract'

export type WorkspaceView = 'assistant' | 'capabilities' | 'files' | 'developer' | 'settings'
export type HubWorkspaceView = Exclude<WorkspaceView, 'assistant' | 'settings'>
export type AgentTypeId = string
export type SettingsSection =
  | 'sustech-info'
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
  | 'external-source'

export interface SelectOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

export type ThemeMode = 'light' | 'dark'

export type ModelCapability = 'vision' | 'search' | 'reasoning' | 'tools' | 'rerank' | 'embedding'
export type ThinkingLevelIntent = 'off' | 'auto' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ThinkingCapabilityDeclaration {
  supported: boolean
  levels?: Array<Exclude<ThinkingLevelIntent, 'off'>>
  defaultLevel?: ThinkingLevelIntent
}

export interface ResolvedThinkingCapability {
  supported: boolean
  levels: ThinkingLevelIntent[]
  defaultLevel: ThinkingLevelIntent | null
}

export interface ProviderModelProfile {
  id: string
  modelId: string
  displayName: string
  groupName: string
  capabilities: ModelCapability[]
  thinkingCapability?: ThinkingCapabilityDeclaration
  supportsStreaming: boolean
  currency: string
  inputPrice: string
  outputPrice: string
}

export type ModelRouteKind = 'provider-model'

export interface ModelRouteRef {
  routeKind: ModelRouteKind
  profileId: string
  modelId: string
}

export type ProviderProfileCompatibilityStatus = 'active' | 'legacy' | 'unsupported'

export interface ProviderProfileCompatibility {
  status: ProviderProfileCompatibilityStatus
  reason: string
}

export type ProviderProfileExtensionValue = string | number | boolean | null
export type ProviderProfileExtensions = Record<string, ProviderProfileExtensionValue>

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
  hint: string | null
  status: string
  icon: LucideIcon
  recommendedTools: string[]
}

export interface AssistantSessionCapabilities {
  capabilitiesVersion: string
  allAvailableTools: RuntimeToolDirectoryEntry[]
  recommendedToolsForAgent: string[]
  defaultEnabledTools: string[]
  toolSelectionMode: string
}

export interface AssistantSessionShell {
  sessionId: string
  title?: string
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
  profileId?: string
  providerId?: string
  name: string
  displayName?: string
  protocol: string
  endpoint: string
  baseUrl?: string
  hasApiKey: boolean
  defaultModel: string
  defaultModelId?: string
  fastModel: string
  fallbackModel: string
  organization: string
  region: string
  notes: string
  compatibility?: ProviderProfileCompatibility
  extensions?: ProviderProfileExtensions
  availableModels: ProviderModelProfile[]
}
