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
  BlackboardSyncPanel: ({ syncState }: { syncState: { status: string } }) => {
    return <div data-testid="blackboard-sync-state">{syncState.status}</div>
  },
}))

vi.mock('../settings/workspace-state', () => ({
  loadSettingsWorkspaceState: vi.fn(async () => ({
    ok: true,
    state: {
      sustech: {
        blackboardParallelSyncWorkers: '1',
        blackboardCurrentTermOnly: true,
      },
    },
  })),
}))

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
})
