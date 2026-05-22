/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockCalendarGanttView, MockKanbanTracker } = vi.hoisted(() => ({
  MockCalendarGanttView: vi.fn(({ events = [] }: { events?: unknown[] }) => (
    <div data-testid="calendar-gantt-count">{String(events.length)}</div>
  )),
  MockKanbanTracker: vi.fn(({ events = [] }: { events?: unknown[] }) => (
    <div data-testid="kanban-count">{String(events.length)}</div>
  )),
}))

vi.mock('./components/CalendarGanttView', () => ({
  CalendarGanttView: MockCalendarGanttView,
}))

vi.mock('./components/KanbanTracker', () => ({
  KanbanTracker: MockKanbanTracker,
}))

import { HubWorkspace } from './HubWorkspace'
import type { UnifiedCalendarEvent } from './calendar-types'
import type { CopilotBootstrapController } from '../../features/copilot/types'

describe('HubWorkspace calendar loading', () => {
  const originalTimelineDatabase = window.timelineDatabase

  beforeEach(() => {
    MockCalendarGanttView.mockClear()
    MockKanbanTracker.mockClear()
    window.timelineDatabase = {
      loadEvents: vi.fn(async () => ({ items: [] })),
      addEvent: vi.fn(),
    }
  })

  afterEach(() => {
    window.timelineDatabase = originalTimelineDatabase
  })

  it('loads calendar events through the Electron timeline bridge with the active runtime URL', async () => {
    const events = [createCalendarEvent({ id: 42, title: 'Remote Assignment' })]
    window.timelineDatabase.loadEvents = vi.fn(async () => ({ items: events }))

    const rendered = renderWithRoot(
      <HubWorkspace
        view="developer"
        bootstrap={createBootstrapController({ runtimeUrl: 'http://127.0.0.1:8765' })}
      />,
    )

    await waitForCondition(() => rendered.getByTestId('calendar-gantt-count').textContent === '1')

    expect(window.timelineDatabase.loadEvents).toHaveBeenCalledWith({ runtimeUrl: 'http://127.0.0.1:8765' })
    expect(rendered.getByTestId('kanban-count').textContent).toBe('1')

    rendered.unmount()
  })

  it('surfaces bridge load failures in the debug panel without direct renderer fetch', async () => {
    window.timelineDatabase.loadEvents = vi.fn(async () => {
      throw new Error('无法加载日历事件：本地无缓存数据且远端 API 请求失败，请检查网络连接或后端服务状态。')
    })

    const rendered = renderWithRoot(
      <HubWorkspace
        view="developer"
        bootstrap={createBootstrapController({ runtimeUrl: 'http://127.0.0.1:8765' })}
      />,
    )

    await waitForCondition(() => rendered.container.textContent?.includes('本地无缓存数据且远端 API 请求失败') === true)

    expect(rendered.container.textContent).toContain('错误: 无法加载日历事件')

    rendered.unmount()
  })
})

function createCalendarEvent(overrides: Partial<UnifiedCalendarEvent> = {}): UnifiedCalendarEvent {
  return {
    id: 1,
    source: 'bb',
    source_id: 'source-1',
    title: 'Task 1',
    description: 'Example event',
    start_time: '2026-05-01T00:00:00.000Z',
    end_time: '2026-05-03T00:00:00.000Z',
    is_all_day: false,
    location: null,
    status: 'not_started',
    metadata_payload: null,
    ...overrides,
  }
}

function createBootstrapController(input: { runtimeUrl: string }): CopilotBootstrapController {
  return {
    retrying: false,
    retry: vi.fn(),
    state: {
      status: 'ready',
      runtimeUrl: input.runtimeUrl,
      bootstrapFields: {
        runtimeUrl: input.runtimeUrl,
        agentName: null,
        debugModeEnabled: false,
      },
      storageState: 'stored',
      runtime: {
        status: 'ready',
        expectedMode: 'development',
        resolvedMode: 'development',
        runtimeUrl: input.runtimeUrl,
        isPackaged: false,
        failure: null,
      },
      runtimeSource: 'hosted',
      agentName: null,
      agentNameSource: 'missing',
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
