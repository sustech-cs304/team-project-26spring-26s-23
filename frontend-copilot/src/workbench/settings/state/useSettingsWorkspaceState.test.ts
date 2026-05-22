/** @vitest-environment jsdom */

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installSettingsWorkspaceBridge } from '../test-support/settings-workspace-test-bridge'
import { useSettingsWorkspaceState } from './useSettingsWorkspaceState'

function createProviderProfile(id: string, name: string) {
  return {
    id,
    profileId: id,
    providerId: 'openai',
    name,
    protocol: 'openai',
    endpoint: 'https://api.example.com/v1',
    baseUrl: 'https://api.example.com/v1',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    compatibility: { status: 'active' as const, reason: '' },
    extensions: {},
    availableModels: [],
  }
}

const PROVIDER_1 = createProviderProfile('openrouter', 'OpenRouter')
const PROVIDER_2 = createProviderProfile('deepseek', 'DeepSeek')

describe('useSettingsWorkspaceState', () => {
  beforeEach(() => {
    installSettingsWorkspaceBridge()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('returns the initial form state structure before hydration', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      expect(result.current.workspaceHydrated).toBe(false)
      expect(result.current.activeProviderId).toBe('openrouter')
      expect(result.current.formState.studentId).toBe('')
      expect(result.current.formState.sustechEmail).toBe('')
      expect(result.current.formState.providerProfiles).toEqual([])
      expect(result.current.formState.language).toBe('zh-CN')
      expect(result.current.formState.toolPermissionMode).toBe('manual')
      expect(result.current.formState.apiReconnectMode).toBe('exponential')
      expect(result.current.formState.primaryAssistantModel).toBe('')
      expect(result.current.formState.fastAssistantModel).toBe('')
      expect(result.current.providerSecretValues).toEqual({})
      expect(result.current.casPasswordValue).toBe('')
    })

    it('accepts an active provider id parameter', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('custom-id'))

      expect(result.current.activeProviderId).toBe('custom-id')
    })
  })

  describe('form value setters', () => {
    it('sets studentId via setStudentId', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setStudentId('2021000000')
      })

      expect(result.current.formState.studentId).toBe('2021000000')
    })

    it('sets sustechEmail via setSustechEmail', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setSustechEmail('test@sustech.edu.cn')
      })

      expect(result.current.formState.sustechEmail).toBe('test@sustech.edu.cn')
    })

    it('toggles blackboardCurrentTermOnly', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setBlackboardCurrentTermOnly(true)
      })

      expect(result.current.formState.blackboardCurrentTermOnly).toBe(true)
    })

    it('sets language', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setLanguage('en-US')
      })

      expect(result.current.formState.language).toBe('en-US')
    })

    it('toggles assistantNotificationsEnabled', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setAssistantNotificationsEnabled(true)
      })

      expect(result.current.formState.assistantNotificationsEnabled).toBe(true)
    })

    it('sets apiReconnectMode', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setApiReconnectMode('fixed')
      })

      expect(result.current.formState.apiReconnectMode).toBe('fixed')
    })

    it('sets apiBaseUrl', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setApiBaseUrl('http://localhost:9000')
      })

      expect(result.current.formState.apiBaseUrl).toBe('http://localhost:9000')
    })

    it('sets searchEngine', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setSearchEngine('bing')
      })

      expect(result.current.formState.searchEngine).toBe('bing')
    })

    it('sets searchResultCount', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setSearchResultCount('12')
      })

      expect(result.current.formState.searchResultCount).toBe('12')
    })

    it('sets compressionMode', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setCompressionMode('summary')
      })

      expect(result.current.formState.compressionMode).toBe('summary')
    })

    it('sets healthPollingEnabled', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setHealthPollingEnabled(false)
      })

      expect(result.current.formState.healthPollingEnabled).toBe(false)
    })

    it('sets mcpAutoDiscoveryEnabled', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setMcpAutoDiscoveryEnabled(false)
      })

      expect(result.current.formState.mcpAutoDiscoveryEnabled).toBe(false)
    })

    it('sets docsFormat', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setDocsFormat('html')
      })

      expect(result.current.formState.docsFormat).toBe('html')
    })

    it('sets wakeupShareLink', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setWakeupShareLink('https://example.com/share')
      })

      expect(result.current.formState.wakeupShareLink).toBe('https://example.com/share')
    })
  })

  describe('tool permission mode', () => {
    it('normalizes known legacy permission modes', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setToolPermissionMode('trusted')
      })

      expect(result.current.formState.toolPermissionMode).toBe('trusted')
      expect(result.current.formState.toolPermissionPolicy.defaultMode).toBe('allow')
      expect(result.current.formState.toolPermissionPolicy.migrationSourceMode).toBe('trusted')
    })

    it('maps strict mode to deny default', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setToolPermissionMode('strict')
      })

      expect(result.current.formState.toolPermissionMode).toBe('strict')
      expect(result.current.formState.toolPermissionPolicy.defaultMode).toBe('deny')
    })

    it('normalizes unknown permission mode to manual', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setToolPermissionMode('unknown_mode')
      })

      expect(result.current.formState.toolPermissionMode).toBe('manual')
      expect(result.current.formState.toolPermissionPolicy.defaultMode).toBe('ask')
      expect(result.current.formState.toolPermissionPolicy.migrationSourceMode).toBe('manual')
    })
  })

  describe('provider profiles', () => {
    it('sets providerProfiles with a direct value', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setProviderProfiles([PROVIDER_1, PROVIDER_2])
      })

      expect(result.current.formState.providerProfiles).toHaveLength(2)
      expect(result.current.formState.providerProfiles[0].id).toBe('openrouter')
      expect(result.current.formState.providerProfiles[1].id).toBe('deepseek')
    })

    it('sets providerProfiles with an updater function', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setProviderProfiles([PROVIDER_1])
      })

      act(() => {
        result.current.setProviderProfiles((previous) => [
          ...previous,
          PROVIDER_2,
        ])
      })

      expect(result.current.formState.providerProfiles).toHaveLength(2)
    })
  })

  describe('active provider id', () => {
    it('sets activeProviderId', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setActiveProviderId('deepseek')
      })

      expect(result.current.activeProviderId).toBe('deepseek')
    })
  })

  describe('model route serialization', () => {
    it('sets primaryAssistantModel with a plain model id', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setPrimaryAssistantModel('gpt-4')
      })

      expect(result.current.formState.primaryAssistantModel).toBe('gpt-4')
      expect(result.current.formState.primaryAssistantModelRoute).toBeNull()
    })

    it('parses a serialized route ref and sets both model and route fields', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setPrimaryAssistantModel('provider-model|openai|gpt-4o')
      })

      expect(result.current.formState.primaryAssistantModel).toBe('gpt-4o')
      expect(result.current.formState.primaryAssistantModelRoute).toEqual({
        routeKind: 'provider-model',
        profileId: 'openai',
        modelId: 'gpt-4o',
      })
    })

    it('clears route when value is empty', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setPrimaryAssistantModel('provider-model|openai|gpt-4o')
      })
      act(() => {
        result.current.setPrimaryAssistantModel('')
      })

      expect(result.current.formState.primaryAssistantModel).toBe('')
      expect(result.current.formState.primaryAssistantModelRoute).toBeNull()
    })

    it('preserves route info when updating model id within same profile', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setPrimaryAssistantModel('provider-model|openai|gpt-4o')
      })
      act(() => {
        result.current.setPrimaryAssistantModel('gpt-4-turbo')
      })

      expect(result.current.formState.primaryAssistantModel).toBe('gpt-4-turbo')
      expect(result.current.formState.primaryAssistantModelRoute).toEqual({
        routeKind: 'provider-model',
        profileId: 'openai',
        modelId: 'gpt-4-turbo',
      })
    })

    it('sets fastAssistantModel with route parsing', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setFastAssistantModel('provider-model|anthropic|claude-sonnet')
      })

      expect(result.current.formState.fastAssistantModel).toBe('claude-sonnet')
      expect(result.current.formState.fastAssistantModelRoute).toEqual({
        routeKind: 'provider-model',
        profileId: 'anthropic',
        modelId: 'claude-sonnet',
      })
    })

    it('handles functional updaters for primaryAssistantModel', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setPrimaryAssistantModel('gpt-4')
      })
      act(() => {
        result.current.setPrimaryAssistantModel((prev) => prev + '-turbo')
      })

      expect(result.current.formState.primaryAssistantModel).toBe('gpt-4-turbo')
    })

    it('handles functional updaters for fastAssistantModel', () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setFastAssistantModel('gpt-3')
      })
      act(() => {
        result.current.setFastAssistantModel((prev) => prev + '.5-turbo')
      })

      expect(result.current.formState.fastAssistantModel).toBe('gpt-3.5-turbo')
    })
  })

  describe('hydration', () => {
    it('transitions workspaceHydrated to true after hydration completes', async () => {
      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      expect(result.current.workspaceHydrated).toBe(false)

      // Hydration is async; wait for pending promises to settle
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      expect(result.current.workspaceHydrated).toBe(true)
    })

    it('skips auto-save when workspace is not yet hydrated', () => {
      const spy = vi.spyOn(window, 'setTimeout')

      const { result } = renderHook(() => useSettingsWorkspaceState('openrouter'))

      act(() => {
        result.current.setLanguage('en-US')
      })

      expect(spy).not.toHaveBeenCalled()
    })
  })
})
