import { describe, expect, it } from 'vitest'

import {
  buildCalendarEventDatePatch,
  buildCalendarEventProgressPatch,
  getCalendarEventIdFromGanttTaskId,
  mapCalendarEventsToGanttTasks,
  mergeCalendarEventPatch,
  resolveEventProgress,
  resolveProgressBucket,
} from './calendar-gantt-model'
import type { UnifiedCalendarEvent } from './calendar-types'

describe('calendar gantt model', () => {
  it('maps valid calendar events to gantt tasks and skips invalid dates', () => {
    const mapping = mapCalendarEventsToGanttTasks([
      createCalendarEvent({ id: 1, status: 'completed' }),
      createCalendarEvent({ id: 'bad-end', end_time: null }),
    ])

    expect(mapping.skippedEventCount).toBe(1)
    expect(mapping.tasks).toHaveLength(1)
    expect(mapping.tasks[0]).toMatchObject({
      id: 'calendar-event-1',
      name: 'Task 1',
      progress: 100,
      custom_class: 'calendar-gantt-source--bb',
      originalEventId: 1,
    })
    expect(mapping.tasks[0].start).toBeInstanceOf(Date)
    expect(mapping.tasks[0].end).toBeInstanceOf(Date)
  })

  it('normalizes progress from explicit progress or status buckets', () => {
    expect(resolveEventProgress(createCalendarEvent({ progress: 42, status: 'not_started' }))).toBe(42)
    expect(resolveEventProgress(createCalendarEvent({ status: 'in_progress' }))).toBe(50)
    expect(resolveEventProgress(createCalendarEvent({ status: 'completed' }))).toBe(100)
    expect(resolveEventProgress(createCalendarEvent({ status: 'not_started' }))).toBe(0)
  })

  it('builds safe date and progress patches from gantt callbacks', () => {
    const datePatch = buildCalendarEventDatePatch(
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-02T00:00:00.000Z'),
    )
    const progressPatch = buildCalendarEventProgressPatch(99.6)

    expect(datePatch).toEqual({
      start_time: '2026-05-01T00:00:00.000Z',
      end_time: '2026-05-02T00:00:00.000Z',
    })
    expect(progressPatch).toEqual({ progress: 100, status: 'completed' })
    expect(buildCalendarEventDatePatch(new Date('bad'), new Date('2026-05-02T00:00:00.000Z'))).toBeNull()
    expect(buildCalendarEventProgressPatch(Number.NaN)).toBeNull()
  })

  it('merges local event patches without mutating unrelated events', () => {
    const original = [
      createCalendarEvent({ id: 1 }),
      createCalendarEvent({ id: 2, title: 'Task 2' }),
    ]

    const updated = mergeCalendarEventPatch(original, '2', { progress: 50, status: 'in_progress' })

    expect(updated[0]).toBe(original[0])
    expect(updated[1]).toEqual({
      ...original[1],
      progress: 50,
      status: 'in_progress',
    })
  })

  it('resolves progress buckets and task ids', () => {
    expect(resolveProgressBucket(0)).toBe('not_started')
    expect(resolveProgressBucket(1)).toBe('in_progress')
    expect(resolveProgressBucket(100)).toBe('completed')
    expect(getCalendarEventIdFromGanttTaskId('calendar-event-abc')).toBe('abc')
    expect(getCalendarEventIdFromGanttTaskId('external')).toBe('external')
  })

  it('preserves original ISO times on mapped tasks for popup consistency', () => {
    const mapping = mapCalendarEventsToGanttTasks([
      createCalendarEvent({
        id: 1,
        start_time: '2026-05-23T00:00:00.000Z',
        end_time: '2026-05-23T00:59:00.000Z',
      }),
    ])

    expect(mapping.tasks).toHaveLength(1)
    expect(mapping.tasks[0]._originalStartIso).toBe('2026-05-23T00:00:00.000Z')
    expect(mapping.tasks[0]._originalEndIso).toBe('2026-05-23T00:59:00.000Z')
  })

  it('maps sub-day events correctly without skipping them', () => {
    const mapping = mapCalendarEventsToGanttTasks([
      createCalendarEvent({
        id: 1,
        start_time: '2026-05-23T00:00:00.000Z',
        end_time: '2026-05-23T00:59:00.000Z',
      }),
    ])

    expect(mapping.skippedEventCount).toBe(0)
    expect(mapping.tasks).toHaveLength(1)

    const task = mapping.tasks[0]
    // start and end should be valid Date objects
    expect(task.start).toBeInstanceOf(Date)
    expect(task.end).toBeInstanceOf(Date)
    // the 59-min difference should be preserved in the date objects
    expect(task.end.getTime() - task.start.getTime()).toBe(59 * 60 * 1000)
  })

  it('maps multi-day events with correct ISO preservation', () => {
    const mapping = mapCalendarEventsToGanttTasks([
      createCalendarEvent({
        id: 1,
        start_time: '2026-05-01T00:00:00.000Z',
        end_time: '2026-05-03T00:00:00.000Z',
      }),
      createCalendarEvent({
        id: 2,
        start_time: '2026-05-04T08:00:00.000Z',
        end_time: '2026-05-04T10:30:00.000Z',
      }),
    ])

    expect(mapping.skippedEventCount).toBe(0)
    expect(mapping.tasks).toHaveLength(2)

    // Multi-day event
    expect(mapping.tasks[0]._originalStartIso).toBe('2026-05-01T00:00:00.000Z')
    expect(mapping.tasks[0]._originalEndIso).toBe('2026-05-03T00:00:00.000Z')

    // Sub-day event (2.5 hours)
    expect(mapping.tasks[1]._originalStartIso).toBe('2026-05-04T08:00:00.000Z')
    expect(mapping.tasks[1]._originalEndIso).toBe('2026-05-04T10:30:00.000Z')
    expect(mapping.tasks[1].end.getTime() - mapping.tasks[1].start.getTime()).toBe(2.5 * 60 * 60 * 1000)
  })

  it('skips events with invalid or missing end_time', () => {
    const mapping = mapCalendarEventsToGanttTasks([
      createCalendarEvent({ id: 1, end_time: null }),
      createCalendarEvent({
        id: 2,
        start_time: '2026-05-01T10:00:00.000Z',
        end_time: '2026-05-01T09:00:00.000Z', // end before start
      }),
      createCalendarEvent({ id: 3, start_time: 'invalid-date' }),
    ])

    expect(mapping.skippedEventCount).toBe(3)
    expect(mapping.tasks).toHaveLength(0)
  })
})

function createCalendarEvent(overrides: Partial<UnifiedCalendarEvent> = {}): UnifiedCalendarEvent {
  const id = overrides.id ?? 1

  return {
    id,
    source: 'bb',
    source_id: `source-${id}`,
    title: `Task ${id}`,
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
