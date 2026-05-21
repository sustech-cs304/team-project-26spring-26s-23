import { describe, expect, it } from 'vitest'
import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigSnapshot,
} from './domain-schema'
import { createDefaultUnifiedConfigSnapshot } from './defaults'
import { applyUnifiedConfigFieldPatch } from './patch'
import type { UnifiedConfigFieldPatch } from './field-registry'

function makeSnapshot(overrides: Partial<{
  theme: 'light' | 'dark'
  animationsEnabled: boolean
  agentName: string | null
  debugModeEnabled: boolean
  runtimeUrl: string | null
  model: string | null
  language: string
}> = {}): UnifiedConfigSnapshot {
  const defaults = createDefaultUnifiedConfigSnapshot()
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    documents: {
      [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {
          theme: overrides.theme ?? defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme,
          animationsEnabled:
            overrides.animationsEnabled ??
            defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.animationsEnabled,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        {
          agentName:
            overrides.agentName ?? defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
          debugModeEnabled:
            overrides.debugModeEnabled ??
            defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.debugModeEnabled,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        {
          runtimeUrl:
            overrides.runtimeUrl ?? defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        {
          model: overrides.model ?? defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values.model,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        {
          language: overrides.language ?? defaults.documents[UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL].values.language,
        },
      ),
    },
  }
}

describe('applyUnifiedConfigFieldPatch', () => {
  it('returns a snapshot with the same version', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const result = applyUnifiedConfigFieldPatch(snapshot, { theme: 'dark' })
    expect(result.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
  })

  it('does not mutate the original snapshot', () => {
    const snapshot = createDefaultUnifiedConfigSnapshot()
    const originalTheme = snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme
    applyUnifiedConfigFieldPatch(snapshot, { theme: 'dark' })
    expect(snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme).toBe(originalTheme)
  })

  describe('theme', () => {
    it('patches theme to dark', () => {
      const snapshot = makeSnapshot({ theme: 'light' })
      const result = applyUnifiedConfigFieldPatch(snapshot, { theme: 'dark' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme).toBe('dark')
    })

    it('normalizes invalid theme value to light', () => {
      const snapshot = makeSnapshot({ theme: 'dark' })
      const result = applyUnifiedConfigFieldPatch(snapshot, { theme: 'system' as unknown as 'light' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme).toBe('light')
    })
  })

  describe('animationsEnabled', () => {
    it('patches animationsEnabled to false', () => {
      const snapshot = makeSnapshot({ animationsEnabled: true })
      const result = applyUnifiedConfigFieldPatch(snapshot, { animationsEnabled: false })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.animationsEnabled).toBe(false)
    })

    it('normalizes invalid boolean to true', () => {
      const snapshot = makeSnapshot({ animationsEnabled: false })
      const result = applyUnifiedConfigFieldPatch(snapshot, { animationsEnabled: 'yes' as unknown as boolean })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.animationsEnabled).toBe(true)
    })
  })

  describe('agentName', () => {
    it('patches agentName', () => {
      const snapshot = makeSnapshot({ agentName: null })
      const result = applyUnifiedConfigFieldPatch(snapshot, { agentName: 'planner' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName).toBe('planner')
    })

    it('trims whitespace from agentName patch', () => {
      const snapshot = makeSnapshot({ agentName: null })
      const result = applyUnifiedConfigFieldPatch(snapshot, { agentName: '  planner  ' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName).toBe('planner')
    })

    it('normalizes empty string to null', () => {
      const snapshot = makeSnapshot({ agentName: 'planner' })
      const result = applyUnifiedConfigFieldPatch(snapshot, { agentName: '   ' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName).toBe(null)
    })
  })

  describe('debugModeEnabled', () => {
    it('patches debugModeEnabled to true', () => {
      const snapshot = makeSnapshot({ debugModeEnabled: false })
      const result = applyUnifiedConfigFieldPatch(snapshot, { debugModeEnabled: true })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.debugModeEnabled).toBe(true)
    })

    it('normalizes invalid debugModeEnabled to false', () => {
      const snapshot = makeSnapshot({ debugModeEnabled: true })
      const result = applyUnifiedConfigFieldPatch(snapshot, { debugModeEnabled: 'yes' as unknown as boolean })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.debugModeEnabled).toBe(false)
    })
  })

  describe('runtimeUrl', () => {
    it('patches runtimeUrl', () => {
      const snapshot = makeSnapshot({ runtimeUrl: null })
      const result = applyUnifiedConfigFieldPatch(snapshot, { runtimeUrl: 'http://127.0.0.1:4400' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe('http://127.0.0.1:4400')
    })

    it('trims whitespace from runtimeUrl patch', () => {
      const snapshot = makeSnapshot({ runtimeUrl: null })
      const result = applyUnifiedConfigFieldPatch(snapshot, { runtimeUrl: '  http://127.0.0.1:4400  ' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe('http://127.0.0.1:4400')
    })
  })

  describe('model', () => {
    it('patches model', () => {
      const snapshot = makeSnapshot({ model: null })
      const result = applyUnifiedConfigFieldPatch(snapshot, { model: 'qwen-plus' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values.model).toBe('qwen-plus')
    })

    it('trims whitespace from model patch', () => {
      const snapshot = makeSnapshot({ model: null })
      const result = applyUnifiedConfigFieldPatch(snapshot, { model: '  qwen-plus  ' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values.model).toBe('qwen-plus')
    })
  })

  describe('multiple fields in one patch', () => {
    it('applies multiple field patches at once', () => {
      const snapshot = makeSnapshot({
        theme: 'light',
        animationsEnabled: true,
        agentName: null,
      })
      const result = applyUnifiedConfigFieldPatch(snapshot, {
        theme: 'dark',
        animationsEnabled: false,
        agentName: 'planner',
      })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme).toBe('dark')
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.animationsEnabled).toBe(false)
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName).toBe('planner')
    })

    it('cross-domain patches are applied independently', () => {
      const snapshot = makeSnapshot({
        theme: 'light',
        runtimeUrl: null,
        model: null,
      })
      const result = applyUnifiedConfigFieldPatch(snapshot, {
        theme: 'dark',
        runtimeUrl: 'http://127.0.0.1:4400',
        model: 'qwen-plus',
      })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme).toBe('dark')
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl).toBe('http://127.0.0.1:4400')
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values.model).toBe('qwen-plus')
    })
  })

  describe('empty patch', () => {
    it('returns a structurally equivalent snapshot', () => {
      const snapshot = createDefaultUnifiedConfigSnapshot()
      const result = applyUnifiedConfigFieldPatch(snapshot, {} as UnifiedConfigFieldPatch)
      expect(result).toEqual(snapshot)
    })

    it('does not mutate the original on empty patch', () => {
      const snapshot = createDefaultUnifiedConfigSnapshot()
      const result = applyUnifiedConfigFieldPatch(snapshot, {} as UnifiedConfigFieldPatch)
      expect(result).not.toBe(snapshot)
    })
  })

  describe('general document preservation', () => {
    it('preserves the GENERAL domain document unchanged', () => {
      const snapshot = makeSnapshot({ language: 'en-US' })
      const result = applyUnifiedConfigFieldPatch(snapshot, { theme: 'dark' })
      expect(result.documents[UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL]).toEqual(
        snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL],
      )
    })
  })
})
