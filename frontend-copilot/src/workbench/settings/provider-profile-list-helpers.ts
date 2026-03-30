import type { ProviderProfile } from '../types'

import { protocolOptions } from './config'

export function filterProviderProfiles(providerProfiles: ProviderProfile[], providerQuery: string) {
  const keyword = providerQuery.trim().toLowerCase()

  if (!keyword) {
    return providerProfiles
  }

  return providerProfiles.filter((profile) => {
    return (
      profile.name.toLowerCase().includes(keyword)
      || profile.endpoint.toLowerCase().includes(keyword)
      || profile.defaultModel.toLowerCase().includes(keyword)
      || profile.availableModels.some((model) => {
        return model.modelId.toLowerCase().includes(keyword) || model.displayName.toLowerCase().includes(keyword)
      })
    )
  })
}

export function getProviderProtocolLabel(protocol: string) {
  return protocolOptions.find((option) => option.value === protocol)?.label ?? protocol
}
