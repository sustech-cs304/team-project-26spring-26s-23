import type { ProviderModelProfile, ProviderProfile } from '../types'

import { cloneThinkingCapabilityDeclaration } from '../thinking-capabilities'
import type { SettingsWorkspaceFormState } from './settings-workspace-form-state'

export function cloneSettingsWorkspaceFormState(state: SettingsWorkspaceFormState): SettingsWorkspaceFormState {
  return {
    ...state,
    providerProfiles: cloneProviderProfiles(state.providerProfiles),
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
