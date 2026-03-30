import type {
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSecretsApi,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateApi,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from '../../../electron/settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'
import { vi } from 'vitest'

import {
  createPersistedSecretStatesResult,
  createPersistedWorkspaceState,
} from './settings-workspace-test-fixtures'

export interface InstallSettingsWorkspaceBridgeOptions {
  loadStateResult?: SettingsWorkspaceStateLoadResult
  saveStateResult?: SettingsWorkspaceStateSaveResult
  loadStatusesResult?: SettingsWorkspaceSecretsLoadStatusesResult
  loadSustechCasPasswordResult?: SettingsWorkspaceSustechCasSecretLoadResult
  saveProviderApiKeyResult?: SettingsWorkspaceProviderSecretMutationResult
  clearProviderApiKeyResult?: SettingsWorkspaceProviderSecretMutationResult
  saveSustechCasPasswordResult?: SettingsWorkspaceSustechCasSecretMutationResult
  clearSustechCasPasswordResult?: SettingsWorkspaceSustechCasSecretMutationResult
}

export function installSettingsWorkspaceBridge(options: InstallSettingsWorkspaceBridgeOptions = {}) {
  const loadState = vi.fn<() => Promise<SettingsWorkspaceStateLoadResult>>().mockResolvedValue(
    options.loadStateResult ?? {
      ok: true,
      source: 'stored',
      state: createPersistedWorkspaceState(),
    },
  )
  const saveState = vi.fn<(input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>>().mockImplementation(
    async () => options.saveStateResult ?? { ok: true, state: createPersistedWorkspaceState() },
  )
  const loadStatuses = vi.fn<SettingsWorkspaceSecretsApi['loadStatuses']>().mockResolvedValue(
    options.loadStatusesResult ?? createPersistedSecretStatesResult(),
  )
  const loadSustechCasPassword = vi.fn<SettingsWorkspaceSecretsApi['loadSustechCasPassword']>().mockResolvedValue(
    options.loadSustechCasPasswordResult ?? {
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    },
  )
  const saveProviderApiKey = vi.fn<SettingsWorkspaceSecretsApi['saveProviderApiKey']>().mockResolvedValue(
    options.saveProviderApiKeyResult ?? {
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: true,
        apiKey: 'persisted-secret',
      },
    },
  )
  const clearProviderApiKey = vi.fn<SettingsWorkspaceSecretsApi['clearProviderApiKey']>().mockResolvedValue(
    options.clearProviderApiKeyResult ?? {
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    },
  )
  const saveSustechCasPassword = vi.fn<SettingsWorkspaceSecretsApi['saveSustechCasPassword']>().mockResolvedValue(
    options.saveSustechCasPasswordResult ?? {
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    },
  )
  const clearSustechCasPassword = vi.fn<SettingsWorkspaceSecretsApi['clearSustechCasPassword']>().mockResolvedValue(
    options.clearSustechCasPasswordResult ?? {
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    },
  )

  const stateApi: SettingsWorkspaceStateApi = {
    load: loadState,
    save: saveState,
  }
  const secretsApi: SettingsWorkspaceSecretsApi = {
    loadStatuses,
    loadSustechCasPassword,
    saveProviderApiKey,
    clearProviderApiKey,
    saveSustechCasPassword,
    clearSustechCasPassword,
  }

  Object.assign(window, {
    settingsWorkspaceState: stateApi,
    settingsWorkspaceSecrets: secretsApi,
  })

  return {
    stateApi,
    secretsApi,
    loadState,
    saveState,
    loadStatuses,
    loadSustechCasPassword,
    saveProviderApiKey,
    clearProviderApiKey,
    saveSustechCasPassword,
    clearSustechCasPassword,
  }
}
