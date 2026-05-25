import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import type { CalendarEventPatch, UnifiedCalendarEvent } from '../calendar-types'

import {
  CalendarEventContextMenu,
  CalendarEventEditDialog,
  buildCalendarEventEditPatch,
  buildCalendarStatusPatch,
  createCalendarEventEditDraft,
  validateCalendarEventEditDraft,
  formatDateTimeInputValue,
  isDateTimeInputValue,
  type CalendarEventContextMenuState,
  type CalendarEventCustomStatus,
  type CalendarEventEditDraft,
} from './CalendarEventContextMenu'

export interface KanbanNewEventInput {
  title: string
  status: KanbanCreateStatus
  startDateTime: string
  endDateTime: string
}

interface KanbanTrackerProps {
  events?: UnifiedCalendarEvent[]
  onCreateEvent?: (input: KanbanNewEventInput) => Promise<void> | void
  onEventChange?: (eventId: string | number, patch: CalendarEventPatch) => void | Promise<void>
  onEventDelete?: (eventId: string | number) => void | Promise<void>
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

export function KanbanTracker({ events = [], onCreateEvent, onEventChange, onEventDelete }: KanbanTrackerProps) {
  const [activeCreateStatus, setActiveCreateStatus] = useState<KanbanCreateStatus | null>(null)
  const [draft, setDraft] = useState<KanbanEventDraft>(() => createDefaultKanbanEventDraft())
  const [createError, setCreateError] = useState<string | null>(null)
  const [savingCreateStatus, setSavingCreateStatus] = useState<KanbanCreateStatus | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<CalendarEventContextMenuState | null>(null)
  const [editingEvent, setEditingEvent] = useState<UnifiedCalendarEvent | null>(null)
  const [editDraft, setEditDraft] = useState<CalendarEventEditDraft | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [eventActionError, setEventActionError] = useState<string | null>(null)
  const [mutatingEventId, setMutatingEventId] = useState<string | number | null>(null)

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

  const openEventContextMenu = useCallback((event: UnifiedCalendarEvent, x: number, y: number) => {
    setContextMenu({ event, x, y })
    setEventActionError(null)
  }, [])

  const closeEditDialog = useCallback(() => {
    if (mutatingEventId !== null) {
      return
    }

    setEditingEvent(null)
    setEditDraft(null)
    setEditError(null)
  }, [mutatingEventId])

  const openEditDialog = useCallback((event: UnifiedCalendarEvent) => {
    setContextMenu(null)
    setEventActionError(null)
    setEditingEvent(event)
    setEditDraft(createCalendarEventEditDraft(event))
    setEditError(null)
  }, [])

  const applyEventPatch = useCallback(async (eventId: string | number, patch: CalendarEventPatch) => {
    if (onEventChange === undefined) {
      setEventActionError('无法修改事件：日历数据库桥接不可用。')
      return
    }

    setMutatingEventId(eventId)
    setEventActionError(null)
    try {
      await onEventChange(eventId, patch)
    } catch (error) {
      setEventActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingEventId(null)
    }
  }, [onEventChange])

  const handleStatusChange = useCallback((event: UnifiedCalendarEvent, status: CalendarEventCustomStatus) => {
    setContextMenu(null)
    void applyEventPatch(event.id, buildCalendarStatusPatch(status))
  }, [applyEventPatch])

  const handleDeleteEvent = useCallback(async (event: UnifiedCalendarEvent) => {
    setContextMenu(null)
    if (onEventDelete === undefined) {
      setEventActionError('无法删除事件：日历数据库桥接不可用。')
      return
    }

    setMutatingEventId(event.id)
    setEventActionError(null)
    try {
      await onEventDelete(event.id)
    } catch (error) {
      setEventActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingEventId(null)
    }
  }, [onEventDelete])

  const handleEditDraftChange = useCallback((patch: Partial<CalendarEventEditDraft>) => {
    setEditDraft((currentDraft) => currentDraft === null ? currentDraft : { ...currentDraft, ...patch })
    setEditError(null)
  }, [])

  const handleEditSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (editingEvent === null || editDraft === null) {
      return
    }

    const validationError = validateCalendarEventEditDraft(editDraft)
    if (validationError !== null) {
      setEditError(validationError)
      return
    }

    const patch = buildCalendarEventEditPatch(editDraft)
    if (onEventChange === undefined) {
      setEditError('无法修改事件：日历数据库桥接不可用。')
      return
    }

    setMutatingEventId(editingEvent.id)
    setEventActionError(null)
    try {
      await onEventChange(editingEvent.id, patch)
      setEditingEvent(null)
      setEditDraft(null)
      setEditError(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingEventId(null)
    }
  }, [editDraft, editingEvent, onEventChange])

  useEffect(() => {
    if (contextMenu === null) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current !== null && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, { passive: true })
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

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
          onContextMenu={openEventContextMenu}
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
          onContextMenu={openEventContextMenu}
        />
        <KanbanColumn label="已完成" tone="done" events={completed} onContextMenu={openEventContextMenu} />
      </div>

      {eventActionError !== null ? (
        <p className="calendar-gantt-card__notice calendar-gantt-card__notice--danger" role="alert" style={{ marginTop: '0.75rem' }}>
          {eventActionError}
        </p>
      ) : null}

      {contextMenu !== null ? (
        <CalendarEventContextMenu
          refElement={contextMenuRef}
          state={contextMenu}
          mutatingEventId={mutatingEventId}
          onEdit={openEditDialog}
          onDelete={handleDeleteEvent}
          onStatusChange={handleStatusChange}
        />
      ) : null}

      {editingEvent !== null && editDraft !== null ? (
        <CalendarEventEditDialog
          event={editingEvent}
          draft={editDraft}
          error={editError}
          submitting={mutatingEventId !== null}
          onDraftChange={handleEditDraftChange}
          onClose={closeEditDialog}
          onSubmit={handleEditSubmit}
        />
      ) : null}
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
  onContextMenu,
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
  onContextMenu?: (event: UnifiedCalendarEvent, x: number, y: number) => void
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
          <KanbanCard key={evt.id} event={evt} tone={tone} onContextMenu={onContextMenu} />
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

function KanbanCard({ event, tone, onContextMenu }: { event: UnifiedCalendarEvent; tone: string; onContextMenu?: (event: UnifiedCalendarEvent, x: number, y: number) => void }) {
  const done = tone === 'done'
  const sourceClass = SOURCE_LABEL_CLASS[event.source] ?? ''

  return (
    <article
      className={`kanban-card${done ? ' kanban-card--done' : ''}`}
      onContextMenu={(mouseEvent) => {
        if (onContextMenu === undefined) {
          return
        }

        mouseEvent.preventDefault()
        onContextMenu(event, mouseEvent.clientX, mouseEvent.clientY)
      }}
    >
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
