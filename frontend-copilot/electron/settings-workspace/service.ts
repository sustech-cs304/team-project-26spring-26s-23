import type { SettingsWorkspacePaths } from './paths'
import {
  type SettingsWorkspaceProviderSecretState,
  type SettingsWorkspaceProviderSecretStateById,
  type SettingsWorkspaceSustechCasSecretState,
} from './secret-schema'
import {
  createSettingsWorkspaceDocumentIO,
  type SettingsWorkspaceFileSystem,
} from './settings-workspace-document-io'
import { createSettingsWorkspaceSecretStorage } from './settings-workspace-secret-storage'
import { createSettingsWorkspaceStateStorage } from './settings-workspace-state-storage'
import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceStateSaveInput,
  SettingsWorkspaceStateSource,
} from './state-schema'

export interface SettingsWorkspaceStorage {
  loadState: () => Promise<{
    state: SettingsWorkspaceEditableState
    source: SettingsWorkspaceStateSource
  }>
  saveState: (input: SettingsWorkspaceStateSaveInput) => Promise<{
    state: SettingsWorkspaceEditableState
  }>
  loadSecretStates: (providerIds?: readonly string[]) => Promise<{
    states: SettingsWorkspaceProviderSecretStateById
  }>
  loadSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  saveProviderSecret: (providerId: string, apiKey: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  clearProviderSecret: (providerId: string) => Promise<{
    state: SettingsWorkspaceProviderSecretState
  }>
  saveSustechCasSecret: (password: string) => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  clearSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
}

export interface CreateSettingsWorkspaceStorageOptions {
  paths: SettingsWorkspacePaths
  fileSystem?: Partial<SettingsWorkspaceFileSystem>
}

export function createSettingsWorkspaceStorage(
  options: CreateSettingsWorkspaceStorageOptions,
): SettingsWorkspaceStorage {
  const documentIO = createSettingsWorkspaceDocumentIO(options)
  const stateStorage = createSettingsWorkspaceStateStorage(documentIO)
  const secretStorage = createSettingsWorkspaceSecretStorage(documentIO)

  return {
    loadState: stateStorage.loadState,
    saveState: stateStorage.saveState,
    loadSecretStates: secretStorage.loadSecretStates,
    loadSustechCasSecret: secretStorage.loadSustechCasSecret,
    saveProviderSecret: secretStorage.saveProviderSecret,
    clearProviderSecret: secretStorage.clearProviderSecret,
    saveSustechCasSecret: secretStorage.saveSustechCasSecret,
    clearSustechCasSecret: secretStorage.clearSustechCasSecret,
  }
}
