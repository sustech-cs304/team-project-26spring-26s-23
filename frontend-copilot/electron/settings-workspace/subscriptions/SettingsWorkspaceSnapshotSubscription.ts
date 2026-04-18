import type {
  SettingsWorkspaceProviderSecretState,
  SettingsWorkspaceSustechCasSecretState,
} from '../secret-schema'
import type { SettingsWorkspaceEditableState } from '../state-schema'

export interface SettingsWorkspaceSnapshotSubscription {
  publishStateSnapshot: (state: SettingsWorkspaceEditableState) => Promise<void>
  publishProfileSecretSnapshot: (
    profileId: string,
    state: SettingsWorkspaceProviderSecretState,
  ) => Promise<void>
  publishSustechCasSecretSnapshot: (state: SettingsWorkspaceSustechCasSecretState) => Promise<void>
}

export function createSettingsWorkspaceSnapshotSubscription(): SettingsWorkspaceSnapshotSubscription {
  return {
    async publishStateSnapshot(_state) {},
    async publishProfileSecretSnapshot(_profileId, _state) {},
    async publishSustechCasSecretSnapshot(_state) {},
  }
}
