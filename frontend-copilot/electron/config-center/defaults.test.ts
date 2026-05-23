import { describe, expect, it } from 'vitest'
import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  UNIFIED_CONFIG_DOMAIN_LIST,
  type UnifiedConfigDomainKey,
} from './domain-schema'
import { createDefaultUnifiedConfigDomainDocument, createDefaultUnifiedConfigSnapshot } from './defaults'

describe('createDefaultUnifiedConfigDomainDocument', () => {
  describe('FRONTEND_PREFERENCES domain', () => {
    it('returns expected default document', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES)
      expect(doc).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES, {
          theme: 'light',
          animationsEnabled: true,
        }),
      )
    })

    it('version matches UNIFIED_CONFIG_DOCUMENT_VERSION', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES)
      expect(doc.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
    })

    it('domain matches the requested domain', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES)
      expect(doc.domain).toBe(UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES)
    })
  })

  describe('ASSISTANT_BEHAVIOR domain', () => {
    it('returns expected default document', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR)
      expect(doc).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR, {
          agentName: null,
          debugModeEnabled: false,
        }),
      )
    })
  })

  describe('HOST_CONFIG domain', () => {
    it('returns expected default document', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG)
      expect(doc).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG, {
          runtimeUrl: null,
        }),
      )
    })
  })

  describe('BACKEND_EXPOSED domain', () => {
    it('returns expected default document', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED)
      expect(doc).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED, {
          model: null,
        }),
      )
    })
  })

  describe('GENERAL domain', () => {
    it('returns expected default document', () => {
      const doc = createDefaultUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL)
      expect(doc).toEqual(
        createUnifiedConfigDomainDocument(UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL, {
          language: 'zh-CN',
        }),
      )
    })
  })

  it('throws for unsupported domain', () => {
    expect(() =>
      createDefaultUnifiedConfigDomainDocument('nonexistent' as never),
    ).toThrow('Unsupported unified config domain: nonexistent')
  })

  it('produces documents for all known domains', () => {
    for (const domain of UNIFIED_CONFIG_DOMAIN_LIST) {
      const doc = createDefaultUnifiedConfigDomainDocument(domain)
      expect(doc.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
      expect(doc.domain).toBe(domain)
      expect(doc.values).toBeDefined()
    }
  })
})

describe('createDefaultUnifiedConfigSnapshot', () => {
  it('has version equal to UNIFIED_CONFIG_DOCUMENT_VERSION', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    expect(snapshot.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
  })

  it('contains documents for all known domains', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const snapshotDomains = Object.keys(snapshot.documents) as UnifiedConfigDomainKey[]

    for (const domain of UNIFIED_CONFIG_DOMAIN_LIST) {
      expect(snapshotDomains).toContain(domain)
    }
    expect(snapshotDomains.length).toBe(UNIFIED_CONFIG_DOMAIN_LIST.length)
  })

  it('each domain document matches its standalone default', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()

    for (const domain of UNIFIED_CONFIG_DOMAIN_LIST) {
      expect(snapshot.documents[domain]).toEqual(
        createDefaultUnifiedConfigDomainDocument(domain),
      )
    }
  })

  it('FRONTEND_PREFERENCES defaults are correct', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const fp = snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values
    expect(fp.theme).toBe('light')
    expect(fp.animationsEnabled).toBe(true)
  })

  it('ASSISTANT_BEHAVIOR defaults are correct', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const ab = snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values
    expect(ab.agentName).toBe(null)
    expect(ab.debugModeEnabled).toBe(false)
  })

  it('HOST_CONFIG defaults are correct', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const hc = snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values
    expect(hc.runtimeUrl).toBe(null)
  })

  it('BACKEND_EXPOSED defaults are correct', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const be = snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values
    expect(be.model).toBe(null)
  })

  it('GENERAL defaults are correct', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const g = snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL].values
    expect(g.language).toBe('zh-CN')
  })
})
