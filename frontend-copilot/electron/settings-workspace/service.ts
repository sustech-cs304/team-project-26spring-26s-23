import type { SettingsWorkspacePaths } from './paths'
import type {
  SettingsWorkspaceProviderRouteResolveRequest,
  SettingsWorkspaceProviderRouteResolveResult,
} from './provider-route-resolver'
import type {
  SettingsWorkspaceProviderSecretState,
  SettingsWorkspaceProviderSecretStateById,
  SettingsWorkspaceSustechCasSecretState,
} from './secret-schema'
import type { SettingsWorkspaceFileSystem } from './settings-workspace-document-io'
import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceStateSaveInput,
  SettingsWorkspaceStateSource,
} from './state-schema'
import { createSettingsWorkspaceBootstrapService } from './bootstrap/SettingsWorkspaceBootstrapService'
import { createSettingsWorkspacePatchService } from './patching/SettingsWorkspacePatchService'
import {
  createSettingsWorkspaceStore,
  type SettingsWorkspaceStoreFileSystem,
} from './persistence/SettingsWorkspaceStore'

export interface SettingsWorkspaceStorage {
  loadState: () => Promise<{
    state: SettingsWorkspaceEditableState
    source: SettingsWorkspaceStateSource
  }>
  saveState: (input: SettingsWorkspaceStateSaveInput) => Promise<{
    state: SettingsWorkspaceEditableState
  }>
  loadSecretStates: (profileIds?: readonly string[]) => Promise<{
    states: SettingsWorkspaceProviderSecretStateById
  }>
  loadSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
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
  resolveProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult>
}

export interface CreateSettingsWorkspaceStorageOptions {
  paths: SettingsWorkspacePaths
  fileSystem?: Partial<SettingsWorkspaceFileSystem>
}

export function createSettingsWorkspaceStorage(
  options: CreateSettingsWorkspaceStorageOptions,
): SettingsWorkspaceStorage {
  const store = createSettingsWorkspaceStore({
    paths: options.paths,
    fileSystem: options.fileSystem,
  })
  const bootstrapService = createSettingsWorkspaceBootstrapService({ store })
  const patchService = createSettingsWorkspacePatchService({ store })

  return {
    loadState: bootstrapService.loadState,
    saveState: patchService.saveState,
    loadSecretStates: bootstrapService.loadSecretStates,
    loadSustechCasSecret: bootstrapService.loadSustechCasSecret,
    saveProfileSecret: patchService.saveProfileSecret,
    clearProfileSecret: patchService.clearProfileSecret,
    saveSustechCasSecret: patchService.saveSustechCasSecret,
    clearSustechCasSecret: patchService.clearSustechCasSecret,
    resolveProviderRoute: bootstrapService.resolveProviderRoute,
  }
}

export type {
  SettingsWorkspaceStoreFileSystem as SettingsWorkspaceFileSystem,
}
