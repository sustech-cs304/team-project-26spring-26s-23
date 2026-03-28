import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceProviderSecretState,
  SettingsWorkspaceProviderSecretStateById,
  SettingsWorkspaceStateSaveInput,
  SettingsWorkspaceStateSource,
} from './schema'

export const SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL = 'settings-workspace-state:load'
export const SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL = 'settings-workspace-state:save'
export const SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL = 'settings-workspace-secrets:load-statuses'
export const SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL = 'settings-workspace-secrets:save-provider-api-key'
export const SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL = 'settings-workspace-secrets:clear-provider-api-key'

export interface SettingsWorkspaceStateLoadSuccess {
  ok: true
  source: SettingsWorkspaceStateSource
  state: SettingsWorkspaceEditableState
}

export interface SettingsWorkspaceStateSaveSuccess {
  ok: true
  state: SettingsWorkspaceEditableState
}

export interface SettingsWorkspaceApiFailure {
  ok: false
  error: string
}

export type SettingsWorkspaceStateLoadResult = SettingsWorkspaceStateLoadSuccess | SettingsWorkspaceApiFailure
export type SettingsWorkspaceStateSaveResult = SettingsWorkspaceStateSaveSuccess | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceSecretsLoadStatusesRequest {
  providerIds?: string[]
}

export interface SettingsWorkspaceSecretsLoadStatusesSuccess {
  ok: true
  states: SettingsWorkspaceProviderSecretStateById
}

export type SettingsWorkspaceSecretsLoadStatusesResult =
  | SettingsWorkspaceSecretsLoadStatusesSuccess
  | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceSaveProviderApiKeyRequest {
  providerId: string
  apiKey: string
}

export interface SettingsWorkspaceClearProviderApiKeyRequest {
  providerId: string
}

export interface SettingsWorkspaceProviderSecretMutationSuccess {
  ok: true
  providerId: string
  state: SettingsWorkspaceProviderSecretState
}

export type SettingsWorkspaceProviderSecretMutationResult =
  | SettingsWorkspaceProviderSecretMutationSuccess
  | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceStateApi {
  load: () => Promise<SettingsWorkspaceStateLoadResult>
  save: (input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>
}

export interface SettingsWorkspaceSecretsApi {
  loadStatuses: (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ) => Promise<SettingsWorkspaceSecretsLoadStatusesResult>
  saveProviderApiKey: (
    request: SettingsWorkspaceSaveProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
  clearProviderApiKey: (
    request: SettingsWorkspaceClearProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
}
