import type { ProviderProfile } from '../types'

import {
  resolveProviderStatusNotice,
  resolveProviderTypeLabel,
} from './settings-workspace-provider-helpers'

export function filterProviderProfiles(providerProfiles: ProviderProfile[], providerQuery: string) {
  const keyword = providerQuery.trim().toLowerCase()

  if (!keyword) {
    return providerProfiles
  }

  return providerProfiles.filter((profile) => {
    const statusNotice = resolveProviderStatusNotice(profile)

    return (
      profile.name.toLowerCase().includes(keyword)
      || resolveProviderTypeLabel(profile).toLowerCase().includes(keyword)
      || (profile.baseUrl ?? profile.endpoint).toLowerCase().includes(keyword)
      || (statusNotice?.title.toLowerCase().includes(keyword) ?? false)
      || (statusNotice?.description.toLowerCase().includes(keyword) ?? false)
      || profile.availableModels.some((model) => {
        return model.modelId.toLowerCase().includes(keyword) || model.displayName.toLowerCase().includes(keyword)
      })
    )
  })
}
