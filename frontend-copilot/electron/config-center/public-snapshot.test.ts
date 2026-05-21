import { describe, expect, it } from 'vitest'
import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigSnapshot,
} from './domain-schema'
import { projectConfigCenterPublicSnapshot, type ConfigCenterPublicSnapshot } from './public-snapshot'

function makeSnapshot(overrides: {
  theme?: 'light' | 'dark'
  animationsEnabled?: boolean
  agentName?: string | null
  debugModeEnabled?: boolean
  runtimeUrl?: string | null
  model?: string | null
  language?: string
} = {}): UnifiedConfigSnapshot {
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    documents: {
      [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {
          theme: overrides.theme ?? 'light',
          animationsEnabled: overrides.animationsEnabled ?? true,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        {
          agentName: overrides.agentName ?? null,
          debugModeEnabled: overrides.debugModeEnabled ?? false,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        {
          runtimeUrl: overrides.runtimeUrl ?? null,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        {
          model: overrides.model ?? null,
        },
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        {
          language: overrides.language ?? 'zh-CN',
        },
      ),
    },
  }
}

describe('projectConfigCenterPublicSnapshot', () => {
  it('has version equal to UNIFIED_CONFIG_DOCUMENT_VERSION', () => {
    const snapshot = makeSnapshot()
    const projected = projectConfigCenterPublicSnapshot(snapshot)
    expect(projected.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
  })

  describe('domains shape', () => {
    it('includes frontendPreferences, assistantBehavior, hostConfig, backendExposed, general', () => {
      const snapshot = makeSnapshot()
      const projected = projectConfigCenterPublicSnapshot(snapshot)
      expect(Object.keys(projected.domains).sort()).toEqual([
        'assistantBehavior',
        'backendExposed',
        'frontendPreferences',
        'general',
        'hostConfig',
      ])
    })
  })

  describe('frontendPreferences', () => {
    it('projects theme', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ theme: 'dark' }))
      expect(projected.domains.frontendPreferences.theme).toBe('dark')
    })

    it('projects animationsEnabled', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ animationsEnabled: false }))
      expect(projected.domains.frontendPreferences.animationsEnabled).toBe(false)
    })
  })

  describe('assistantBehavior', () => {
    it('projects agentName', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ agentName: 'planner' }))
      expect(projected.domains.assistantBehavior.agentName).toBe('planner')
    })

    it('projects debugModeEnabled', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ debugModeEnabled: true }))
      expect(projected.domains.assistantBehavior.debugModeEnabled).toBe(true)
    })

    it('allows agentName to be null', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ agentName: null }))
      expect(projected.domains.assistantBehavior.agentName).toBe(null)
    })
  })

  describe('hostConfig', () => {
    it('projects runtimeUrl', () => {
      const projected = projectConfigCenterPublicSnapshot(
        makeSnapshot({ runtimeUrl: 'http://127.0.0.1:4400' }),
      )
      expect(projected.domains.hostConfig.runtimeUrl).toBe('http://127.0.0.1:4400')
    })

    it('allows runtimeUrl to be null', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ runtimeUrl: null }))
      expect(projected.domains.hostConfig.runtimeUrl).toBe(null)
    })
  })

  describe('backendExposed', () => {
    it('projects model', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ model: 'qwen-plus' }))
      expect(projected.domains.backendExposed.model).toBe('qwen-plus')
    })

    it('allows model to be null', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ model: null }))
      expect(projected.domains.backendExposed.model).toBe(null)
    })
  })

  describe('general', () => {
    it('projects language', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot({ language: 'en-US' }))
      expect(projected.domains.general.language).toBe('en-US')
    })
  })

  describe('structure matches ConfigCenterPublicSnapshot type', () => {
    it('type-checks as a valid ConfigCenterPublicSnapshot', () => {
      const projected = projectConfigCenterPublicSnapshot(makeSnapshot())
      const result: ConfigCenterPublicSnapshot = projected
      expect(result.version).toBe(UNIFIED_CONFIG_DOCUMENT_VERSION)
    })
  })

  describe('round-trip with defaults', () => {
    it('default snapshot projects correctly', () => {
      const snapshot = makeSnapshot()
      const projected = projectConfigCenterPublicSnapshot(snapshot)

      expect(projected.domains.frontendPreferences.theme).toBe('light')
      expect(projected.domains.frontendPreferences.animationsEnabled).toBe(true)
      expect(projected.domains.assistantBehavior.agentName).toBe(null)
      expect(projected.domains.assistantBehavior.debugModeEnabled).toBe(false)
      expect(projected.domains.hostConfig.runtimeUrl).toBe(null)
      expect(projected.domains.backendExposed.model).toBe(null)
      expect(projected.domains.general.language).toBe('zh-CN')
    })
  })
})
