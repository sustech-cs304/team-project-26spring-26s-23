export const UNIFIED_CONFIG_DOCUMENT_VERSION = 1 as const

export const UNIFIED_CONFIG_DOMAIN_KEYS = {
  FRONTEND_PREFERENCES: 'frontend-preferences',
  ASSISTANT_BEHAVIOR: 'assistant-behavior',
  HOST_CONFIG: 'host-config',
  BACKEND_EXPOSED: 'backend-exposed',
  GENERAL: 'general',
} as const

export type UnifiedConfigDomainKey = typeof UNIFIED_CONFIG_DOMAIN_KEYS[keyof typeof UNIFIED_CONFIG_DOMAIN_KEYS]

export const UNIFIED_CONFIG_DOMAIN_LIST = [
  UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
  UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
  UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
  UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
  UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
] as const satisfies readonly UnifiedConfigDomainKey[]

export type UnifiedConfigTheme = 'light' | 'dark'

export interface FrontendPreferencesConfigValues {
  theme: UnifiedConfigTheme
  animationsEnabled: boolean
}

export interface AssistantBehaviorConfigValues {
  agentName: string | null
  debugModeEnabled: boolean
}

export interface HostConfigValues {
  runtimeUrl: string | null
}

export interface BackendExposedConfigValues {
  model: string | null
}

export interface GeneralConfigValues {
  language: string
}

export interface UnifiedConfigDomainValueMap {
  'frontend-preferences': FrontendPreferencesConfigValues
  'assistant-behavior': AssistantBehaviorConfigValues
  'host-config': HostConfigValues
  'backend-exposed': BackendExposedConfigValues
  'general': GeneralConfigValues
}

export interface UnifiedConfigDomainDocument<TDomain extends UnifiedConfigDomainKey = UnifiedConfigDomainKey> {
  version: typeof UNIFIED_CONFIG_DOCUMENT_VERSION
  domain: TDomain
  values: UnifiedConfigDomainValueMap[TDomain]
}

export type UnifiedConfigSnapshotDocuments = {
  [TDomain in UnifiedConfigDomainKey]: UnifiedConfigDomainDocument<TDomain>
}

export interface UnifiedConfigSnapshot {
  version: typeof UNIFIED_CONFIG_DOCUMENT_VERSION
  documents: UnifiedConfigSnapshotDocuments
}

export interface UnifiedConfigDomainDefinition<TDomain extends UnifiedConfigDomainKey = UnifiedConfigDomainKey> {
  key: TDomain
  fileName: string
}

export const UNIFIED_CONFIG_DOMAIN_DEFINITIONS: {
  [TDomain in UnifiedConfigDomainKey]: UnifiedConfigDomainDefinition<TDomain>
} = {
  [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: {
    key: UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
    fileName: 'frontend-preferences.json',
  },
  [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: {
    key: UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
    fileName: 'assistant-behavior.json',
  },
  [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: {
    key: UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
    fileName: 'host-config.json',
  },
  [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: {
    key: UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
    fileName: 'backend-exposed.json',
  },
  [UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL]: {
    key: UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
    fileName: 'general.json',
  },
}

export function createUnifiedConfigDomainDocument<TDomain extends UnifiedConfigDomainKey>(
  domain: TDomain,
  values: UnifiedConfigDomainValueMap[TDomain],
): UnifiedConfigDomainDocument<TDomain> {
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    domain,
    values,
  }
}
