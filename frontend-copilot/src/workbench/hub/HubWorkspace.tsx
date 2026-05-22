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

/**
 * Build a stable composite key for deduplication.
 * When source_id is available we use source:source_id; otherwise we degrade
 * to source + title + start_time so that multiple local events from the same
 * source without source_id are not collapsed into a single key.
 */
function buildCompositeKey(event: {
  source: string
  source_id: string | null
  title?: string
  start_time?: string
}): string {
  if (event.source_id != null && String(event.source_id).trim().length > 0) {
    return `${String(event.source)}:${String(event.source_id)}`
  }
  return `${String(event.source)}:${String(event.title ?? '')}:${String(event.start_time ?? '')}`
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

    if (bootstrap && bootstrap.state.status !== 'ready' && bootstrap.state.status !== 'degraded') {
      return
    }

    async function fetchEvents() {
      setIsLoading(true)
      setError(null)
      try {
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

        const localKeys = new Set(combinedEvents.map(e => buildCompositeKey(e)))

        let remoteFailed = false
        try {
          const desktopRuntime = window.desktopRuntime
          if (!desktopRuntime || typeof desktopRuntime.loadCalendarEvents !== 'function') {
            throw new Error('desktopRuntime bridge is unavailable')
          }
          const apiResponse = await desktopRuntime.loadCalendarEvents()
          if (apiResponse.ok) {
            if (apiResponse.items.length > 0) {
              for (const remoteEvent of apiResponse.items) {
                if (!localKeys.has(buildCompositeKey(remoteEvent))) {
                  combinedEvents.push(remoteEvent)
                }
              }
            }
          } else {
            console.warn(`[Sync] Calendar IPC proxy failed: ${apiResponse.error}`)
            remoteFailed = true
          }
        } catch (fetchErr: unknown) {
          console.warn('[Sync] Failed to load backend calendar events via IPC proxy:', fetchErr)
          remoteFailed = true
        }

        if (remoteFailed && combinedEvents.length === 0) {
          throw new Error(
            '无法加载日历事件：本地无缓存数据且远端 API 请求失败，请检查网络连接或后端服务状态。',
          )
        }

        // Re-sort the merged list chronologically so the UI always renders in
        // correct time order regardless of the order local vs remote events were appended.
        combinedEvents.sort((a, b) => {
          const aTime = new Date(a.start_time).getTime()
          const bTime = new Date(b.start_time).getTime()
          if (aTime !== bTime) return aTime - bTime
          // Stable tie-breaker: use title then source
          return (a.title ?? '').localeCompare(b.title ?? '') || String(a.source).localeCompare(String(b.source))
        })

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
  }, [bootstrap, refreshToken])

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
