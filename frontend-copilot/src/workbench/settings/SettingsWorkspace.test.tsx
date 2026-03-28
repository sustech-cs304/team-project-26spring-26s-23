/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { CopilotBootstrapController } from '../../features/copilot/types'
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
  delete (window as Partial<Window>).settingsWorkspaceState
  delete (window as Partial<Window>).settingsWorkspaceSecrets
})

describe('SettingsWorkspace', () => {
  it('keeps the settings shell intact while removing the top banner chrome', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    expect(html).toContain('全局设置目录')
    expect(html).toContain('模型服务商')
    expect(html).toContain('设置工作区')
    expect(html).not.toContain('当前设置页')
    expect(html).not.toContain('设置布局')
  })

  it('removes assistant behavior and spell-check from the general section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="general"
      />,
    )

    expect(html).toContain('常规设置')
    expect(html).toContain('助手消息通知')
    expect(html).not.toContain('Assistant 行为配置')
    expect(html).not.toContain('默认 Agent 名称')
    expect(html).not.toContain('拼写检查')
  })

  it('keeps only default model routing in the default model section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="default-model"
      />,
    )

    expect(html).toContain('默认模型路由')
    expect(html).toContain('主助手模型')
    expect(html).toContain('快速执行模型')
    expect(html).not.toContain('后端模型')
    expect(html).not.toContain('后端默认模型 ID')
  })

  it('keeps only theme controls in the display section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="dark"
        onThemeModeChange={vi.fn()}
        initialSection="display"
      />,
    )

    expect(html).toContain('显示设置')
    expect(html).toContain('主题')
    expect(html).toContain('class="select-trigger__value">深色</span>')
    expect(html).not.toContain('字号')
    expect(html).not.toContain('界面密度')
    expect(html).not.toContain('启用微动画')
  })

  it('limits provider endpoint types to the five supported options and removes provider state toggles', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    expect(html).toContain('端点类型')
    expect(html).toContain('OpenAI')
    expect(html).toContain('OpenAI-Response')
    expect(html).toContain('Gemini')
    expect(html).toContain('Anthropic')
    expect(html).toContain('Ollama')
    expect(html).not.toContain('OpenAI Compatible')
    expect(html).not.toContain('Custom REST')
    expect(html).not.toContain('启用当前服务商')
    expect(html).not.toContain('设为默认服务商')
    expect(html).not.toContain('启用中')
    expect(html).not.toContain('已停用')
    expect(html).not.toContain('>默认<')
  })

  it('supports showing, hiding, and copying the provider api key', async () => {
    const clipboardWriteText = vi.fn<(_value: string) => Promise<void>>(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    })

    const rendered = renderWithRoot(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    expect(apiKeyInput.type).toBe('password')

    await setFormControlValue(apiKeyInput, 'secret-api-key')
    expect(apiKeyInput.value).toBe('secret-api-key')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('text')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('password')

    await clickElement(rendered.getByTestId('provider-api-key-copy'))
    expect(clipboardWriteText).toHaveBeenCalledWith('secret-api-key')
    expect(rendered.getByTestId('provider-api-key-feedback').textContent).toBe('已复制 API 密钥')

    rendered.unmount()
  })

  it('loads values from the settings workspace source, persists normal edits, and routes provider secret mutations through the dedicated bridge', async () => {
    vi.useFakeTimers()

    const loadState = vi.fn().mockResolvedValue({
      ok: true,
      source: 'stored',
      state: createPersistedWorkspaceState(),
    })
    const saveState = vi.fn().mockResolvedValue({
      ok: true,
      state: createPersistedWorkspaceState(),
    })
    const saveProviderApiKey = vi.fn().mockResolvedValue({
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: true,
      },
    })
    const clearProviderApiKey = vi.fn().mockResolvedValue({
      ok: true,
      providerId: 'openrouter',
      state: {
        hasApiKey: false,
      },
    })

    Object.assign(window, {
      settingsWorkspaceState: {
        load: loadState,
        save: saveState,
      },
      settingsWorkspaceSecrets: {
        loadStatuses: vi.fn().mockResolvedValue({ ok: true, states: {} }),
        saveProviderApiKey,
        clearProviderApiKey,
      },
    })

    const rendered = renderWithRoot(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    await flushAsyncEffects()

    expect(loadState).toHaveBeenCalledOnce()

    const providerNameInput = rendered.getByPlaceholder('输入服务商名称') as HTMLInputElement
    expect(providerNameInput.value).toBe('Persisted Router')
    expect(rendered.getByTestId('provider-api-key-status').textContent).toContain('当前 provider 已配置密钥')

    await setFormControlValue(providerNameInput, 'Renamed Router')
    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    expect(saveState).toHaveBeenCalled()
    const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
    expect(lastSaveCall?.providerProfiles[0]?.name).toBe('Renamed Router')
    expect(lastSaveCall?.providerProfiles[0]).not.toHaveProperty('hasApiKey')

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    await setFormControlValue(apiKeyInput, 'rotated-secret')
    await clickElement(rendered.getByTestId('provider-api-key-save'))
    expect(saveProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
      apiKey: 'rotated-secret',
    })

    await clickElement(rendered.getByTestId('provider-api-key-clear'))
    expect(clearProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
    })

    rendered.unmount()
  })

  it('keeps focus in the model name field while editing the model dialog', async () => {
    const rendered = renderWithRoot(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    await clickElement(rendered.getByText('添加模型'))

    const modelNameInput = rendered.getByPlaceholder('例如 Gemini 2.5 Pro') as HTMLInputElement
    await focusElement(modelNameInput)
    expect(document.activeElement).toBe(modelNameInput)

    await setFormControlValue(modelNameInput, '12345')
    await waitForNextFrame()
    expect(modelNameInput.value).toBe('12345')
    expect(document.activeElement).toBe(modelNameInput)

    rendered.unmount()
  })

  it('wires the development runtime override card into the api section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="api"
      />,
    )

    expect(html).toContain('API 服务器')
    expect(html).toContain('宿主配置（开发态）')
    expect(html).toContain('开发态运行时覆盖地址')
    expect(html).not.toContain('不表示普通用户后端地址')
    expect(html).toContain('根层启动摘要')
  })

  it('removes safe search and mcp sandbox toggles from their sections', () => {
    const searchHtml = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="search"
      />,
    )

    const mcpHtml = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="mcp"
      />,
    )

    expect(searchHtml).not.toContain('启用安全搜索')
    expect(mcpHtml).not.toContain('启用沙箱保护')
  })
})

function createBootstrapController(): CopilotBootstrapController {
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

function renderWithRoot(element: ReactElement) {
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

      return target
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
    getByPlaceholder(placeholder: string) {
      const target = container.querySelector(`[placeholder="${placeholder}"]`)
      if (target === null) {
        throw new Error(`Missing element for placeholder=${placeholder}`)
      }

      return target
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function focusElement(element: HTMLElement) {
  await act(async () => {
    element.focus()
  })
}

async function setFormControlValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
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

async function waitForNextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

async function flushAsyncEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function createPersistedWorkspaceState() {
  return {
    providerProfiles: [
      {
        id: 'openrouter',
        name: 'Persisted Router',
        protocol: 'openai',
        endpoint: 'https://persisted.example.com/v1',
        hasApiKey: true,
        defaultModel: 'openai/gpt-4.1',
        fastModel: 'openai/gpt-4.1-mini',
        fallbackModel: 'anthropic/claude-3.7-sonnet',
        organization: 'persisted-org',
        region: 'Global',
        notes: 'persisted provider note',
        availableModels: [
          {
            id: 'openrouter-gpt-4-1-1',
            modelId: 'openai/gpt-4.1',
            displayName: 'GPT-4.1',
            groupName: 'OpenAI',
            capabilities: ['vision', 'reasoning', 'tools'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '0.50',
            outputPrice: '3.00',
          },
        ],
      },
    ],
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
  }
}
