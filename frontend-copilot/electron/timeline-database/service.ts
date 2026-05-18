import { getTimelineDatabase } from './database'

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

export function getCalendarEvents(): UnifiedCalendarEvent[] {
  const db = getTimelineDatabase()
  const stmt = db.prepare(`SELECT * FROM timeline_events ORDER BY start_time ASC`)
  const rows = stmt.all() as any[]

  return rows.map(row => ({
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
    metadata_payload: row.metadata_payload ? JSON.parse(row.metadata_payload) : null,
    progress: row.progress,
  }))
}

export function addCalendarEvent(event: Omit<UnifiedCalendarEvent, 'id'>): number {
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