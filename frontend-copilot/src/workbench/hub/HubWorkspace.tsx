import { useCallback, useEffect, useState } from 'react'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { getHubWorkspaceContent, type WorkbenchLanguage } from '../locale'
import type { HubWorkspaceView } from '../types'
import { CalendarGanttView } from './components/CalendarGanttView'
import { KanbanTracker } from './components/KanbanTracker'
import type { CalendarEventPatch, UnifiedCalendarEvent } from './calendar-types'
import { mergeCalendarEventPatch } from './calendar-gantt-model'

interface HubWorkspaceProps {
  view: HubWorkspaceView
  language?: WorkbenchLanguage
  bootstrap?: CopilotBootstrapController
}

function buildCompositeKey(event: { source: string; source_id: string | null }): string {
  // Use a single unified placeholder for null source_id so that the same event
  // cached locally without a source_id is correctly identified as a duplicate
  // when re-fetched from the remote API.
  return `${String(event.source)}:${String(event.source_id ?? '_null_')}`
}

export function HubWorkspace({ view, language = 'zh-CN', bootstrap }: HubWorkspaceProps) {
  const content = getHubWorkspaceContent(language, view)
  const [events, setEvents] = useState<UnifiedCalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    let actualRuntimeUrl = 'http://127.0.0.1:8765'
    if (bootstrap) {
      if (bootstrap.state.status === 'ready' || bootstrap.state.status === 'degraded') {
        actualRuntimeUrl = bootstrap.state.runtimeUrl
      } else {
        return
      }
    }

    async function fetchEvents() {
      setIsLoading(true)
      setError(null)
      try {
        // Guard against environments where the preload bridge is not injected
        // (e.g. running in a plain browser during dev, or preload injection failure).
        const timelineDb = window.timelineDatabase
        let localResponse: { items: UnifiedCalendarEvent[] }
        if (timelineDb && typeof timelineDb.loadEvents === 'function') {
          localResponse = await timelineDb.loadEvents()
        } else {
          console.warn(
            '[Sync] timelineDatabase bridge is unavailable; falling back to remote calendar events only.',
          )
          localResponse = { items: [] }
        }
        const combinedEvents = [...(localResponse.items || [])]

        // Build a composite dedup key from source + source_id to avoid
        // collisions between local auto-increment ids and remote numeric ids.
        // Unified placeholder `_null_` ensures the same event cached locally
        // without a source_id is correctly recognized when re-fetched.
        const localKeys = new Set(combinedEvents.map(e => buildCompositeKey(e)))

        let remoteFailed = false
        try {
          const apiResponse = await fetch(`${actualRuntimeUrl}/calendar/events`)
          if (apiResponse.ok) {
            const data = await apiResponse.json()
            if (data.items && data.items.length > 0) {
              for (const remoteEvent of data.items) {
                if (!localKeys.has(buildCompositeKey(remoteEvent))) {
                  combinedEvents.push(remoteEvent)
                }
              }
            }
          } else {
            console.warn(`[Sync] Calendar API responded with status ${apiResponse.status}`)
            remoteFailed = true
          }
        } catch (fetchErr: unknown) {
          console.warn('[Sync] Failed to fetch backend calendar events:', fetchErr)
          remoteFailed = true
        }

        if (remoteFailed && combinedEvents.length === 0) {
          throw new Error(
            '无法加载日历事件：本地无缓存数据且远端 API 请求失败，请检查网络连接或后端服务状态。',
          )
        }

        if (active) {
          setEvents(combinedEvents)
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
    fetchEvents()

    return () => {
      active = false
    }
  }, [bootstrap])

  const handleCalendarEventChange = useCallback((eventId: string | number, patch: CalendarEventPatch) => {
    setEvents((currentEvents) => mergeCalendarEventPatch(currentEvents, eventId, patch))
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
          <CalendarGanttView events={events} onEventChange={handleCalendarEventChange} />

          <KanbanTracker events={events} />

          <CalendarDebugPanel events={events} error={error} isLoading={isLoading} />
        </section>
      </main>
    </section>
  )
}

function CalendarDebugPanel({ events, error, isLoading }: {
  events: UnifiedCalendarEvent[]
  error: string | null
  isLoading: boolean
}) {
  return (
    <details className="calendar-debug-panel">
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
