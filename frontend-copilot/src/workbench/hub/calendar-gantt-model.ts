import type { CalendarEventPatch, UnifiedCalendarEvent } from './calendar-types'

export interface CalendarGanttTask {
  [key: string]: unknown
  id: string
  name: string
  start: Date
  end: Date
  progress: number
  description?: string
  custom_class: string
  color: string
  color_progress: string
  source: string
  originalEventId: string | number
}

export interface CalendarGanttMappingResult {
  tasks: CalendarGanttTask[]
  skippedEventCount: number
}

const SOURCE_CLASS_PREFIX = 'calendar-gantt-source--'

export function mapCalendarEventsToGanttTasks(events: readonly UnifiedCalendarEvent[]): CalendarGanttMappingResult {
  const tasks: CalendarGanttTask[] = []
  let skippedEventCount = 0

  for (const event of events) {
    const task = mapCalendarEventToGanttTask(event)
    if (task === null) {
      skippedEventCount += 1
      continue
    }

    tasks.push(task)
  }

  return { tasks, skippedEventCount }
}

export function mapCalendarEventToGanttTask(event: UnifiedCalendarEvent): CalendarGanttTask | null {
  const start = parseEventDate(event.start_time)
  const end = parseEventDate(event.end_time)

  if (start === null || end === null || end.getTime() <= start.getTime()) {
    return null
  }

  const colorTokens = resolveSourceColorTokens(event.source)

  return {
    id: buildGanttTaskId(event.id),
    name: event.title,
    start,
    end,
    progress: resolveEventProgress(event),
    description: event.description ?? undefined,
    custom_class: buildSourceClassName(event.source),
    color: colorTokens.bar,
    color_progress: colorTokens.progress,
    source: event.source,
    originalEventId: event.id,
  }
}

export function buildCalendarEventDatePatch(start: Date, end: Date): CalendarEventPatch | null {
  if (!isValidDate(start) || !isValidDate(end) || end.getTime() <= start.getTime()) {
    return null
  }

  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  }
}

export function buildCalendarEventProgressPatch(progress: number): CalendarEventPatch | null {
  if (!Number.isFinite(progress)) {
    return null
  }

  const normalizedProgress = clampProgress(progress)
  return {
    progress: normalizedProgress,
    status: resolveProgressBucket(normalizedProgress),
  }
}

export function mergeCalendarEventPatch(
  events: readonly UnifiedCalendarEvent[],
  eventId: string | number,
  patch: CalendarEventPatch,
): UnifiedCalendarEvent[] {
  return events.map((event) => {
    if (String(event.id) !== String(eventId)) {
      return event
    }

    return {
      ...event,
      ...patch,
    }
  })
}

export function resolveProgressBucket(progress: number): UnifiedCalendarEvent['status'] {
  const normalizedProgress = clampProgress(progress)

  if (normalizedProgress <= 0) {
    return 'not_started'
  }

  if (normalizedProgress >= 100) {
    return 'completed'
  }

  return 'in_progress'
}

export function resolveEventProgress(event: UnifiedCalendarEvent): number {
  if (typeof event.progress === 'number' && Number.isFinite(event.progress)) {
    return clampProgress(event.progress)
  }

  switch (event.status) {
    case 'completed':
      return 100
    case 'in_progress':
      return 50
    default:
      return 0
  }
}

export function getCalendarEventIdFromGanttTaskId(taskId: string): string {
  return taskId.startsWith('calendar-event-') ? taskId.slice('calendar-event-'.length) : taskId
}

function buildGanttTaskId(eventId: string | number): string {
  return `calendar-event-${String(eventId)}`
}

function parseEventDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return isValidDate(date) ? date : null
}

function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime())
}

function clampProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)))
}

interface CalendarGanttColorTokens {
  bar: string
  progress: string
}

const DEFAULT_GANTT_COLOR_TOKENS: CalendarGanttColorTokens = {
  bar: '#64748b',
  progress: '#94a3b8',
}

const SOURCE_COLOR_TOKENS: Record<string, CalendarGanttColorTokens> = {
  bb: {
    bar: '#5b7fb9',
    progress: '#8fb1dc',
  },
  blackboard: {
    bar: '#5b7fb9',
    progress: '#8fb1dc',
  },
  course: {
    bar: '#7d6fa7',
    progress: '#afa4cf',
  },
  tis: {
    bar: '#6b8f7f',
    progress: '#9bc2ae',
  },
  manual: {
    bar: '#9a7a4f',
    progress: '#c8a873',
  },
  custom: {
    bar: '#9a7a4f',
    progress: '#c8a873',
  },
}

function buildSourceClassName(source: string): string {
  const normalizedSource = normalizeSourceKey(source) || 'unknown'
  return `${SOURCE_CLASS_PREFIX}${normalizedSource}`
}

function resolveSourceColorTokens(source: string): CalendarGanttColorTokens {
  return SOURCE_COLOR_TOKENS[normalizeSourceKey(source)] ?? DEFAULT_GANTT_COLOR_TOKENS
}

function normalizeSourceKey(source: string): string {
  return source.toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
}
