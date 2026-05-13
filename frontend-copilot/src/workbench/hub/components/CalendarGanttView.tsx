import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import Gantt, { type GanttOptions, type GanttTask } from 'frappe-gantt'

import type { CalendarEventPatch, UnifiedCalendarEvent } from '../calendar-types'
import {
  buildCalendarEventDatePatch,
  buildCalendarEventProgressPatch,
  getCalendarEventIdFromGanttTaskId,
  mapCalendarEventsToGanttTasks,
} from '../calendar-gantt-model'

interface CalendarGanttViewProps {
  events?: UnifiedCalendarEvent[]
  onEventChange: (eventId: string | number, patch: CalendarEventPatch) => void
}

export function CalendarGanttView({ events = [], onEventChange }: CalendarGanttViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const ganttRef = useRef<Gantt | null>(null)
  const onEventChangeRef = useRef(onEventChange)
  const [renderError, setRenderError] = useState<string | null>(null)
  const mapping = useMemo(() => mapCalendarEventsToGanttTasks(events), [events])
  const tasks = mapping.tasks
  const hideChart = tasks.length === 0 || renderError !== null

  useEffect(() => {
    onEventChangeRef.current = onEventChange
  }, [onEventChange])

  useEffect(() => {
    const container = containerRef.current
    if (container === null || tasks.length === 0) {
      return undefined
    }

    setRenderError(null)

    try {
      if (ganttRef.current === null) {
        ganttRef.current = new Gantt(container, tasks, buildGanttOptions(onEventChangeRef))
      } else {
        ganttRef.current.refresh(tasks)
      }
    } catch (error) {
      ganttRef.current = null
      container.innerHTML = ''
      setRenderError(error instanceof Error ? error.message : String(error))
    }

    return undefined
  }, [tasks])

  useEffect(() => () => {
    ganttRef.current = null
    if (containerRef.current !== null) {
      containerRef.current.innerHTML = ''
    }
  }, [])

  return (
    <section className="calendar-gantt-card" aria-label="甘特图时间轴">
      <header className="calendar-gantt-card__header">
        <div>
          <p className="calendar-gantt-card__eyebrow">Timeline</p>
          <h3 className="calendar-gantt-card__title">甘特图时间轴</h3>
        </div>
        <p className="calendar-gantt-card__meta">
          共 {events.length} 个事件{mapping.skippedEventCount > 0 ? `，${mapping.skippedEventCount} 个无法渲染` : ''}
        </p>
      </header>

      {mapping.skippedEventCount > 0 ? (
        <p className="calendar-gantt-card__notice" role="status">
          部分事件缺少有效开始或结束时间，已从甘特图中跳过。
        </p>
      ) : null}

      {renderError !== null ? (
        <div className="calendar-gantt-card__fallback" role="alert">
          <strong>甘特图初始化失败</strong>
          <span>{renderError}</span>
        </div>
      ) : null}

      {tasks.length === 0 && renderError === null ? (
        <div className="calendar-gantt-card__empty" data-testid="calendar-gantt-empty">
          暂无可显示的日历事件。
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="calendar-gantt-card__chart"
        data-testid="calendar-gantt-container"
        hidden={hideChart}
      />
    </section>
  )
}

function buildGanttOptions(onEventChangeRef: MutableRefObject<CalendarGanttViewProps['onEventChange']>): GanttOptions {
  return {
    view_mode: 'Day',
    view_mode_select: true,
    today_button: true,
    readonly: false,
    readonly_dates: false,
    readonly_progress: false,
    move_dependencies: false,
    container_height: 'auto',
    bar_height: 28,
    padding: 16,
    language: 'zh',
    popup_on: 'click',
    scroll_to: 'today',
    on_date_change(task, start, end) {
      const patch = buildCalendarEventDatePatch(start, end)
      if (patch === null) {
        return
      }

      onEventChangeRef.current(getCalendarEventIdFromTask(task), patch)
    },
    on_progress_change(task, progress) {
      const patch = buildCalendarEventProgressPatch(progress)
      if (patch === null) {
        return
      }

      onEventChangeRef.current(getCalendarEventIdFromTask(task), patch)
    },
    popup(context) {
      return buildPopupHtml(context.task)
    },
  }
}

function getCalendarEventIdFromTask(task: GanttTask): string | number {
  const originalEventId = task.originalEventId
  if (typeof originalEventId === 'string' || typeof originalEventId === 'number') {
    return originalEventId
  }

  return getCalendarEventIdFromGanttTaskId(task.id)
}

function buildPopupHtml(task: GanttTask): string {
  const start = task._start instanceof Date ? task._start : new Date(task.start)
  const end = task._end instanceof Date ? task._end : new Date(task.end)
  const progress = typeof task.progress === 'number' ? task.progress : 0
  const description = typeof task.description === 'string' && task.description.length > 0
    ? `<p class="calendar-gantt-popup__description">${escapeHtml(task.description)}</p>`
    : ''

  return [
    '<div class="calendar-gantt-popup">',
    `<strong class="calendar-gantt-popup__title">${escapeHtml(task.name)}</strong>`,
    description,
    `<span class="calendar-gantt-popup__detail">${formatDate(start)} - ${formatDate(end)}</span>`,
    `<span class="calendar-gantt-popup__detail">进度：${Math.round(progress)}%</span>`,
    '</div>',
  ].join('')
}

function formatDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return '未知时间'
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;')
}
