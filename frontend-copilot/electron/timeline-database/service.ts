import { getTimelineDatabase } from './database'
import type { TimelineEventRow } from './database'

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
  status: string
  metadata_payload?: Record<string, unknown> | null
  progress?: number
}

function validateCalendarEventInput(event: Omit<UnifiedCalendarEvent, 'id'>): void {
  const errors: string[] = []

  if (typeof event.source !== 'string' || event.source.trim().length === 0) {
    errors.push('source must be a non-empty string')
  }
  if (typeof event.title !== 'string' || event.title.trim().length === 0) {
    errors.push('title must be a non-empty string')
  }
  if (typeof event.start_time !== 'string' || event.start_time.trim().length === 0) {
    errors.push('start_time must be a non-empty string')
  }
  if (typeof event.is_all_day !== 'boolean') {
    errors.push('is_all_day must be a boolean')
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

export function addCalendarEvent(event: Omit<UnifiedCalendarEvent, 'id'>): number {
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
    source_id: event.source_id,
    title: event.title,
    description: event.description,
    start_time: event.start_time,
    end_time: event.end_time,
    is_all_day: event.is_all_day ? 1 : 0,
    location: event.location,
    status: event.status,
    metadata_payload: event.metadata_payload ? JSON.stringify(event.metadata_payload) : null,
    progress: event.progress ?? 0,
  })

  return Number(info.lastInsertRowid)
}
