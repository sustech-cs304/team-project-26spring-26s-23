import type { UnifiedCalendarEvent } from './service'

export interface LoadTimelineEventsResult {
  items: UnifiedCalendarEvent[]
}

export interface AddTimelineEventRequest {
  event: Omit<UnifiedCalendarEvent, 'id'>
}

export interface AddTimelineEventResult {
  id: number
}
