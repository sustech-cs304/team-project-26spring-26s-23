export const UNIFIED_CONFIG_DOCUMENT_VERSION = 1 as const

export const UNIFIED_CONFIG_DOMAIN_KEYS = {
  FRONTEND_PREFERENCES: 'frontend-preferences',
  ASSISTANT_BEHAVIOR: 'assistant-behavior',
  HOST_CONFIG: 'host-config',
  BACKEND_EXPOSED: 'backend-exposed',
} as const

export type UnifiedConfigDomainKey = typeof UNIFIED_CONFIG_DOMAIN_KEYS[keyof typeof UNIFIED_CONFIG_DOMAIN_KEYS]

export const UNIFIED_CONFIG_DOMAIN_LIST = [
  UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
  UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
  UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
  UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
] as const satisfies readonly UnifiedConfigDomainKey[]

export type UnifiedConfigEffectLevel = 'immediate' | 'restart-module' | 'restart-application'
export type UnifiedConfigFieldValueType = 'optional-string'
export type UnifiedConfigUiSection = 'appearance' | 'assistant' | 'connection' | 'backend'

export interface FrontendPreferencesConfigValues {}

export interface AssistantBehaviorConfigValues {
  agentName: string | null
}

export interface HostConfigValues {
  runtimeUrl: string | null
}

export interface BackendExposedConfigValues {}

export interface UnifiedConfigDomainValueMap {
  'frontend-preferences': FrontendPreferencesConfigValues
  'assistant-behavior': AssistantBehaviorConfigValues
  'host-config': HostConfigValues
  'backend-exposed': BackendExposedConfigValues
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

export type UnifiedConfigFieldKey = 'agentName' | 'runtimeUrl'

export interface UnifiedConfigFieldValueMap {
  agentName: string | null
  runtimeUrl: string | null
}

export type UnifiedConfigFieldPatch = Partial<Record<UnifiedConfigFieldKey, unknown>>

export interface UnifiedConfigDomainDefinition<TDomain extends UnifiedConfigDomainKey = UnifiedConfigDomainKey> {
  key: TDomain
  fileName: string
}

export interface UnifiedConfigFieldDefinition<TValue> {
  key: string
  storageKey: string
  domain: UnifiedConfigDomainKey
  defaultValue: TValue
  valueType: UnifiedConfigFieldValueType
  effectLevel: UnifiedConfigEffectLevel
  rendererEditable: boolean
  runtimeProjectable: boolean
  uiSection: UnifiedConfigUiSection
  normalize: (value: unknown) => TValue
  parsePatchValue: (value: unknown) => TValue
}

export type UnifiedConfigFieldRegistry = {
  [TKey in UnifiedConfigFieldKey]: UnifiedConfigFieldDefinition<UnifiedConfigFieldValueMap[TKey]> & { key: TKey }
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
}

export const UNIFIED_CONFIG_FIELD_REGISTRY: UnifiedConfigFieldRegistry = {
  agentName: {
    key: 'agentName',
    storageKey: 'agentName',
    domain: UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
    defaultValue: null,
    valueType: 'optional-string',
    effectLevel: 'immediate',
    rendererEditable: true,
    runtimeProjectable: false,
    uiSection: 'assistant',
    normalize: normalizeOptionalString,
    parsePatchValue: parseOptionalStringPatchValue,
  },
  runtimeUrl: {
    key: 'runtimeUrl',
    storageKey: 'runtimeUrl',
    domain: UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
    defaultValue: null,
    valueType: 'optional-string',
    effectLevel: 'restart-module',
    rendererEditable: true,
    runtimeProjectable: true,
    uiSection: 'connection',
    normalize: normalizeOptionalString,
    parsePatchValue: parseOptionalStringPatchValue,
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

export function createDefaultUnifiedConfigDomainDocument<TDomain extends UnifiedConfigDomainKey>(
  domain: TDomain,
): UnifiedConfigDomainDocument<TDomain> {
  switch (domain) {
    case UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {},
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        {
          agentName: UNIFIED_CONFIG_FIELD_REGISTRY.agentName.defaultValue,
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        {
          runtimeUrl: UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.defaultValue,
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        {},
      ) as UnifiedConfigDomainDocument<TDomain>
  }

  throw new Error(`Unsupported unified config domain: ${String(domain)}`)
}

export function normalizeUnifiedConfigDomainDocument<TDomain extends UnifiedConfigDomainKey>(
  domain: TDomain,
  input: unknown,
): UnifiedConfigDomainDocument<TDomain> {
  const record = asRecord(input)
  const values = asRecord(record.values)

  switch (domain) {
    case UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {},
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        {
          agentName: UNIFIED_CONFIG_FIELD_REGISTRY.agentName.normalize(values.agentName),
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        {
          runtimeUrl: UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.normalize(values.runtimeUrl),
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        {},
      ) as UnifiedConfigDomainDocument<TDomain>
  }

  throw new Error(`Unsupported unified config domain: ${String(domain)}`)
}

export function createDefaultUnifiedConfigSnapshot(): UnifiedConfigSnapshot {
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    documents: {
      [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
      ),
    },
  }
}

export function applyUnifiedConfigFieldPatch(
  snapshot: UnifiedConfigSnapshot,
  patch: UnifiedConfigFieldPatch,
): UnifiedConfigSnapshot {
  const nextAssistantValues = {
    ...snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values,
  }
  const nextHostValues = {
    ...snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values,
  }

  if ('agentName' in patch) {
    nextAssistantValues.agentName = UNIFIED_CONFIG_FIELD_REGISTRY.agentName.normalize(patch.agentName)
  }

  if ('runtimeUrl' in patch) {
    nextHostValues.runtimeUrl = UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.normalize(patch.runtimeUrl)
  }

  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    documents: {
      ...snapshot.documents,
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        nextAssistantValues,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        nextHostValues,
      ),
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}

function parseOptionalStringPatchValue(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('Expected a string or null.')
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}
