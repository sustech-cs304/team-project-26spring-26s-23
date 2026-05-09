/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./BlackboardDataBrowser', () => ({
  BlackboardDataBrowser: ({ refreshToken = 0 }: { refreshToken?: number }) => {
    return <div data-testid="blackboard-browser-refresh-token">{String(refreshToken)}</div>
  },
}))

vi.mock('./BlackboardSyncPanel', () => ({
  BlackboardSyncPanel: ({ syncState }: { syncState: { status: string; lastSyncError?: string | null } }) => {
    return (
      <>
        <div data-testid="blackboard-sync-state">{syncState.status}</div>
        <div data-testid="blackboard-sync-error">{syncState.lastSyncError ?? ''}</div>
      </>
    )
  },
}))

vi.mock('../settings/workspace-state', () => ({
  loadSettingsWorkspaceState: vi.fn(async () => ({
    ok: true,
    state: {
      sustech: {
        studentId: '',
        email: '',
        blackboardParallelSyncWorkers: '1',
        blackboardCurrentTermOnly: true,
        blackboardSyncInterval: 'off' as const,
        blackboardLastAutoSyncAt: null,
        blackboardNextAutoSyncAt: null,
      },
      providerProfiles: [
        {
          id: 'openrouter',
          profileId: 'openrouter',
          providerId: 'openai',
          name: 'Persisted Router',
          displayName: 'Persisted Router',
          protocol: 'openai',
          endpoint: 'https://persisted.example.com/v1',
          baseUrl: 'https://persisted.example.com/v1',
          hasApiKey: true,
          fastModel: 'openai/gpt-4.1-mini',
          fallbackModel: 'anthropic/claude-3.7-sonnet',
          organization: 'persisted-org',
          region: 'Global',
          notes: 'persisted provider note',
          compatibility: {
            status: 'active',
            reason: '',
          },
          extensions: {},
          availableModels: [
            {
              profileId: 'openrouter',
              modelId: 'openai/gpt-4.1',
              displayName: 'Persisted Router / openai/gpt-4.1',
              contextWindow: null,
              maxOutputTokens: null,
              supportsTools: true,
              supportsReasoning: false,
              supportsVision: false,
              supportsStreaming: true,
              supportsJsonMode: false,
              supportsFunctionCalling: false,
              isPreview: false,
              capabilities: [],
            },
          ],
        },
      ],
      defaultModelRouting: {
        primaryAssistantModel: 'openai/gpt-4.1',
        fastAssistantModel: 'openai/gpt-4.1-mini',
        primaryAssistantModelRoute: {
          routeKind: 'provider-model',
          profileId: 'openrouter',
          modelId: 'openai/gpt-4.1',
        },
        fastAssistantModelRoute: {
          routeKind: 'provider-model',
          profileId: 'openrouter',
          modelId: 'openai/gpt-4.1-mini',
        },
      },
      general: {
        language: 'zh-CN',
        assistantNotificationsEnabled: true,
      },
      mcp: {
        mcpAutoDiscoveryEnabled: true,
        toolPermissionMode: 'manual',
        toolPermissionPolicy: {
          version: 1,
          migrationSourceMode: 'manual',
          defaultMode: 'ask',
          toolPermissions: {},
        },
      },
      api: {
        apiReconnectMode: 'exponential',
        healthPollingEnabled: true,
        apiBaseUrl: 'http://127.0.0.1:8000',
      },
      docs: {
        docsFormat: 'markdown',
      },
      externalSource: {
        wakeupShareLink: '',
      },
    },
  })),
  saveSettingsWorkspaceState: vi.fn(async (input) => ({
    ok: true,
    state: input,
  })),
}))

import { loadSettingsWorkspaceState, saveSettingsWorkspaceState } from '../settings/workspace-state'
import { SustechWorkspace } from './SustechWorkspace'

interface RenderedWorkspace {
  container: HTMLDivElement
  getByTestId: (testId: string) => HTMLElement
  unmount: () => void
}

function renderWithRoot(element: ReactElement): RenderedWorkspace {
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
      if (!(target instanceof HTMLElement)) {
        throw new Error(`Missing element for data-testid=${testId}`)
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

async function changeSelectValue(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) {
      return
    }
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error('Condition was not met within timeout.')
}

describe('SustechWorkspace sync refresh', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('refreshes the Blackboard data browser after a sync completes via status polling', async () => {
    vi.useFakeTimers()

    let syncTriggered = false
    let statusPollCount = 0
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)

      if (url.endsWith('/api/blackboard/sync/status')) {
        statusPollCount += 1
        if (!syncTriggered) {
          return new Response(JSON.stringify({
            status: 'idle',
            lastSyncAt: null,
            lastSyncError: null,
            progressMessage: null,
            progressStage: null,
            progressLogs: [],
            canCancel: false,
            timeoutSeconds: null,
          }))
        }

        return new Response(JSON.stringify({
          status: statusPollCount >= 2 ? 'completed' : 'running',
          lastSyncAt: statusPollCount >= 2 ? '2026-05-02T08:30:00Z' : null,
          lastSyncError: null,
          progressMessage: null,
          progressStage: null,
          progressLogs: [],
          canCancel: false,
          timeoutSeconds: null,
        }))
      }

      if (url.endsWith('/api/blackboard/sync/trigger')) {
        syncTriggered = true
        expect(JSON.parse(String(init?.body ?? '{}'))).toMatchObject({
          parallelWorkers: 1,
          currentTermOnly: true,
        })
        return new Response(JSON.stringify({
          status: 'running',
          lastSyncAt: null,
          lastSyncError: null,
          progressMessage: '开始同步...',
          progressStage: 'authenticating',
          progressLogs: ['开始同步...'],
          canCancel: true,
          timeoutSeconds: 300,
        }))
      }

      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = renderWithRoot(
      <SustechWorkspace bootstrap={{ state: { runtimeUrl: 'http://localhost' } } as never} language="zh-CN" />,
    )

    try {
      await act(async () => {
        await Promise.resolve()
      })

      expect(rendered.getByTestId('blackboard-browser-refresh-token').textContent).toBe('0')

      const syncButton = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
        return button.title === '手动同步'
      })
      expect(syncButton).toBeTruthy()

      await clickElement(syncButton as HTMLButtonElement)

      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      await waitForCondition(() => rendered.getByTestId('blackboard-browser-refresh-token').textContent === '1')
      expect(rendered.getByTestId('blackboard-sync-state').textContent).toBe('completed')
    } finally {
      rendered.unmount()
    }
  })

  it('persists sync interval changes into settings workspace state', async () => {
    const rendered = renderWithRoot(
      <SustechWorkspace bootstrap={{ state: { runtimeUrl: 'http://localhost' } } as never} language="zh-CN" />,
    )

    try {
      await act(async () => {
        await Promise.resolve()
      })

      const settingsButton = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
        return button.title === '设置'
      })
      expect(settingsButton).toBeTruthy()

      await clickElement(settingsButton as HTMLButtonElement)

      const select = rendered.container.querySelector('select')
      expect(select).toBeInstanceOf(HTMLSelectElement)

      await changeSelectValue(select as HTMLSelectElement, 'daily')

      expect(loadSettingsWorkspaceState).toHaveBeenCalled()
      await waitForCondition(() => vi.mocked(saveSettingsWorkspaceState).mock.calls.length > 0)
      expect(saveSettingsWorkspaceState).toHaveBeenCalledWith(expect.objectContaining({
        sustech: expect.objectContaining({
          blackboardSyncInterval: 'daily',
        }),
      }))
    } finally {
      rendered.unmount()
    }
  })

  it('surfaces a concise error when sync status polling returns a non-2xx response', async () => {
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/sync/status')) {
        return new Response('server boom', { status: 500, statusText: 'Internal Server Error' })
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = renderWithRoot(
      <SustechWorkspace bootstrap={{ state: { runtimeUrl: 'http://localhost' } } as never} language="zh-CN" />,
    )

    try {
      await waitForCondition(() => rendered.getByTestId('blackboard-sync-error').textContent === 'HTTP 500')
    } finally {
      rendered.unmount()
    }
  })
})
