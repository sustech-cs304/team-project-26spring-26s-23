import { describe, expect, it } from 'vitest'
import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  UNIFIED_CONFIG_DOCUMENT_VERSION,
} from './domain-schema'
import { normalizeUnifiedConfigDomainDocument } from './normalize'

function makeRawDocument(values: unknown) {
  return { values }
}

describe('normalizeUnifiedConfigDomainDocument', () => {
  describe('FRONTEND_PREFERENCES domain', () => {
    it('normalizes a well-formed input', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        makeRawDocument({
          theme: 'dark',
          animationsEnabled: false,
        }),
      )
      expect(result).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'dark',
          animationsEnabled: false,
        }),
      )
      expect(result.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
    })

    it('coerces invalid theme to "light"', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        makeRawDocument({
          theme: 'system',
          animationsEnabled: true,
        }),
      )
      expect(result.values.theme).toBe('light')
    })

    it('coerces invalid animationsEnabled to true', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        makeRawDocument({
          theme: 'light',
          animationsEnabled: 'yes',
        }),
      )
      expect(result.values.animationsEnabled).toBe(true)
    })

    it('normalizes missing values to defaults', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        makeRawDocument({}),
      )
      expect(result.values.theme).toBe('light')
      expect(result.values.animationsEnabled).toBe(true)
    })

    it('handles null input as empty object', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        null,
      )
      expect(result.values.theme).toBe('light')
      expect(result.values.animationsEnabled).toBe(true)
    })

    it('handles undefined input as empty object', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        undefined,
      )
      expect(result.values.theme).toBe('light')
      expect(result.values.animationsEnabled).toBe(true)
    })

    it('handles missing values property', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {},
      )
      expect(result.values.theme).toBe('light')
      expect(result.values.animationsEnabled).toBe(true)
    })
  })

  describe('ASSISTANT_BEHAVIOR domain', () => {
    it('normalizes a well-formed input', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        makeRawDocument({
          agentName: 'planner',
          debugModeEnabled: false,
        }),
      )
      expect(result).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: 'planner',
          debugModeEnabled: false,
        }),
      )
    })

    it('trims whitespace from agentName', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        makeRawDocument({
          agentName: '  planner  ',
          debugModeEnabled: false,
        }),
      )
      expect(result.values.agentName).toBe('planner')
    })

    it('coerces empty agentName to null', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        makeRawDocument({
          agentName: '   ',
          debugModeEnabled: false,
        }),
      )
      expect(result.values.agentName).toBe(null)
    })

    it('coerces invalid debugModeEnabled to false', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        makeRawDocument({
          debugModeEnabled: 'yes',
        }),
      )
      expect(result.values.debugModeEnabled).toBe(false)
    })

    it('handles null input', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        null,
      )
      expect(result.values.agentName).toBe(null)
      expect(result.values.debugModeEnabled).toBe(false)
    })
  })

  describe('HOST_CONFIG domain', () => {
    it('normalizes a well-formed input', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        makeRawDocument({
          runtimeUrl: 'http://127.0.0.1:4400',
        }),
      )
      expect(result).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: 'http://127.0.0.1:4400',
        }),
      )
    })

    it('trims whitespace from runtimeUrl', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        makeRawDocument({
          runtimeUrl: '  http://127.0.0.1:4400  ',
        }),
      )
      expect(result.values.runtimeUrl).toBe('http://127.0.0.1:4400')
    })

    it('coerces empty runtimeUrl to null', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        makeRawDocument({
          runtimeUrl: '',
        }),
      )
      expect(result.values.runtimeUrl).toBe(null)
    })
  })

  describe('BACKEND_EXPOSED domain', () => {
    it('normalizes a well-formed input', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        makeRawDocument({
          model: 'qwen-plus',
        }),
      )
      expect(result).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED, {
          model: 'qwen-plus',
        }),
      )
    })

    it('trims whitespace from model', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        makeRawDocument({
          model: '  qwen-plus  ',
        }),
      )
      expect(result.values.model).toBe('qwen-plus')
    })
  })

  describe('GENERAL domain', () => {
    it('normalizes a well-formed input', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        makeRawDocument({
          language: 'en-US',
        }),
      )
      expect(result).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL, {
          language: 'en-US',
        }),
      )
    })

    it('trims whitespace from language', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        makeRawDocument({
          language: '  en-US  ',
        }),
      )
      expect(result.values.language).toBe('en-US')
    })

    it('falls back to "zh-CN" when language is empty', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        makeRawDocument({
          language: '',
        }),
      )
      expect(result.values.language).toBe('zh-CN')
    })

    it('falls back to "zh-CN" when language is missing', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        makeRawDocument({}),
      )
      expect(result.values.language).toBe('zh-CN')
    })

    it('falls back to "zh-CN" when language is not a string', () => {
      const result = normalizeUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        makeRawDocument({
          language: 42,
        }),
      )
      expect(result.values.language).toBe('zh-CN')
    })
  })

  it('throws for unsupported domain', () => {
    expect(() =>
      normalizeUnifiedConfigDomainDocument(
        'nonexistent' as never,
        makeRawDocument({}),
      ),
    ).toThrow('Unsupported unified config domain: nonexistent')
  })

  it('sets version on all output documents', () => {
    const domains = [
      UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
      UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
      UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
      UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
      UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
    ]

    for (const domain of domains) {
      const result = normalizeUnifiedConfigDomainDocument(domain, null)
      expect(result.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
    }
  })

  it('sets the domain field on all output documents', () => {
    const domains = [
      UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
      UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
      UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
      UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
      UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
    ]

    for (const domain of domains) {
      const result = normalizeUnifiedConfigDomainDocument(domain, null)
      expect(result.domain).toBe(domain)
    }
  })
})
