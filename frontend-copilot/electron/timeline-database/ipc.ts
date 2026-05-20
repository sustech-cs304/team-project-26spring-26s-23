// Canonical shared types for timeline events.
// Used by both Electron main process (service.ts) and renderer (calendar-types.ts).

export type CalendarEventStatus = 'not_started' | 'in_progress' | 'completed' | string

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
  status: CalendarEventStatus
  metadata_payload?: Record<string, unknown> | null
  progress?: number
}

export interface LoadTimelineEventsResult {
  items: UnifiedCalendarEvent[]
}

// Input type that mirrors server-side defaults: status and progress are optional
// so callers don't have to supply them when the DB layer will default them.
export type AddTimelineEventInput = Omit<UnifiedCalendarEvent, 'id' | 'status' | 'progress'> & {
  status?: UnifiedCalendarEvent['status']
  progress?: UnifiedCalendarEvent['progress']
}

export interface AddTimelineEventRequest {
  event: AddTimelineEventInput
}

export interface AddTimelineEventResult {
  id: number
}
