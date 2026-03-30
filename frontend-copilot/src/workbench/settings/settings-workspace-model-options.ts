import type { ProviderModelProfile, ProviderProfile, SelectOption } from '../types'

export function collectAllModelOptions(providerProfiles: ProviderProfile[]): SelectOption[] {
  const modelsById = new Map<string, ProviderModelProfile>()

  providerProfiles.forEach((profile) => {
    profile.availableModels.forEach((model) => {
      if (!modelsById.has(model.modelId)) {
        modelsById.set(model.modelId, model)
      }
    })
  })

  return Array.from(modelsById.values()).map((model) => ({
    value: model.modelId,
    label: model.displayName || model.modelId,
  }))
}

export function resolveSettingsWorkspaceActiveProviderId(
  providerProfiles: ProviderProfile[],
  currentActiveProviderId: string,
): string {
  return providerProfiles.some((profile) => profile.id === currentActiveProviderId)
    ? currentActiveProviderId
    : providerProfiles[0]?.id ?? ''
}
