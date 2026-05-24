/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockKanbanCreateInput = {
  title: string
  status: 'not_started' | 'in_progress'
  startDateTime: string
  endDateTime: string
}

interface MockKanbanTrackerProps {
  events?: unknown[]
  onCreateEvent?: (input: MockKanbanCreateInput) => Promise<void> | void
  onEventChange?: (eventId: string | number, patch: Partial<UnifiedCalendarEvent>) => Promise<void> | void
  onEventDelete?: (eventId: string | number) => Promise<void> | void
}

interface MockCalendarGanttViewProps {
  events?: UnifiedCalendarEvent[]
  onEventChange?: (eventId: string | number, patch: Partial<UnifiedCalendarEvent>) => Promise<void> | void
  onEventDelete?: (eventId: string | number) => Promise<void> | void
  onRefresh?: () => void
}

const { MockCalendarGanttView, MockKanbanTracker } = vi.hoisted(() => ({
  MockCalendarGanttView: vi.fn(({ events = [], onRefresh }: MockCalendarGanttViewProps) => (
    <div data-testid="calendar-gantt-count">
      {String(events.length)}
      {typeof onRefresh === 'function' ? <button data-testid="calendar-gantt-refresh-button" aria-label="刷新日历" onClick={onRefresh} /> : null}
    </div>
  )),
  MockKanbanTracker: vi.fn(({ events = [] }: MockKanbanTrackerProps) => (
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
      updateEvent: vi.fn(),
      deleteEvent: vi.fn(),
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

  it('persists gantt event edits and deletes through the timeline bridge', async () => {
    const event = createCalendarEvent({ id: 7, title: 'Original task' })
    const updatedEvent = createCalendarEvent({ id: 7, title: 'Updated task', status: 'completed', progress: 100 })
    window.timelineDatabase.loadEvents = vi.fn(async () => ({ items: [event] }))
    window.timelineDatabase.updateEvent = vi.fn(async () => ({ updated: true, item: updatedEvent }))
    window.timelineDatabase.deleteEvent = vi.fn(async () => ({ deleted: true }))

    const rendered = renderWithRoot(
      <HubWorkspace
        view="developer"
        bootstrap={createBootstrapController({ runtimeUrl: 'http://127.0.0.1:8765' })}
      />,
    )

    await waitForCondition(() => rendered.getByTestId('calendar-gantt-count').textContent === '1')

    const changeHandler = getLatestGanttChangeHandler()
    await act(async () => {
      await changeHandler(7, { status: 'completed', progress: 100 })
    })

    expect(window.timelineDatabase.updateEvent).toHaveBeenCalledWith({
      id: 7,
      patch: { status: 'completed', progress: 100 },
    })
    await waitForCondition(() => getLatestGanttEvents()[0]?.title === 'Updated task')

    const deleteHandler = getLatestGanttDeleteHandler()
    await act(async () => {
      await deleteHandler(7)
    })

    expect(window.timelineDatabase.deleteEvent).toHaveBeenCalledWith({ id: 7 })
    await waitForCondition(() => rendered.getByTestId('calendar-gantt-count').textContent === '0')

    rendered.unmount()
  })

  it('persists kanban-created events as custom timeline events and updates local views', async () => {
    const loadEvents = vi.fn(async () => ({ items: [] }))
    window.timelineDatabase.loadEvents = loadEvents
    window.timelineDatabase.addEvent = vi.fn(async () => ({ id: 88 }))

    const rendered = renderWithRoot(
      <HubWorkspace
        view="developer"
        bootstrap={createBootstrapController({ runtimeUrl: 'http://127.0.0.1:8765' })}
      />,
    )

    await act(async () => {
      await flushPromises()
    })
    expect(loadEvents).toHaveBeenCalled()
    await waitForCondition(() => MockKanbanTracker.mock.calls.length > 0)

    const createHandler = getLatestKanbanCreateHandler()
    await act(async () => {
      await createHandler({
        title: 'New custom task',
        status: 'not_started',
        startDateTime: '2026-05-10T09:30',
        endDateTime: '2026-05-10T11:45',
      })
    })

    expect(window.timelineDatabase.addEvent).toHaveBeenCalledWith({
      event: {
        source: 'custom',
        source_id: null,
        title: 'New custom task',
        description: null,
        start_time: '2026-05-10T01:30:00.000Z',
        end_time: '2026-05-10T03:45:00.000Z',
        is_all_day: false,
        location: null,
        status: 'not_started',
        metadata_payload: {
          created_from: 'kanban_tracker',
        },
        progress: 0,
      },
    })

    await waitForCondition(() => rendered.getByTestId('calendar-gantt-count').textContent === '1')
    expect(rendered.getByTestId('kanban-count').textContent).toBe('1')

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

function getLatestKanbanCreateHandler(): (input: MockKanbanCreateInput) => Promise<void> | void {
  const latestProps = MockKanbanTracker.mock.calls[MockKanbanTracker.mock.calls.length - 1]?.[0]
  const handler = latestProps?.onCreateEvent
  if (typeof handler !== 'function') {
    throw new Error('Expected KanbanTracker onCreateEvent prop to be wired.')
  }

  return handler
}

function getLatestGanttChangeHandler(): (eventId: string | number, patch: Partial<UnifiedCalendarEvent>) => Promise<void> | void {
  const latestProps = MockCalendarGanttView.mock.calls[MockCalendarGanttView.mock.calls.length - 1]?.[0] as MockCalendarGanttViewProps | undefined
  const handler = latestProps?.onEventChange
  if (typeof handler !== 'function') {
    throw new Error('Expected CalendarGanttView onEventChange prop to be wired.')
  }

  return handler
}

function getLatestGanttDeleteHandler(): (eventId: string | number) => Promise<void> | void {
  const latestProps = MockCalendarGanttView.mock.calls[MockCalendarGanttView.mock.calls.length - 1]?.[0] as MockCalendarGanttViewProps | undefined
  const handler = latestProps?.onEventDelete
  if (typeof handler !== 'function') {
    throw new Error('Expected CalendarGanttView onEventDelete prop to be wired.')
  }

  return handler
}

function getLatestGanttEvents(): UnifiedCalendarEvent[] {
  const latestProps = MockCalendarGanttView.mock.calls[MockCalendarGanttView.mock.calls.length - 1]?.[0] as MockCalendarGanttViewProps | undefined
  return latestProps?.events ?? []
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) {
      return
    }
    await act(async () => {
      await flushPromises()
    })
  }
  throw new Error('Condition was not met within timeout.')
}
