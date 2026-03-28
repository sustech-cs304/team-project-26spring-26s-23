import type {
  SettingsWorkspaceApiFailure,
  SettingsWorkspaceClearProviderApiKeyRequest,
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSaveSustechCasPasswordRequest,
  SettingsWorkspaceSaveProviderApiKeyRequest,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
  SettingsWorkspaceSecretsApi,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateApi,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
} from '../../../electron/settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/state-schema'

const STATE_API_UNAVAILABLE_ERROR = 'window.settingsWorkspaceState is unavailable in the renderer process.'
const SECRETS_API_UNAVAILABLE_ERROR = 'window.settingsWorkspaceSecrets is unavailable in the renderer process.'

function getSettingsWorkspaceStateApi(): SettingsWorkspaceStateApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.settingsWorkspaceState
}

function getSettingsWorkspaceSecretsApi(): SettingsWorkspaceSecretsApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.settingsWorkspaceSecrets
}

export async function loadSettingsWorkspaceState(): Promise<SettingsWorkspaceStateLoadResult> {
  const api = getSettingsWorkspaceStateApi()
  return api ? api.load() : createFailureResult(STATE_API_UNAVAILABLE_ERROR)
}

export async function saveSettingsWorkspaceState(
  input: SettingsWorkspaceStateSaveInput,
): Promise<SettingsWorkspaceStateSaveResult> {
  const api = getSettingsWorkspaceStateApi()
  return api ? api.save(input) : createFailureResult(STATE_API_UNAVAILABLE_ERROR)
}

export async function loadSettingsWorkspaceSecretStatuses(
  request?: SettingsWorkspaceSecretsLoadStatusesRequest,
): Promise<SettingsWorkspaceSecretsLoadStatusesResult> {
  const api = getSettingsWorkspaceSecretsApi()
  return api ? api.loadStatuses(request) : createFailureResult(SECRETS_API_UNAVAILABLE_ERROR)
}

export async function loadSettingsWorkspaceSustechCasPassword(): Promise<SettingsWorkspaceSustechCasSecretLoadResult> {
  const api = getSettingsWorkspaceSecretsApi()
  return api ? api.loadSustechCasPassword() : createFailureResult(SECRETS_API_UNAVAILABLE_ERROR)
}

export async function saveSettingsWorkspaceProviderApiKey(
  request: SettingsWorkspaceSaveProviderApiKeyRequest,
): Promise<SettingsWorkspaceProviderSecretMutationResult> {
  const api = getSettingsWorkspaceSecretsApi()
  return api ? api.saveProviderApiKey(request) : createFailureResult(SECRETS_API_UNAVAILABLE_ERROR)
}

export async function clearSettingsWorkspaceProviderApiKey(
  request: SettingsWorkspaceClearProviderApiKeyRequest,
): Promise<SettingsWorkspaceProviderSecretMutationResult> {
  const api = getSettingsWorkspaceSecretsApi()
  return api ? api.clearProviderApiKey(request) : createFailureResult(SECRETS_API_UNAVAILABLE_ERROR)
}

export async function saveSettingsWorkspaceSustechCasPassword(
  request: SettingsWorkspaceSaveSustechCasPasswordRequest,
): Promise<SettingsWorkspaceSustechCasSecretMutationResult> {
  const api = getSettingsWorkspaceSecretsApi()
  return api ? api.saveSustechCasPassword(request) : createFailureResult(SECRETS_API_UNAVAILABLE_ERROR)
}

export async function clearSettingsWorkspaceSustechCasPassword(): Promise<SettingsWorkspaceSustechCasSecretMutationResult> {
  const api = getSettingsWorkspaceSecretsApi()
  return api ? api.clearSustechCasPassword() : createFailureResult(SECRETS_API_UNAVAILABLE_ERROR)
}

function createFailureResult<TResult extends SettingsWorkspaceApiFailure>(error: string): TResult {
  return {
    ok: false,
    error,
  } as TResult
}
