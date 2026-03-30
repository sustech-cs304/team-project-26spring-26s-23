import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import type { ProviderProfile } from '../types'
import { createModelProfileId } from './config'
import { createCustomProvider, createProviderId } from './provider-profiles'
import { resolveSettingsWorkspaceActiveProviderId } from './settings-workspace-model-options'
import {
  patchProviderProfileById,
  resolveNextProviderIdAfterDeletion,
} from './settings-workspace-provider-helpers'

interface UseSettingsWorkspaceProviderListControllerArgs {
  providerProfiles: ProviderProfile[]
  activeProviderId: string
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>
  setActiveProviderId: (value: string) => void
  getProviderSecretValue: (providerId: string) => string
  syncCopiedProviderApiKey: (providerId: string, apiKey: string) => Promise<boolean>
  removeProviderSecret: (providerId: string) => Promise<boolean>
}

interface UseSettingsWorkspaceProviderListControllerResult {
  providerQuery: string
  setProviderQuery: (value: string) => void
  updateActiveProvider: (patch: Partial<ProviderProfile>) => void
  handleAddProvider: () => void
  moveProviderToIndex: (draggingProviderId: string, nextIndex: number) => void
  handleCopyProvider: (providerId: string) => Promise<void>
  handleDeleteProvider: (providerId: string) => Promise<void>
}

export function useSettingsWorkspaceProviderListController({
  providerProfiles,
  activeProviderId,
  setProviderProfiles,
  setActiveProviderId,
  getProviderSecretValue,
  syncCopiedProviderApiKey,
  removeProviderSecret,
}: UseSettingsWorkspaceProviderListControllerArgs): UseSettingsWorkspaceProviderListControllerResult {
  const [providerQuery, setProviderQuery] = useState('')

  useEffect(() => {
    const nextActiveProviderId = resolveSettingsWorkspaceActiveProviderId(providerProfiles, activeProviderId)
    if (nextActiveProviderId !== activeProviderId) {
      setActiveProviderId(nextActiveProviderId)
    }
  }, [activeProviderId, providerProfiles, setActiveProviderId])

  const updateActiveProvider = (patch: Partial<ProviderProfile>) => {
    if (!activeProviderId) {
      return
    }

    setProviderProfiles((previous) => patchProviderProfileById(previous, activeProviderId, patch))
  }

  const handleAddProvider = () => {
    const nextProvider = createCustomProvider(providerProfiles.length + 1)

    setProviderProfiles((previous) => [...previous, nextProvider])
    setProviderQuery('')
    setActiveProviderId(nextProvider.id)
  }

  const moveProviderToIndex = (draggingProviderId: string, nextIndex: number) => {
    setProviderProfiles((previous) => {
      const draggingIndex = previous.findIndex((profile) => profile.id === draggingProviderId)

      if (draggingIndex === -1) {
        return previous
      }

      const clampedIndex = Math.max(0, Math.min(nextIndex, previous.length - 1))
      const nextProfiles = [...previous]
      const [draggingProvider] = nextProfiles.splice(draggingIndex, 1)
      nextProfiles.splice(clampedIndex, 0, draggingProvider)
      return nextProfiles
    })
  }

  const handleCopyProvider = async (providerId: string) => {
    const sourceProvider = providerProfiles.find((profile) => profile.id === providerId)

    if (!sourceProvider) {
      return
    }

    const nextProviderId = createProviderId(sourceProvider.name)
    const nextProviderName = `${sourceProvider.name} 副本`
    const copiedSecret = getProviderSecretValue(providerId)
    const nextProvider: ProviderProfile = {
      ...sourceProvider,
      id: nextProviderId,
      name: nextProviderName,
      hasApiKey: copiedSecret !== '',
      availableModels: sourceProvider.availableModels.map((model) => ({
        ...model,
        id: createModelProfileId(nextProviderId, model.modelId),
        capabilities: [...model.capabilities],
      })),
    }

    setProviderProfiles((previous) => {
      const sourceIndex = previous.findIndex((profile) => profile.id === providerId)
      const nextProfiles = [...previous]
      nextProfiles.splice(sourceIndex + 1, 0, nextProvider)
      return nextProfiles
    })
    setActiveProviderId(nextProviderId)

    await syncCopiedProviderApiKey(nextProviderId, copiedSecret)
  }

  const handleDeleteProvider = async (providerId: string) => {
    if (!providerProfiles.some((profile) => profile.id === providerId)) {
      return
    }

    const nextActiveProviderId = resolveNextProviderIdAfterDeletion(providerProfiles, providerId)

    setProviderProfiles((previous) => previous.filter((profile) => profile.id !== providerId))

    if (providerId === activeProviderId) {
      setActiveProviderId(nextActiveProviderId)
    }

    await removeProviderSecret(providerId)
  }

  return {
    providerQuery,
    setProviderQuery,
    updateActiveProvider,
    handleAddProvider,
    moveProviderToIndex,
    handleCopyProvider,
    handleDeleteProvider,
  }
}
