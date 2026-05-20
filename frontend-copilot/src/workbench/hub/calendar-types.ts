// Re-export canonical types from the shared IPC module so Electron main process
// and renderer stay consistent automatically.
export type {
  CalendarEventStatus,
  UnifiedCalendarEvent,
} from '../../electron/timeline-database/ipc'

export interface CalendarEventPatch {
  start_time?: string
  end_time?: string
  status?: string
  progress?: number
}
