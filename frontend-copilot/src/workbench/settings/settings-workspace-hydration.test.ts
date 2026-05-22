/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installSettingsWorkspaceBridge } from './test-support/settings-workspace-test-bridge'
import { createPersistedWorkspaceState } from './test-support/settings-workspace-test-fixtures'
import {
  loadSettingsWorkspaceHydration,
  projectLoadedProviderSecretValues,
} from './settings-workspace-hydration'
import type { SettingsWorkspaceFormState } from './settings-workspace-form-state'

describe('projectLoadedProviderSecretValues', () => {
  it('returns entries for providers with non-empty api keys', () => {
    const result = projectLoadedProviderSecretValues({
      providerA: { apiKey: 'secret-a' },
      providerB: { apiKey: 'secret-b' },
    })

    expect(result).toEqual({
      providerA: 'secret-a',
      providerB: 'secret-b',
    })
  })

  it('omits providers with empty api keys', () => {
    const result = projectLoadedProviderSecretValues({
      providerA: { apiKey: 'secret-a' },
      providerB: { apiKey: '' },
      providerC: { apiKey: 'secret-c' },
    })

    expect(result).toEqual({
      providerA: 'secret-a',
      providerC: 'secret-c',
    })
    expect(result.providerB).toBeUndefined()
  })

  it('returns empty object for empty input', () => {
    const result = projectLoadedProviderSecretValues({})

    expect(result).toEqual({})
  })

  it('returns empty object when all api keys are empty', () => {
    const result = projectLoadedProviderSecretValues({
      providerA: { apiKey: '' },
      providerB: { apiKey: '' },
    })

    expect(result).toEqual({})
  })
})

describe('loadSettingsWorkspaceHydration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when state load fails', async () => {
    installSettingsWorkspaceBridge({
      loadStateResult: { ok: false, error: 'Load failed' },
    })

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result).toBeNull()
  })

  it('returns hydrated state when state load succeeds', async () => {
    installSettingsWorkspaceBridge()

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result).not.toBeNull()
    expect(result!.state).toBeDefined()
    expect(result!.activeProviderId).toBeDefined()
  })

  it('transforms persisted state into form state', async () => {
    installSettingsWorkspaceBridge()

    const result = await loadSettingsWorkspaceHydration('openrouter')

    const formState = result!.state as SettingsWorkspaceFormState
    expect(formState.studentId).toBe('')
    expect(formState.sustechEmail).toBe('')
    expect(formState.language).toBe('zh-CN')
    expect(formState.providerProfiles).toHaveLength(1)
    expect(formState.providerProfiles[0].id).toBe('openrouter')
    expect(formState.apiReconnectMode).toBe('exponential')
    expect(formState.toolPermissionMode).toBe('manual')
    expect(formState.primaryAssistantModel).toBe('openai/gpt-4.1')
    expect(formState.fastAssistantModel).toBe('openai/gpt-4.1-mini')
  })

  it('includes provider secret values when secrets load succeeds', async () => {
    installSettingsWorkspaceBridge()

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result!.providerSecretValues).toEqual({
      openrouter: 'persisted-secret',
    })
  })

  it('returns empty secret values when secrets load fails', async () => {
    installSettingsWorkspaceBridge({
      loadStatusesResult: { ok: false, error: 'Secrets unavailable' },
    })

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result!.providerSecretValues).toEqual({})
  })

  it('includes CAS password when password load succeeds', async () => {
    installSettingsWorkspaceBridge({
      loadSustechCasPasswordResult: {
        ok: true,
        state: { hasPassword: true, password: 'cas-secret-123' },
      },
    })

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result!.casPasswordValue).toBe('cas-secret-123')
  })

  it('returns empty CAS password when password load fails', async () => {
    installSettingsWorkspaceBridge({
      loadSustechCasPasswordResult: {
        ok: false,
        error: 'CAS password unavailable',
      },
    })

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result!.casPasswordValue).toBe('')
  })

  it('resolves active provider id from persisted state', async () => {
    installSettingsWorkspaceBridge()

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result!.activeProviderId).toBe('openrouter')
  })

  it('falls back to first provider when current active provider is not found', async () => {
    const persistedState = createPersistedWorkspaceState()

    installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: persistedState,
      },
    })

    const result = await loadSettingsWorkspaceHydration('nonexistent-provider')

    expect(result!.activeProviderId).toBe('openrouter')
  })

  it('sets provider secret values from secret statuses result', async () => {
    installSettingsWorkspaceBridge()

    const result = await loadSettingsWorkspaceHydration('openrouter')

    expect(result!.providerSecretValues.openrouter).toBe('persisted-secret')
  })

  it('loads secrets in parallel with form state', async () => {
    const { loadState, loadStatuses, loadSustechCasPassword } = installSettingsWorkspaceBridge()

    await loadSettingsWorkspaceHydration('openrouter')

    expect(loadState).toHaveBeenCalled()
    expect(loadStatuses).toHaveBeenCalled()
    expect(loadSustechCasPassword).toHaveBeenCalled()
  })
})
