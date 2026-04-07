import type { SettingsWorkspacePaths } from './paths'
import {
  resolveSettingsWorkspaceProviderRoute,
  type SettingsWorkspaceProviderRouteResolveRequest,
  type SettingsWorkspaceProviderRouteResolveResult,
} from './provider-route-resolver'
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
  const documentIO = createSettingsWorkspaceDocumentIO(options)
  const stateStorage = createSettingsWorkspaceStateStorage(documentIO)
  const secretStorage = createSettingsWorkspaceSecretStorage(documentIO)

  const resolveProviderRoute = async (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ): Promise<SettingsWorkspaceProviderRouteResolveResult> => {
    const { state } = await stateStorage.loadState()
    const secretProfileId = request.routeRef?.profileId?.trim() ?? ''
    const { states } = await secretStorage.loadSecretStates(secretProfileId === '' ? [] : [secretProfileId])

    return resolveSettingsWorkspaceProviderRoute({
      state,
      secretStates: states,
      request,
    })
  }

  return {
    loadState: stateStorage.loadState,
    saveState: stateStorage.saveState,
    loadSecretStates: secretStorage.loadSecretStates,
    loadSustechCasSecret: secretStorage.loadSustechCasSecret,
    saveProfileSecret: secretStorage.saveProfileSecret,
    clearProfileSecret: secretStorage.clearProfileSecret,
    saveSustechCasSecret: secretStorage.saveSustechCasSecret,
    clearSustechCasSecret: secretStorage.clearSustechCasSecret,
    resolveProviderRoute,
  }
}
