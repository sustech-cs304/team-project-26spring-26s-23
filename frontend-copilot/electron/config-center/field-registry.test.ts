import { describe, expect, it } from 'vitest'
import {
  UNIFIED_CONFIG_FIELD_REGISTRY,
  type UnifiedConfigFieldKey,
} from './field-registry'
import { UNIFIED_CONFIG_DOMAIN_KEYS } from './domain-schema'
import {
  normalizeBoolean,
  normalizeOptionalString,
  normalizeThemeMode,
  parseBooleanPatchValue,
  parseOptionalStringPatchValue,
  parseThemeModePatchValue,
} from './field-behavior'

const EXPECTED_FIELDS: UnifiedConfigFieldKey[] = [
  'theme',
  'animationsEnabled',
  'agentName',
  'debugModeEnabled',
  'runtimeUrl',
  'model',
]

describe('UNIFIED_CONFIG_FIELD_REGISTRY', () => {
  it('registers all expected fields', () => {
    const registeredKeys = Object.keys(UNIFIED_CONFIG_FIELD_REGISTRY) as UnifiedConfigFieldKey[]
    expect(registeredKeys.sort()).toEqual([...EXPECTED_FIELDS].sort())
  })

  it('records no extra fields beyond the expected set', () => {
    const registeredKeys = Object.keys(UNIFIED_CONFIG_FIELD_REGISTRY)
    expect(registeredKeys.length).toBe(EXPECTED_FIELDS.length)
  })

  describe('theme', () => {
    it('has correct metadata', () => {
      const def = UNIFIED_CONFIG_FIELD_REGISTRY.theme
      expect(def.key).toBe('theme')
      expect(def.storageKey).toBe('theme')
      expect(def.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES)
      expect(def.defaultValue).toBe('light')
      expect(def.valueType).toBe('theme-mode')
      expect(def.effectLevel).toBe('immediate')
      expect(def.rendererEditable).toBe(true)
      expect(def.runtimeProjectable).toBe(false)
      expect(def.uiSection).toBe('appearance')
    })

    it('uses normalizeThemeMode for normalization', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.theme.normalize).toBe(normalizeThemeMode)
    })

    it('uses parseThemeModePatchValue for patch parsing', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.theme.parsePatchValue).toBe(parseThemeModePatchValue)
    })
  })

  describe('animationsEnabled', () => {
    it('has correct metadata', () => {
      const def = UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled
      expect(def.key).toBe('animationsEnabled')
      expect(def.storageKey).toBe('animationsEnabled')
      expect(def.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES)
      expect(def.defaultValue).toBe(true)
      expect(def.valueType).toBe('boolean')
      expect(def.effectLevel).toBe('immediate')
      expect(def.rendererEditable).toBe(true)
      expect(def.runtimeProjectable).toBe(false)
      expect(def.uiSection).toBe('appearance')
    })

    it('uses normalizeBoolean for normalization', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled.normalize).toBe(normalizeBoolean)
    })

    it('uses parseBooleanPatchValue for patch parsing', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled.parsePatchValue).toBe(parseBooleanPatchValue)
    })

    it('normalizes to true by default', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled.normalize('invalid')).toBe(true)
    })
  })

  describe('agentName', () => {
    it('has correct metadata', () => {
      const def = UNIFIED_CONFIG_FIELD_REGISTRY.agentName
      expect(def.key).toBe('agentName')
      expect(def.storageKey).toBe('agentName')
      expect(def.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR)
      expect(def.defaultValue).toBe(null)
      expect(def.valueType).toBe('optional-string')
      expect(def.effectLevel).toBe('immediate')
      expect(def.rendererEditable).toBe(true)
      expect(def.runtimeProjectable).toBe(false)
      expect(def.uiSection).toBe('assistant')
    })

    it('uses normalizeOptionalString for normalization', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.agentName.normalize).toBe(normalizeOptionalString)
    })

    it('uses parseOptionalStringPatchValue for patch parsing', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.agentName.parsePatchValue).toBe(parseOptionalStringPatchValue)
    })
  })

  describe('debugModeEnabled', () => {
    it('has correct metadata', () => {
      const def = UNIFIED_CONFIG_FIELD_REGISTRY.debugModeEnabled
      expect(def.key).toBe('debugModeEnabled')
      expect(def.storageKey).toBe('debugModeEnabled')
      expect(def.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR)
      expect(def.defaultValue).toBe(false)
      expect(def.valueType).toBe('boolean')
      expect(def.effectLevel).toBe('immediate')
      expect(def.rendererEditable).toBe(true)
      expect(def.runtimeProjectable).toBe(true)
      expect(def.uiSection).toBe('assistant')
    })

    it('uses a custom normalize that defaults to false', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.debugModeEnabled.normalize('invalid')).toBe(false)
    })

    it('uses parseBooleanPatchValue for patch parsing', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.debugModeEnabled.parsePatchValue).toBe(parseBooleanPatchValue)
    })

    it('normalize is not the same reference as normalizeBoolean', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.debugModeEnabled.normalize).not.toBe(normalizeBoolean)
    })
  })

  describe('runtimeUrl', () => {
    it('has correct metadata', () => {
      const def = UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl
      expect(def.key).toBe('runtimeUrl')
      expect(def.storageKey).toBe('runtimeUrl')
      expect(def.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)
      expect(def.defaultValue).toBe(null)
      expect(def.valueType).toBe('optional-string')
      expect(def.effectLevel).toBe('restart-module')
      expect(def.rendererEditable).toBe(true)
      expect(def.runtimeProjectable).toBe(true)
      expect(def.uiSection).toBe('connection')
    })

    it('uses normalizeOptionalString for normalization', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.normalize).toBe(normalizeOptionalString)
    })

    it('uses parseOptionalStringPatchValue for patch parsing', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.parsePatchValue).toBe(parseOptionalStringPatchValue)
    })
  })

  describe('model', () => {
    it('has correct metadata', () => {
      const def = UNIFIED_CONFIG_FIELD_REGISTRY.model
      expect(def.key).toBe('model')
      expect(def.storageKey).toBe('model')
      expect(def.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED)
      expect(def.defaultValue).toBe(null)
      expect(def.valueType).toBe('optional-string')
      expect(def.effectLevel).toBe('restart-application')
      expect(def.rendererEditable).toBe(true)
      expect(def.runtimeProjectable).toBe(true)
      expect(def.uiSection).toBe('backend')
    })

    it('uses normalizeOptionalString for normalization', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.model.normalize).toBe(normalizeOptionalString)
    })

    it('uses parseOptionalStringPatchValue for patch parsing', () => {
      expect(UNIFIED_CONFIG_FIELD_REGISTRY.model.parsePatchValue).toBe(parseOptionalStringPatchValue)
    })
  })

  describe('type safety', () => {
    it('every field key matches its own key property', () => {
      for (const key of EXPECTED_FIELDS) {
        expect(UNIFIED_CONFIG_FIELD_REGISTRY[key].key).toBe(key)
      }
    })

    it('every field has a function for normalize', () => {
      for (const key of EXPECTED_FIELDS) {
        expect(typeof UNIFIED_CONFIG_FIELD_REGISTRY[key].normalize).toBe('function')
      }
    })

    it('every field has a function for parsePatchValue', () => {
      for (const key of EXPECTED_FIELDS) {
        expect(typeof UNIFIED_CONFIG_FIELD_REGISTRY[key].parsePatchValue).toBe('function')
      }
    })

    it('every field has a defined defaultValue', () => {
      for (const key of EXPECTED_FIELDS) {
        expect(UNIFIED_CONFIG_FIELD_REGISTRY[key].defaultValue).toBeDefined()
      }
    })

    it('all rendererEditable fields are set', () => {
      for (const key of EXPECTED_FIELDS) {
        expect(typeof UNIFIED_CONFIG_FIELD_REGISTRY[key].rendererEditable).toBe('boolean')
      }
    })

    it('all runtimeProjectable fields are set', () => {
      for (const key of EXPECTED_FIELDS) {
        expect(typeof UNIFIED_CONFIG_FIELD_REGISTRY[key].runtimeProjectable).toBe('boolean')
      }
    })
  })
})
