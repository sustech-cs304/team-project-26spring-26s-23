import { useEffect, type CSSProperties, type FormEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Pencil, Trash2 } from 'lucide-react'

import type { CalendarEventPatch, UnifiedCalendarEvent } from '../calendar-types'

export interface CalendarEventContextMenuState {
  event: UnifiedCalendarEvent
  x: number
  y: number
}

export interface CalendarEventEditDraft {
  title: string
  description: string
  location: string
  startDateTime: string
  endDateTime: string
}

export type CalendarEventCustomStatus = 'not_started' | 'in_progress' | 'completed'

export interface CalendarEventStatusOption {
  value: CalendarEventCustomStatus
  label: string
  progress: number
}

export const CALENDAR_EVENT_CUSTOM_STATUS_OPTIONS: CalendarEventStatusOption[] = [
  { value: 'not_started', label: '未开始', progress: 0 },
  { value: 'in_progress', label: '进行中', progress: 50 },
  { value: 'completed', label: '已完成', progress: 100 },
]

export const CALENDAR_EVENT_CONTEXT_MENU_WIDTH = 226
export const CALENDAR_EVENT_CONTEXT_MENU_VIEWPORT_MARGIN = 10

export function CalendarEventContextMenu({
  refElement,
  state,
  mutatingEventId,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  refElement: RefObject<HTMLDivElement>
  state: CalendarEventContextMenuState
  mutatingEventId: string | number | null
  onEdit: (event: UnifiedCalendarEvent) => void
  onDelete: (event: UnifiedCalendarEvent) => void
  onStatusChange: (event: UnifiedCalendarEvent, status: CalendarEventCustomStatus) => void
}) {
  const isMutating = mutatingEventId !== null
  const eventIsMutating = mutatingEventId !== null && String(mutatingEventId) === String(state.event.id)
  const isCustomEvent = isCustomCalendarEvent(state.event)
  const style = buildCalendarEventContextMenuStyle(state.x, state.y)

  const menu = (
    <div
      ref={refElement}
      className="calendar-gantt-context-menu"
      style={style}
      aria-label={`${state.event.title} 事件操作菜单`}
      data-testid="calendar-event-context-menu"
    >
      <div className="calendar-gantt-context-menu__summary">
        <span className="calendar-gantt-context-menu__title">{state.event.title}</span>
        <span className="calendar-gantt-context-menu__meta">{state.event.source.toUpperCase()} · {formatCalendarEventRange(state.event)}</span>
      </div>

      <div className="calendar-gantt-context-menu__group" aria-label="事件操作">
        <button
          type="button"
          className="calendar-gantt-context-menu__item"
          disabled={isMutating}
          data-testid="calendar-event-context-menu-edit"
          onClick={() => onEdit(state.event)}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>修改事件信息</span>
        </button>
        <button
          type="button"
          className="calendar-gantt-context-menu__item calendar-gantt-context-menu__item--danger"
          disabled={isMutating}
          data-testid="calendar-event-context-menu-delete"
          onClick={() => onDelete(state.event)}
        >
          <Trash2 size={15} aria-hidden="true" />
          <span>{eventIsMutating ? '删除中…' : '删除事件'}</span>
        </button>
      </div>

      {isCustomEvent ? (
        <div className="calendar-gantt-context-menu__group calendar-gantt-context-menu__status-group" aria-label="自定义事件状态">
          <span className="calendar-gantt-context-menu__section-label">设置状态</span>
          {CALENDAR_EVENT_CUSTOM_STATUS_OPTIONS.map((option) => {
            const active = state.event.status === option.value

            return (
              <button
                key={option.value}
                type="button"
                className={`calendar-gantt-context-menu__item calendar-gantt-context-menu__status calendar-gantt-context-menu__status--${option.value.replace('_', '-')}${active ? ' calendar-gantt-context-menu__status--active' : ''}`}
                disabled={isMutating || active}
                data-testid={`calendar-event-context-menu-status-${option.value}`}
                onClick={() => onStatusChange(state.event, option.value)}
              >
                <span className={`calendar-gantt-context-menu__status-dot calendar-gantt-context-menu__status-dot--${option.value.replace('_', '-')}`} aria-hidden="true" />
                <span>{option.label}</span>
                {active ? <Check size={14} className="calendar-gantt-context-menu__check" aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )

  return typeof document === 'undefined' || document.body === null ? menu : createPortal(menu, document.body)
}

export function CalendarEventEditDialog({
  event,
  draft,
  error,
  submitting,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  event: UnifiedCalendarEvent
  draft: CalendarEventEditDraft
  error: string | null
  submitting: boolean
  onDraftChange: (patch: Partial<CalendarEventEditDraft>) => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const dialog = (
    <div
      className="calendar-gantt-edit-dialog"
      role="presentation"
      data-testid="calendar-event-edit-dialog"
      onPointerDown={(pointerEvent) => {
        if (pointerEvent.target === pointerEvent.currentTarget) {
          onClose()
        }
      }}
    >
      <form className="calendar-gantt-edit-dialog__panel" role="dialog" aria-modal="true" aria-label="修改事件信息" onSubmit={onSubmit}>
        <header className="calendar-gantt-edit-dialog__header">
          <div>
            <p className="calendar-gantt-edit-dialog__eyebrow">Edit Event</p>
            <h3 className="calendar-gantt-edit-dialog__title">修改事件信息</h3>
          </div>
          <span className="calendar-gantt-edit-dialog__source">{event.source.toUpperCase()}</span>
        </header>

        <label className="calendar-gantt-edit-dialog__field">
          <span>标题</span>
          <input
            className="calendar-gantt-edit-dialog__input"
            data-testid="calendar-event-edit-title"
            value={draft.title}
            disabled={submitting}
            autoFocus
            onChange={(changeEvent) => onDraftChange({ title: changeEvent.currentTarget.value })}
          />
        </label>

        <label className="calendar-gantt-edit-dialog__field">
          <span>描述</span>
          <textarea
            className="calendar-gantt-edit-dialog__textarea"
            data-testid="calendar-event-edit-description"
            rows={3}
            value={draft.description}
            disabled={submitting}
            placeholder="可选"
            onChange={(changeEvent) => onDraftChange({ description: changeEvent.currentTarget.value })}
          />
        </label>

        <label className="calendar-gantt-edit-dialog__field">
          <span>地点</span>
          <input
            className="calendar-gantt-edit-dialog__input"
            data-testid="calendar-event-edit-location"
            value={draft.location}
            disabled={submitting}
            placeholder="可选"
            onChange={(changeEvent) => onDraftChange({ location: changeEvent.currentTarget.value })}
          />
        </label>

        <div className="calendar-gantt-edit-dialog__grid">
          <label className="calendar-gantt-edit-dialog__field">
            <span>开始时间</span>
            <input
              className="calendar-gantt-edit-dialog__input"
              data-testid="calendar-event-edit-start"
              type="datetime-local"
              step="60"
              value={draft.startDateTime}
              disabled={submitting}
              onChange={(changeEvent) => onDraftChange({ startDateTime: changeEvent.currentTarget.value })}
            />
          </label>
          <label className="calendar-gantt-edit-dialog__field">
            <span>结束时间</span>
            <input
              className="calendar-gantt-edit-dialog__input"
              data-testid="calendar-event-edit-end"
              type="datetime-local"
              step="60"
              min={draft.startDateTime}
              value={draft.endDateTime}
              disabled={submitting}
              onChange={(changeEvent) => onDraftChange({ endDateTime: changeEvent.currentTarget.value })}
            />
          </label>
        </div>

        {error !== null ? (
          <p className="calendar-gantt-edit-dialog__error" role="alert">{error}</p>
        ) : null}

        <footer className="calendar-gantt-edit-dialog__actions">
          <button type="button" className="calendar-gantt-edit-dialog__secondary" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button type="submit" className="calendar-gantt-edit-dialog__primary" disabled={submitting} data-testid="calendar-event-edit-submit">
            {submitting ? '保存中…' : '保存修改'}
          </button>
        </footer>
      </form>
    </div>
  )

  return typeof document === 'undefined' || document.body === null ? dialog : createPortal(dialog, document.body)
}

export function isCustomCalendarEvent(event: UnifiedCalendarEvent): boolean {
  return normalizeCalendarMarker(event.source) === 'custom'
}

export function buildCalendarStatusPatch(status: CalendarEventCustomStatus): CalendarEventPatch {
  const option = CALENDAR_EVENT_CUSTOM_STATUS_OPTIONS.find((item) => item.value === status)

  return {
    status,
    progress: option?.progress ?? 0,
  }
}

export function createCalendarEventEditDraft(event: UnifiedCalendarEvent): CalendarEventEditDraft {
  return {
    title: event.title,
    description: event.description ?? '',
    location: event.location ?? '',
    startDateTime: formatDateTimeInputValue(new Date(event.start_time)),
    endDateTime: formatDateTimeInputValue(event.end_time === null ? new Date(Number.NaN) : new Date(event.end_time)),
  }
}

export function validateCalendarEventEditDraft(draft: CalendarEventEditDraft): string | null {
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

export function buildCalendarEventEditPatch(draft: CalendarEventEditDraft): CalendarEventPatch {
  return {
    title: draft.title.trim(),
    description: normalizeOptionalText(draft.description),
    location: normalizeOptionalText(draft.location),
    start_time: new Date(draft.startDateTime).toISOString(),
    end_time: new Date(draft.endDateTime).toISOString(),
  }
}

export function buildCalendarEventContextMenuStyle(x: number, y: number): CSSProperties {
  const maxLeft = Math.max(
    CALENDAR_EVENT_CONTEXT_MENU_VIEWPORT_MARGIN,
    window.innerWidth - CALENDAR_EVENT_CONTEXT_MENU_WIDTH - CALENDAR_EVENT_CONTEXT_MENU_VIEWPORT_MARGIN,
  )

  return {
    left: `${clampNumber(x, CALENDAR_EVENT_CONTEXT_MENU_VIEWPORT_MARGIN, maxLeft)}px`,
    top: `${Math.max(CALENDAR_EVENT_CONTEXT_MENU_VIEWPORT_MARGIN, y)}px`,
    width: `${CALENDAR_EVENT_CONTEXT_MENU_WIDTH}px`,
  }
}

function formatCalendarEventRange(event: UnifiedCalendarEvent): string {
  const start = new Date(event.start_time)
  const end = event.end_time === null ? null : new Date(event.end_time)

  return end === null ? formatDate(start) : `${formatDate(start)} - ${formatDate(end)}`
}

function normalizeCalendarMarker(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
}

function normalizeOptionalText(value: string): string | null {
  const trimmedValue = value.trim()
  return trimmedValue.length === 0 ? null : trimmedValue
}

export function isDateTimeInputValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

export function formatDateTimeInputValue(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
