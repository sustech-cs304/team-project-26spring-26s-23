import type { ProviderModelProfile, ProviderProfile } from '../types'

import { cloneThinkingCapabilityDeclaration } from '../thinking-capabilities'
import type { SettingsWorkspaceFormState } from './settings-workspace-form-state'

export function cloneSettingsWorkspaceFormState(state: SettingsWorkspaceFormState): SettingsWorkspaceFormState {
  return {
    ...state,
    providerProfiles: cloneProviderProfiles(state.providerProfiles),
    primaryAssistantModelRoute: cloneModelRouteRef(state.primaryAssistantModelRoute ?? null),
    fastAssistantModelRoute: cloneModelRouteRef(state.fastAssistantModelRoute ?? null),
  }
}

export function cloneProviderProfiles(providerProfiles: ProviderProfile[]): ProviderProfile[] {
  return providerProfiles.map((profile) => ({
    ...profile,
    availableModels: profile.availableModels.map(cloneProviderModelProfile),
  }))
}

export function cloneProviderModelProfile(model: ProviderModelProfile): ProviderModelProfile {
  return {
    ...model,
    capabilities: [...model.capabilities],
    thinkingCapability: cloneThinkingCapabilityDeclaration(model.thinkingCapability),
  }
}

function cloneModelRouteRef(route: SettingsWorkspaceFormState['primaryAssistantModelRoute']): SettingsWorkspaceFormState['primaryAssistantModelRoute'] {
  return route === null
    ? null
    : {
      routeKind: route.routeKind,
      profileId: route.profileId,
      modelId: route.modelId,
    }
}
