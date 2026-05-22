import type { CSSProperties } from 'react'

import type { UnifiedCalendarEvent } from '../calendar-types'

interface KanbanTrackerProps {
  events?: UnifiedCalendarEvent[]
}

const SOURCE_LABEL_CLASS: Record<string, string> = {
  bb: 'kanban-card__source--bb',
  course: 'kanban-card__source--course',
  custom: 'kanban-card__source--custom',
}

const KANBAN_MAX_VISIBLE_EVENTS = 10
const KANBAN_CARD_BLOCK_SIZE = 58
const KANBAN_CARD_GAP = 6

export function KanbanTracker({ events = [] }: KanbanTrackerProps) {
  const notStarted = events.filter((e) => e.status === 'not_started')
  const inProgress = events.filter((e) => e.status === 'in_progress')
  const completed = events.filter((e) => e.status === 'completed')

  return (
    <section className="kanban-tracker">
      <header className="kanban-tracker__head">
        <p className="kanban-tracker__eyebrow">Task Board</p>
        <h3 className="kanban-tracker__title">任务跟踪</h3>
      </header>

      <div className="kanban-tracker__columns">
        <KanbanColumn label="未开始" tone="warn" events={notStarted} showAdd />
        <KanbanColumn label="进行中" tone="active" events={inProgress} showAdd />
        <KanbanColumn label="已完成" tone="done" events={completed} />
      </div>
    </section>
  )
}

function KanbanColumn({ label, tone, events, showAdd = false }: {
  label: string
  tone: 'warn' | 'active' | 'done'
  events: UnifiedCalendarEvent[]
  showAdd?: boolean
}) {
  const bodyStyle = {
    '--kanban-visible-event-list-height': `${getKanbanVisibleEventListHeight(events.length)}px`,
  } as CSSProperties
  const scrollable = events.length > KANBAN_MAX_VISIBLE_EVENTS

  return (
    <div className={`kanban-column kanban-column--${tone}`}>
      <div className="kanban-column__head">
        <span className={`kanban-column__dot kanban-column__dot--${tone}`} />
        <span className="kanban-column__label">{label}</span>
        <span className="kanban-column__count">{events.length}</span>
      </div>
      <div
        className={`kanban-column__body${scrollable ? ' kanban-column__body--scrollable' : ''}`}
        style={bodyStyle}
        data-testid={`kanban-column-body-${tone}`}
        data-visible-event-limit={KANBAN_MAX_VISIBLE_EVENTS}
        aria-label={`${label}事件列表，最多显示${KANBAN_MAX_VISIBLE_EVENTS}个事件，可滚动查看更多`}
      >
        {events.map((evt) => (
          <KanbanCard key={evt.id} event={evt} tone={tone} />
        ))}
        {events.length === 0 && (
          <p className="kanban-column__empty">—</p>
        )}
      </div>
      {showAdd ? (
        <button type="button" className="kanban-column__add-btn">+ 新建任务</button>
      ) : null}
    </div>
  )
}

function getKanbanVisibleEventListHeight(eventCount: number): number {
  const visibleEventCount = Math.max(1, Math.min(eventCount, KANBAN_MAX_VISIBLE_EVENTS))

  return KANBAN_CARD_BLOCK_SIZE * visibleEventCount + KANBAN_CARD_GAP * Math.max(0, visibleEventCount - 1)
}

function KanbanCard({ event, tone }: { event: UnifiedCalendarEvent; tone: string }) {
  const done = tone === 'done'
  const sourceClass = SOURCE_LABEL_CLASS[event.source] ?? ''

  return (
    <article className={`kanban-card${done ? ' kanban-card--done' : ''}`}>
      <div className="kanban-card__body">
        <span className={`kanban-card__source-dot${sourceClass ? ` ${sourceClass}` : ''}`} />
        <span className={done ? 'kanban-card__title--done' : 'kanban-card__title'}>
          {event.title}
        </span>
      </div>
      <div className="kanban-card__meta">
        <span>{event.source.toUpperCase()}</span>
        {typeof event.progress === 'number' && (
          <span>{event.progress}%</span>
        )}
      </div>
    </article>
  )
}
