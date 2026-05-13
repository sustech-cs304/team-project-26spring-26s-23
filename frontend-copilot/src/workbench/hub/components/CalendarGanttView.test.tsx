/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CalendarGanttView } from './CalendarGanttView'
import type { UnifiedCalendarEvent } from '../calendar-types'

interface MockGanttTask {
  id: string
  [key: string]: unknown
}

interface MockGanttOptions {
  on_date_change?: (task: MockGanttTask, start: Date, end: Date) => void
  on_progress_change?: (task: MockGanttTask, progress: number) => void
}

interface MockGanttInstance {
  wrapper: string | HTMLElement | SVGElement
  tasks: MockGanttTask[]
  options: MockGanttOptions
  refresh: (tasks: MockGanttTask[]) => void
}

const { ganttInstances, MockGantt } = vi.hoisted(() => {
  const instances: MockGanttInstance[] = []

  class MockGanttImplementation implements MockGanttInstance {
    wrapper: string | HTMLElement | SVGElement
    tasks: MockGanttTask[]
    options: MockGanttOptions

    constructor(wrapper: string | HTMLElement | SVGElement, tasks: MockGanttTask[], options: MockGanttOptions = {}) {
      this.wrapper = wrapper
      this.tasks = tasks
      this.options = options
      instances.push(this)
    }

    refresh(tasks: MockGanttTask[]) {
      this.tasks = tasks
    }
  }

  return {
    ganttInstances: instances,
    MockGantt: MockGanttImplementation,
  }
})

vi.mock('frappe-gantt', () => ({
  default: MockGantt,
}))

describe('CalendarGanttView', () => {
  beforeEach(() => {
    ganttInstances.length = 0
  })

  it('initializes frappe gantt with mapped tasks', () => {
    const rendered = renderWithRoot(<CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} />)

    expect(ganttInstances).toHaveLength(1)
    expect(ganttInstances[0].tasks).toHaveLength(1)
    expect(ganttInstances[0].tasks[0].id).toBe('calendar-event-1')
    expect(rendered.queryByTestId('calendar-gantt-empty')).toBeNull()

    rendered.unmount()
  })

  it('forwards date and progress changes as local event patches', () => {
    const onEventChange = vi.fn()
    const rendered = renderWithRoot(<CalendarGanttView events={[createCalendarEvent()]} onEventChange={onEventChange} />)
    const task = ganttInstances[0].tasks[0]

    act(() => {
      ganttInstances[0].options.on_date_change?.(
        task,
        new Date('2026-05-04T00:00:00.000Z'),
        new Date('2026-05-05T00:00:00.000Z'),
      )
      ganttInstances[0].options.on_progress_change?.(task, 51)
    })

    expect(onEventChange).toHaveBeenNthCalledWith(1, 1, {
      start_time: '2026-05-04T00:00:00.000Z',
      end_time: '2026-05-05T00:00:00.000Z',
    })
    expect(onEventChange).toHaveBeenNthCalledWith(2, 1, {
      progress: 51,
      status: 'in_progress',
    })

    rendered.unmount()
  })

  it('renders an empty state without constructing gantt for empty events', () => {
    const rendered = renderWithRoot(<CalendarGanttView events={[]} onEventChange={vi.fn()} />)

    expect(ganttInstances).toHaveLength(0)
    expect(rendered.getByTestId('calendar-gantt-empty').textContent).toContain('暂无可显示')

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
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`)
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
