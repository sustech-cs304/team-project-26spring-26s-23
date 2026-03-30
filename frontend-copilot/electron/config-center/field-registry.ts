import type {
  UnifiedConfigDomainKey,
  UnifiedConfigTheme,
} from './domain-schema'
import {
  UNIFIED_CONFIG_DOMAIN_KEYS,
} from './domain-schema'
import {
  normalizeBoolean,
  normalizeOptionalString,
  normalizeThemeMode,
  parseBooleanPatchValue,
  parseOptionalStringPatchValue,
  parseThemeModePatchValue,
} from './field-behavior'

export type UnifiedConfigEffectLevel = 'immediate' | 'restart-module' | 'restart-application'
export type UnifiedConfigFieldValueType = 'optional-string' | 'theme-mode' | 'boolean'
export type UnifiedConfigUiSection = 'appearance' | 'assistant' | 'connection' | 'backend'

export interface UnifiedConfigFieldValueMap {
  theme: UnifiedConfigTheme
  animationsEnabled: boolean
  agentName: string | null
  runtimeUrl: string | null
  model: string | null
}

export type UnifiedConfigFieldKey = keyof UnifiedConfigFieldValueMap

export type UnifiedConfigFieldPatch = Partial<Record<UnifiedConfigFieldKey, unknown>>

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

export const UNIFIED_CONFIG_FIELD_REGISTRY: UnifiedConfigFieldRegistry = {
  theme: {
    key: 'theme',
    storageKey: 'theme',
    domain: UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
    defaultValue: 'light',
    valueType: 'theme-mode',
    effectLevel: 'immediate',
    rendererEditable: true,
    runtimeProjectable: false,
    uiSection: 'appearance',
    normalize: normalizeThemeMode,
    parsePatchValue: parseThemeModePatchValue,
  },
  animationsEnabled: {
    key: 'animationsEnabled',
    storageKey: 'animationsEnabled',
    domain: UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
    defaultValue: true,
    valueType: 'boolean',
    effectLevel: 'immediate',
    rendererEditable: true,
    runtimeProjectable: false,
    uiSection: 'appearance',
    normalize: normalizeBoolean,
    parsePatchValue: parseBooleanPatchValue,
  },
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
  model: {
    key: 'model',
    storageKey: 'model',
    domain: UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
    defaultValue: null,
    valueType: 'optional-string',
    effectLevel: 'restart-application',
    rendererEditable: true,
    runtimeProjectable: true,
    uiSection: 'backend',
    normalize: normalizeOptionalString,
    parsePatchValue: parseOptionalStringPatchValue,
  },
}
