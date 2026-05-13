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

export interface CalendarEventPatch {
  start_time?: string
  end_time?: string
  status?: CalendarEventStatus
  progress?: number
}
