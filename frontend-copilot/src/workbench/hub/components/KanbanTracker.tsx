import { useCallback, useState, type CSSProperties, type FormEvent } from 'react'

import type { UnifiedCalendarEvent } from '../calendar-types'

export interface KanbanNewEventInput {
  title: string
  status: KanbanCreateStatus
  startDateTime: string
  endDateTime: string
}

interface KanbanTrackerProps {
  events?: UnifiedCalendarEvent[]
  onCreateEvent?: (input: KanbanNewEventInput) => Promise<void> | void
}

export type KanbanCreateStatus = 'not_started' | 'in_progress'
type KanbanColumnTone = 'warn' | 'active' | 'done'

interface KanbanEventDraft {
  title: string
  startDateTime: string
  endDateTime: string
}

const SOURCE_LABEL_CLASS: Record<string, string> = {
  bb: 'kanban-card__source--bb',
  course: 'kanban-card__source--course',
  custom: 'kanban-card__source--custom',
}

const KANBAN_MAX_VISIBLE_EVENTS = 10
const KANBAN_CARD_BLOCK_SIZE = 58
const KANBAN_CARD_GAP = 6

const KANBAN_EXCLUDED_SOURCES = new Set<string>(['wakeup'])

export function KanbanTracker({ events = [], onCreateEvent }: KanbanTrackerProps) {
  const [activeCreateStatus, setActiveCreateStatus] = useState<KanbanCreateStatus | null>(null)
  const [draft, setDraft] = useState<KanbanEventDraft>(() => createDefaultKanbanEventDraft())
  const [createError, setCreateError] = useState<string | null>(null)
  const [savingCreateStatus, setSavingCreateStatus] = useState<KanbanCreateStatus | null>(null)

  const visibleEvents = events.filter((e) => !KANBAN_EXCLUDED_SOURCES.has(e.source))
  const notStarted = visibleEvents.filter((e) => e.status === 'not_started')
  const inProgress = visibleEvents.filter((e) => e.status === 'in_progress')
  const completed = visibleEvents.filter((e) => e.status === 'completed')

  const openCreateForm = useCallback((status: KanbanCreateStatus) => {
    setDraft(createDefaultKanbanEventDraft())
    setCreateError(null)
    setActiveCreateStatus(status)
  }, [])

  const updateDraft = useCallback((patch: Partial<KanbanEventDraft>) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }))
    setCreateError(null)
  }, [])

  const cancelCreate = useCallback(() => {
    if (savingCreateStatus !== null) {
      return
    }

    setActiveCreateStatus(null)
    setCreateError(null)
    setDraft(createDefaultKanbanEventDraft())
  }, [savingCreateStatus])

  const submitCreate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (activeCreateStatus === null) {
      return
    }

    const validationError = validateKanbanEventDraft(draft)
    if (validationError !== null) {
      setCreateError(validationError)
      return
    }

    if (onCreateEvent === undefined) {
      setCreateError('无法新建事件：日历数据库桥接不可用。')
      return
    }

    try {
      setSavingCreateStatus(activeCreateStatus)
      await onCreateEvent({
        title: draft.title.trim(),
        status: activeCreateStatus,
        startDateTime: draft.startDateTime,
        endDateTime: draft.endDateTime,
      })
      setActiveCreateStatus(null)
      setCreateError(null)
      setDraft(createDefaultKanbanEventDraft())
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingCreateStatus(null)
    }
  }, [activeCreateStatus, draft, onCreateEvent])

  return (
    <section className="kanban-tracker">
      <header className="kanban-tracker__head">
        <p className="kanban-tracker__eyebrow">Task Board</p>
        <h3 className="kanban-tracker__title">任务跟踪</h3>
      </header>

      <div className="kanban-tracker__columns">
        <KanbanColumn
          label="未开始"
          tone="warn"
          events={notStarted}
          createStatus="not_started"
          isComposerOpen={activeCreateStatus === 'not_started'}
          draft={draft}
          createError={activeCreateStatus === 'not_started' ? createError : null}
          isCreating={savingCreateStatus === 'not_started'}
          createDisabled={savingCreateStatus !== null}
          onOpenCreate={openCreateForm}
          onDraftChange={updateDraft}
          onCancelCreate={cancelCreate}
          onSubmitCreate={submitCreate}
        />
        <KanbanColumn
          label="进行中"
          tone="active"
          events={inProgress}
          createStatus="in_progress"
          isComposerOpen={activeCreateStatus === 'in_progress'}
          draft={draft}
          createError={activeCreateStatus === 'in_progress' ? createError : null}
          isCreating={savingCreateStatus === 'in_progress'}
          createDisabled={savingCreateStatus !== null}
          onOpenCreate={openCreateForm}
          onDraftChange={updateDraft}
          onCancelCreate={cancelCreate}
          onSubmitCreate={submitCreate}
        />
        <KanbanColumn label="已完成" tone="done" events={completed} />
      </div>
    </section>
  )
}

function KanbanColumn({
  label,
  tone,
  events,
  createStatus,
  isComposerOpen = false,
  draft,
  createError,
  isCreating = false,
  createDisabled = false,
  onOpenCreate,
  onDraftChange,
  onCancelCreate,
  onSubmitCreate,
}: {
  label: string
  tone: KanbanColumnTone
  events: UnifiedCalendarEvent[]
  createStatus?: KanbanCreateStatus
  isComposerOpen?: boolean
  draft?: KanbanEventDraft
  createError?: string | null
  isCreating?: boolean
  createDisabled?: boolean
  onOpenCreate?: (status: KanbanCreateStatus) => void
  onDraftChange?: (patch: Partial<KanbanEventDraft>) => void
  onCancelCreate?: () => void
  onSubmitCreate?: (event: FormEvent<HTMLFormElement>) => void
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
      {createStatus !== undefined && onOpenCreate !== undefined ? (
        isComposerOpen && draft !== undefined && onDraftChange !== undefined && onCancelCreate !== undefined && onSubmitCreate !== undefined ? (
          <KanbanCreateEventForm
            label={label}
            tone={tone}
            draft={draft}
            error={createError ?? null}
            isCreating={isCreating}
            onDraftChange={onDraftChange}
            onCancel={onCancelCreate}
            onSubmit={onSubmitCreate}
          />
        ) : (
          <button
            type="button"
            className="kanban-column__add-btn"
            data-testid={`kanban-add-event-${tone}`}
            aria-label={`${label}新建事件`}
            disabled={createDisabled}
            onClick={() => onOpenCreate(createStatus)}
          >
            + 新建事件
          </button>
        )
      ) : null}
    </div>
  )
}

function KanbanCreateEventForm({
  label,
  tone,
  draft,
  error,
  isCreating,
  onDraftChange,
  onCancel,
  onSubmit,
}: {
  label: string
  tone: KanbanColumnTone
  draft: KanbanEventDraft
  error: string | null
  isCreating: boolean
  onDraftChange: (patch: Partial<KanbanEventDraft>) => void
  onCancel: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <form
      id={`kanban-create-form-${tone}`}
      className="kanban-column__composer"
      data-testid={`kanban-new-event-form-${tone}`}
      aria-label={`${label}新建事件`}
      onSubmit={onSubmit}
    >
      <div className="kanban-column__composer-head">
        <span className="kanban-column__composer-title">新建事件</span>
        <span className="kanban-column__composer-source">CUSTOM</span>
      </div>

      <label className="kanban-column__composer-field">
        <span>标题</span>
        <input
          className="kanban-column__composer-input"
          data-testid={`kanban-new-event-title-${tone}`}
          value={draft.title}
          placeholder="例如：完成课程作业"
          disabled={isCreating}
          autoFocus
          onChange={(event) => onDraftChange({ title: event.currentTarget.value })}
        />
      </label>

      <div className="kanban-column__composer-grid">
        <label className="kanban-column__composer-field">
          <span>开始时间</span>
          <input
            className="kanban-column__composer-input"
            data-testid={`kanban-new-event-start-${tone}`}
            type="datetime-local"
            step="60"
            value={draft.startDateTime}
            disabled={isCreating}
            onChange={(event) => onDraftChange({ startDateTime: event.currentTarget.value })}
          />
        </label>
        <label className="kanban-column__composer-field">
          <span>结束时间</span>
          <input
            className="kanban-column__composer-input"
            data-testid={`kanban-new-event-end-${tone}`}
            type="datetime-local"
            step="60"
            min={draft.startDateTime}
            value={draft.endDateTime}
            disabled={isCreating}
            onChange={(event) => onDraftChange({ endDateTime: event.currentTarget.value })}
          />
        </label>
      </div>

      {error !== null ? (
        <p className="kanban-column__composer-error" role="alert">{error}</p>
      ) : null}

      <div className="kanban-column__composer-actions">
        <button type="submit" className="kanban-column__composer-submit" disabled={isCreating}>
          {isCreating ? '创建中…' : '创建'}
        </button>
        <button type="button" className="kanban-column__composer-cancel" disabled={isCreating} onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  )
}

function getKanbanVisibleEventListHeight(eventCount: number): number {
  const visibleEventCount = Math.max(1, Math.min(eventCount, KANBAN_MAX_VISIBLE_EVENTS))

  return KANBAN_CARD_BLOCK_SIZE * visibleEventCount + KANBAN_CARD_GAP * Math.max(0, visibleEventCount - 1)
}

function createDefaultKanbanEventDraft(): KanbanEventDraft {
  const start = new Date()
  start.setSeconds(0, 0)

  const end = new Date(start)
  end.setHours(start.getHours() + 1)

  return {
    title: '',
    startDateTime: formatDateTimeInputValue(start),
    endDateTime: formatDateTimeInputValue(end),
  }
}

function validateKanbanEventDraft(draft: KanbanEventDraft): string | null {
  if (draft.title.trim().length === 0) {
    return '请输入事件标题。'
  }

  if (!isDateTimeInputValue(draft.startDateTime) || !isDateTimeInputValue(draft.endDateTime)) {
    return '请选择有效的开始和结束时间。'
  }

  if (Date.parse(draft.endDateTime) <= Date.parse(draft.startDateTime)) {
    return '结束时间必须晚于开始时间。'
  }

  return null
}

function isDateTimeInputValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function formatDateTimeInputValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
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
