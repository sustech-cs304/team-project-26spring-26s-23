import { Link2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
import { settingsItems } from '../config'
import { SelectField, TextField, ToggleSwitch } from '../components/FormFields'
import type { SettingsWorkspaceEditableState, SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'
import type {
  ModelCapability,
  ProviderModelProfile,
  ProviderProfile,
  SelectOption,
  SettingsSection,
  ThemeMode,
} from '../types'
import {
  apiReconnectOptions,
  backupCycleOptions,
  compressionOptions,
  createModelProfileId,
  docsFormatOptions,
  initialProviderProfiles,
  languageOptions,
  memoryStrategyOptions,
  proxyModeOptions,
  resultCountOptions,
  searchEngineOptions,
  themeOptions,
  toolPermissionOptions,
} from './config'
import {
  clearSettingsWorkspaceProviderApiKey,
  clearSettingsWorkspaceSustechCasPassword,
  loadSettingsWorkspaceSecretStatuses,
  loadSettingsWorkspaceSustechCasPassword,
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceProviderApiKey,
  saveSettingsWorkspaceSustechCasPassword,
  saveSettingsWorkspaceState,
} from './workspace-state'
import {
  HostConfigRuntimeOverrideCard,
} from './ConfigCenterPublicFieldCards'
import { ProviderProfilesSection } from './ProviderProfilesSection'
import {
  createCustomProvider,
  createEmptyModelEditorState,
  createPlaceholderProviderProfile,
  createProviderId,
  formatModelDisplayName,
  formatModelGroupName,
  syncTrackedModelValue,
} from './provider-profiles'
import type { ModelEditorState } from './provider-profiles'

interface SettingsWorkspaceProps {
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
  initialSection?: SettingsSection
}

type WakeupDialogState =
  | { status: 'failure' }
  | { status: 'success' }
  | null

function isThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function projectLoadedProviderSecretValues(
  states: Record<string, { apiKey: string }>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(states).flatMap(([providerId, state]) => {
      return state.apiKey ? [[providerId, state.apiKey]] : []
    }),
  )
}

export function SettingsWorkspace({
  bootstrap,
  themeMode,
  onThemeModeChange,
  initialSection,
}: SettingsWorkspaceProps) {
  const [studentId, setStudentId] = useState('')
  const [sustechEmail, setSustechEmail] = useState('')
  const [sustechEmailFocused, setSustechEmailFocused] = useState(false)
  const [casPasswordDraft, setCasPasswordDraft] = useState('')
  const [casPasswordSavedValue, setCasPasswordSavedValue] = useState('')
  const [casPasswordFeedback, setCasPasswordFeedback] = useState<string | null>(null)
  const [blackboardAutoDownloadEnabled, setBlackboardAutoDownloadEnabled] = useState(false)
  const [blackboardDownloadLimitMb, setBlackboardDownloadLimitMb] = useState('0')
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? settingsItems[0]?.id ?? 'sustech-info')
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(initialProviderProfiles)
  const [activeProviderId, setActiveProviderId] = useState<string>(initialProviderProfiles[0]?.id ?? '')
  const [providerQuery, setProviderQuery] = useState('')
  const [providerSecretDrafts, setProviderSecretDrafts] = useState<Record<string, string>>({})
  const [providerSecretSavedValues, setProviderSecretSavedValues] = useState<Record<string, string>>({})
  const [modelEditorState, setModelEditorState] = useState<ModelEditorState | null>(null)
  const [modelEditorError, setModelEditorError] = useState<string | null>(null)
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false)
  const skipNextWorkspaceSaveRef = useRef(true)

  const [language, setLanguage] = useState('zh-CN')
  const [proxyMode, setProxyMode] = useState('system')
  const [assistantNotificationsEnabled, setAssistantNotificationsEnabled] = useState(false)
  const [backupEnabled, setBackupEnabled] = useState(true)

  const [dataPath, setDataPath] = useState('D:/workspace/copilot-data')
  const [backupCycle, setBackupCycle] = useState('daily')
  const [launchSyncEnabled, setLaunchSyncEnabled] = useState(true)

  const [searchEngine, setSearchEngine] = useState('google')
  const [searchResultCount, setSearchResultCount] = useState('8')
  const [compressionMode, setCompressionMode] = useState('summary')

  const [memoryStrategy, setMemoryStrategy] = useState('session-longterm')
  const [memoryCleanupEnabled, setMemoryCleanupEnabled] = useState(true)

  const [mcpAutoDiscoveryEnabled, setMcpAutoDiscoveryEnabled] = useState(true)
  const [toolPermissionMode, setToolPermissionMode] = useState('manual')

  const [apiReconnectMode, setApiReconnectMode] = useState('exponential')
  const [healthPollingEnabled, setHealthPollingEnabled] = useState(true)
  const [apiBaseUrl, setApiBaseUrl] = useState('http://127.0.0.1:8000')

  const [docsFormat, setDocsFormat] = useState('markdown')
  const [outputDirectory, setOutputDirectory] = useState('D:/workspace/exports')
  const [autoFileNameEnabled, setAutoFileNameEnabled] = useState(true)
  const [wakeupShareLink, setWakeupShareLink] = useState('')
  const [wakeupDialogState, setWakeupDialogState] = useState<WakeupDialogState>(null)

  const activeSettingsItem = useMemo(
    () => settingsItems.find((item) => item.id === activeSection) ?? settingsItems[0],
    [activeSection],
  )

  const activeProvider = useMemo<ProviderProfile | null>(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0] ?? null,
    [activeProviderId, providerProfiles],
  )

  const allModelOptions = useMemo<SelectOption[]>(() => {
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
  }, [providerProfiles])

  const [primaryAssistantModel, setPrimaryAssistantModel] = useState(
    initialProviderProfiles[0]?.defaultModel ?? '',
  )
  const [fastAssistantModel, setFastAssistantModel] = useState(initialProviderProfiles[0]?.fastModel ?? '')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyFeedback, setApiKeyFeedback] = useState<string | null>(null)
  const activeProviderApiKeyDraft = activeProvider ? (providerSecretDrafts[activeProvider.id] ?? '') : ''
  const activeProviderDetail = activeProvider ?? createPlaceholderProviderProfile()
  const derivedSustechEmail = useMemo(() => {
    const normalizedStudentId = studentId.trim()

    if (!normalizedStudentId) {
      return ''
    }

    return `${normalizedStudentId}@sustech.edu.cn`
  }, [studentId])
  const displayedSustechEmail = sustechEmail.trim() || (!sustechEmailFocused ? derivedSustechEmail : '')

  const workspaceStateInput = useMemo<SettingsWorkspaceStateSaveInput>(() => {
    return {
      sustech: {
        studentId,
        email: sustechEmail,
        blackboardAutoDownloadEnabled,
        blackboardDownloadLimitMb,
      },
      providerProfiles: providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }) => ({
        ...profile,
        availableModels: profile.availableModels.map((model) => ({
          ...model,
          capabilities: [...model.capabilities],
        })),
      })),
      defaultModelRouting: {
        primaryAssistantModel,
        fastAssistantModel,
      },
      general: {
        language,
        proxyMode,
        assistantNotificationsEnabled,
        backupEnabled,
      },
      data: {
        dataPath,
        backupCycle,
        launchSyncEnabled,
      },
      mcp: {
        mcpAutoDiscoveryEnabled,
        toolPermissionMode,
      },
      search: {
        searchEngine,
        searchResultCount,
        compressionMode,
      },
      memory: {
        memoryStrategy,
        memoryCleanupEnabled,
      },
      api: {
        apiReconnectMode,
        healthPollingEnabled,
        apiBaseUrl,
      },
      docs: {
        docsFormat,
        outputDirectory,
        autoFileNameEnabled,
      },
      externalSource: {
        wakeupShareLink,
      },
    }
  }, [
    apiBaseUrl,
    apiReconnectMode,
    assistantNotificationsEnabled,
    autoFileNameEnabled,
    backupCycle,
    backupEnabled,
    blackboardAutoDownloadEnabled,
    blackboardDownloadLimitMb,
    compressionMode,
    dataPath,
    docsFormat,
    fastAssistantModel,
    healthPollingEnabled,
    language,
    launchSyncEnabled,
    mcpAutoDiscoveryEnabled,
    memoryCleanupEnabled,
    memoryStrategy,
    outputDirectory,
    primaryAssistantModel,
    providerProfiles,
    proxyMode,
    searchEngine,
    searchResultCount,
    studentId,
    sustechEmail,
    toolPermissionMode,
    wakeupShareLink,
  ])

  useEffect(() => {
    setModelEditorState(null)
    setApiKeyVisible(false)
    setApiKeyFeedback(null)
  }, [activeProviderId])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await loadSettingsWorkspaceState()
      let loadedProviderSecretValues: Record<string, string> = {}
      let loadedCasPasswordValue = ''

      if (result.ok) {
        const secretStatusesResult = await loadSettingsWorkspaceSecretStatuses({
          providerIds: result.state.providerProfiles.map((profile) => profile.id),
        })
        const sustechCasPasswordResult = await loadSettingsWorkspaceSustechCasPassword()

        if (secretStatusesResult.ok) {
          loadedProviderSecretValues = projectLoadedProviderSecretValues(secretStatusesResult.states)
        }

        if (sustechCasPasswordResult.ok) {
          loadedCasPasswordValue = sustechCasPasswordResult.state.password
        }
      }

      if (!cancelled && result.ok) {
        applyLoadedWorkspaceState(result.state, {
          activeProviderId,
          setProviderProfiles,
          setActiveProviderId,
          setPrimaryAssistantModel,
          setFastAssistantModel,
          setLanguage,
          setProxyMode,
          setAssistantNotificationsEnabled,
          setBackupEnabled,
          setDataPath,
          setBackupCycle,
          setLaunchSyncEnabled,
          setMcpAutoDiscoveryEnabled,
          setToolPermissionMode,
          setSearchEngine,
          setSearchResultCount,
          setCompressionMode,
          setStudentId,
          setSustechEmail,
          setBlackboardAutoDownloadEnabled,
          setBlackboardDownloadLimitMb,
          setMemoryStrategy,
          setMemoryCleanupEnabled,
          setApiReconnectMode,
          setHealthPollingEnabled,
          setApiBaseUrl,
          setDocsFormat,
          setOutputDirectory,
          setAutoFileNameEnabled,
          setWakeupShareLink,
        })
        setProviderSecretDrafts(loadedProviderSecretValues)
        setProviderSecretSavedValues(loadedProviderSecretValues)
        setCasPasswordDraft(loadedCasPasswordValue)
        setCasPasswordSavedValue(loadedCasPasswordValue)
      }

      if (!cancelled) {
        setWorkspaceHydrated(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!workspaceHydrated) {
      return
    }

    if (skipNextWorkspaceSaveRef.current) {
      skipNextWorkspaceSaveRef.current = false
      return
    }

    const timeoutId = window.setTimeout(() => {
      void saveSettingsWorkspaceState(workspaceStateInput)
    }, 200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [workspaceHydrated, workspaceStateInput])

  useEffect(() => {
    if (providerProfiles.length === 0) {
      return
    }

    if (!providerProfiles.some((profile) => profile.id === activeProviderId)) {
      setActiveProviderId(providerProfiles[0]?.id ?? '')
    }
  }, [activeProviderId, providerProfiles])

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

  useEffect(() => {
    if (!casPasswordFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCasPasswordFeedback(null)
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [casPasswordFeedback])

  const updateActiveProvider = (patch: Partial<ProviderProfile>) => {
    if (!activeProvider) {
      return
    }

    setProviderProfiles((previous) =>
      previous.map((profile) => {
        if (profile.id === activeProviderId) {
          return { ...profile, ...patch }
        }

        return profile
      }),
    )
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
      const result = await clearSettingsWorkspaceProviderApiKey({
        providerId,
      })

      if (!result.ok) {
        setApiKeyFeedback('清除失败，请稍后重试')
        return
      }

      setProviderProfiles((previous) =>
        previous.map((profile) => {
          return profile.id === result.providerId ? { ...profile, hasApiKey: result.state.hasApiKey } : profile
        }),
      )
      setProviderSecretDrafts((previous) => ({
        ...previous,
        [result.providerId]: '',
      }))
      setProviderSecretSavedValues((previous) => ({
        ...previous,
        [result.providerId]: result.state.apiKey,
      }))
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

    setProviderProfiles((previous) =>
      previous.map((profile) => {
        return profile.id === result.providerId ? { ...profile, hasApiKey: result.state.hasApiKey } : profile
      }),
    )
    setProviderSecretDrafts((previous) => ({
      ...previous,
      [result.providerId]: result.state.apiKey,
    }))
    setProviderSecretSavedValues((previous) => ({
      ...previous,
      [result.providerId]: result.state.apiKey,
    }))
    setApiKeyFeedback('已自动保存 API 密钥')
  }

  const handlePersistCasPasswordDraft = async () => {
    const normalizedDraft = casPasswordDraft.trim()

    if (normalizedDraft === casPasswordSavedValue) {
      return
    }

    if (!normalizedDraft) {
      const result = await clearSettingsWorkspaceSustechCasPassword()

      if (!result.ok) {
        setCasPasswordFeedback('保存失败，请稍后重试')
        return
      }

      setCasPasswordDraft('')
      setCasPasswordSavedValue('')
      setCasPasswordFeedback('已清除 CAS 密码')
      return
    }

    const result = await saveSettingsWorkspaceSustechCasPassword({
      password: normalizedDraft,
    })

    if (!result.ok) {
      setCasPasswordFeedback('保存失败，请稍后重试')
      return
    }

    setCasPasswordDraft(result.state.password)
    setCasPasswordSavedValue(result.state.password)
    setCasPasswordFeedback('已自动保存 CAS 密码')
  }

  const commitActiveProviderModels = (
    nextModels: ProviderModelProfile[],
    options?: { previousModelId?: string | null; nextModelId?: string | null },
  ) => {
    const previousModelId = options?.previousModelId ?? null
    const nextModelId = options?.nextModelId ?? null

    setProviderProfiles((previous) =>
      previous.map((profile) => {
        if (profile.id !== activeProviderId) {
          return profile
        }

        return {
          ...profile,
          availableModels: nextModels,
          defaultModel: syncTrackedModelValue(profile.defaultModel, previousModelId, nextModelId),
          fastModel: syncTrackedModelValue(profile.fastModel, previousModelId, nextModelId),
          fallbackModel: syncTrackedModelValue(profile.fallbackModel, previousModelId, nextModelId),
        }
      }),
    )

    setPrimaryAssistantModel((current) => syncTrackedModelValue(current, previousModelId, nextModelId))
    setFastAssistantModel((current) => syncTrackedModelValue(current, previousModelId, nextModelId))
  }

  const handleAddProvider = () => {
    const nextProvider = createCustomProvider(providerProfiles.length + 1)

    setProviderProfiles((previous) => [...previous, nextProvider])
    setProviderQuery('')
    setActiveProviderId(nextProvider.id)
    setModelEditorState(null)
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
    const copiedSecret = providerSecretSavedValues[providerId] ?? providerSecretDrafts[providerId] ?? ''
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

    if (!copiedSecret) {
      return
    }

    const result = await saveSettingsWorkspaceProviderApiKey({
      providerId: nextProviderId,
      apiKey: copiedSecret,
    })

    if (!result.ok) {
      setApiKeyFeedback('复制服务商后未能同步 API 密钥')
      return
    }

    setProviderSecretDrafts((previous) => ({
      ...previous,
      [nextProviderId]: result.state.apiKey,
    }))
    setProviderSecretSavedValues((previous) => ({
      ...previous,
      [nextProviderId]: result.state.apiKey,
    }))
  }

  const handleDeleteProvider = async (providerId: string) => {
    const currentIndex = providerProfiles.findIndex((profile) => profile.id === providerId)

    if (currentIndex === -1) {
      return
    }

    const nextActiveProviderId = providerProfiles[currentIndex + 1]?.id
      ?? providerProfiles[currentIndex - 1]?.id
      ?? ''
    const savedSecret = providerSecretSavedValues[providerId] ?? ''

    setProviderProfiles((previous) => previous.filter((profile) => profile.id !== providerId))
    setProviderSecretDrafts((previous) => {
      const { [providerId]: _removedDraft, ...remainingDrafts } = previous
      return remainingDrafts
    })
    setProviderSecretSavedValues((previous) => {
      const { [providerId]: _removedSavedValue, ...remainingSavedValues } = previous
      return remainingSavedValues
    })
    setModelEditorState(null)

    if (providerId === activeProviderId) {
      setActiveProviderId(nextActiveProviderId)
    }

    if (!savedSecret) {
      return
    }

    const result = await clearSettingsWorkspaceProviderApiKey({ providerId })

    if (!result.ok) {
      setApiKeyFeedback('删除服务商后未能清除 API 密钥')
    }
  }

  const handleOpenCreateModelEditor = () => {
    if (!activeProvider) {
      return
    }

    setModelEditorError(null)
    setModelEditorState(createEmptyModelEditorState(activeProvider.name, activeProvider.availableModels.length))
  }

  const handleOpenModelEditor = (index: number) => {
    if (!activeProvider) {
      return
    }

    const currentModel = activeProvider.availableModels[index]

    if (!currentModel) {
      return
    }

    setModelEditorError(null)
    setModelEditorState({
      ...currentModel,
      index,
      advancedOpen: false,
      isNew: false,
    })
  }

  const handleCloseModelEditor = () => {
    setModelEditorError(null)
    setModelEditorState(null)
  }

  const updateModelEditorState = (patch: Partial<ModelEditorState>) => {
    setModelEditorState((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  const handleToggleModelCapability = (capability: ModelCapability) => {
    setModelEditorState((previous) => {
      if (!previous) {
        return previous
      }

      const capabilities = previous.capabilities.includes(capability)
        ? previous.capabilities.filter((item) => item !== capability)
        : [...previous.capabilities, capability]

      return {
        ...previous,
        capabilities,
      }
    })
  }

  const handleSaveModel = () => {
    if (!modelEditorState || !activeProvider) {
      return
    }

    const nextModelId = modelEditorState.modelId.trim()

    if (!nextModelId) {
      return
    }

    const duplicateModelIndex = activeProvider.availableModels.findIndex((model, index) => {
      return model.modelId === nextModelId && index !== modelEditorState.index
    })

    if (duplicateModelIndex !== -1) {
      setModelEditorError('模型 ID 已存在，请使用不同的模型 ID。')
      return
    }

    const nextModel: ProviderModelProfile = {
      id: modelEditorState.isNew ? createModelProfileId(activeProvider.id, nextModelId) : modelEditorState.id,
      modelId: nextModelId,
      displayName: modelEditorState.displayName.trim() || formatModelDisplayName(nextModelId),
      groupName: modelEditorState.groupName.trim() || formatModelGroupName(nextModelId, activeProvider.name),
      capabilities: modelEditorState.capabilities.length > 0 ? modelEditorState.capabilities : ['reasoning'],
      supportsStreaming: modelEditorState.supportsStreaming,
      currency: modelEditorState.currency,
      inputPrice: modelEditorState.inputPrice,
      outputPrice: modelEditorState.outputPrice,
    }

    if (modelEditorState.isNew) {
      commitActiveProviderModels([...activeProvider.availableModels, nextModel])
    } else {
      const previousModelId = activeProvider.availableModels[modelEditorState.index]?.modelId ?? null
      const nextModels = activeProvider.availableModels.map((model, modelIndex) => {
        return modelIndex === modelEditorState.index ? nextModel : model
      })

      commitActiveProviderModels(nextModels, { previousModelId, nextModelId })
    }

    setModelEditorState(null)
  }

  const handleRemoveModel = (index: number) => {
    if (!activeProvider) {
      return
    }

    const previousModelId = activeProvider.availableModels[index]?.modelId ?? null
    const nextModels = activeProvider.availableModels.filter((_, modelIndex) => modelIndex !== index)

    commitActiveProviderModels(nextModels, {
      previousModelId,
      nextModelId: nextModels[0]?.modelId ?? null,
    })
    setModelEditorState(null)
  }

  const handleWakeupLinkParse = async () => {
    const parseStatus = await resolveWakeupShareLinkParseStatus(wakeupShareLink)
    setWakeupDialogState(parseStatus === 'success' ? { status: 'success' } : { status: 'failure' })
  }

  const handleWakeupDialogClose = () => {
    setWakeupDialogState(null)
  }

  const handleWakeupConflictChoice = () => {
    setWakeupDialogState(null)
  }

  return (
    <section className="workspace-stage settings-workspace" aria-label="设置工作区">
      <aside className="workspace-panel settings-panel" aria-label="设置导航列">
        <header className="panel-head">
          <p className="panel-head__eyebrow">设置</p>
          <h1 className="panel-head__title">全局设置目录</h1>
        </header>

        <ul className="settings-nav-list">
          {settingsItems.map((item) => {
            const Icon = item.icon
            const active = item.id === activeSection

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`settings-nav-item${active ? ' settings-nav-item--active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={16} className="settings-nav-item__icon" />
                  <span className="settings-nav-item__body">
                    <span className="settings-nav-item__title">{item.label}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>

      <main className="workspace-main" aria-label="设置主内容区">
        <header className="workspace-main__header">
          <h2 className="workspace-main__title">{activeSettingsItem.label}</h2>
        </header>

        <section className="workspace-main__content workspace-main__content--flush workspace-main__content--settings">
          {(() => {
            switch (activeSection) {
              case 'sustech-info':
                return (
                  <div className="settings-page settings-page--split settings-page--balanced">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">基本信息</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <TextField
                            label="学号"
                            value={studentId}
                            onChange={setStudentId}
                            placeholder="输入学号"
                          />
                          <label className="form-field">
                            <span className="form-field__meta">
                              <span className="form-field__label">邮箱</span>
                            </span>
                            <input
                              className="text-input"
                              type="text"
                              value={displayedSustechEmail}
                              placeholder="输入邮箱"
                              onFocus={() => setSustechEmailFocused(true)}
                              onBlur={() => setSustechEmailFocused(false)}
                              onChange={(event) => setSustechEmail(event.target.value)}
                            />
                          </label>
                          <label className="form-field form-field--full" htmlFor="sustech-cas-password-input">
                            <span className="form-field__meta">
                              <span className="form-field__label">CAS 密码</span>
                            </span>
                            <input
                              id="sustech-cas-password-input"
                              data-testid="sustech-cas-password-input"
                              className="text-input"
                              type="password"
                              value={casPasswordDraft}
                              placeholder="输入 CAS 密码"
                              onChange={(event) => setCasPasswordDraft(event.target.value)}
                              onBlur={() => {
                                void handlePersistCasPasswordDraft()
                              }}
                            />
                            {casPasswordFeedback ? (
                              <span className="form-field__feedback form-field__feedback--success" role="status">
                                {casPasswordFeedback}
                              </span>
                            ) : null}
                          </label>
                        </div>
                      </div>
                    </section>

                    <div className="settings-detail-column">
                      <section className="settings-card settings-card--form">
                        <div className="settings-card__header">
                          <div>
                            <h3 className="settings-card__title">Blackboard 信息</h3>
                          </div>
                        </div>

                        <div className="settings-stack">
                          <ToggleSwitch
                            label="自动下载 Blackboard 文件"
                            checked={blackboardAutoDownloadEnabled}
                            onChange={setBlackboardAutoDownloadEnabled}
                          />
                          <TextField
                            label="下载文件大小限制（MB）"
                            value={blackboardDownloadLimitMb}
                            onChange={(value) => {
                              if (/^\d*$/.test(value)) {
                                setBlackboardDownloadLimitMb(value === '' ? '' : String(Number.parseInt(value, 10) || 0))
                              }
                            }}
                            placeholder="0"
                          />
                          <p className="form-field__description">0为不限制</p>
                        </div>
                      </section>

                      <section className="settings-card settings-card--form">
                        <div className="settings-card__header">
                          <div>
                            <h3 className="settings-card__title">TIS 信息</h3>
                          </div>
                        </div>

                        <div className="settings-stack">
                          <p className="settings-empty-hint">敬请期待</p>
                        </div>
                      </section>
                    </div>
                  </div>
                )

              case 'model-service':
                return (
                  <ProviderProfilesSection
                    providerProfiles={providerProfiles}
                    activeProviderId={activeProviderId}
                    activeProvider={activeProvider}
                    activeProviderDetail={activeProviderDetail}
                    providerQuery={providerQuery}
                    activeProviderApiKeyDraft={activeProviderApiKeyDraft}
                    apiKeyVisible={apiKeyVisible}
                    apiKeyFeedback={apiKeyFeedback}
                    modelEditorState={modelEditorState}
                    modelEditorError={modelEditorError}
                    onProviderQueryChange={setProviderQuery}
                    onActiveProviderChange={setActiveProviderId}
                    onAddProvider={handleAddProvider}
                    onReorderProviders={moveProviderToIndex}
                    onCopyProvider={handleCopyProvider}
                    onDeleteProvider={handleDeleteProvider}
                    onUpdateActiveProvider={updateActiveProvider}
                    onProviderApiKeyDraftChange={(providerId, value) => {
                      setProviderSecretDrafts((previous) => ({
                        ...previous,
                        [providerId]: value,
                      }))
                    }}
                    onPersistProviderApiKeyDraft={handlePersistProviderApiKeyDraft}
                    onToggleApiKeyVisibility={() => setApiKeyVisible((previous) => !previous)}
                    onCopyApiKey={handleCopyApiKey}
                    onOpenCreateModelEditor={handleOpenCreateModelEditor}
                    onOpenModelEditor={handleOpenModelEditor}
                    onRemoveModel={handleRemoveModel}
                    onCloseModelEditor={handleCloseModelEditor}
                    onModelEditorSave={handleSaveModel}
                    onModelEditorStateChange={updateModelEditorState}
                    onToggleModelCapability={handleToggleModelCapability}
                    onClearModelEditorError={() => setModelEditorError(null)}
                  />
                )

              case 'default-model':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">默认模型路由</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="主助手模型"
                            value={primaryAssistantModel}
                            options={allModelOptions}
                            onChange={setPrimaryAssistantModel}
                          />
                          <SelectField
                            label="快速执行模型"
                            value={fastAssistantModel}
                            options={allModelOptions}
                            onChange={setFastAssistantModel}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'general':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">常规设置</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="界面语言"
                            value={language}
                            options={languageOptions}
                            onChange={setLanguage}
                          />
                          <SelectField
                            label="代理模式"
                            value={proxyMode}
                            options={proxyModeOptions}
                            onChange={setProxyMode}
                          />
                        </div>

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="助手消息通知"
                            checked={assistantNotificationsEnabled}
                            onChange={setAssistantNotificationsEnabled}
                          />
                          <ToggleSwitch
                            label="自动备份"
                            checked={backupEnabled}
                            onChange={setBackupEnabled}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'display':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">显示设置</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid">
                          <SelectField
                            label="主题"
                            value={themeMode}
                            options={themeOptions}
                            onChange={(value) => {
                              if (isThemeMode(value)) {
                                onThemeModeChange(value)
                              }
                            }}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'data':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">数据设置</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <TextField
                            label="数据目录"
                            value={dataPath}
                            onChange={setDataPath}
                            placeholder="输入本地目录"
                          />
                          <SelectField
                            label="备份周期"
                            value={backupCycle}
                            options={backupCycleOptions}
                            onChange={setBackupCycle}
                          />
                        </div>

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="启用自动备份"
                            checked={backupEnabled}
                            onChange={setBackupEnabled}
                          />
                          <ToggleSwitch
                            label="启动时同步"
                            checked={launchSyncEnabled}
                            onChange={setLaunchSyncEnabled}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'mcp':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">MCP 服务器</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="工具权限策略"
                            value={toolPermissionMode}
                            options={toolPermissionOptions}
                            onChange={setToolPermissionMode}
                          />
                        </div>

                        <div className="toggle-grid">
                          <ToggleSwitch
                            label="自动发现 MCP 服务"
                            checked={mcpAutoDiscoveryEnabled}
                            onChange={setMcpAutoDiscoveryEnabled}
                          />
                        </div>
                      </div>
                    </section>
                  </div>
                )

              case 'search':
                return (
                  <div className="settings-page settings-page--split settings-page--balanced">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">搜索服务商</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <SelectField
                          label="默认搜索引擎"
                          value={searchEngine}
                          options={searchEngineOptions}
                          onChange={setSearchEngine}
                        />
                        <SelectField
                          label="结果数量"
                          value={searchResultCount}
                          options={resultCountOptions}
                          onChange={setSearchResultCount}
                        />
                      </div>
                    </section>

                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">网络搜索配置</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <SelectField
                          label="压缩方式"
                          value={compressionMode}
                          options={compressionOptions}
                          onChange={setCompressionMode}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'memory':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">全局记忆</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <SelectField
                          label="记忆策略"
                          value={memoryStrategy}
                          options={memoryStrategyOptions}
                          onChange={setMemoryStrategy}
                        />
                        <ToggleSwitch
                          label="自动清理陈旧记忆"
                          checked={memoryCleanupEnabled}
                          onChange={setMemoryCleanupEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'api':
                return (
                  <div className="settings-page">
                    <HostConfigRuntimeOverrideCard />

                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header settings-card__header--spaced">
                        <div>
                          <h3 className="settings-card__title">API 服务器</h3>
                        </div>
                        <span className={`inline-badge ${resolveBootstrapBadgeClass(bootstrap.state)}`}>
                          {formatBootstrapStatusLabel(bootstrap.state)}
                        </span>
                      </div>

                      <div className="settings-stack">
                        <div className="settings-card__header">
                          <div>
                            <h4 className="settings-card__title">根层启动摘要</h4>
                          </div>
                        </div>

                        <div className="workspace-facts">
                          <article className="workspace-fact">
                            <span>当前状态</span>
                            <strong>{formatBootstrapStatusLabel(bootstrap.state)}</strong>
                          </article>
                          <article className="workspace-fact">
                            <span>重试动作</span>
                            <strong>{bootstrap.retrying ? '根层重试中' : '由根层统一持有'}</strong>
                          </article>
                        </div>

                        <div className="toolbar-actions">
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={bootstrap.retry}
                            disabled={bootstrap.retrying}
                          >
                            {bootstrap.retrying ? '正在重试…' : '重试读取运行态'}
                          </button>
                        </div>

                        <div className="form-grid form-grid--two">
                          <TextField
                            label="后端地址"
                            value={apiBaseUrl}
                            onChange={setApiBaseUrl}
                            placeholder="http://127.0.0.1:8000"
                            type="url"
                          />
                          <SelectField
                            label="重连策略"
                            value={apiReconnectMode}
                            options={apiReconnectOptions}
                            onChange={setApiReconnectMode}
                          />
                        </div>

                        <ToggleSwitch
                          label="启用健康检查轮询"
                          checked={healthPollingEnabled}
                          onChange={setHealthPollingEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'docs':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">文档处理</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <div className="form-grid form-grid--two">
                          <SelectField
                            label="默认导出格式"
                            value={docsFormat}
                            options={docsFormatOptions}
                            onChange={setDocsFormat}
                          />
                          <TextField
                            label="输出目录"
                            value={outputDirectory}
                            onChange={setOutputDirectory}
                            placeholder="输入导出目录"
                          />
                        </div>

                        <ToggleSwitch
                          label="自动生成文件名"
                          checked={autoFileNameEnabled}
                          onChange={setAutoFileNameEnabled}
                        />
                      </div>
                    </section>
                  </div>
                )

              case 'external-source':
                return (
                  <div className="settings-page">
                    <section className="settings-card settings-card--form">
                      <div className="settings-card__header">
                        <div>
                          <h3 className="settings-card__title">WakeUP 课程群同步</h3>
                        </div>
                      </div>

                      <div className="settings-stack">
                        <label className="form-field form-field--full">
                          <span className="form-field__meta">
                            <span className="form-field__label">WakeUP 分享链接</span>
                          </span>
                          <span className="text-input-shell">
                            <input
                              data-testid="wakeup-share-link-input"
                              className="text-input text-input-shell__input"
                              type="text"
                              value={wakeupShareLink}
                              placeholder="输入 WakeUP 分享链接"
                              onChange={(event) => setWakeupShareLink(event.target.value)}
                            />
                            <span className="text-input-shell__actions">
                              <button
                                type="button"
                                className="icon-button icon-button--compact"
                                data-testid="wakeup-parse-button"
                                aria-label="解析链接"
                                onClick={() => {
                                  void handleWakeupLinkParse()
                                }}
                              >
                                <Link2 size={14} />
                              </button>
                            </span>
                          </span>
                        </label>
                      </div>
                    </section>

                    {wakeupDialogState ? (
                      <div className="model-editor-backdrop" role="presentation" onClick={handleWakeupDialogClose}>
                        <section
                          className="model-editor-modal model-editor-modal--compact"
                          role="dialog"
                          aria-modal="true"
                          aria-label="WakeUP 链接解析"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="model-editor-modal__header">
                            <div>
                              <h3 className="settings-card__title">解析链接</h3>
                            </div>
                            <button
                              type="button"
                              className="model-editor-modal__close"
                              aria-label="关闭解析弹窗"
                              onClick={handleWakeupDialogClose}
                            >
                              <X size={14} />
                            </button>
                          </div>

                          <div className="model-editor-modal__body">
                            {wakeupDialogState.status === 'failure' ? (
                              <p data-testid="wakeup-parse-failure">解析未成功</p>
                            ) : (
                              <div className="settings-stack" data-testid="wakeup-parse-success">
                                <button type="button" className="secondary-button" onClick={handleWakeupConflictChoice}>保留 WakeUP版本</button>
                                <button type="button" className="secondary-button" onClick={handleWakeupConflictChoice}>保留 TIS 版本</button>
                                <button type="button" className="primary-button" onClick={handleWakeupConflictChoice}>尝试智能解析</button>
                                <button type="button" className="ghost-button" onClick={handleWakeupDialogClose}>取消</button>
                              </div>
                            )}
                          </div>
                        </section>
                      </div>
                    ) : null}
                  </div>
                )
            }
          })()}
        </section>
      </main>
    </section>
  )
}

async function resolveWakeupShareLinkParseStatus(value: string): Promise<'success' | 'failure'> {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return 'failure'
  }

  return normalizedValue.includes('success') || normalizedValue.includes('wakeup') ? 'success' : 'failure'
}

function applyLoadedWorkspaceState(
  state: SettingsWorkspaceEditableState,
  setters: {
    activeProviderId: string
    setStudentId: (value: string) => void
    setSustechEmail: (value: string) => void
    setBlackboardAutoDownloadEnabled: (value: boolean) => void
    setBlackboardDownloadLimitMb: (value: string) => void
    setProviderProfiles: (value: ProviderProfile[]) => void
    setActiveProviderId: (value: string) => void
    setPrimaryAssistantModel: (value: string) => void
    setFastAssistantModel: (value: string) => void
    setLanguage: (value: string) => void
    setProxyMode: (value: string) => void
    setAssistantNotificationsEnabled: (value: boolean) => void
    setBackupEnabled: (value: boolean) => void
    setDataPath: (value: string) => void
    setBackupCycle: (value: string) => void
    setLaunchSyncEnabled: (value: boolean) => void
    setMcpAutoDiscoveryEnabled: (value: boolean) => void
    setToolPermissionMode: (value: string) => void
    setSearchEngine: (value: string) => void
    setSearchResultCount: (value: string) => void
    setCompressionMode: (value: string) => void
    setMemoryStrategy: (value: string) => void
    setMemoryCleanupEnabled: (value: boolean) => void
    setApiReconnectMode: (value: string) => void
    setHealthPollingEnabled: (value: boolean) => void
    setApiBaseUrl: (value: string) => void
    setDocsFormat: (value: string) => void
    setOutputDirectory: (value: string) => void
    setAutoFileNameEnabled: (value: boolean) => void
    setWakeupShareLink: (value: string) => void
  },
): void {
  setters.setStudentId(state.sustech.studentId)
  setters.setSustechEmail(state.sustech.email)
  setters.setBlackboardAutoDownloadEnabled(state.sustech.blackboardAutoDownloadEnabled)
  setters.setBlackboardDownloadLimitMb(state.sustech.blackboardDownloadLimitMb)
  setters.setProviderProfiles(state.providerProfiles)
  setters.setActiveProviderId(
    state.providerProfiles.some((profile) => profile.id === setters.activeProviderId)
      ? setters.activeProviderId
      : state.providerProfiles[0]?.id ?? '',
  )
  setters.setPrimaryAssistantModel(state.defaultModelRouting.primaryAssistantModel)
  setters.setFastAssistantModel(state.defaultModelRouting.fastAssistantModel)
  setters.setLanguage(state.general.language)
  setters.setProxyMode(state.general.proxyMode)
  setters.setAssistantNotificationsEnabled(state.general.assistantNotificationsEnabled)
  setters.setBackupEnabled(state.general.backupEnabled)
  setters.setDataPath(state.data.dataPath)
  setters.setBackupCycle(state.data.backupCycle)
  setters.setLaunchSyncEnabled(state.data.launchSyncEnabled)
  setters.setMcpAutoDiscoveryEnabled(state.mcp.mcpAutoDiscoveryEnabled)
  setters.setToolPermissionMode(state.mcp.toolPermissionMode)
  setters.setSearchEngine(state.search.searchEngine)
  setters.setSearchResultCount(state.search.searchResultCount)
  setters.setCompressionMode(state.search.compressionMode)
  setters.setMemoryStrategy(state.memory.memoryStrategy)
  setters.setMemoryCleanupEnabled(state.memory.memoryCleanupEnabled)
  setters.setApiReconnectMode(state.api.apiReconnectMode)
  setters.setHealthPollingEnabled(state.api.healthPollingEnabled)
  setters.setApiBaseUrl(state.api.apiBaseUrl)
  setters.setDocsFormat(state.docs.docsFormat)
  setters.setOutputDirectory(state.docs.outputDirectory)
  setters.setAutoFileNameEnabled(state.docs.autoFileNameEnabled)
  setters.setWakeupShareLink(state.externalSource.wakeupShareLink)
}

function formatBootstrapStatusLabel(state: CopilotBootstrapState): string {
  switch (state.status) {
    case 'loading':
      return '根层读取中'
    case 'empty':
      return '尚未配置'
    case 'incomplete':
      return '配置缺失'
    case 'starting':
      return '宿主启动中'
    case 'ready':
      return '运行态已就绪'
    case 'failed':
      return '宿主启动失败'
    case 'degraded':
      return '运行态降级'
    case 'error':
      return '读取失败'
  }
}

function resolveBootstrapBadgeClass(state: CopilotBootstrapState): string {
  switch (state.status) {
    case 'ready':
      return 'inline-badge--success'
    case 'degraded':
    case 'starting':
    case 'loading':
      return 'inline-badge--primary'
    default:
      return 'inline-badge--warning'
  }
}
