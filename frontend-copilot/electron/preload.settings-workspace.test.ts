import { describe, expect, it } from 'vitest'

import { normalizeSettingsWorkspaceStateValues } from './settings-workspace/state-schema'

import {
  SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL,
  SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL,
  SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
  type SettingsWorkspaceSecretsApi,
  type SettingsWorkspaceStateApi,
} from './settings-workspace/ipc'
import {
  createSettingsWorkspaceStateFixture,
  getExposedApi,
  getInvokeMock,
  loadPreloadModule,
} from './preload.test-support'

describe('preload settings workspace bridge', () => {
  it('routes settings workspace state APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const settingsWorkspaceStateApi = getExposedApi<SettingsWorkspaceStateApi>('settingsWorkspaceState')
    const state = createSettingsWorkspaceStateFixture()
    const saveInput = normalizeSettingsWorkspaceStateValues(state)

    await settingsWorkspaceStateApi.load()
    await settingsWorkspaceStateApi.save(saveInput)

    expect(invokeMock.mock.calls).toEqual([
      [SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL],
      [SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL, saveInput],
    ])
  })

  it('routes settings workspace secrets APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const settingsWorkspaceSecretsApi = getExposedApi<SettingsWorkspaceSecretsApi>('settingsWorkspaceSecrets')

    await settingsWorkspaceSecretsApi.loadStatuses({ profileIds: ['openrouter'] })
    await settingsWorkspaceSecretsApi.loadSustechCasPassword()
    await settingsWorkspaceSecretsApi.saveProfileApiKey({ profileId: 'openrouter', apiKey: 'draft-secret' })
    await settingsWorkspaceSecretsApi.clearProfileApiKey({ profileId: 'openrouter' })
    await settingsWorkspaceSecretsApi.saveSustechCasPassword({ password: 'cas-secret' })
    await settingsWorkspaceSecretsApi.clearSustechCasPassword()

    expect(invokeMock.mock.calls).toEqual([
      [SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL, { profileIds: ['openrouter'] }],
      [SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL],
      [SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL, { profileId: 'openrouter', apiKey: 'draft-secret' }],
      [SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL, { profileId: 'openrouter' }],
      [SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL, { password: 'cas-secret' }],
      [SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL],
    ])
  })
})
