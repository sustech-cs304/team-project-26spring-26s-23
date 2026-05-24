// Re-export canonical types from the shared IPC module so Electron main process
// and renderer stay consistent automatically.
export type {
  AddTimelineEventInput,
  CalendarEventStatus,
  UnifiedCalendarEvent,
} from '../../../electron/timeline-database/ipc'

export interface CalendarEventPatch {
  title?: string
  description?: string | null
  start_time?: string
  end_time?: string | null
  location?: string | null
  status?: string
  progress?: number
}
