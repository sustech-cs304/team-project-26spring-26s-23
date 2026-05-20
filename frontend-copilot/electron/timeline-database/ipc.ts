import type { UnifiedCalendarEvent } from './service'

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
