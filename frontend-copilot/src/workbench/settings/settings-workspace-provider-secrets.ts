import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import type { ProviderProfile } from '../types'
import { omitProviderSecretValue } from './settings-workspace-provider-helpers'
import {
  clearSettingsWorkspaceProviderApiKey,
  saveSettingsWorkspaceProviderApiKey,
} from './workspace-state'

interface UseSettingsWorkspaceProviderSecretsArgs {
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

export function useSettingsWorkspaceProviderSecrets({
  activeProviderId,
  activeProvider,
  hydratedProviderSecretValues,
  setProviderProfiles,
}: UseSettingsWorkspaceProviderSecretsArgs): UseSettingsWorkspaceProviderSecretsResult {
  const [providerSecretDrafts, setProviderSecretDrafts] = useState<Record<string, string>>({})
  const [providerSecretSavedValues, setProviderSecretSavedValues] = useState<Record<string, string>>({})
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyFeedback, setApiKeyFeedback] = useState<string | null>(null)

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

  const syncProviderApiKeyState = (providerId: string, apiKey: string) => {
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

    const normalizedDraft = activeDraft.trim()
    const savedValue = providerSecretSavedValues[providerId] ?? ''

    if (normalizedDraft === savedValue) {
      return
    }

    if (!normalizedDraft) {
      const result = await clearSettingsWorkspaceProviderApiKey({ providerId })

      if (!result.ok) {
        setApiKeyFeedback('清除失败，请稍后重试')
        return
      }

      syncProviderApiKeyState(result.providerId, result.state.apiKey)
      setApiKeyFeedback('已清除 API 密钥')
      return
    }

    const result = await saveSettingsWorkspaceProviderApiKey({
      providerId,
      apiKey: normalizedDraft,
    })

    if (!result.ok) {
      setApiKeyFeedback('保存失败，请稍后重试')
      return
    }

    syncProviderApiKeyState(result.providerId, result.state.apiKey)
    setApiKeyFeedback('已自动保存 API 密钥')
  }

  const handleToggleApiKeyVisibility = () => {
    setApiKeyVisible((previous) => !previous)
  }

  const handleCopyApiKey = async () => {
    if (!activeProvider) {
      return
    }

    if (!activeProviderApiKeyDraft.trim()) {
      setApiKeyFeedback('当前没有可复制的 API 密钥')
      return
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard-unavailable')
      }

      await navigator.clipboard.writeText(activeProviderApiKeyDraft)
      setApiKeyFeedback('已复制 API 密钥')
    } catch {
      setApiKeyFeedback('复制失败，请手动复制')
    }
  }

  const getProviderSecretValue = (providerId: string) => {
    return providerSecretSavedValues[providerId] ?? providerSecretDrafts[providerId] ?? ''
  }

  const syncCopiedProviderApiKey = async (providerId: string, apiKey: string) => {
    if (!apiKey) {
      return true
    }

    const result = await saveSettingsWorkspaceProviderApiKey({
      providerId,
      apiKey,
    })

    if (!result.ok) {
      setApiKeyFeedback('复制服务商后未能同步 API 密钥')
      return false
    }

    syncProviderApiKeyState(result.providerId, result.state.apiKey)
    return true
  }

  const removeProviderSecret = async (providerId: string) => {
    const savedSecret = providerSecretSavedValues[providerId] ?? ''

    setProviderSecretDrafts((previous) => omitProviderSecretValue(previous, providerId))
    setProviderSecretSavedValues((previous) => omitProviderSecretValue(previous, providerId))

    if (!savedSecret) {
      return true
    }

    const result = await clearSettingsWorkspaceProviderApiKey({ providerId })

    if (!result.ok) {
      setApiKeyFeedback('删除服务商后未能清除 API 密钥')
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
