import type { SettingsWorkspaceStore } from '../persistence/SettingsWorkspaceStore'
import type {
  SettingsWorkspaceProviderSecretState,
  SettingsWorkspaceSustechCasSecretState,
} from '../secret-schema'
import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceStateSaveInput,
} from '../state-schema'

export interface SettingsWorkspacePatchService {
  saveState: (input: SettingsWorkspaceStateSaveInput) => Promise<{
    state: SettingsWorkspaceEditableState
  }>
  saveProfileSecret: (profileId: string, apiKey: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  clearProfileSecret: (profileId: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  saveSustechCasSecret: (password: string) => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  clearSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
}

export interface CreateSettingsWorkspacePatchServiceOptions {
  store: SettingsWorkspaceStore
}

export function createSettingsWorkspacePatchService(
  options: CreateSettingsWorkspacePatchServiceOptions,
): SettingsWorkspacePatchService {
  return {
    saveState: options.store.saveState,
    saveProfileSecret: options.store.saveProfileSecret,
    clearProfileSecret: options.store.clearProfileSecret,
    saveSustechCasSecret: options.store.saveSustechCasSecret,
    clearSustechCasSecret: options.store.clearSustechCasSecret,
  }
}
