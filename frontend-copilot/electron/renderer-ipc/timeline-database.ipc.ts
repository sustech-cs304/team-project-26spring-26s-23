import type {
  AddTimelineEventRequest,
  AddTimelineEventResult,
  DeleteTimelineEventRequest,
  DeleteTimelineEventResult,
  LoadTimelineEventsRequest,
  LoadTimelineEventsResult,
  UpdateTimelineEventRequest,
  UpdateTimelineEventResult,
} from '../timeline-database/ipc'

export const TIMELINE_DATABASE_LOAD_EVENTS_CHANNEL = 'timeline-database:load-events'
export const TIMELINE_DATABASE_ADD_EVENT_CHANNEL = 'timeline-database:add-event'
export const TIMELINE_DATABASE_UPDATE_EVENT_CHANNEL = 'timeline-database:update-event'
export const TIMELINE_DATABASE_DELETE_EVENT_CHANNEL = 'timeline-database:delete-event'

export interface TimelineDatabaseApi {
  loadEvents: (request?: LoadTimelineEventsRequest) => Promise<LoadTimelineEventsResult>
  addEvent: (request: AddTimelineEventRequest) => Promise<AddTimelineEventResult>
  updateEvent: (request: UpdateTimelineEventRequest) => Promise<UpdateTimelineEventResult>
  deleteEvent: (request: DeleteTimelineEventRequest) => Promise<DeleteTimelineEventResult>
}

export interface TimelineDatabaseIpcHandlers {
  loadTimelineEvents: (request?: LoadTimelineEventsRequest) => Promise<LoadTimelineEventsResult>
  addTimelineEvent: (request: AddTimelineEventRequest) => Promise<AddTimelineEventResult>
  updateTimelineEvent: (request: UpdateTimelineEventRequest) => Promise<UpdateTimelineEventResult>
  deleteTimelineEvent: (request: DeleteTimelineEventRequest) => Promise<DeleteTimelineEventResult>
}
