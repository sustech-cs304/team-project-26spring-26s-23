/** @vitest-environment jsdom */

import type { ComponentProps, ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'

import type {
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSecretsApi,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateApi,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from '../../../electron/settings-workspace/ipc'
import type { SettingsWorkspaceEditableState, SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import type { ProviderProfile } from '../types'
import { createProviderModelProfile } from './provider-profiles'
import { SettingsWorkspace } from './SettingsWorkspace'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (window as Partial<Window>).settingsWorkspaceState
  delete (window as Partial<Window>).settingsWorkspaceSecrets
})

interface WorkspaceStateOverrides {
  sustech?: Partial<SettingsWorkspaceEditableState['sustech']>
  providerProfiles?: ProviderProfile[]
  defaultModelRouting?: Partial<SettingsWorkspaceEditableState['defaultModelRouting']>
  general?: Partial<SettingsWorkspaceEditableState['general']>
  data?: Partial<SettingsWorkspaceEditableState['data']>
  mcp?: Partial<SettingsWorkspaceEditableState['mcp']>
  search?: Partial<SettingsWorkspaceEditableState['search']>
  memory?: Partial<SettingsWorkspaceEditableState['memory']>
  api?: Partial<SettingsWorkspaceEditableState['api']>
  docs?: Partial<SettingsWorkspaceEditableState['docs']>
  externalSource?: Partial<SettingsWorkspaceEditableState['externalSource']>
}

interface InstallSettingsWorkspaceBridgeOptions {
  loadStateResult?: SettingsWorkspaceStateLoadResult
  saveStateResult?: SettingsWorkspaceStateSaveResult
  loadStatusesResult?: SettingsWorkspaceSecretsLoadStatusesResult
  loadSustechCasPasswordResult?: SettingsWorkspaceSustechCasSecretLoadResult
  saveProviderApiKeyResult?: SettingsWorkspaceProviderSecretMutationResult
  clearProviderApiKeyResult?: SettingsWorkspaceProviderSecretMutationResult
  saveSustechCasPasswordResult?: SettingsWorkspaceSustechCasSecretMutationResult
  clearSustechCasPasswordResult?: SettingsWorkspaceSustechCasSecretMutationResult
}

export interface RenderedSettingsWorkspace {
  container: HTMLDivElement
  getByTestId: (testId: string) => HTMLElement
  queryByTestId: (testId: string) => Element | null
  getByText: (text: string) => HTMLElement
  queryByText: (text: string) => HTMLElement | null
  getByPlaceholder: (placeholder: string) => HTMLElement
  unmount: () => void
}

export function createBootstrapController(): CopilotBootstrapController {
  return {
    retrying: false,
    retry: vi.fn(),
    state: {
      status: 'ready',
      bootstrapFields: {
        runtimeUrl: 'http://127.0.0.1:8765',
        agentName: 'campus-agent',
      },
      storageState: 'stored',
      runtime: {
        status: 'ready',
        expectedMode: 'development',
        resolvedMode: 'development',
        runtimeUrl: 'http://127.0.0.1:8765',
        isPackaged: false,
        failure: null,
      },
      runtimeUrl: 'http://127.0.0.1:8765',
      runtimeSource: 'hosted',
      agentName: 'campus-agent',
      agentNameSource: 'config-center',
      diagnostics: {
        hostedStatus: 'ready',
        failure: null,
        mode: 'development',
        modeSource: 'resolved',
        runtimeSource: 'hosted',
      },
      devOverrideAllowed: true,
      devOverrideConfigured: false,
    },
  }
}

export function createProviderProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const id = overrides.id ?? 'openrouter'
  const name = overrides.name ?? 'Persisted Router'

  return {
    id,
    name,
    protocol: overrides.protocol ?? 'openai',
    endpoint: overrides.endpoint ?? 'https://persisted.example.com/v1',
    hasApiKey: overrides.hasApiKey ?? true,
    defaultModel: overrides.defaultModel ?? 'openai/gpt-4.1',
    fastModel: overrides.fastModel ?? 'openai/gpt-4.1-mini',
    fallbackModel: overrides.fallbackModel ?? 'anthropic/claude-3.7-sonnet',
    organization: overrides.organization ?? 'persisted-org',
    region: overrides.region ?? 'Global',
    notes: overrides.notes ?? 'persisted provider note',
    availableModels:
      overrides.availableModels
      ?? [
        createProviderModelProfile(id, overrides.defaultModel ?? 'openai/gpt-4.1', name),
      ],
  }
}

export function createPersistedWorkspaceState(overrides: WorkspaceStateOverrides = {}): SettingsWorkspaceEditableState {
  const baseState: SettingsWorkspaceEditableState = {
    sustech: {
      studentId: '',
      email: '',
      blackboardAutoDownloadEnabled: false,
      blackboardDownloadLimitMb: '0',
    },
    providerProfiles: [createProviderProfile()],
    defaultModelRouting: {
      primaryAssistantModel: 'openai/gpt-4.1',
      fastAssistantModel: 'openai/gpt-4.1-mini',
    },
    general: {
      language: 'zh-CN',
      proxyMode: 'system',
      assistantNotificationsEnabled: true,
      backupEnabled: false,
    },
    data: {
      dataPath: 'D:/workspace/persisted-data',
      backupCycle: 'daily',
      launchSyncEnabled: true,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
    },
    search: {
      searchEngine: 'google',
      searchResultCount: '8',
      compressionMode: 'summary',
    },
    memory: {
      memoryStrategy: 'session-longterm',
      memoryCleanupEnabled: true,
    },
    api: {
      apiReconnectMode: 'exponential',
      healthPollingEnabled: true,
      apiBaseUrl: 'http://127.0.0.1:8000',
    },
    docs: {
      docsFormat: 'markdown',
      outputDirectory: 'D:/workspace/exports',
      autoFileNameEnabled: true,
    },
    externalSource: {
      wakeupShareLink: '',
    },
  }

  return {
    sustech: { ...baseState.sustech, ...overrides.sustech },
    providerProfiles: overrides.providerProfiles ?? baseState.providerProfiles,
    defaultModelRouting: { ...baseState.defaultModelRouting, ...overrides.defaultModelRouting },
    general: { ...baseState.general, ...overrides.general },
    data: { ...baseState.data, ...overrides.data },
    mcp: { ...baseState.mcp, ...overrides.mcp },
    search: { ...baseState.search, ...overrides.search },
    memory: { ...baseState.memory, ...overrides.memory },
    api: { ...baseState.api, ...overrides.api },
    docs: { ...baseState.docs, ...overrides.docs },
    externalSource: { ...baseState.externalSource, ...overrides.externalSource },
  }
}

export function createSingleProviderWorkspaceState(providerOverrides: Partial<ProviderProfile> = {}): SettingsWorkspaceEditableState {
  return createPersistedWorkspaceState({
    providerProfiles: [createProviderProfile(providerOverrides)],
  })
}

export function createPersistedSecretStatesResult(apiKey = 'persisted-secret', providerId = 'openrouter'): SettingsWorkspaceSecretsLoadStatusesResult {
  return {
    ok: true,
    states: {
      [providerId]: {
        hasApiKey: apiKey !== '',
        apiKey,
      },
    },
  }
}

export function installSettingsWorkspaceBridge(options: InstallSettingsWorkspaceBridgeOptions = {}) {
  const loadState = vi.fn<() => Promise<SettingsWorkspaceStateLoadResult>>().mockResolvedValue(
    options.loadStateResult ?? {
      ok: true,
      source: 'stored',
      state: createPersistedWorkspaceState(),
    },
  )
  const saveState = vi.fn<(input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>>().mockImplementation(
    async () => options.saveStateResult ?? { ok: true, state: createPersistedWorkspaceState() },
  )
  const loadStatuses = vi.fn<SettingsWorkspaceSecretsApi['loadStatuses']>().mockResolvedValue(
    options.loadStatusesResult ?? createPersistedSecretStatesResult(),
  )
  const loadSustechCasPassword = vi.fn<SettingsWorkspaceSecretsApi['loadSustechCasPassword']>().mockResolvedValue(
    options.loadSustechCasPasswordResult ?? {
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    },
  )
  const saveProviderApiKey = vi.fn<SettingsWorkspaceSecretsApi['saveProviderApiKey']>().mockResolvedValue(
    options.saveProviderApiKeyResult ?? {
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: true,
        apiKey: 'persisted-secret',
      },
    },
  )
  const clearProviderApiKey = vi.fn<SettingsWorkspaceSecretsApi['clearProviderApiKey']>().mockResolvedValue(
    options.clearProviderApiKeyResult ?? {
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    },
  )
  const saveSustechCasPassword = vi.fn<SettingsWorkspaceSecretsApi['saveSustechCasPassword']>().mockResolvedValue(
    options.saveSustechCasPasswordResult ?? {
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    },
  )
  const clearSustechCasPassword = vi.fn<SettingsWorkspaceSecretsApi['clearSustechCasPassword']>().mockResolvedValue(
    options.clearSustechCasPasswordResult ?? {
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    },
  )

  const stateApi: SettingsWorkspaceStateApi = {
    load: loadState,
    save: saveState,
  }
  const secretsApi: SettingsWorkspaceSecretsApi = {
    loadStatuses,
    loadSustechCasPassword,
    saveProviderApiKey,
    clearProviderApiKey,
    saveSustechCasPassword,
    clearSustechCasPassword,
  }

  Object.assign(window, {
    settingsWorkspaceState: stateApi,
    settingsWorkspaceSecrets: secretsApi,
  })

  return {
    stateApi,
    secretsApi,
    loadState,
    saveState,
    loadStatuses,
    loadSustechCasPassword,
    saveProviderApiKey,
    clearProviderApiKey,
    saveSustechCasPassword,
    clearSustechCasPassword,
  }
}

export function renderSettingsWorkspace(
  overrides: Partial<ComponentProps<typeof SettingsWorkspace>> = {},
): RenderedSettingsWorkspace {
  return renderWithRoot(
    <SettingsWorkspace
      bootstrap={createBootstrapController()}
      themeMode="light"
      onThemeModeChange={vi.fn()}
      {...overrides}
    />,
  )
}

export function renderWithRoot(element: ReactElement): RenderedSettingsWorkspace {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target as HTMLElement
    },
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`)
    },
    getByText(text: string) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      })

      if (target === undefined) {
        throw new Error(`Missing element for text=${text}`)
      }

      return target
    },
    queryByText(text: string) {
      return Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      }) ?? null
    },
    getByPlaceholder(placeholder: string) {
      const target = container.querySelector(`[placeholder="${placeholder}"]`)
      if (target === null) {
        throw new Error(`Missing element for placeholder=${placeholder}`)
      }

      return target as HTMLElement
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

export async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

export async function contextMenuElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 64, clientY: 48 }))
  })
}

export async function focusElement(element: HTMLElement) {
  await act(async () => {
    element.focus()
  })
}

export async function blurElement(element: HTMLElement) {
  await act(async () => {
    element.focus()
    element.blur()
    element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

export async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set

  if (valueSetter === undefined) {
    throw new Error('Unable to resolve native value setter')
  }

  await act(async () => {
    const previousValue = element.value
    valueSetter.call(element, value)
    const tracker = (element as HTMLInputElement & { _valueTracker?: { setValue: (nextValue: string) => void } })._valueTracker
    tracker?.setValue(previousValue)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function waitForNextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

export async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

export function mockClipboardWriteText() {
  const clipboardWriteText = vi.fn<(_value: string) => Promise<void>>(async () => undefined)

  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: clipboardWriteText,
    },
  })

  return clipboardWriteText
}

export function mockListItemRect(element: HTMLElement, top: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: top,
    top,
    left: 0,
    right: 240,
    bottom: top + 40,
    width: 240,
    height: 40,
    toJSON() {
      return {}
    },
  })
}

export function mockButtonRect(element: HTMLElement) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 240,
    bottom: 40,
    width: 240,
    height: 40,
    toJSON() {
      return {}
    },
  })
}
