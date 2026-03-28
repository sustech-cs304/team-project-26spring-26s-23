import { Copy, Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import type { CopilotBootstrapController, CopilotBootstrapState } from '../../features/copilot/types'
import { settingsItems } from '../config'
import { SelectField, TextareaField, TextField, ToggleSwitch } from '../components/FormFields'
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
  currencyOptions,
  docsFormatOptions,
  initialProviderProfiles,
  languageOptions,
  memoryStrategyOptions,
  modelCapabilityOptions,
  protocolOptions,
  proxyModeOptions,
  resultCountOptions,
  searchEngineOptions,
  themeOptions,
  toolPermissionOptions,
} from './config'
import {
  clearSettingsWorkspaceProviderApiKey,
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceProviderApiKey,
  saveSettingsWorkspaceState,
} from './workspace-state'
import {
  HostConfigRuntimeOverrideCard,
} from './ConfigCenterPublicFieldCards'

interface SettingsWorkspaceProps {
  bootstrap: CopilotBootstrapController
  themeMode: ThemeMode
  onThemeModeChange: (value: ThemeMode) => void
  initialSection?: SettingsSection
}

type ModelEditorState = ProviderModelProfile & {
  index: number
  advancedOpen: boolean
  isNew: boolean
}

const focusableElementSelector = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function isFocusableElementVisible(element: HTMLElement) {
  let current: HTMLElement | null = element

  while (current) {
    const style = window.getComputedStyle(current)

    if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
      return false
    }

    current = current.parentElement
  }

  return true
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableElementSelector)).filter((element) => {
    if (element.tabIndex < 0 || element.hasAttribute('disabled') || element.getAttribute('aria-hidden') === 'true') {
      return false
    }

    if (element instanceof HTMLInputElement && element.type === 'hidden') {
      return false
    }

    return isFocusableElementVisible(element)
  })
}

function titleCaseToken(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatModelDisplayName(modelId: string) {
  const normalized = modelId.trim()

  if (!normalized) {
    return '未命名模型'
  }

  const leaf = normalized.split('/').pop() ?? normalized

  return titleCaseToken(leaf)
}

function formatModelGroupName(modelId: string, providerName: string) {
  const normalized = modelId.trim()

  if (!normalized) {
    return providerName
  }

  const vendor = normalized.includes('/') ? normalized.split('/')[0] : providerName

  return titleCaseToken(vendor)
}

function isThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function getDefaultModelCapabilities(modelId: string): ModelCapability[] {
  const normalized = modelId.toLowerCase()
  const capabilities: ModelCapability[] = []

  if (/(gpt|gemini|claude|vision|vl)/.test(normalized)) {
    capabilities.push('vision')
  }

  if (/(search|web)/.test(normalized)) {
    capabilities.push('search')
  }

  if (/(embed)/.test(normalized)) {
    capabilities.push('embedding')
  }

  if (/(rerank)/.test(normalized)) {
    capabilities.push('rerank')
  }

  if (/(reason|think|claude|gpt|gemini)/.test(normalized)) {
    capabilities.push('reasoning')
  }

  if (/(tool|agent|gpt|gemini|claude)/.test(normalized)) {
    capabilities.push('tools')
  }

  if (capabilities.length === 0) {
    capabilities.push('reasoning')
  }

  return Array.from(new Set(capabilities))
}

function createProviderModelProfile(providerId: string, modelId: string, providerName: string): ProviderModelProfile {
  return {
    id: createModelProfileId(providerId, modelId),
    modelId,
    displayName: formatModelDisplayName(modelId),
    groupName: formatModelGroupName(modelId, providerName),
    capabilities: getDefaultModelCapabilities(modelId),
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
  }
}

function createEmptyModelEditorState(providerName: string, index: number): ModelEditorState {
  return {
    id: '',
    index,
    modelId: '',
    displayName: '',
    groupName: providerName,
    capabilities: ['reasoning', 'tools'],
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
    advancedOpen: false,
    isNew: true,
  }
}

function syncTrackedModelValue(currentValue: string, previousModelId: string | null, nextModelId: string | null) {
  if (!previousModelId || currentValue !== previousModelId) {
    return currentValue
  }

  return nextModelId ?? ''
}

export function SettingsWorkspace({
  bootstrap,
  themeMode,
  onThemeModeChange,
  initialSection,
}: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? 'model-service')
  const [providerProfiles, setProviderProfiles] = useState<ProviderProfile[]>(initialProviderProfiles)
  const [activeProviderId, setActiveProviderId] = useState<string>(initialProviderProfiles[0]?.id ?? '')
  const [providerQuery, setProviderQuery] = useState('')
  const [providerSecretDrafts, setProviderSecretDrafts] = useState<Record<string, string>>({})
  const [providerSecretSavedValues, setProviderSecretSavedValues] = useState<Record<string, string>>({})
  const [modelEditorState, setModelEditorState] = useState<ModelEditorState | null>(null)
  const [modelEditorError, setModelEditorError] = useState<string | null>(null)
  const modelEditorDialogRef = useRef<HTMLElement | null>(null)
  const modelEditorInitialFocusRef = useRef<HTMLInputElement | null>(null)
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)
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

  const activeSettingsItem = useMemo(
    () => settingsItems.find((item) => item.id === activeSection) ?? settingsItems[0],
    [activeSection],
  )

  const activeProvider = useMemo(
    () => providerProfiles.find((profile) => profile.id === activeProviderId) ?? providerProfiles[0],
    [activeProviderId, providerProfiles],
  )

  const filteredProviderProfiles = useMemo(() => {
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
          return (
            model.modelId.toLowerCase().includes(keyword)
            || model.displayName.toLowerCase().includes(keyword)
          )
        })
      )
    })
  }, [providerProfiles, providerQuery])

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
  const modelEditorOpen = modelEditorState !== null
  const modelEditorAdvancedSectionId = 'settings-model-editor-advanced-panel'
  const activeProviderApiKeyDraft = providerSecretDrafts[activeProviderId] ?? ''

  const workspaceStateInput = useMemo<SettingsWorkspaceStateSaveInput>(() => {
    return {
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
    }
  }, [
    apiBaseUrl,
    apiReconnectMode,
    assistantNotificationsEnabled,
    autoFileNameEnabled,
    backupCycle,
    backupEnabled,
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
    toolPermissionMode,
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
          setMemoryStrategy,
          setMemoryCleanupEnabled,
          setApiReconnectMode,
          setHealthPollingEnabled,
          setApiBaseUrl,
          setDocsFormat,
          setOutputDirectory,
          setAutoFileNameEnabled,
        })
        setProviderSecretDrafts({})
        setProviderSecretSavedValues({})
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
    if (!modelEditorOpen) {
      const previousFocusedElement = previouslyFocusedElementRef.current
      previouslyFocusedElementRef.current = null

      if (previousFocusedElement?.isConnected) {
        previousFocusedElement.focus()
      }

      return
    }

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusTimer = window.requestAnimationFrame(() => {
      const dialog = modelEditorDialogRef.current

      if (!dialog) {
        return
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

      if (activeElement && dialog.contains(activeElement) && activeElement !== dialog) {
        return
      }

      const focusTarget = modelEditorInitialFocusRef.current ?? getFocusableElements(dialog)[0] ?? dialog
      focusTarget.focus()
    })

    return () => {
      window.cancelAnimationFrame(focusTimer)
    }
  }, [modelEditorOpen])

  const updateActiveProvider = (patch: Partial<ProviderProfile>) => {
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
    if (!activeProviderApiKeyDraft.trim()) {
      setApiKeyFeedback(activeProvider.hasApiKey ? '已保存密钥不会回填原文，请重新输入后再复制' : '当前没有可复制的 API 密钥')
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
      setProviderSecretSavedValues((previous) => ({
        ...previous,
        [result.providerId]: '',
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
    setProviderSecretSavedValues((previous) => ({
      ...previous,
      [result.providerId]: normalizedDraft,
    }))
    setApiKeyFeedback('已自动保存 API 密钥')
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

  const handleOpenCreateModelEditor = () => {
    setModelEditorError(null)
    setModelEditorState(createEmptyModelEditorState(activeProvider.name, activeProvider.availableModels.length))
  }

  const handleOpenModelEditor = (index: number) => {
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

  const handleModelEditorKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      handleCloseModelEditor()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const dialog = modelEditorDialogRef.current

    if (!dialog) {
      return
    }

    const focusableElements = getFocusableElements(dialog)

    if (focusableElements.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.shiftKey) {
      if (activeIndex <= 0) {
        event.preventDefault()
        lastElement.focus()
      }

      return
    }

    if (activeIndex === -1 || activeIndex === focusableElements.length - 1) {
      event.preventDefault()
      firstElement.focus()
    }
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
    if (!modelEditorState) {
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
    const previousModelId = activeProvider.availableModels[index]?.modelId ?? null
    const nextModels = activeProvider.availableModels.filter((_, modelIndex) => modelIndex !== index)

    commitActiveProviderModels(nextModels, {
      previousModelId,
      nextModelId: nextModels[0]?.modelId ?? null,
    })
    setModelEditorState(null)
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
              case 'model-service':
                return (
                  <div className="settings-page settings-page--split">
                    <section className="settings-card">
                      <div className="settings-card__header settings-card__header--spaced">
                        <div>
                          <h3 className="settings-card__title">模型服务商</h3>
                        </div>
                        <button type="button" className="secondary-button" onClick={handleAddProvider}>
                          <Plus size={14} />
                          <span>添加</span>
                        </button>
                      </div>

                      <div className="search-box search-box--input">
                        <input
                          type="text"
                          className="search-box__input"
                          value={providerQuery}
                          placeholder="搜索服务商、地址或模型..."
                          onChange={(event) => setProviderQuery(event.target.value)}
                        />
                      </div>

                      <ul className="provider-list provider-list--interactive">
                        {filteredProviderProfiles.map((profile) => {
                          const active = profile.id === activeProvider.id

                          return (
                            <li key={profile.id}>
                              <button
                                type="button"
                                className={`provider-card${active ? ' provider-card--active' : ''}`}
                                onClick={() => setActiveProviderId(profile.id)}
                              >
                                <span className="provider-card__title-row">
                                  <span className="provider-card__title">{profile.name}</span>
                                </span>
                                <span className="provider-card__meta-row">
                                 <span className="provider-card__meta">
                                    {
                                      protocolOptions.find((option) => option.value === profile.protocol)?.label
                                      ?? profile.protocol
                                    }
                                  </span>
                                  <span className="provider-card__meta">
                                    {profile.hasApiKey ? '已配置密钥' : '未配置密钥'}
                                  </span>
                                </span>
                                <span className="provider-card__description">{profile.endpoint}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </section>

                    <div className="settings-detail-column">
                      <section className="settings-card settings-card--form">
                        <div className="settings-card__header">
                          <div>
                            <h3 className="settings-card__title">服务商基础信息</h3>
                          </div>
                        </div>

                        <div className="settings-stack">
                          <div className="form-grid form-grid--two">
                            <TextField
                              label="服务商名称"
                              value={activeProvider.name}
                              onChange={(value) => updateActiveProvider({ name: value })}
                              placeholder="输入服务商名称"
                            />
                            <SelectField
                              label="端点类型"
                              value={activeProvider.protocol}
                              options={protocolOptions}
                              onChange={(value) => updateActiveProvider({ protocol: value })}
                            />
                            <TextField
                              label="API 地址"
                              value={activeProvider.endpoint}
                              onChange={(value) => updateActiveProvider({ endpoint: value })}
                              placeholder="https://api.example.com/v1"
                              type="url"
                            />
                            <TextField
                              label="默认模型 ID"
                              value={activeProvider.defaultModel}
                              onChange={(value) => updateActiveProvider({ defaultModel: value })}
                              placeholder="例如 openai/gpt-4.1"
                            />
                            <label className="form-field form-field--full" htmlFor="provider-api-key-input">
                              <span className="form-field__meta">
                                <span className="form-field__label">API 密钥</span>
                              </span>
                              <span className="form-field__description" data-testid="provider-api-key-status">
                                {activeProvider.hasApiKey
                                  ? '当前 provider 已配置密钥；编辑后失焦会自动保存，清空后失焦可清除。原文仅由主进程持有。'
                                  : '当前 provider 尚未配置密钥；输入后失焦会自动保存。'}
                              </span>
                              <span className="text-input-shell">
                                <input
                                  id="provider-api-key-input"
                                  data-testid="provider-api-key-input"
                                  className="text-input text-input-shell__input"
                                  type={apiKeyVisible ? 'text' : 'password'}
                                  value={activeProviderApiKeyDraft}
                                  placeholder={activeProvider.hasApiKey ? '已配置，输入新密钥以替换' : '输入访问密钥'}
                                  onChange={(event) => {
                                    const nextValue = event.target.value
                                    setProviderSecretDrafts((previous) => ({
                                      ...previous,
                                      [activeProvider.id]: nextValue,
                                    }))
                                  }}
                                  onBlur={() => {
                                    void handlePersistProviderApiKeyDraft(activeProvider.id)
                                  }}
                                />
                                <span className="text-input-shell__actions">
                                  <button
                                    type="button"
                                    className="icon-button icon-button--compact"
                                    aria-label={apiKeyVisible ? '隐藏 API 密钥' : '查看 API 密钥原文'}
                                    title={apiKeyVisible ? '隐藏 API 密钥' : '查看 API 密钥原文'}
                                    data-testid="provider-api-key-visibility-toggle"
                                    onClick={() => setApiKeyVisible((previous) => !previous)}
                                  >
                                    {apiKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-button icon-button--compact"
                                    aria-label="复制 API 密钥原文"
                                    title="复制 API 密钥原文"
                                    data-testid="provider-api-key-copy"
                                    onClick={() => {
                                      void handleCopyApiKey()
                                    }}
                                  >
                                    <Copy size={14} />
                                  </button>
                                </span>
                              </span>
                              {apiKeyFeedback ? (
                                <span
                                  className={`form-field__feedback${apiKeyFeedback.startsWith('已复制') ? ' form-field__feedback--success' : ' form-field__feedback--warning'}`}
                                  data-testid="provider-api-key-feedback"
                                  role="status"
                                >
                                  {apiKeyFeedback}
                                </span>
                              ) : null}
                            </label>
                          </div>

                          <TextareaField
                            label="备注与扩展配置"
                            value={activeProvider.notes}
                            onChange={(value) => updateActiveProvider({ notes: value })}
                            placeholder="输入补充说明"
                          />
                        </div>
                      </section>

                      <section className="settings-card settings-card--form">
                        <div className="settings-card__header settings-card__header--spaced">
                          <div>
                            <h3 className="settings-card__title">模型列表管理</h3>
                          </div>
                          <span className="inline-badge">{activeProvider.availableModels.length} 个模型</span>
                        </div>

                        <div className="settings-stack">
                          <div className="model-list-shell">
                            {activeProvider.availableModels.length > 0 ? (
                              activeProvider.availableModels.map((model, index) => {
                                const modelDisplayName = model.displayName || '未命名模型'
                                const modelIdentifier = model.modelId || '未填写模型 ID'

                                return (
                                  <article key={model.id} className="model-list-row">
                                    <div className="model-list-row__main">
                                      <span className="model-list-row__name" title={modelDisplayName}>
                                        {modelDisplayName}
                                      </span>
                                      <span className="model-list-row__id" title={modelIdentifier}>
                                        {modelIdentifier}
                                      </span>
                                      <div className="model-capability-list model-capability-list--compact" aria-label="支持特性">
                                        {model.capabilities.length > 0 ? (
                                          model.capabilities.map((capability) => {
                                            const option = modelCapabilityOptions.find((item) => item.value === capability)

                                            return (
                                              <span
                                                key={`${model.id}-${capability}`}
                                                className={`model-capability-chip model-capability-chip--${capability}`}
                                              >
                                                {option?.label ?? capability}
                                              </span>
                                            )
                                          })
                                        ) : (
                                          <span className="model-capability-chip model-capability-chip--empty">未标记特性</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="model-list-row__actions">
                                      <button
                                        type="button"
                                        className="icon-button"
                                        title={`编辑 ${modelDisplayName}`}
                                        aria-label={`编辑模型 ${modelDisplayName}`}
                                        onClick={() => handleOpenModelEditor(index)}
                                      >
                                        <Pencil size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        className="icon-button icon-button--danger"
                                        title={`删除 ${modelDisplayName}`}
                                        aria-label={`删除模型 ${modelDisplayName}`}
                                        onClick={() => handleRemoveModel(index)}
                                      >
                                        <Trash2 size={14} />
                                      </button>
                                    </div>
                                  </article>
                                )
                              })
                            ) : (
                              <div className="model-list-empty">当前服务商还没有可用模型。点击下方按钮添加第一个模型。</div>
                            )}
                          </div>

                          <button
                            type="button"
                            className="secondary-button secondary-button--subtle"
                            onClick={handleOpenCreateModelEditor}
                          >
                            添加模型
                          </button>
                        </div>
                      </section>

                      {modelEditorState ? (
                        <div className="model-editor-backdrop" role="presentation" onClick={handleCloseModelEditor}>
                          <section
                            ref={modelEditorDialogRef}
                            className="model-editor-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-label={modelEditorState.isNew ? '添加模型' : '编辑模型'}
                            tabIndex={-1}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={handleModelEditorKeyDown}
                          >
                            <div className="model-editor-modal__header">
                              <div>
                                <h3 className="settings-card__title">{modelEditorState.isNew ? '添加模型' : '编辑模型'}</h3>
                              </div>
                              <button
                                type="button"
                                className="model-editor-modal__close"
                                aria-label="关闭模型编辑弹层"
                                onClick={handleCloseModelEditor}
                              >
                                ×
                              </button>
                            </div>

                            <div className="model-editor-modal__body">
                              <div className="form-grid form-grid--two">
                                <TextField
                                  label="模型 ID"
                                  value={modelEditorState.modelId}
                                  onChange={(value) => {
                                    setModelEditorError(null)
                                    updateModelEditorState({ modelId: value })
                                  }}
                                  placeholder="例如 google/gemini-2.5-pro"
                                  inputRef={modelEditorInitialFocusRef}
                                />
                                <TextField
                                  label="模型名称"
                                  value={modelEditorState.displayName}
                                  onChange={(value) => updateModelEditorState({ displayName: value })}
                                  placeholder="例如 Gemini 2.5 Pro"
                                />
                              </div>

                              {modelEditorError ? (
                                <p className="form-field__description" role="alert">
                                  {modelEditorError}
                                </p>
                              ) : null}

                              <div className="model-editor-section">
                                <div className="model-editor-section__header">
                                  <span className="form-field__label">模型类型</span>
                                </div>

                                <div className="model-capability-picker">
                                  {modelCapabilityOptions.map((option) => {
                                    const active = modelEditorState.capabilities.includes(option.value)

                                    return (
                                      <button
                                        key={option.value}
                                        type="button"
                                        aria-pressed={active}
                                        className={`model-capability-button model-capability-button--${option.value}${active ? ' model-capability-button--active' : ''}`}
                                        onClick={() => handleToggleModelCapability(option.value)}
                                      >
                                        {option.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>

                              <div className="model-editor-advanced">
                                <button
                                  type="button"
                                  className="ghost-button model-editor-advanced__toggle"
                                  aria-expanded={modelEditorState.advancedOpen}
                                  aria-controls={modelEditorAdvancedSectionId}
                                  onClick={() => updateModelEditorState({ advancedOpen: !modelEditorState.advancedOpen })}
                                >
                                  {modelEditorState.advancedOpen ? '收起更多设置' : '更多设置'}
                                </button>

                                <div id={modelEditorAdvancedSectionId}>
                                  {modelEditorState.advancedOpen ? (
                                    <div className="model-editor-section">
                                      <div className="form-grid form-grid--pricing">
                                        <SelectField
                                          label="币种"
                                          value={modelEditorState.currency}
                                          options={currencyOptions}
                                          onChange={(value) => updateModelEditorState({ currency: value })}
                                        />
                                        <TextField
                                          label="输入价格"
                                          value={modelEditorState.inputPrice}
                                          onChange={(value) => updateModelEditorState({ inputPrice: value })}
                                          placeholder="0.50"
                                        />
                                        <TextField
                                          label="输出价格"
                                          value={modelEditorState.outputPrice}
                                          onChange={(value) => updateModelEditorState({ outputPrice: value })}
                                          placeholder="3.00"
                                        />
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="model-editor-modal__footer">
                              <button type="button" className="secondary-button" onClick={handleCloseModelEditor}>
                                取消
                              </button>
                              <button
                                type="button"
                                className="primary-button"
                                onClick={handleSaveModel}
                                disabled={!modelEditorState.modelId.trim()}
                              >
                                保存
                              </button>
                            </div>
                          </section>
                        </div>
                      ) : null}
                    </div>
                  </div>
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
            }
          })()}
        </section>
      </main>
    </section>
  )
}

function createCustomProvider(index: number): ProviderProfile {
  const providerId = `custom-provider-${index}`
  const providerName = `Custom Provider ${index}`

  return {
    id: providerId,
    name: providerName,
    protocol: 'openai',
    endpoint: 'https://api.example.com/v1',
    hasApiKey: false,
    defaultModel: 'custom-model',
    fastModel: 'custom-model-fast',
    fallbackModel: 'custom-model-fallback',
    organization: '',
    region: 'Custom',
    notes: '',
    availableModels: [
      createProviderModelProfile(providerId, 'custom-model', providerName),
      createProviderModelProfile(providerId, 'custom-model-fast', providerName),
      createProviderModelProfile(providerId, 'custom-model-fallback', providerName),
    ],
  }
}

function applyLoadedWorkspaceState(
  state: SettingsWorkspaceEditableState,
  setters: {
    activeProviderId: string
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
  },
): void {
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
