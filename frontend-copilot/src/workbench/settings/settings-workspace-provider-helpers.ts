import type { ProviderProfile } from '../types'
import { createPlaceholderProviderProfile } from './provider-profiles'

export function findSettingsWorkspaceActiveProvider(
  providerProfiles: ProviderProfile[],
  activeProviderId: string,
): ProviderProfile | null {
  return providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0] ?? null
}

export function resolveSettingsWorkspaceActiveProviderDetail(
  activeProvider: ProviderProfile | null,
): ProviderProfile {
  return activeProvider ?? createPlaceholderProviderProfile()
}

export function patchProviderProfileById(
  providerProfiles: ProviderProfile[],
  providerId: string,
  patch: Partial<ProviderProfile>,
): ProviderProfile[] {
  return providerProfiles.map((profile) => {
    if (profile.id === providerId) {
      return { ...profile, ...patch }
    }

    return profile
  })
}

export function resolveNextProviderIdAfterDeletion(
  providerProfiles: ProviderProfile[],
  providerId: string,
): string {
  const currentIndex = providerProfiles.findIndex((profile) => profile.id === providerId)

  if (currentIndex === -1) {
    return ''
  }

  return providerProfiles[currentIndex + 1]?.id
    ?? providerProfiles[currentIndex - 1]?.id
    ?? ''
}

export function omitProviderSecretValue(
  providerSecretValues: Record<string, string>,
  providerId: string,
): Record<string, string> {
  const { [providerId]: _removedProviderSecretValue, ...remainingProviderSecretValues } = providerSecretValues
  return remainingProviderSecretValues
}
