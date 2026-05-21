/** @vitest-environment jsdom */

import { act } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installSettingsWorkspaceBridge } from '../../test-support/settings-workspace-test-bridge'
import { useSettingsWorkspaceProviderSecrets } from './useProviderSecretsState'
import type { ProviderProfile } from '../../../types'

function createMockProvider(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'openrouter',
    profileId: 'openrouter',
    providerId: 'openai',
    name: 'OpenRouter',
    protocol: 'openai',
    endpoint: 'https://api.openrouter.ai/v1',
    baseUrl: 'https://api.openrouter.ai/v1',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    compatibility: { status: 'active' as const, reason: '' },
    extensions: {},
    availableModels: [],
    ...overrides,
  }
}

describe('useSettingsWorkspaceProviderSecrets', () => {
  let setProviderProfiles: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setProviderProfiles = vi.fn()
    // Set up clipboard mock on navigator
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderSecretsHook(opts: {
    language?: string
    activeProviderId?: string
    activeProvider?: ProviderProfile | null
    hydratedProviderSecretValues?: Record<string, string>
  } = {}) {
    return renderHook(
      ({ language, activeProviderId, activeProvider, hydratedProviderSecretValues }) =>
        useSettingsWorkspaceProviderSecrets({
          language,
          activeProviderId,
          activeProvider,
          hydratedProviderSecretValues,
          setProviderProfiles,
        }),
      {
        initialProps: {
          language: opts.language ?? 'zh-CN',
          activeProviderId: opts.activeProviderId ?? 'openrouter',
          activeProvider: opts.activeProvider !== undefined ? opts.activeProvider : createMockProvider(),
          hydratedProviderSecretValues: opts.hydratedProviderSecretValues ?? {},
        },
      },
    )
  }

  describe('initial state', () => {
    it('returns empty api key draft when no hydrated values', () => {
      const { result } = renderSecretsHook()

      expect(result.current.activeProviderApiKeyDraft).toBe('')
      expect(result.current.apiKeyVisible).toBe(false)
      expect(result.current.apiKeyFeedback).toBeNull()
    })

    it('populates draft and saved values from hydrated secrets', () => {
      const { result } = renderSecretsHook({
        hydratedProviderSecretValues: { openrouter: 'sk-initial-key' },
      })

      expect(result.current.activeProviderApiKeyDraft).toBe('sk-initial-key')
    })
  })

  describe('draft changes', () => {
    it('updates provider api key draft for a given provider id', () => {
      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-new-key')
      })

      expect(result.current.activeProviderApiKeyDraft).toBe('sk-new-key')
    })

    it('returns empty draft when active provider is null', () => {
      const { result } = renderSecretsHook({
        activeProvider: null,
      })

      expect(result.current.activeProviderApiKeyDraft).toBe('')
    })
  })

  describe('api key visibility toggle', () => {
    it('toggles apiKeyVisible from false to true', () => {
      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleToggleApiKeyVisibility()
      })

      expect(result.current.apiKeyVisible).toBe(true)
    })

    it('toggles apiKeyVisible back to false', () => {
      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleToggleApiKeyVisibility()
      })
      act(() => {
        result.current.handleToggleApiKeyVisibility()
      })

      expect(result.current.apiKeyVisible).toBe(false)
    })

    it('resets apiKeyVisible when activeProviderId changes', () => {
      const { result, rerender } = renderSecretsHook()

      act(() => {
        result.current.handleToggleApiKeyVisibility()
      })
      expect(result.current.apiKeyVisible).toBe(true)

      rerender({
        language: 'zh-CN',
        activeProviderId: 'deepseek',
        activeProvider: createMockProvider({ id: 'deepseek' }),
        hydratedProviderSecretValues: {},
      })

      expect(result.current.apiKeyVisible).toBe(false)
    })

    it('resets apiKeyFeedback when activeProviderId changes', () => {
      const { result, rerender } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-test')
      })

      rerender({
        language: 'zh-CN',
        activeProviderId: 'deepseek',
        activeProvider: createMockProvider({ id: 'deepseek' }),
        hydratedProviderSecretValues: {},
      })

      expect(result.current.apiKeyFeedback).toBeNull()
    })
  })

  describe('copy api key', () => {
    it('copies api key to clipboard', async () => {
      const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: clipboardWriteText },
      })

      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-copy-me')
      })

      await act(async () => {
        await result.current.handleCopyApiKey()
      })

      expect(clipboardWriteText).toHaveBeenCalledWith('sk-copy-me')
      expect(result.current.apiKeyFeedback).toBe('已复制 API 密钥')
    })

    it('shows nothingToCopy feedback when draft is empty', async () => {
      const { result } = renderSecretsHook()

      await act(async () => {
        await result.current.handleCopyApiKey()
      })

      expect(result.current.apiKeyFeedback).toBe('当前没有可复制的 API 密钥')
    })

    it('shows nothingToCopy when draft is only whitespace', async () => {
      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', '   ')
      })

      await act(async () => {
        await result.current.handleCopyApiKey()
      })

      expect(result.current.apiKeyFeedback).toBe('当前没有可复制的 API 密钥')
    })

    it('returns early when activeProvider is null', async () => {
      const { result } = renderSecretsHook({
        activeProvider: null,
      })

      await act(async () => {
        await result.current.handleCopyApiKey()
      })

      expect(result.current.apiKeyFeedback).toBeNull()
    })
  })

  describe('persist api key', () => {
    it('persists api key via IPC and updates saved values', async () => {
      const { saveProfileApiKey } = installSettingsWorkspaceBridge({
        saveProfileApiKeyResult: {
          ok: true,
          profileId: 'openrouter',
          state: { hasApiKey: true, apiKey: 'sk-persisted' },
        },
      })

      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-persisted')
      })

      await act(async () => {
        await result.current.handlePersistProviderApiKeyDraft('openrouter')
      })

      expect(saveProfileApiKey).toHaveBeenCalledWith({
        profileId: 'openrouter',
        apiKey: 'sk-persisted',
      })
      expect(result.current.getProviderSecretValue('openrouter')).toBe('sk-persisted')
      expect(result.current.apiKeyFeedback).toBe('已自动保存 API 密钥')
    })

    it('does not call IPC when draft equals saved value', async () => {
      const { saveProfileApiKey } = installSettingsWorkspaceBridge()

      const { result } = renderSecretsHook({
        hydratedProviderSecretValues: { openrouter: 'sk-existing' },
      })

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-existing')
      })

      await act(async () => {
        await result.current.handlePersistProviderApiKeyDraft('openrouter')
      })

      expect(saveProfileApiKey).not.toHaveBeenCalled()
    })

    it('returns early when draft is undefined', async () => {
      const { saveProfileApiKey } = installSettingsWorkspaceBridge()

      const { result } = renderSecretsHook()

      await act(async () => {
        await result.current.handlePersistProviderApiKeyDraft('nonexistent')
      })

      expect(saveProfileApiKey).not.toHaveBeenCalled()
    })
  })

  describe('getProviderSecretValue', () => {
    it('returns saved value if available', () => {
      const { result } = renderSecretsHook({
        hydratedProviderSecretValues: { openrouter: 'sk-saved' },
      })

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-draft')
      })

      expect(result.current.getProviderSecretValue('openrouter')).toBe('sk-saved')
    })

    it('falls back to draft when no saved value', () => {
      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-only-draft')
      })

      expect(result.current.getProviderSecretValue('openrouter')).toBe('sk-only-draft')
    })

    it('returns empty string for unknown provider', () => {
      const { result } = renderSecretsHook()

      expect(result.current.getProviderSecretValue('unknown')).toBe('')
    })
  })

  describe('removeProviderSecret', () => {
    it('removes provider secret from draft and saved values', async () => {
      const { clearProfileApiKey } = installSettingsWorkspaceBridge({
        clearProfileApiKeyResult: {
          ok: true,
          profileId: 'openrouter',
          state: { hasApiKey: false, apiKey: '' },
        },
      })

      const { result } = renderSecretsHook({
        hydratedProviderSecretValues: { openrouter: 'sk-to-remove' },
      })

      await act(async () => {
        await result.current.removeProviderSecret('openrouter')
      })

      expect(clearProfileApiKey).toHaveBeenCalledWith({ profileId: 'openrouter' })
      expect(result.current.getProviderSecretValue('openrouter')).toBe('')
    })

    it('returns true when secret was already empty', async () => {
      const { result } = renderSecretsHook()

      let returnedValue = false

      await act(async () => {
        returnedValue = await result.current.removeProviderSecret('openrouter')
      })

      expect(returnedValue).toBe(true)
    })
  })

  describe('syncCopiedProviderApiKey', () => {
    it('saves api key for duplicated provider', async () => {
      const { saveProfileApiKey } = installSettingsWorkspaceBridge({
        saveProfileApiKeyResult: {
          ok: true,
          profileId: 'new-provider',
          state: { hasApiKey: true, apiKey: 'sk-synced' },
        },
      })

      const { result } = renderSecretsHook()

      await act(async () => {
        await result.current.syncCopiedProviderApiKey('new-provider', 'sk-synced')
      })

      expect(saveProfileApiKey).toHaveBeenCalledWith({
        profileId: 'new-provider',
        apiKey: 'sk-synced',
      })
    })

    it('returns true when apiKey is empty', async () => {
      const { result } = renderSecretsHook()

      const returned = await act(async () =>
        result.current.syncCopiedProviderApiKey('some-provider', ''))

      expect(returned).toBe(true)
    })
  })

  describe('api key feedback auto-clear', () => {
    it('automatically clears feedback after 2 seconds', async () => {
      vi.useFakeTimers()

      const { result } = renderSecretsHook()

      act(() => {
        result.current.handleProviderApiKeyDraftChange('openrouter', 'sk-test')
      })

      // Set feedback directly through copy (which sets feedback)
      const clipboardWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: { writeText: clipboardWriteText },
      })

      await act(async () => {
        await result.current.handleCopyApiKey()
      })

      expect(result.current.apiKeyFeedback).toBe('已复制 API 密钥')

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(result.current.apiKeyFeedback).toBeNull()

      vi.useRealTimers()
    })
  })
})
