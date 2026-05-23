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
  bar_height?: number
  lower_header_height?: number
  padding?: number
  upper_header_height?: number
  on_date_change?: (task: MockGanttTask, start: Date, end: Date) => void
  on_progress_change?: (task: MockGanttTask, progress: number) => void
}

interface MockGanttPopupOptions {
  target?: Element | null
  [key: string]: unknown
}

interface MockGanttPopup {
  parent: HTMLElement
}

interface MockGanttInstance {
  wrapper: string | HTMLElement | SVGElement
  tasks: MockGanttTask[]
  options: MockGanttOptions
  $popup_wrapper: HTMLElement
  popup?: MockGanttPopup
  refresh: (tasks: MockGanttTask[]) => void
  scroll_current: () => void
  show_popup: (options: MockGanttPopupOptions) => void
}

const { ganttInstances, MockGantt } = vi.hoisted(() => {
  const instances: MockGanttInstance[] = []

  class MockGanttImplementation implements MockGanttInstance {
    wrapper: string | HTMLElement | SVGElement
    tasks: MockGanttTask[]
    options: MockGanttOptions
    $popup_wrapper: HTMLElement
    popup?: MockGanttPopup

    constructor(wrapper: string | HTMLElement | SVGElement, tasks: MockGanttTask[], options: MockGanttOptions = {}) {
      this.wrapper = wrapper
      this.tasks = tasks
      this.options = options
      this.$popup_wrapper = document.createElement('div')
      this.$popup_wrapper.className = 'popup-wrapper hide'
      instances.push(this)
    }

    refresh(tasks: MockGanttTask[]) {
      this.tasks = tasks
    }

    scroll_current() {}

    show_popup(_options: MockGanttPopupOptions) {
      this.popup = { parent: this.$popup_wrapper }
      this.$popup_wrapper.classList.remove('hide')
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
    document.body.innerHTML = ''
  })

  it('initializes frappe gantt with mapped tasks', () => {
    const rendered = renderWithRoot(<CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} />)

    expect(ganttInstances).toHaveLength(1)
    expect(ganttInstances[0].tasks).toHaveLength(1)
    expect(ganttInstances[0].tasks[0].id).toBe('calendar-event-1')
    expect(rendered.queryByTestId('calendar-gantt-empty')).toBeNull()

    rendered.unmount()
  })

  it('caps the gantt viewport to seven visible rows and reserves Shift+wheel for vertical row scrolling', () => {
    const rendered = renderWithRoot(
      <CalendarGanttView
        events={Array.from({ length: 12 }, (_, index) => createCalendarEvent({
          id: index + 1,
          source_id: `source-${index + 1}`,
          title: `Task ${index + 1}`,
        }))}
        onEventChange={vi.fn()}
      />,
    )
    const chart = rendered.getByTestId('calendar-gantt-container')
    const chartShell = chart.parentElement
    const scrollContainer = document.createElement('div')

    scrollContainer.className = 'gantt-container'
    Object.defineProperty(scrollContainer, 'clientHeight', { configurable: true, value: 399 })
    Object.defineProperty(scrollContainer, 'scrollHeight', { configurable: true, value: 620 })
    chart.appendChild(scrollContainer)

    act(() => {
      scrollContainer.dispatchEvent(new window.WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaY: 100,
        shiftKey: true,
      }))
    })

    expect(ganttInstances[0].options.bar_height).toBe(28)
    expect(ganttInstances[0].options.padding).toBe(16)
    expect(chartShell?.style.getPropertyValue('--calendar-gantt-visible-chart-height')).toBe('399px')
    expect(scrollContainer.scrollTop).toBe(100)

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

  it('toggles wakeup-sourced events from the timeline settings menu', () => {
    const rendered = renderWithRoot(
      <CalendarGanttView
        events={[
          createCalendarEvent({ id: 1, source: 'wakeup', source_id: 'WakeupSchedule', title: 'Wakeup Course' }),
          createCalendarEvent({ id: 2, source: 'bb', source_id: 'source-2', title: 'Normal Task' }),
        ]}
        onEventChange={vi.fn()}
      />,
    )

    expect(ganttInstances[0].tasks.map((task) => task.id)).toEqual(['calendar-event-1', 'calendar-event-2'])

    act(() => {
      rendered.getByTestId('calendar-gantt-settings-trigger').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    act(() => {
      rendered.getByTestId('calendar-gantt-toggle-wakeup').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(ganttInstances[0].tasks.map((task) => task.id)).toEqual(['calendar-event-2'])
    expect(rendered.container.textContent).toContain('已隐藏 1 个 Wakeup 课程')

    rendered.unmount()
  })

  it('opens a right-click event menu and updates custom event status', () => {
    const onEventChange = vi.fn()
    const rendered = renderWithRoot(
      <CalendarGanttView events={[createCalendarEvent({ source: 'custom', status: 'not_started' })]} onEventChange={onEventChange} />,
    )

    dispatchGanttContextMenu(rendered.getByTestId('calendar-gantt-container'), 'calendar-event-1')

    expect(rendered.getByTestId('calendar-gantt-context-menu').textContent).toContain('设置状态')

    act(() => {
      rendered.getByTestId('calendar-gantt-context-menu-status-completed').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onEventChange).toHaveBeenCalledWith(1, { status: 'completed', progress: 100 })

    rendered.unmount()
  })

  it('edits event information from the right-click menu', async () => {
    const onEventChange = vi.fn(async () => undefined)
    const rendered = renderWithRoot(
      <CalendarGanttView events={[createCalendarEvent({ source: 'custom', location: 'Room 101' })]} onEventChange={onEventChange} />,
    )

    dispatchGanttContextMenu(rendered.getByTestId('calendar-gantt-container'), 'calendar-event-1')
    act(() => {
      rendered.getByTestId('calendar-gantt-context-menu-edit').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    changeInputValue(rendered.getByTestId('calendar-gantt-edit-title') as HTMLInputElement, 'Updated task')
    changeInputValue(rendered.getByTestId('calendar-gantt-edit-start') as HTMLInputElement, '2026-05-06T09:30')
    changeInputValue(rendered.getByTestId('calendar-gantt-edit-end') as HTMLInputElement, '2026-05-06T11:00')

    await act(async () => {
      rendered.getByTestId('calendar-gantt-edit-submit').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onEventChange).toHaveBeenCalledWith(1, expect.objectContaining({
      title: 'Updated task',
      start_time: new Date('2026-05-06T09:30').toISOString(),
      end_time: new Date('2026-05-06T11:00').toISOString(),
      location: 'Room 101',
    }))

    rendered.unmount()
  })

  it('deletes events from the right-click menu', async () => {
    const onEventDelete = vi.fn(async () => undefined)
    const rendered = renderWithRoot(
      <CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} onEventDelete={onEventDelete} />,
    )

    dispatchGanttContextMenu(rendered.getByTestId('calendar-gantt-container'), 'calendar-event-1')
    await act(async () => {
      rendered.getByTestId('calendar-gantt-context-menu-delete').dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onEventDelete).toHaveBeenCalledWith(1)

    rendered.unmount()
  })

  it('suppresses the default gantt popup when right-clicking a bar', () => {
    const rendered = renderWithRoot(<CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} />)
    const gantt = ganttInstances[0]
    const chart = rendered.getByTestId('calendar-gantt-container')
    const namespace = 'http://www.w3.org/2000/svg'
    const barWrapper = document.createElementNS(namespace, 'g') as SVGGElement
    const popupAttempt = vi.fn(() => {
      gantt.show_popup({ task: gantt.tasks[0], target: barWrapper })
    })

    barWrapper.classList.add('bar-wrapper')
    barWrapper.setAttribute('data-id', 'calendar-event-1')
    barWrapper.addEventListener('mouseup', popupAttempt)
    chart.appendChild(barWrapper)

    act(() => {
      barWrapper.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 120,
        clientY: 160,
      }))
      barWrapper.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 120,
        clientY: 160,
      }))
      barWrapper.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: 120,
        clientY: 160,
      }))
    })

    expect(popupAttempt).not.toHaveBeenCalled()
    expect(gantt.popup).toBeUndefined()
    expect(gantt.$popup_wrapper.classList.contains('hide')).toBe(true)
    expect(rendered.getByTestId('calendar-gantt-context-menu').textContent).toContain('删除事件')

    rendered.unmount()
  })

  it('keeps the frappe popup wrapper outside clipped chart containers', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })

    const rendered = renderWithRoot(<CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} />)
    const gantt = ganttInstances[0]
    const target = document.createElement('div')
    target.getBoundingClientRect = () => createRect({ left: 520, top: 220, width: 100, height: 30 })
    gantt.$popup_wrapper.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 180, height: 80 })

    expect(gantt.$popup_wrapper.parentElement).toBe(document.body)

    gantt.show_popup({ task: gantt.tasks[0], target })

    expect(gantt.$popup_wrapper.parentElement).toBe(document.body)
    expect(gantt.$popup_wrapper.classList.contains('calendar-gantt-popup-wrapper')).toBe(true)
    expect(gantt.$popup_wrapper.style.left).toBe('575px')
    expect(gantt.$popup_wrapper.style.top).toBe('260px')

    rendered.unmount()
    expect(gantt.$popup_wrapper.parentElement).toBeNull()
  })

  it('renders a refresh button and fires onRefresh when clicked', () => {
    const onRefresh = vi.fn()
    const rendered = renderWithRoot(
      <CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} onRefresh={onRefresh} />,
    )

    const refreshButton = rendered.getByTestId('calendar-gantt-refresh-button')
    act(() => {
      refreshButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)

    rendered.unmount()
  })

  it('does not render a refresh button when onRefresh is omitted', () => {
    const rendered = renderWithRoot(<CalendarGanttView events={[createCalendarEvent()]} onEventChange={vi.fn()} />)

    expect(rendered.queryByTestId('calendar-gantt-refresh-button')).toBeNull()

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

function dispatchGanttContextMenu(chart: HTMLElement, taskId: string): void {
  const namespace = 'http://www.w3.org/2000/svg'
  const wrapper = document.createElementNS(namespace, 'g')
  wrapper.classList.add('bar-wrapper')
  wrapper.setAttribute('data-id', taskId)
  chart.appendChild(wrapper)

  act(() => {
    wrapper.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 160,
    }))
  })
}

function changeInputValue(input: HTMLInputElement, value: string): void {
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function createRect({ left, top, width, height }: { left: number; top: number; width: number; height: number }): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}
