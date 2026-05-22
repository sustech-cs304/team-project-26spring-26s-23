import type {
  AddTimelineEventRequest,
  AddTimelineEventResult,
  LoadTimelineEventsRequest,
  LoadTimelineEventsResult,
} from '../timeline-database/ipc'

export const TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL = 'timeline-database:load-events'
export const TIMELINE_DATABASE_ADD_EVENT_CHANNEL = 'timeline-database:add-event'

export interface TimelineDatabaseApi {
  loadEvents: (request?: LoadTimelineEventsRequest) => Promise<LoadTimelineEventsResult>
  addEvent: (request: AddTimelineEventRequest) => Promise<AddTimelineEventResult>
}

export interface TimelineDatabaseIpcHandlers {
  loadTimelineEvents: (request?: LoadTimelineEventsRequest) => Promise<LoadTimelineEventsResult>
  addTimelineEvent: (request: AddTimelineEventRequest) => Promise<AddTimelineEventResult>
}
