import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import { getProviderSecretsFeedbackCopy } from '../../../locale'
import type { ProviderProfile } from '../../../types'
import { omitProviderSecretValue } from './provider-profiles-helpers'
import {
  clearSettingsWorkspaceProfileApiKey,
  saveSettingsWorkspaceProfileApiKey,
} from '../../workspace-state'

interface UseSettingsWorkspaceProviderSecretsArgs {
  language: string
  activeProviderId: string
  activeProvider: ProviderProfile | null
  hydratedProviderSecretValues: Record<string, string>
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>
}

interface UseSettingsWorkspaceProviderSecretsResult {
  activeProviderApiKeyDraft: string
  apiKeyVisible: boolean
  apiKeyFeedback: string | null
  handleProviderApiKeyDraftChange: (providerId: string, value: string) => void
  handlePersistProviderApiKeyDraft: (providerId: string) => Promise<void>
  handleToggleApiKeyVisibility: () => void
  handleCopyApiKey: () => Promise<void>
  getProviderSecretValue: (providerId: string) => string
  syncCopiedProviderApiKey: (providerId: string, apiKey: string) => Promise<boolean>
  removeProviderSecret: (providerId: string) => Promise<boolean>
}

function syncProviderApiKeyState(params: {
  providerId: string
  apiKey: string
  setProviderProfiles: Dispatch<SetStateAction<ProviderProfile[]>>
  setProviderSecretDrafts: Dispatch<SetStateAction<Record<string, string>>>
  setProviderSecretSavedValues: Dispatch<SetStateAction<Record<string, string>>>
}) {
  const { providerId, apiKey, setProviderProfiles, setProviderSecretDrafts, setProviderSecretSavedValues } = params

  setProviderProfiles((previous) =>
    previous.map((profile) => {
      return profile.id === providerId ? { ...profile, hasApiKey: apiKey !== '' } : profile
    }),
  )
  setProviderSecretDrafts((previous) => ({
    ...previous,
    [providerId]: apiKey,
  }))
  setProviderSecretSavedValues((previous) => ({
    ...previous,
    [providerId]: apiKey,
  }))
}

async function persistProviderApiKeyDraft(params: {
  providerId: string
  activeDraft: string
  savedValue: string
  feedbackCopy: ReturnType<typeof getProviderSecretsFeedbackCopy>
  setApiKeyFeedback: Dispatch<SetStateAction<string | null>>
  syncState: (providerId: string, apiKey: string) => void
}) {
  const { providerId, activeDraft, savedValue, feedbackCopy, setApiKeyFeedback, syncState } = params
  const normalizedDraft = activeDraft.trim()

  if (normalizedDraft === savedValue) {
    return
  }

  if (!normalizedDraft) {
    const result = await clearSettingsWorkspaceProfileApiKey({ profileId: providerId })

    if (!result.ok) {
      setApiKeyFeedback(feedbackCopy.clearFailed)
      return
    }

    syncState(result.profileId, result.state.apiKey)
    setApiKeyFeedback(feedbackCopy.cleared)
    return
  }

  const result = await saveSettingsWorkspaceProfileApiKey({
    profileId: providerId,
    apiKey: normalizedDraft,
  })

  if (!result.ok) {
    setApiKeyFeedback(feedbackCopy.saveFailed)
    return
  }

  syncState(result.profileId, result.state.apiKey)
  setApiKeyFeedback(feedbackCopy.saved)
}

/* eslint-disable-next-line max-lines-per-function */
export function useSettingsWorkspaceProviderSecrets({
  language,
  activeProviderId,
  activeProvider,
  hydratedProviderSecretValues,
  setProviderProfiles,
}: UseSettingsWorkspaceProviderSecretsArgs): UseSettingsWorkspaceProviderSecretsResult {
  const [providerSecretDrafts, setProviderSecretDrafts] = useState<Record<string, string>>({})
  const [providerSecretSavedValues, setProviderSecretSavedValues] = useState<Record<string, string>>({})
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyFeedback, setApiKeyFeedback] = useState<string | null>(null)
  const feedbackCopy = getProviderSecretsFeedbackCopy(language)

  useEffect(() => {
    setProviderSecretDrafts(hydratedProviderSecretValues)
    setProviderSecretSavedValues(hydratedProviderSecretValues)
  }, [hydratedProviderSecretValues])

  useEffect(() => {
    setApiKeyVisible(false)
    setApiKeyFeedback(null)
  }, [activeProviderId])

  useEffect(() => {
    if (!apiKeyFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setApiKeyFeedback(null)
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [apiKeyFeedback])

  const activeProviderApiKeyDraft = activeProvider ? (providerSecretDrafts[activeProvider.id] ?? '') : ''

  const syncState = (providerId: string, apiKey: string) => {
    syncProviderApiKeyState({
      providerId,
      apiKey,
      setProviderProfiles,
      setProviderSecretDrafts,
      setProviderSecretSavedValues,
    })
  }

  const handleProviderApiKeyDraftChange = (providerId: string, value: string) => {
    setProviderSecretDrafts((previous) => ({
      ...previous,
      [providerId]: value,
    }))
  }

  const handlePersistProviderApiKeyDraft = async (providerId: string) => {
    const activeDraft = providerSecretDrafts[providerId]

    if (activeDraft === undefined) {
      return
    }

    await persistProviderApiKeyDraft({
      providerId,
      activeDraft,
      savedValue: providerSecretSavedValues[providerId] ?? '',
      feedbackCopy,
      setApiKeyFeedback,
      syncState,
    })
  }

  const handleToggleApiKeyVisibility = () => {
    setApiKeyVisible((previous) => !previous)
  }

  const handleCopyApiKey = async () => {
    if (!activeProvider) {
      return
    }

    if (!activeProviderApiKeyDraft.trim()) {
      setApiKeyFeedback(feedbackCopy.nothingToCopy)
      return
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard-unavailable')
      }

      await navigator.clipboard.writeText(activeProviderApiKeyDraft)
      setApiKeyFeedback(feedbackCopy.copied)
    } catch {
      setApiKeyFeedback(feedbackCopy.copyFailed)
    }
  }

  const getProviderSecretValue = (providerId: string) => {
    return providerSecretSavedValues[providerId] ?? providerSecretDrafts[providerId] ?? ''
  }

  const syncCopiedProviderApiKey = async (providerId: string, apiKey: string) => {
    if (!apiKey) {
      return true
    }

    const result = await saveSettingsWorkspaceProfileApiKey({
      profileId: providerId,
      apiKey,
    })

    if (!result.ok) {
      setApiKeyFeedback(feedbackCopy.syncFailedAfterDuplicate)
      return false
    }

    syncState(result.profileId, result.state.apiKey)
    return true
  }

  const removeProviderSecret = async (providerId: string) => {
    const savedSecret = providerSecretSavedValues[providerId] ?? ''

    setProviderSecretDrafts((previous) => omitProviderSecretValue(previous, providerId))
    setProviderSecretSavedValues((previous) => omitProviderSecretValue(previous, providerId))

    if (!savedSecret) {
      return true
    }

    const result = await clearSettingsWorkspaceProfileApiKey({ profileId: providerId })

    if (!result.ok) {
      setApiKeyFeedback(feedbackCopy.clearFailedAfterDelete)
      return false
    }

    return true
  }

  return {
    activeProviderApiKeyDraft,
    apiKeyVisible,
    apiKeyFeedback,
    handleProviderApiKeyDraftChange,
    handlePersistProviderApiKeyDraft,
    handleToggleApiKeyVisibility,
    handleCopyApiKey,
    getProviderSecretValue,
    syncCopiedProviderApiKey,
    removeProviderSecret,
  }
}
