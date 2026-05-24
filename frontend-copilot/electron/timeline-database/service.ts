import type { AddTimelineEventInput, UnifiedCalendarEvent, UpdateTimelineEventPatch } from './ipc'
import { getTimelineDatabase } from './database'
import type { TimelineEventRow } from './database'

// ISO-8601 subset accepted for start_time / end_time
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

function parseTimeMs(value: string): number {
  const ts = Date.parse(value)
  if (Number.isNaN(ts)) {
    throw new Error(`Cannot parse time value: ${value}`)
  }
  return ts
}

function validateCalendarEventInput(event: AddTimelineEventInput): void {
  const errors: string[] = []

  validateCalendarEventCoreFields(event, errors, { requireTitle: true, requireStartTime: true, requireAllDay: true })

  if (typeof event.source !== 'string' || event.source.trim().length === 0) {
    errors.unshift('source must be a non-empty string')
  }

  if (errors.length > 0) {
    throw new Error(`Invalid calendar event: ${errors.join('; ')}`)
  }
}

function validateCalendarEventPatch(patch: UpdateTimelineEventPatch): void {
  const errors: string[] = []

  if (!isPlainRecord(patch) || !SUPPORTED_UPDATE_FIELDS.some((field) => field in patch)) {
    errors.push('patch must include at least one supported field')
  } else {
    validateCalendarEventCoreFields(patch, errors, { requireTitle: false, requireStartTime: false, requireAllDay: false })
  }

  if (errors.length > 0) {
    throw new Error(`Invalid calendar event patch: ${errors.join('; ')}`)
  }
}

function validateCalendarEventCoreFields(
  value: AddTimelineEventInput | UpdateTimelineEventPatch,
  errors: string[],
  options: { requireTitle: boolean; requireStartTime: boolean; requireAllDay: boolean },
): void {
  if (options.requireTitle || value.title !== undefined) {
    if (typeof value.title !== 'string' || value.title.trim().length === 0) {
      errors.push('title must be a non-empty string')
    }
  }
  if (options.requireStartTime || value.start_time !== undefined) {
    if (typeof value.start_time !== 'string' || !ISO_8601_RE.test(value.start_time)) {
      errors.push('start_time must be a valid ISO-8601 string')
    }
  }
  if (value.end_time != null) {
    if (typeof value.end_time !== 'string' || !ISO_8601_RE.test(value.end_time)) {
      errors.push('end_time must be a valid ISO-8601 string when provided')
    }
  } else if (value.end_time !== undefined && value.end_time !== null) {
    errors.push('end_time must be a valid ISO-8601 string when provided')
  }
  if (typeof value.start_time === 'string' && typeof value.end_time === 'string' && ISO_8601_RE.test(value.start_time) && ISO_8601_RE.test(value.end_time)) {
    try {
      const startMs = parseTimeMs(value.start_time)
      const endMs = parseTimeMs(value.end_time)
      if (endMs <= startMs) {
        errors.push('end_time must be later than start_time')
      }
    } catch {
      // parse failure is already caught by the ISO-8601 check above
    }
  }
  if (options.requireAllDay || value.is_all_day !== undefined) {
    if (typeof value.is_all_day !== 'boolean') {
      errors.push('is_all_day must be a boolean')
    }
  }
  if (value.status !== undefined && typeof value.status !== 'string') {
    errors.push('status must be a string when provided')
  }
  if (value.progress !== undefined && (typeof value.progress !== 'number' || !Number.isFinite(value.progress))) {
    errors.push('progress must be a finite number when provided')
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

export function addCalendarEvent(event: AddTimelineEventInput): number {
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
    status: normalizeStatus(event.status),
    metadata_payload: serializeMetadataPayload(event.metadata_payload),
    progress: event.progress ?? 0,
  })

  return Number(info.lastInsertRowid)
}

export function updateCalendarEvent(id: string | number, patch: UpdateTimelineEventPatch): UnifiedCalendarEvent | null {
  validateCalendarEventId(id)
  validateCalendarEventPatch(patch)
  const normalizedPatch = normalizeCalendarEventPatch(patch)

  const assignments = Object.keys(normalizedPatch).map((field) => `${field} = @${field}`)
  const db = getTimelineDatabase()
  const stmt = db.prepare(`
    UPDATE timeline_events
    SET ${assignments.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `)
  const info = stmt.run({ id, ...normalizedPatch })

  if (Number(info.changes) === 0) {
    return null
  }

  return getCalendarEventById(id)
}

export function deleteCalendarEvent(id: string | number): boolean {
  validateCalendarEventId(id)

  const db = getTimelineDatabase()
  const stmt = db.prepare('DELETE FROM timeline_events WHERE id = @id')
  const info = stmt.run({ id })
  return Number(info.changes) > 0
}

function getCalendarEventById(id: string | number): UnifiedCalendarEvent | null {
  const db = getTimelineDatabase()
  const stmt = db.prepare('SELECT * FROM timeline_events WHERE id = @id LIMIT 1')
  const row = stmt.get({ id }) as TimelineEventRow | undefined

  return row === undefined ? null : mapRowToCalendarEvent(row)
}

function validateCalendarEventId(id: string | number): void {
  if ((typeof id !== 'string' && typeof id !== 'number') || String(id).trim().length === 0) {
    throw new Error('Invalid calendar event id')
  }
}

function normalizeCalendarEventPatch(patch: UpdateTimelineEventPatch): Record<string, unknown> {
  const normalizedPatch: Record<string, unknown> = {}

  for (const key of SUPPORTED_UPDATE_FIELDS) {
    if (!(key in patch)) {
      continue
    }

    const value = patch[key]
    if (key === 'is_all_day') {
      normalizedPatch[key] = value === true ? 1 : value === false ? 0 : value
    } else if (key === 'metadata_payload') {
      normalizedPatch[key] = serializeMetadataPayload(value)
    } else if (key === 'status') {
      normalizedPatch[key] = normalizeStatus(value)
    } else {
      normalizedPatch[key] = value ?? null
    }
  }

  return normalizedPatch
}

function normalizeStatus(status: unknown): string {
  return typeof status === 'string' && status.trim().length > 0 ? status : 'not_started'
}

function serializeMetadataPayload(metadataPayload: unknown): string | null {
  return metadataPayload ? JSON.stringify(metadataPayload) : null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SUPPORTED_UPDATE_FIELDS = [
  'title',
  'description',
  'start_time',
  'end_time',
  'is_all_day',
  'location',
  'status',
  'metadata_payload',
  'progress',
] as const satisfies ReadonlyArray<keyof UpdateTimelineEventPatch>
