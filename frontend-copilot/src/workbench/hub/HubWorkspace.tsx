import { useCallback, useEffect, useState } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { getHubWorkspaceContent, type WorkbenchLanguage } from '../locale'
import type { HubWorkspaceView } from '../types'
import { CalendarGanttView } from './components/CalendarGanttView'
import { KanbanTracker } from './components/KanbanTracker'
import type { AddTimelineEventInput, CalendarEventPatch, UnifiedCalendarEvent } from './calendar-types'
import type { KanbanNewEventInput } from './components/KanbanTracker'
interface HubWorkspaceProps {
  view: HubWorkspaceView
  language?: WorkbenchLanguage
  bootstrap?: CopilotBootstrapController
}

export function HubWorkspace({ view, language = 'zh-CN', bootstrap }: HubWorkspaceProps) {
  const content = getHubWorkspaceContent(language, view)
  const [events, setEvents] = useState<UnifiedCalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    const handler = () => {
      setRefreshToken((value) => value + 1)
    }
    window.addEventListener('candue:calendar-refresh', handler)
    return () => {
      window.removeEventListener('candue:calendar-refresh', handler)
    }
  }, [])

  useEffect(() => {
    let active = true

    let actualRuntimeUrl = 'http://127.0.0.1:8765'
    if (bootstrap) {
      if (bootstrap.state.status === 'ready' || bootstrap.state.status === 'degraded') {
        actualRuntimeUrl = bootstrap.state.runtimeUrl
      } else {
        return undefined
      }
    }

    async function fetchEvents() {
      setIsLoading(true)
      setError(null)
      try {
        const timelineDb = window.timelineDatabase
        if (timelineDb === undefined || typeof timelineDb.loadEvents !== 'function') {
          throw new Error('无法加载日历事件：日历数据库桥接不可用。')
        }

        const response = await timelineDb.loadEvents({ runtimeUrl: actualRuntimeUrl })

        if (active) {
          setEvents(response.items || [])
        }
      } catch (err: unknown) {
        if (active) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }
    void fetchEvents()

    return () => {
      active = false
    }
  }, [bootstrap, refreshToken])

  const handleCalendarEventChange = useCallback(async (eventId: string | number, patch: CalendarEventPatch) => {
    const timelineDb = window.timelineDatabase
    if (timelineDb === undefined || typeof timelineDb.updateEvent !== 'function') {
      throw new Error('无法修改事件：日历数据库桥接不可用。')
    }

    const response = await timelineDb.updateEvent({ id: eventId, patch })
    if (!response.updated) {
      throw new Error('无法修改事件：事件不存在或未更新。')
    }

    setEvents((currentEvents) => sortCalendarEventsByStartTime(
      currentEvents.map((event) => {
        if (String(event.id) !== String(eventId)) {
          return event
        }

        return response.item ?? { ...event, ...patch }
      }),
    ))
  }, [])

  const handleCalendarEventDelete = useCallback(async (eventId: string | number) => {
    const timelineDb = window.timelineDatabase
    if (timelineDb === undefined || typeof timelineDb.deleteEvent !== 'function') {
      throw new Error('无法删除事件：日历数据库桥接不可用。')
    }

    const response = await timelineDb.deleteEvent({ id: eventId })
    if (!response.deleted) {
      throw new Error('无法删除事件：事件不存在或未删除。')
    }

    setEvents((currentEvents) => currentEvents.filter((event) => String(event.id) !== String(eventId)))
  }, [])

  const handleKanbanEventCreate = useCallback(async (input: KanbanNewEventInput) => {
    const timelineDb = window.timelineDatabase
    if (timelineDb === undefined || typeof timelineDb.addEvent !== 'function') {
      throw new Error('无法新建事件：日历数据库桥接不可用。')
    }

    const eventInput = buildCustomTimelineEventInput(input)
    const response = await timelineDb.addEvent({ event: eventInput })

    setEvents((currentEvents) => sortCalendarEventsByStartTime([
      ...currentEvents,
      buildUnifiedCalendarEvent(response.id, eventInput),
    ]))
  }, [])

  return (
    <section className="workspace-stage hub-workspace" aria-label={`${content.title}工作区`}>
      <main className="workspace-main" aria-label={`${content.title}主内容区`}>
        <header className="workspace-main__header">
          <div>
            <p className="workspace-main__eyebrow">{content.eyebrow}</p>
            <h2 className="workspace-main__title">{content.title}</h2>
          </div>
        </header>

        <section className="workspace-main__content calendar-workspace-content" style={{ display: 'flex', flexDirection: 'column' }}>
          <CalendarGanttView events={events} onEventChange={handleCalendarEventChange} onEventDelete={handleCalendarEventDelete} />

          <KanbanTracker events={events} onCreateEvent={handleKanbanEventCreate} />

          <CalendarDebugPanel events={events} error={error} isLoading={isLoading} />
        </section>
      </main>
    </section>
  )
}

function buildCustomTimelineEventInput(input: KanbanNewEventInput): AddTimelineEventInput {
  return {
    source: 'custom',
    source_id: null,
    title: input.title,
    description: null,
    start_time: buildMinutePrecisionIsoTime(input.startDateTime),
    end_time: buildMinutePrecisionIsoTime(input.endDateTime),
    is_all_day: false,
    location: null,
    status: input.status,
    metadata_payload: {
      created_from: 'kanban_tracker',
    },
    progress: input.status === 'in_progress' ? 50 : 0,
  }
}

function buildUnifiedCalendarEvent(id: string | number, input: AddTimelineEventInput): UnifiedCalendarEvent {
  return {
    id,
    source: input.source,
    source_id: input.source_id ?? null,
    title: input.title,
    description: input.description ?? null,
    start_time: input.start_time,
    end_time: input.end_time ?? null,
    is_all_day: input.is_all_day,
    location: input.location ?? null,
    status: input.status ?? 'not_started',
    metadata_payload: input.metadata_payload ?? null,
    progress: input.progress ?? 0,
  }
}

function buildMinutePrecisionIsoTime(dateTimeInput: string): string {
  return new Date(dateTimeInput).toISOString()
}

function sortCalendarEventsByStartTime(events: UnifiedCalendarEvent[]): UnifiedCalendarEvent[] {
  return [...events].sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
}

function CalendarDebugPanel({ events, error, isLoading }: {
  events: UnifiedCalendarEvent[]
  error: string | null
  isLoading: boolean
}) {
  return (
    <details className="calendar-debug-panel" hidden>
      <summary className="calendar-debug-panel__summary">
        后端原始事件数据 Debug (Error: {error || 'None'})
      </summary>
      <div className="calendar-debug-panel__body">
        {error ? (
          <p style={{ color: 'red' }}>错误: {error}</p>
        ) : isLoading ? (
          <p>Loading events...</p>
        ) : events.length === 0 ? (
          <p>No events found.</p>
        ) : (
          <ul>
            {events.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong>
                <div>
                  {new Date(event.start_time).toLocaleString()} - {event.source.toUpperCase()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
