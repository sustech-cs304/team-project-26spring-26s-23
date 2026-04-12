import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceStateSaveInput,
  SettingsWorkspaceStateSource,
} from './state-schema'
import type {
  SettingsWorkspaceProviderSecretState,
  SettingsWorkspaceProviderSecretStateById,
  SettingsWorkspaceSustechCasSecretState,
} from './secret-schema'

export const SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL = 'settings-workspace-state:load'
export const SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL = 'settings-workspace-state:save'
export const SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL = 'settings-workspace-secrets:load-statuses'
export const SETTINGS_WORKSPACE_SECRETS_LOAD_SUSTECH_CAS_CHANNEL = 'settings-workspace-secrets:load-sustech-cas'
export const SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL = 'settings-workspace-secrets:save-provider-api-key'
export const SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL = 'settings-workspace-secrets:clear-provider-api-key'
export const SETTINGS_WORKSPACE_SECRETS_SAVE_SUSTECH_CAS_CHANNEL = 'settings-workspace-secrets:save-sustech-cas'
export const SETTINGS_WORKSPACE_SECRETS_CLEAR_SUSTECH_CAS_CHANNEL = 'settings-workspace-secrets:clear-sustech-cas'

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
  profileIds?: string[]
}

export interface SettingsWorkspaceSecretsLoadStatusesSuccess {
  ok: true
  states: SettingsWorkspaceProviderSecretStateById
}

export type SettingsWorkspaceSecretsLoadStatusesResult =
  | SettingsWorkspaceSecretsLoadStatusesSuccess
  | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceSustechCasSecretLoadSuccess {
  ok: true
  state: SettingsWorkspaceSustechCasSecretState
}

export type SettingsWorkspaceSustechCasSecretLoadResult =
  | SettingsWorkspaceSustechCasSecretLoadSuccess
  | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceSaveProfileApiKeyRequest {
  profileId: string
  apiKey: string
}

export interface SettingsWorkspaceClearProfileApiKeyRequest {
  profileId: string
}

export interface SettingsWorkspaceSaveSustechCasPasswordRequest {
  password: string
}

export interface SettingsWorkspaceProfileSecretMutationSuccess {
  ok: true
  profileId: string
  state: SettingsWorkspaceProviderSecretState
}

export type SettingsWorkspaceProfileSecretMutationResult =
  | SettingsWorkspaceProfileSecretMutationSuccess
  | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceSustechCasSecretMutationSuccess {
  ok: true
  state: SettingsWorkspaceSustechCasSecretState
}

export type SettingsWorkspaceSustechCasSecretMutationResult =
  | SettingsWorkspaceSustechCasSecretMutationSuccess
  | SettingsWorkspaceApiFailure

export interface SettingsWorkspaceStateApi {
  load: () => Promise<SettingsWorkspaceStateLoadResult>
  save: (input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>
}

export interface SettingsWorkspaceSecretsApi {
  loadStatuses: (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ) => Promise<SettingsWorkspaceSecretsLoadStatusesResult>
  loadSustechCasPassword: () => Promise<SettingsWorkspaceSustechCasSecretLoadResult>
  saveProfileApiKey: (
    request: SettingsWorkspaceSaveProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  clearProfileApiKey: (
    request: SettingsWorkspaceClearProfileApiKeyRequest,
  ) => Promise<SettingsWorkspaceProfileSecretMutationResult>
  saveSustechCasPassword: (
    request: SettingsWorkspaceSaveSustechCasPasswordRequest,
  ) => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
  clearSustechCasPassword: () => Promise<SettingsWorkspaceSustechCasSecretMutationResult>
}
