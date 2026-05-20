import { getTimelineDatabase } from './database'
import type { TimelineEventRow } from './database'

// Keep in sync with src/workbench/hub/calendar-types.ts:UnifiedCalendarEvent
export type CalendarEventStatus = 'not_started' | 'in_progress' | 'completed'

export interface UnifiedCalendarEvent {
  id: string | number
  source: string
  source_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  is_all_day: boolean
  location: string | null
  status: CalendarEventStatus | string
  metadata_payload?: Record<string, unknown> | null
  progress?: number
}

// ISO-8601 subset accepted for start_time / end_time
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

const VALID_STATUS_VALUES: ReadonlySet<string> = new Set(['not_started', 'in_progress', 'completed'])

function validateCalendarEventInput(event: Omit<UnifiedCalendarEvent, 'id'>): void {
  const errors: string[] = []

  if (typeof event.source !== 'string' || event.source.trim().length === 0) {
    errors.push('source must be a non-empty string')
  }
  if (typeof event.title !== 'string' || event.title.trim().length === 0) {
    errors.push('title must be a non-empty string')
  }
  if (typeof event.start_time !== 'string' || !ISO_8601_RE.test(event.start_time)) {
    errors.push('start_time must be a valid ISO-8601 string')
  }
  if (event.end_time != null && (typeof event.end_time !== 'string' || !ISO_8601_RE.test(event.end_time))) {
    errors.push('end_time must be a valid ISO-8601 string when provided')
  }
  if (typeof event.is_all_day !== 'boolean') {
    errors.push('is_all_day must be a boolean')
  }
  if (event.status !== undefined && typeof event.status !== 'string') {
    errors.push('status must be a string when provided')
  }
  if (
    typeof event.status === 'string' &&
    event.status.trim().length > 0 &&
    !VALID_STATUS_VALUES.has(event.status)
  ) {
    errors.push(`status must be one of: ${[...VALID_STATUS_VALUES].join(', ')}`)
  }

  if (errors.length > 0) {
    throw new Error(`Invalid calendar event: ${errors.join('; ')}`)
  }
}

function mapRowToCalendarEvent(row: TimelineEventRow): UnifiedCalendarEvent {
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    title: row.title,
    description: row.description,
    start_time: row.start_time,
    end_time: row.end_time,
    is_all_day: Boolean(row.is_all_day),
    location: row.location,
    status: row.status,
    metadata_payload: (() => {
      if (!row.metadata_payload) return null
      try {
        return JSON.parse(row.metadata_payload) as Record<string, unknown>
      } catch (err) {
        console.warn('Failed to parse metadata_payload:', err, row.metadata_payload)
        return null
      }
    })(),
    progress: row.progress ?? undefined,
  }
}

export function getCalendarEvents(): UnifiedCalendarEvent[] {
  const db = getTimelineDatabase()
  const stmt = db.prepare(`SELECT * FROM timeline_events ORDER BY start_time ASC`)
  const rows = stmt.all() as TimelineEventRow[]

  return rows.map(row => mapRowToCalendarEvent(row))
}

export function addCalendarEvent(event: Omit<UnifiedCalendarEvent, 'id' | 'status'> & { status?: UnifiedCalendarEvent['status'] }): number {
  validateCalendarEventInput(event)

  const db = getTimelineDatabase()
  const stmt = db.prepare(`
    INSERT INTO timeline_events (
      source, source_id, title, description, start_time, end_time,
      is_all_day, location, status, metadata_payload, progress
    )
    VALUES (
      @source, @source_id, @title, @description, @start_time, @end_time,
      @is_all_day, @location, @status, @metadata_payload, @progress
    )
  `)

  const info = stmt.run({
    source: event.source,
    source_id: event.source_id ?? null,
    title: event.title,
    description: event.description ?? null,
    start_time: event.start_time,
    end_time: event.end_time ?? null,
    is_all_day: event.is_all_day ? 1 : 0,
    location: event.location ?? null,
    status: (event.status && String(event.status).trim().length > 0) ? event.status : 'not_started',
    metadata_payload: event.metadata_payload ? JSON.stringify(event.metadata_payload) : null,
    progress: event.progress ?? 0,
  })

  return Number(info.lastInsertRowid)
}
