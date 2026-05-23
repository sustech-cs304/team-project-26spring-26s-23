import type { UnifiedCalendarEvent } from './timeline-database/ipc'

export const DESKTOP_RUNTIME_CALENDAR_EVENTS_LOAD_CHANNEL = 'desktop-runtime:calendar-events:load'
export const DESKTOP_RUNTIME_WAKEUP_ICS_IMPORT_CHANNEL = 'desktop-runtime:wakeup-ics:import'

export interface DesktopRuntimeCalendarEventsLoadSuccess {
  ok: true
  items: UnifiedCalendarEvent[]
}

export interface DesktopRuntimeCalendarEventsLoadFailure {
  ok: false
  error: string
}

export type DesktopRuntimeCalendarEventsLoadResult =
  | DesktopRuntimeCalendarEventsLoadSuccess
  | DesktopRuntimeCalendarEventsLoadFailure

export interface DesktopRuntimeWakeupIcsImportRequest {
  icsText: string
}

export interface DesktopRuntimeWakeupIcsImportSuccess {
  ok: true
  parsed: number
  stats?: unknown
}

export interface DesktopRuntimeWakeupIcsImportFailure {
  ok: false
  error: string
}

export type DesktopRuntimeWakeupIcsImportResult =
  | DesktopRuntimeWakeupIcsImportSuccess
  | DesktopRuntimeWakeupIcsImportFailure

export interface DesktopRuntimeApi {
  loadCalendarEvents: () => Promise<DesktopRuntimeCalendarEventsLoadResult>
  importWakeupIcs: (
    request: DesktopRuntimeWakeupIcsImportRequest,
  ) => Promise<DesktopRuntimeWakeupIcsImportResult>
}
