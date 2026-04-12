import type {
  SettingsWorkspaceProviderRouteResolveRequest,
  SettingsWorkspaceProviderRouteResolveResult,
} from '../provider-route-resolver'
import type {
  SettingsWorkspaceProviderSecretStateById,
  SettingsWorkspaceSustechCasSecretState,
} from '../secret-schema'
import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceStateSource,
} from '../state-schema'
import type { SettingsWorkspaceStore } from '../persistence/SettingsWorkspaceStore'

export interface SettingsWorkspaceBootstrapService {
  loadState: () => Promise<{
    state: SettingsWorkspaceEditableState
    source: SettingsWorkspaceStateSource
  }>
  loadSecretStates: (profileIds?: readonly string[]) => Promise<{
    states: SettingsWorkspaceProviderSecretStateById
  }>
  loadSustechCasSecret: () => Promise<{
    state: SettingsWorkspaceSustechCasSecretState
  }>
  resolveProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult>
}

export interface CreateSettingsWorkspaceBootstrapServiceOptions {
  store: SettingsWorkspaceStore
}

export function createSettingsWorkspaceBootstrapService(
  options: CreateSettingsWorkspaceBootstrapServiceOptions,
): SettingsWorkspaceBootstrapService {
  return {
    loadState: options.store.loadState,
    loadSecretStates: options.store.loadSecretStates,
    loadSustechCasSecret: options.store.loadSustechCasSecret,
    resolveProviderRoute: options.store.resolveProviderRoute,
  }
}
