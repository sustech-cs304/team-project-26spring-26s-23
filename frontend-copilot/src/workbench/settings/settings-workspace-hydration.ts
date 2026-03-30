import {
  loadSettingsWorkspaceSecretStatuses,
  loadSettingsWorkspaceState,
  loadSettingsWorkspaceSustechCasPassword,
} from './workspace-state'
import { createSettingsWorkspaceFormStateFromEditableState, type SettingsWorkspaceFormState } from './settings-workspace-form-state'
import { resolveSettingsWorkspaceActiveProviderId } from './settings-workspace-model-options'

export interface SettingsWorkspaceHydrationPayload {
  state: SettingsWorkspaceFormState
  activeProviderId: string
  providerSecretValues: Record<string, string>
  casPasswordValue: string
}

export function projectLoadedProviderSecretValues(
  states: Record<string, { apiKey: string }>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(states).flatMap(([providerId, state]) => {
      return state.apiKey ? [[providerId, state.apiKey]] : []
    }),
  )
}

export async function loadSettingsWorkspaceHydration(
  currentActiveProviderId: string,
): Promise<SettingsWorkspaceHydrationPayload | null> {
  const result = await loadSettingsWorkspaceState()

  if (!result.ok) {
    return null
  }

  let providerSecretValues: Record<string, string> = {}
  let casPasswordValue = ''

  const secretStatusesResult = await loadSettingsWorkspaceSecretStatuses({
    providerIds: result.state.providerProfiles.map((profile) => profile.id),
  })
  const sustechCasPasswordResult = await loadSettingsWorkspaceSustechCasPassword()

  if (secretStatusesResult.ok) {
    providerSecretValues = projectLoadedProviderSecretValues(secretStatusesResult.states)
  }

  if (sustechCasPasswordResult.ok) {
    casPasswordValue = sustechCasPasswordResult.state.password
  }

  const state = createSettingsWorkspaceFormStateFromEditableState(result.state)

  return {
    state,
    activeProviderId: resolveSettingsWorkspaceActiveProviderId(state.providerProfiles, currentActiveProviderId),
    providerSecretValues,
    casPasswordValue,
  }
}
