/* eslint-disable sonarjs/no-duplicate-string -- Test fixture data contains repeated ISO timestamps and field values across independent test cases. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const mockDbInstance = {
    prepare: vi.fn(),
    exec: vi.fn(),
    pragma: vi.fn(),
    close: vi.fn(),
  }

  return {
    mockDbInstance,
    mockGetTimelineDatabase: vi.fn(() => mockDbInstance),
  }
})

vi.mock('./database', () => ({
  getTimelineDatabase: hoisted.mockGetTimelineDatabase,
}))

import { getCalendarEvents, addCalendarEvent } from './service'
import type { AddTimelineEventInput } from './ipc'

const VALID_EVENT: AddTimelineEventInput = {
  source: 'test-source',
  title: 'Test Event',
  start_time: '2026-05-21T10:00:00.000Z',
  is_all_day: false,
}

const FULL_EVENT: AddTimelineEventInput = {
  source: 'blackboard',
  source_id: 'course-42',
  title: 'Lecture: Algorithms',
  description: 'Weekly algorithms lecture.',
  start_time: '2026-05-21T08:00:00.000Z',
  end_time: '2026-05-21T10:00:00.000Z',
  is_all_day: false,
  location: 'Room 301',
  status: 'not_started',
  metadata_payload: { campus: 'south', building: 'A' },
  progress: 0,
}

function createMockStatement(rows: unknown[]) {
  return {
    all: vi.fn(() => rows),
    run: vi.fn(() => ({ lastInsertRowid: 42, changes: 1 })),
  }
}

function createTimelineRow(overrides: Partial<{
  id: number
  source: string
  source_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  is_all_day: number
  location: string | null
  status: string
  metadata_payload: string | null
  progress: number | null
  created_at: string
  updated_at: string
}> = {}): ReturnType<typeof getCalendarEvents>[number] {
  const row = {
    id: overrides.id ?? 1,
    source: overrides.source ?? 'test-source',
    source_id: overrides.source_id ?? null,
    title: overrides.title ?? 'Test Event',
    description: overrides.description ?? null,
    start_time: overrides.start_time ?? '2026-05-21T10:00:00.000Z',
    end_time: overrides.end_time ?? null,
    is_all_day: overrides.is_all_day ?? 0,
    location: overrides.location ?? null,
    status: overrides.status ?? 'not_started',
    metadata_payload: overrides.metadata_payload ?? null,
    progress: overrides.progress ?? null,
    created_at: overrides.created_at ?? '2026-05-21T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-05-21T00:00:00.000Z',
  }
  return row
}

describe('getCalendarEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an empty array when no events exist', () => {
    const stmt = createMockStatement([])
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    const result = getCalendarEvents()

    expect(result).toEqual([])
    expect(hoisted.mockDbInstance.prepare).toHaveBeenCalledWith(
      'SELECT * FROM timeline_events ORDER BY start_time ASC',
    )
    expect(stmt.all).toHaveBeenCalledTimes(1)
  })

  it('returns mapped calendar events from database rows', () => {
    const rows = [
      {
        id: 1,
        source: 'blackboard',
        source_id: 'bb-001',
        title: 'Course A',
        description: 'Description A',
        start_time: '2026-05-21T08:00:00.000Z',
        end_time: '2026-05-21T10:00:00.000Z',
        is_all_day: 0,
        location: 'Room 101',
        status: 'not_started',
        metadata_payload: JSON.stringify({ campus: 'south' }),
        progress: 0,
        created_at: '2026-05-21T00:00:00.000Z',
        updated_at: '2026-05-21T00:00:00.000Z',
      },
      {
        id: 2,
        source: 'manual',
        source_id: null,
        title: 'Personal Task',
        description: null,
        start_time: '2026-05-21T12:00:00.000Z',
        end_time: null,
        is_all_day: 1,
        location: null,
        status: 'in_progress',
        metadata_payload: null,
        progress: 50,
        created_at: '2026-05-20T00:00:00.000Z',
        updated_at: '2026-05-20T00:00:00.000Z',
      },
    ]

    const stmt = createMockStatement(rows)
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    const result = getCalendarEvents()

    expect(result).toHaveLength(2)

    expect(result[0]).toEqual({
      id: 1,
      source: 'blackboard',
      source_id: 'bb-001',
      title: 'Course A',
      description: 'Description A',
      start_time: '2026-05-21T08:00:00.000Z',
      end_time: '2026-05-21T10:00:00.000Z',
      is_all_day: false,
      location: 'Room 101',
      status: 'not_started',
      metadata_payload: { campus: 'south' },
      progress: 0,
    })

    expect(result[1]).toEqual({
      id: 2,
      source: 'manual',
      source_id: null,
      title: 'Personal Task',
      description: null,
      start_time: '2026-05-21T12:00:00.000Z',
      end_time: null,
      is_all_day: true,
      location: null,
      status: 'in_progress',
      metadata_payload: null,
      progress: 50,
    })
  })

  it('handles malformed metadata_payload gracefully', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = [{
      id: 3,
      source: 'test',
      source_id: null,
      title: 'Bad JSON',
      description: null,
      start_time: '2026-05-21T10:00:00.000Z',
      end_time: null,
      is_all_day: 0,
      location: null,
      status: 'not_started',
      metadata_payload: '{invalid json',
      progress: null,
      created_at: '2026-05-21T00:00:00.000Z',
      updated_at: '2026-05-21T00:00:00.000Z',
    }]

    const stmt = createMockStatement(rows)
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    const result = getCalendarEvents()

    expect(result).toHaveLength(1)
    expect(result[0]?.metadata_payload).toBeNull()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Failed to parse metadata_payload:',
      expect.any(Error),
      '{invalid json',
    )
    consoleWarnSpy.mockRestore()
  })

  it('maps null progress to undefined', () => {
    const rows = [{
      id: 4,
      source: 'test',
      source_id: null,
      title: 'No Progress',
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

    const stmt = createMockStatement(rows)
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    const result = getCalendarEvents()

    expect(result[0]?.progress).toBeUndefined()
  })
})

describe('addCalendarEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a valid event and returns its id', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 42, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    const id = addCalendarEvent(VALID_EVENT)

    expect(id).toBe(42)
    expect(hoisted.mockDbInstance.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO timeline_events'))
    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'test-source',
        title: 'Test Event',
        start_time: '2026-05-21T10:00:00.000Z',
        is_all_day: 0,
        status: 'not_started',
      }),
    )
  })

  it('inserts a full event with all optional fields', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 99, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    const id = addCalendarEvent(FULL_EVENT)

    expect(id).toBe(99)
    expect(stmt.run).toHaveBeenCalledWith({
      source: 'blackboard',
      source_id: 'course-42',
      title: 'Lecture: Algorithms',
      description: 'Weekly algorithms lecture.',
      start_time: '2026-05-21T08:00:00.000Z',
      end_time: '2026-05-21T10:00:00.000Z',
      is_all_day: 0,
      location: 'Room 301',
      status: 'not_started',
      metadata_payload: JSON.stringify({ campus: 'south', building: 'A' }),
      progress: 0,
    })
  })

  it('defaults status to not_started when not provided', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent(VALID_EVENT)

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'not_started' }),
    )
  })

  it('defaults status to not_started when status is empty string', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent({ ...VALID_EVENT, status: '   ' })

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'not_started' }),
    )
  })

  it('uses provided status when non-empty', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent({ ...VALID_EVENT, status: 'in_progress' })

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' }),
    )
  })

  it('defaults progress to 0 when not provided', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent(VALID_EVENT)

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({ progress: 0 }),
    )
  })

  it('converts is_all_day boolean to integer 1 when true', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent({ ...VALID_EVENT, is_all_day: true })

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({ is_all_day: 1 }),
    )
  })

  it('converts is_all_day boolean to integer 0 when false', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent({ ...VALID_EVENT, is_all_day: false })

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({ is_all_day: 0 }),
    )
  })

  it('stringifies metadata_payload to JSON', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    addCalendarEvent({
      ...VALID_EVENT,
      metadata_payload: { key: 'value', nested: { a: 1 } },
    })

    expect(stmt.run).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata_payload: '{"key":"value","nested":{"a":1}}',
      }),
    )
  })
})

describe('addCalendarEvent validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws when source is missing', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, source: '' })).toThrow(
      'Invalid calendar event: source must be a non-empty string',
    )
  })

  it('throws when source is only whitespace', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, source: '   ' })).toThrow(
      'Invalid calendar event: source must be a non-empty string',
    )
  })

  it('throws when source is not a string', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, source: 123 as unknown as string })).toThrow(
      'Invalid calendar event: source must be a non-empty string',
    )
  })

  it('throws when title is missing', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, title: '' })).toThrow(
      'Invalid calendar event: title must be a non-empty string',
    )
  })

  it('throws when start_time is missing', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, start_time: '' })).toThrow(
      'Invalid calendar event: start_time must be a valid ISO-8601 string',
    )
  })

  it('throws when start_time is not a string', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, start_time: 123 as unknown as string })).toThrow(
      'Invalid calendar event: start_time must be a valid ISO-8601 string',
    )
  })

  it('throws when start_time is not valid ISO-8601', () => {
    expect(() => addCalendarEvent({ ...VALID_EVENT, start_time: 'yesterday' })).toThrow(
      'Invalid calendar event: start_time must be a valid ISO-8601 string',
    )
  })

  it('throws when end_time is provided but not valid ISO-8601', () => {
    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      end_time: 'tomorrow',
    })).toThrow(
      'Invalid calendar event: end_time must be a valid ISO-8601 string when provided',
    )
  })

  it('throws when end_time is not later than start_time', () => {
    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      end_time: '2026-05-21T08:00:00.000Z',
    })).toThrow(
      'Invalid calendar event: end_time must be later than start_time',
    )
  })

  it('throws when end_time equals start_time', () => {
    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      end_time: VALID_EVENT.start_time,
    })).toThrow(
      'Invalid calendar event: end_time must be later than start_time',
    )
  })

  it('throws when is_all_day is not a boolean', () => {
    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      is_all_day: 'yes' as unknown as boolean,
    })).toThrow(
      'Invalid calendar event: is_all_day must be a boolean',
    )
  })

  it('throws when status is not a string', () => {
    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      status: 42 as unknown as string,
    })).toThrow(
      'Invalid calendar event: status must be a string when provided',
    )
  })

  it('accumulates multiple validation errors', () => {
    expect(() => addCalendarEvent({
      source: '',
      title: '',
      start_time: 'bad',
      is_all_day: 'yes' as unknown as boolean,
      status: 99 as unknown as string,
    } as unknown as AddTimelineEventInput)).toThrow(
      'Invalid calendar event: source must be a non-empty string; title must be a non-empty string; start_time must be a valid ISO-8601 string; is_all_day must be a boolean; status must be a string when provided',
    )
  })

  it('accepts date-only ISO-8601 strings (YYYY-MM-DD)', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      start_time: '2026-05-21',
    })).not.toThrow()
  })

  it('accepts datetime with timezone ISO-8601 strings', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    expect(() => addCalendarEvent({
      ...VALID_EVENT,
      start_time: '2026-05-21T10:00:00+08:00',
      end_time: '2026-05-21T12:00:00+08:00',
    })).not.toThrow()
  })

  it('allows end_time to be omitted (null/undefined)', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    expect(() => addCalendarEvent(VALID_EVENT)).not.toThrow()
    expect(() => addCalendarEvent({ ...VALID_EVENT, end_time: undefined })).not.toThrow()
  })

  it('allows status to be omitted', () => {
    const stmt = createMockStatement([])
    stmt.run = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
    hoisted.mockDbInstance.prepare = vi.fn(() => stmt)

    expect(() => addCalendarEvent(VALID_EVENT)).not.toThrow()
  })
})
