import { beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AddTimelineEventInput,
  AddTimelineEventRequest,
  AddTimelineEventResult,
  CalendarEventStatus,
  LoadTimelineEventsResult,
  UnifiedCalendarEvent,
} from './ipc'
import {
  TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL,
  TIMELINE_DATABASE_ADD_EVENT_CHANNEL,
  type TimelineDatabaseApi,
} from '../renderer-ipc/timeline-database.ipc'
import { getCalendarEvents, addCalendarEvent } from './service'

const hoisted = vi.hoisted(() => {
  const mockStatement = {
    all: vi.fn(() => [] as unknown[]),
    run: vi.fn(() => ({ lastInsertRowid: 42, changes: 1 })),
  }

  const mockDbInstance = {
    prepare: vi.fn(() => mockStatement),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  }

  return {
    mockDbInstance,
    mockStatement,
    mockGetTimelineDatabase: vi.fn(() => mockDbInstance),
  }
})

vi.mock('./database', () => ({
  getTimelineDatabase: hoisted.mockGetTimelineDatabase,
}))

describe('timeline-database IPC', () => {
  describe('channel constants', () => {
    it('defines the load events channel', () => {
      expect(TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL).toBe('timeline-database:load-events')
    })

    it('defines the add event channel', () => {
      expect(TIMELINE_DATABASE_ADD_EVENT_CHANNEL).toBe('timeline-database:add-event')
    })

    it('has distinct channel names', () => {
      expect(TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL).not.toBe(TIMELINE_DATABASE_ADD_EVENT_CHANNEL)
    })
  })

  describe('type shapes (compile-time verification)', () => {
    it('can construct a valid UnifiedCalendarEvent object', () => {
      const event: UnifiedCalendarEvent = {
        id: 1,
        source: 'test',
        source_id: null,
        title: 'Test Event',
        description: null,
        start_time: '2026-05-21T10:00:00.000Z',
        end_time: null,
        is_all_day: false,
        location: null,
        status: 'not_started',
      }

      expect(event.id).toBe(1)
      expect(event.source).toBe('test')
      expect(event.title).toBe('Test Event')
      expect(event.status).toBe('not_started')
    })

    it('can construct a valid AddTimelineEventInput', () => {
      const input: AddTimelineEventInput = {
        source: 'blackboard',
        source_id: 'course-1',
        title: 'Lecture',
        description: 'Weekly lecture',
        start_time: '2026-05-21T08:00:00.000Z',
        end_time: '2026-05-21T10:00:00.000Z',
        is_all_day: false,
        location: 'Room 301',
        status: 'not_started' as CalendarEventStatus,
        metadata_payload: { campus: 'south' },
        progress: 0,
      }

      expect(input.source).toBe('blackboard')
      expect(input.is_all_day).toBe(false)
    })

    it('can construct a minimal AddTimelineEventInput with only required fields', () => {
      const input: AddTimelineEventInput = {
        source: 'test',
        title: 'Minimal Event',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: false,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
      }

      expect(input.source).toBe('test')
      expect(input.title).toBe('Minimal Event')
    })

    it('can construct a valid AddTimelineEventRequest', () => {
      const request: AddTimelineEventRequest = {
        event: {
          source: 'test',
          title: 'Test Event',
          start_time: '2026-05-21T10:00:00.000Z',
          is_all_day: false,
          description: null,
          location: null,
          source_id: null,
          end_time: null,
        },
      }

      expect(request.event.source).toBe('test')
    })

    it('can construct a valid AddTimelineEventResult', () => {
      const result: AddTimelineEventResult = { id: 42 }

      expect(result.id).toBe(42)
    })

    it('can construct a valid LoadTimelineEventsResult with items', () => {
      const result: LoadTimelineEventsResult = {
        items: [
          {
            id: 1,
            source: 'test',
            source_id: null,
            title: 'Event 1',
            description: null,
            start_time: '2026-05-21T10:00:00.000Z',
            end_time: null,
            is_all_day: false,
            location: null,
            status: 'not_started',
          },
        ],
      }

      expect(result.items).toHaveLength(1)
    })

    it('can construct a valid LoadTimelineEventsResult with empty items', () => {
      const result: LoadTimelineEventsResult = { items: [] }

      expect(result.items).toHaveLength(0)
    })
  })

  describe('TimelineDatabaseApi interface', () => {
    it('defines loadEvents method', () => {
      const api = {
        loadEvents: vi.fn(),
        addEvent: vi.fn(),
      } satisfies TimelineDatabaseApi

      expect(typeof api.loadEvents).toBe('function')
      expect(typeof api.addEvent).toBe('function')
    })
  })

  describe('database service integration', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      hoisted.mockStatement.all.mockReturnValue([])
      hoisted.mockStatement.run.mockReturnValue({ lastInsertRowid: 42, changes: 1 })
    })

    it('loadTimelineEvents returns empty items when no events exist', () => {
      const result = getCalendarEvents()

      expect(hoisted.mockGetTimelineDatabase).toHaveBeenCalled()
      expect(hoisted.mockDbInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM timeline_events'))
      expect(result).toEqual([])
    })

    it('loadTimelineEvents returns mapped events from database rows', () => {
      const rows = [{
        id: 1,
        source: 'test-source',
        source_id: null,
        title: 'Test Event',
        description: null,
        start_time: '2026-05-21T10:00:00.000Z',
        end_time: null,
        is_all_day: 0,
        location: null,
        status: 'not_started',
        metadata_payload: null,
        progress: null,
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
      }]

      hoisted.mockStatement.all.mockReturnValue(rows)

      const result = getCalendarEvents()

      expect(result).toHaveLength(1)
      expect(result[0]?.id).toBe(1)
      expect(result[0]?.source).toBe('test-source')
      expect(result[0]?.is_all_day).toBe(false)
    })

    it('addCalendarEvent inserts an event and returns the new id', () => {
      const id = addCalendarEvent({
        source: 'test-source',
        title: 'Test Event',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: false,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
      })

      expect(hoisted.mockGetTimelineDatabase).toHaveBeenCalled()
      expect(hoisted.mockDbInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO timeline_events'))
      expect(id).toBe(42)
    })

    it('addCalendarEvent defaults status to not_started', () => {
      addCalendarEvent({
        source: 'test-source',
        title: 'Test Event',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: true,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
      })

      expect(hoisted.mockStatement.run).toHaveBeenCalledWith(expect.objectContaining({
        is_all_day: 1,
        status: 'not_started',
        progress: 0,
      }))
    })

    it('addCalendarEvent converts metadata_payload to JSON string', () => {
      addCalendarEvent({
        source: 'test-source',
        title: 'Test Event',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: false,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
        metadata_payload: { campus: 'south', building: 'A' },
      })

      expect(hoisted.mockStatement.run).toHaveBeenCalledWith(expect.objectContaining({
        metadata_payload: '{"campus":"south","building":"A"}',
      }))
    })

    it('addCalendarEvent throws for invalid input', () => {
      expect(() => addCalendarEvent({
        source: '',
        title: 'Test Event',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: false,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
      })).toThrow('Invalid calendar event')

      expect(() => addCalendarEvent({
        source: 'test',
        title: '',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: false,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
      })).toThrow('Invalid calendar event')

      expect(() => addCalendarEvent({
        source: 'test',
        title: 'Test',
        start_time: 'not-a-date',
        is_all_day: false,
        description: null,
        location: null,
        source_id: null,
        end_time: null,
      })).toThrow('Invalid calendar event')
    })
  })
})
