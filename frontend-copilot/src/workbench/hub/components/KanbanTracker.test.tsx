/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { KanbanTracker } from './KanbanTracker'
import type { UnifiedCalendarEvent } from '../calendar-types'

describe('KanbanTracker', () => {
  it('caps each event column viewport to ten visible events while keeping all events scrollable', () => {
    const rendered = renderWithRoot(
      <KanbanTracker
        events={Array.from({ length: 12 }, (_, index) => createCalendarEvent({
          id: index + 1,
          source_id: `source-${index + 1}`,
          title: `Task ${index + 1}`,
          status: 'not_started',
        }))}
      />,
    )

    const notStartedBody = rendered.getByTestId('kanban-column-body-warn')

    expect(notStartedBody.dataset.visibleEventLimit).toBe('10')
    expect(notStartedBody.style.getPropertyValue('--kanban-visible-event-list-height')).toBe('634px')
    expect(notStartedBody.classList.contains('kanban-column__body--scrollable')).toBe(true)
    expect(notStartedBody.querySelectorAll('.kanban-card')).toHaveLength(12)

    rendered.unmount()
  })

  it('uses the actual event count height when a column has ten or fewer events', () => {
    const rendered = renderWithRoot(
      <KanbanTracker
        events={Array.from({ length: 3 }, (_, index) => createCalendarEvent({
          id: index + 1,
          source_id: `source-${index + 1}`,
          title: `Task ${index + 1}`,
          status: 'in_progress',
        }))}
      />,
    )

    const inProgressBody = rendered.getByTestId('kanban-column-body-active')

    expect(inProgressBody.style.getPropertyValue('--kanban-visible-event-list-height')).toBe('186px')
    expect(inProgressBody.classList.contains('kanban-column__body--scrollable')).toBe(false)
    expect(inProgressBody.querySelectorAll('.kanban-card')).toHaveLength(3)

    rendered.unmount()
  })

  it('excludes wakeup-sourced events from the kanban view while keeping non-wakeup events', () => {
    const rendered = renderWithRoot(
      <KanbanTracker
        events={[
          createCalendarEvent({ id: 1, source: 'wakeup', title: 'WakeUp Task', status: 'not_started' }),
          createCalendarEvent({ id: 2, source: 'wakeup', title: 'WakeUp Task 2', status: 'in_progress' }),
          createCalendarEvent({ id: 3, source: 'bb', title: 'Normal Task', status: 'not_started' }),
          createCalendarEvent({ id: 4, source: 'course', title: 'Course Task', status: 'in_progress' }),
          createCalendarEvent({ id: 5, source: 'custom', title: 'Custom Task', status: 'completed' }),
        ]}
      />,
    )

    const notStartedBody = rendered.getByTestId('kanban-column-body-warn')
    const inProgressBody = rendered.getByTestId('kanban-column-body-active')
    const completedBody = rendered.getByTestId('kanban-column-body-done')

    const notStartedCards = notStartedBody.querySelectorAll('.kanban-card')
    expect(notStartedCards).toHaveLength(1)
    expect(notStartedCards[0].textContent).toContain('Normal Task')

    const inProgressCards = inProgressBody.querySelectorAll('.kanban-card')
    expect(inProgressCards).toHaveLength(1)
    expect(inProgressCards[0].textContent).toContain('Course Task')

    const completedCards = completedBody.querySelectorAll('.kanban-card')
    expect(completedCards).toHaveLength(1)
    expect(completedCards[0].textContent).toContain('Custom Task')

    rendered.unmount()
  })

  it('opens an inline create form and submits a custom event draft for not-started tasks', async () => {
    const handleCreateEvent = vi.fn(async () => undefined)
    const rendered = renderWithRoot(<KanbanTracker events={[]} onCreateEvent={handleCreateEvent} />)

    await act(async () => {
      rendered.getByTestId('kanban-add-event-warn').click()
    })

    const form = rendered.getByTestId('kanban-new-event-form-warn')
    const titleInput = rendered.getByTestId('kanban-new-event-title-warn') as HTMLInputElement
    const startInput = rendered.getByTestId('kanban-new-event-start-warn') as HTMLInputElement
    const endInput = rendered.getByTestId('kanban-new-event-end-warn') as HTMLInputElement

    expect(form.textContent).toContain('CUSTOM')

    await act(async () => {
      changeInputValue(titleInput, 'Read paper')
    })
    await act(async () => {
      changeInputValue(startInput, '2026-05-10T09:30')
    })
    await act(async () => {
      changeInputValue(endInput, '2026-05-10T11:45')
    })
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(startInput.type).toBe('datetime-local')
    expect(endInput.type).toBe('datetime-local')
    expect(startInput.step).toBe('60')
    expect(endInput.step).toBe('60')
    expect(handleCreateEvent).toHaveBeenCalledWith({
      title: 'Read paper',
      status: 'not_started',
      startDateTime: '2026-05-10T09:30',
      endDateTime: '2026-05-10T11:45',
    })
    expect(rendered.container.querySelector('[data-testid="kanban-new-event-form-warn"]')).toBeNull()

    rendered.unmount()
  })

  it('validates the inline create form before submitting', async () => {
    const handleCreateEvent = vi.fn(async () => undefined)
    const rendered = renderWithRoot(<KanbanTracker events={[]} onCreateEvent={handleCreateEvent} />)

    await act(async () => {
      rendered.getByTestId('kanban-add-event-active').click()
    })

    const form = rendered.getByTestId('kanban-new-event-form-active')

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(handleCreateEvent).not.toHaveBeenCalled()
    expect(rendered.container.textContent).toContain('请输入事件标题。')

    rendered.unmount()
  })

  it('opens the event context menu through a viewport-positioned portal', () => {
    const rendered = renderWithRoot(<KanbanTracker events={[createCalendarEvent({ source: 'custom' })]} />)
    const card = rendered.container.querySelector('.kanban-card')
    if (!(card instanceof HTMLElement)) {
      throw new Error('Missing kanban card')
    }

    act(() => {
      card.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 148,
        clientY: 96,
      }))
    })

    const contextMenu = rendered.getByTestId('calendar-event-context-menu')
    expect(contextMenu.parentElement).toBe(document.body)
    expect(contextMenu.style.left).toBe('148px')
    expect(contextMenu.style.top).toBe('96px')

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

function changeInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  valueSetter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
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
      const target = container.querySelector(`[data-testid="${testId}"]`) ?? document.body.querySelector(`[data-testid="${testId}"]`)
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
