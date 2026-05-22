/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

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
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}
