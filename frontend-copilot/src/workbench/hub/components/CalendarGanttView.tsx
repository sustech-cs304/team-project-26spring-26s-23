import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MutableRefObject } from 'react'
import Gantt, { type GanttOptions, type GanttTask } from 'frappe-gantt'
import { Check, ChevronDown, RefreshCw, Settings } from 'lucide-react'

import type { CalendarEventPatch, UnifiedCalendarEvent } from '../calendar-types'
import {
  buildCalendarEventDatePatch,
  buildCalendarEventProgressPatch,
  getCalendarEventIdFromGanttTaskId,
  mapCalendarEventsToGanttTasks,
} from '../calendar-gantt-model'
import {
  CalendarEventContextMenu,
  CalendarEventEditDialog,
  buildCalendarEventEditPatch,
  buildCalendarStatusPatch,
  createCalendarEventEditDraft,
  validateCalendarEventEditDraft,
  type CalendarEventContextMenuState,
  type CalendarEventCustomStatus,
  type CalendarEventEditDraft,
} from './CalendarEventContextMenu'

interface CalendarGanttViewProps {
  events?: UnifiedCalendarEvent[]
  onEventChange: (eventId: string | number, patch: CalendarEventPatch) => void | Promise<void>
  onEventDelete?: (eventId: string | number) => void | Promise<void>
  onRefresh?: () => void
}

export function CalendarGanttView({ events = [], onEventChange, onEventDelete, onRefresh }: CalendarGanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ganttRef = useRef<Gantt | null>(null)
  const onEventChangeRef = useRef(onEventChange)
  const viewModeSelectRef = useRef<HTMLDivElement>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const viewModeRef = useRef<CalendarGanttViewMode>(DEFAULT_GANTT_VIEW_MODE)
  const wheelInteractionRef = useRef<GanttWheelInteractionState>(createGanttWheelInteractionState())
  const [renderError, setRenderError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<CalendarGanttViewMode>(DEFAULT_GANTT_VIEW_MODE)
  const [viewModeMenuOpen, setViewModeMenuOpen] = useState(false)
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false)
  const [showWakeupCourses, setShowWakeupCourses] = useState(true)
  const [contextMenu, setContextMenu] = useState<CalendarEventContextMenuState | null>(null)
  const [editingEvent, setEditingEvent] = useState<UnifiedCalendarEvent | null>(null)
  const [editDraft, setEditDraft] = useState<CalendarEventEditDraft | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [eventActionError, setEventActionError] = useState<string | null>(null)
  const [mutatingEventId, setMutatingEventId] = useState<string | number | null>(null)
  const displayedEvents = useMemo(
    () => (showWakeupCourses ? events : events.filter((event) => !isWakeupCalendarEvent(event))),
    [events, showWakeupCourses],
  )
  const hiddenWakeupCount = events.length - displayedEvents.length
  const mapping = useMemo(() => mapCalendarEventsToGanttTasks(displayedEvents), [displayedEvents])
  const tasks = mapping.tasks
  const hideChart = tasks.length === 0 || renderError !== null
  const selectedViewModeOption = GANTT_VIEW_MODE_OPTIONS.find((option) => option.value === viewMode) ?? GANTT_VIEW_MODE_OPTIONS[0]
  const ganttChartViewportStyle = useMemo(() => ({
    '--calendar-gantt-visible-chart-height': `${getGanttVisibleChartHeight(tasks.length)}px`,
  }) as CSSProperties, [tasks.length])

  useEffect(() => {
    onEventChangeRef.current = onEventChange
  }, [onEventChange])

  useEffect(() => {
    if (editingEvent === null) {
      return
    }

    const latestEvent = events.find((event) => String(event.id) === String(editingEvent.id))
    if (latestEvent === undefined) {
      setEditingEvent(null)
      setEditDraft(null)
      setEditError(null)
      return
    }

    setEditingEvent(latestEvent)
  }, [editingEvent, events])

  useEffect(() => {
    if (!viewModeMenuOpen && !settingsMenuOpen && contextMenu === null) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (viewModeSelectRef.current !== null && !viewModeSelectRef.current.contains(target)) {
        setViewModeMenuOpen(false)
      }
      if (settingsMenuRef.current !== null && !settingsMenuRef.current.contains(target)) {
        setSettingsMenuOpen(false)
      }
      if (contextMenuRef.current !== null && !contextMenuRef.current.contains(target)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setViewModeMenuOpen(false)
        setSettingsMenuOpen(false)
        setContextMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, { passive: true })
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu, settingsMenuOpen, viewModeMenuOpen])

  useEffect(() => {
    const container = containerRef.current
    if (container === null || tasks.length === 0) {
      return undefined
    }

    setRenderError(null)

    try {
      if (ganttRef.current === null) {
        ganttRef.current = new Gantt(container, tasks, buildGanttOptions(onEventChangeRef, viewModeRef.current))
        enhanceGanttPopupPositioning(ganttRef.current)
      } else {
        ganttRef.current.refresh(tasks)
      }
      fixGanttBarDurationComputation(ganttRef.current)
      correctGanttBarDurations(ganttRef.current)
      scheduleGanttLabelStabilization(ganttRef.current)
      syncGanttVerticalScrollAffordance(container, tasks.length)
    } catch (error) {
      cleanupGanttPopupPositioning(ganttRef.current)
      ganttRef.current = null
      container.innerHTML = ''
      setRenderError(error instanceof Error ? error.message : String(error))
    }

    return undefined
  }, [tasks])

  useEffect(() => {
    const wrapper = containerRef.current
    if (wrapper === null || hideChart) {
      return undefined
    }

    const wheelInteraction = wheelInteractionRef.current
    const handleWheel = (event: WheelEvent) => {
      if (!(event.target instanceof Node)) {
        return
      }

      const scrollContainer = resolveGanttScrollContainer(wrapper)
      if (!scrollContainer.contains(event.target)) {
        return
      }

      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        scheduleGanttTimelineZoom(event, scrollContainer, ganttRef.current, viewModeRef.current, setRenderError, wheelInteraction)
        return
      }

      if (event.shiftKey) {
        const rawVerticalDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
        if (rawVerticalDelta === 0) {
          return
        }

        event.preventDefault()
        scheduleGanttTimelineVerticalScroll(event, scrollContainer, rawVerticalDelta, wheelInteraction)
        return
      }

      const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (rawDelta === 0) {
        return
      }

      event.preventDefault()
      scheduleGanttTimelinePan(event, scrollContainer, rawDelta, wheelInteraction)
    }

    wrapper.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      wrapper.removeEventListener('wheel', handleWheel)
      cancelGanttWheelInteraction(wheelInteraction)
    }
  }, [hideChart])

  useEffect(() => () => {
    cleanupGanttPopupPositioning(ganttRef.current)
    ganttRef.current = null
    if (containerRef.current !== null) {
      containerRef.current.innerHTML = ''
    }
  }, [])

  const handleTodayClick = useCallback(() => {
    try {
      ganttRef.current?.scroll_current()
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const openEventContextMenu = useCallback((event: UnifiedCalendarEvent, x: number, y: number) => {
    setContextMenu({ event, x, y })
    setSettingsMenuOpen(false)
    setViewModeMenuOpen(false)
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
    setMutatingEventId(eventId)
    setEventActionError(null)
    try {
      await onEventChangeRef.current(eventId, patch)
    } catch (error) {
      setEventActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingEventId(null)
    }
  }, [])

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
    setMutatingEventId(editingEvent.id)
    setEventActionError(null)
    try {
      await onEventChangeRef.current(editingEvent.id, patch)
      setEditingEvent(null)
      setEditDraft(null)
      setEditError(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error))
    } finally {
      setMutatingEventId(null)
    }
  }, [editDraft, editingEvent])

  const handleViewModeChange = useCallback((nextViewMode: CalendarGanttViewMode) => {
    try {
      ganttRef.current?.change_view_mode(nextViewMode, true)
      if (ganttRef.current !== null) {
        scheduleGanttLabelStabilization(ganttRef.current)
      }
      viewModeRef.current = nextViewMode
      setViewMode(nextViewMode)
      setRenderError(null)
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error))
    } finally {
      setViewModeMenuOpen(false)
    }
  }, [])

  return (
    <section className="calendar-gantt-card" aria-label="日历甘特视图">
      <header className="calendar-gantt-card__header">
        <p className="calendar-gantt-card__meta">
          共 {displayedEvents.length} 个时间轴事件{!showWakeupCourses && hiddenWakeupCount > 0 ? `，已隐藏 ${hiddenWakeupCount} 个 Wakeup 课程` : ''}{mapping.skippedEventCount > 0 ? `，${mapping.skippedEventCount} 个无法渲染` : ''}
        </p>
        <div className="calendar-gantt-card__header-actions">
          {onRefresh !== undefined ? (
            <button
              type="button"
              className="calendar-gantt-card__refresh-button"
              aria-label="刷新日历"
              data-testid="calendar-gantt-refresh-button"
              onClick={() => onRefresh()}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          ) : null}
          <div
          ref={settingsMenuRef}
          className={`calendar-gantt-settings${settingsMenuOpen ? ' calendar-gantt-settings--open' : ''}`}
        >
          <button
            type="button"
            className="calendar-gantt-settings__trigger"
            aria-haspopup="menu"
            aria-label={settingsMenuOpen ? '关闭时间轴显示设置' : '打开时间轴显示设置'}
            data-testid="calendar-gantt-settings-trigger"
            onClick={() => {
              setSettingsMenuOpen((open) => !open)
              setViewModeMenuOpen(false)
              setContextMenu(null)
            }}
          >
            <Settings size={15} aria-hidden="true" />
          </button>
          <div
            className={`calendar-gantt-settings__menu${settingsMenuOpen ? ' calendar-gantt-settings__menu--open' : ''}`}
            role="menu"
            aria-label="时间轴显示设置"
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={settingsMenuOpen ? 0 : -1}
              className="calendar-gantt-settings__toggle"
              data-testid="calendar-gantt-toggle-wakeup"
              onClick={() => setShowWakeupCourses((visible) => !visible)}
            >
              <span className="calendar-gantt-settings__toggle-copy">
                <span className="calendar-gantt-settings__toggle-title">显示 Wakeup 课程</span>
                <span className="calendar-gantt-settings__toggle-detail">关闭后仅隐藏时间轴中的 Wakeup 事件</span>
              </span>
              <span className={`calendar-gantt-settings__switch${showWakeupCourses ? ' calendar-gantt-settings__switch--on' : ''}`} aria-hidden="true" />
            </button>
          </div>
          </div>
        </div>
      </header>

      {mapping.skippedEventCount > 0 ? (
        <p className="calendar-gantt-card__notice" role="status">
          部分事件缺少有效开始或结束时间，已从甘特图中跳过。
        </p>
      ) : null}

      {eventActionError !== null ? (
        <p className="calendar-gantt-card__notice calendar-gantt-card__notice--danger" role="alert">
          {eventActionError}
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

      <div className="calendar-gantt-card__chart-shell" hidden={hideChart} style={ganttChartViewportStyle}>
        <div className="calendar-gantt-card__controls" aria-label="时间轴控制">
          <button
            type="button"
            className="calendar-gantt-card__today-button"
            data-testid="calendar-gantt-today-button"
            onClick={handleTodayClick}
          >
            Today
          </button>
          <div
            ref={viewModeSelectRef}
            className={`calendar-gantt-view-mode${viewModeMenuOpen ? ' calendar-gantt-view-mode--open' : ''}`}
          >
            <button
              type="button"
              className={`select-trigger calendar-gantt-view-mode__trigger${viewModeMenuOpen ? ' select-trigger--open' : ''}`}
              aria-haspopup="listbox"
              aria-expanded={viewModeMenuOpen ? 'true' : 'false'}
              aria-label="切换时间尺度"
              data-testid="calendar-gantt-view-mode-trigger"
              onClick={() => setViewModeMenuOpen((open) => !open)}
            >
              <span className="select-trigger__copy">
                <span className="select-trigger__value">{selectedViewModeOption.label}</span>
              </span>
              <ChevronDown size={15} className="select-trigger__icon" aria-hidden="true" />
            </button>
            <div
              className={`select-dropdown calendar-gantt-view-mode__menu${viewModeMenuOpen ? ' select-dropdown--open' : ''}`}
              role="listbox"
              aria-hidden={viewModeMenuOpen ? 'false' : 'true'}
              aria-label="时间尺度选项"
            >
              {GANTT_VIEW_MODE_OPTIONS.map((option) => {
                const active = option.value === viewMode

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={active ? 'true' : 'false'}
                    tabIndex={viewModeMenuOpen ? 0 : -1}
                    className={`select-option calendar-gantt-view-mode__option${active ? ' select-option--active' : ''}`}
                    data-testid={`calendar-gantt-view-mode-option-${option.value}`}
                    onClick={() => handleViewModeChange(option.value)}
                  >
                    <span className="select-option__copy">
                      <span className="select-option__label">{option.label}</span>
                    </span>
                    {active ? <Check size={15} className="select-option__check" aria-hidden="true" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
        <div
          ref={containerRef}
          className="calendar-gantt-card__chart"
          data-testid="calendar-gantt-container"
          onMouseDownCapture={(event) => {
            if (!shouldSuppressCalendarGanttPopupMouseEvent(event)) {
              return
            }

            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseUpCapture={(event) => {
            if (!shouldSuppressCalendarGanttPopupMouseEvent(event)) {
              return
            }

            event.preventDefault()
            event.stopPropagation()
          }}
          onContextMenu={(event) => {
            const calendarEvent = resolveCalendarEventFromContextMenuTarget(event.target, displayedEvents)
            if (calendarEvent === null) {
              return
            }

            event.preventDefault()
            openEventContextMenu(calendarEvent, event.clientX, event.clientY)
          }}
        />
      </div>

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

const GANTT_VIEW_MODE_OPTIONS = [
  { value: 'Hour', label: 'Hour' },
  { value: 'Quarter Day', label: 'Quarter Day' },
  { value: 'Half Day', label: 'Half Day' },
  { value: 'Day', label: 'Day' },
  { value: 'Week', label: 'Week' },
  { value: 'Month', label: 'Month' },
  { value: 'Year', label: 'Year' },
] as const

type CalendarGanttViewMode = typeof GANTT_VIEW_MODE_OPTIONS[number]['value']

const DEFAULT_GANTT_VIEW_MODE: CalendarGanttViewMode = 'Day'
const GANTT_MAX_VISIBLE_ROWS = 7
const GANTT_UPPER_HEADER_HEIGHT = 45
const GANTT_LOWER_HEADER_HEIGHT = 30
const GANTT_HEADER_HEIGHT = GANTT_UPPER_HEADER_HEIGHT + GANTT_LOWER_HEADER_HEIGHT + 10
const GANTT_BAR_HEIGHT = 28
const GANTT_ROW_PADDING = 16
const GANTT_MIN_COLUMN_WIDTH = 28
const GANTT_MAX_COLUMN_WIDTH = 180
const GANTT_WHEEL_ZOOM_SENSITIVITY = 0.0015
const GANTT_WHEEL_LINE_HEIGHT = 28
const GANTT_WHEEL_PAGE_RATIO = 0.9
const GANTT_SCROLL_EASING = 0.38
const GANTT_POPUP_VIEWPORT_MARGIN = 12
const GANTT_POPUP_POINTER_OFFSET = 10
const GANTT_POPUP_GAP = 10
const GANTT_LABEL_OUTSIDE_GAP = 6

const WAKEUP_SOURCE_KEYS = new Set(['wakeup', 'wake-up', 'wake_up'])

function isWakeupCalendarEvent(event: UnifiedCalendarEvent): boolean {
  return containsWakeupMarker(event.source) || containsWakeupMarker(event.source_id) || containsWakeupMetadataMarker(event.metadata_payload)
}

function containsWakeupMetadataMarker(payload: UnifiedCalendarEvent['metadata_payload']): boolean {
  if (payload === null || payload === undefined) {
    return false
  }

  const relevantKeys = new Set(['source', 'source_id', 'tag', 'tags', 'label', 'labels', 'category', 'categories', 'origin', 'type'])
  return Object.entries(payload).some(([key, value]) => relevantKeys.has(key.toLowerCase()) && containsWakeupMarker(value))
}

function containsWakeupMarker(value: unknown): boolean {
  if (typeof value === 'string') {
    const normalized = normalizeCalendarMarker(value)
    return WAKEUP_SOURCE_KEYS.has(normalized) || normalized.includes('wakeup')
  }

  if (Array.isArray(value)) {
    return value.some((item) => containsWakeupMarker(item))
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((item) => containsWakeupMarker(item))
  }

  return false
}

function normalizeCalendarMarker(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
}

function resolveCalendarEventFromContextMenuTarget(target: EventTarget | null, events: readonly UnifiedCalendarEvent[]): UnifiedCalendarEvent | null {
  if (!(target instanceof Element)) {
    return null
  }

  const barWrapper = target.closest<SVGGElement>('.bar-wrapper[data-id]')
  const taskId = barWrapper?.getAttribute('data-id')
  if (taskId === null || taskId === undefined) {
    return null
  }

  const eventId = getCalendarEventIdFromGanttTaskId(taskId)
  return events.find((event) => String(event.id) === String(eventId)) ?? null
}

function shouldSuppressCalendarGanttPopupMouseEvent(event: { button: number; target: EventTarget | null }): boolean {
  if (event.button !== 2) {
    return false
  }

  if (!(event.target instanceof Element)) {
    return false
  }

  return event.target.closest('.bar-wrapper, .handle') !== null
}

interface GanttWheelInteractionState {
  panAnimationFrame: number | null
  panTargetScrollLeft: number | null
  zoomAnimationFrame: number | null
  zoomTargetColumnWidth: number | null
  zoomAnchorClientX: number
}

interface GanttPrivateRuntime extends Gantt {
  $svg?: SVGSVGElement
  $popup_wrapper?: HTMLElement
  popup?: CalendarGanttPopupController
  show_popup?: (options: CalendarGanttPopupShowOptions) => void
  __calendarGanttPopupEnhanced?: boolean
  __calendarGanttDurationFixed?: boolean
}

interface CalendarGanttPopupController {
  parent: HTMLElement
  show: (options: CalendarGanttPopupShowOptions) => void
}

interface CalendarGanttPopupShowOptions {
  x: number
  y: number
  task: GanttTask
  target?: Element | null
}

function createGanttWheelInteractionState(): GanttWheelInteractionState {
  return {
    panAnimationFrame: null,
    panTargetScrollLeft: null,
    zoomAnimationFrame: null,
    zoomTargetColumnWidth: null,
    zoomAnchorClientX: 0,
  }
}

function getGanttVisibleChartHeight(taskCount: number): number {
  const visibleRowCount = clampNumber(taskCount, 1, GANTT_MAX_VISIBLE_ROWS)

  return GANTT_HEADER_HEIGHT + GANTT_ROW_PADDING + (GANTT_BAR_HEIGHT + GANTT_ROW_PADDING) * visibleRowCount - 10
}

function buildGanttOptions(
  onEventChangeRef: MutableRefObject<CalendarGanttViewProps['onEventChange']>,
  viewMode: CalendarGanttViewMode,
): GanttOptions {
  return {
    view_mode: viewMode,
    view_mode_select: false,
    today_button: false,
    readonly: false,
    readonly_dates: false,
    readonly_progress: false,
    move_dependencies: false,
    container_height: 'auto',
    upper_header_height: GANTT_UPPER_HEADER_HEIGHT,
    lower_header_height: GANTT_LOWER_HEADER_HEIGHT,
    bar_height: GANTT_BAR_HEIGHT,
    padding: GANTT_ROW_PADDING,
    infinite_padding: false,
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

function enhanceGanttPopupPositioning(gantt: Gantt): void {
  const runtime = gantt as GanttPrivateRuntime
  if (runtime.__calendarGanttPopupEnhanced === true) {
    return
  }

  const popupWrapper = runtime.$popup_wrapper ?? runtime.popup?.parent
  if (popupWrapper !== undefined) {
    popupWrapper.classList.add('calendar-gantt-popup-wrapper')
    if (popupWrapper.parentElement !== document.body) {
      document.body.appendChild(popupWrapper)
    }
  }

  const originalShowPopup = runtime.show_popup?.bind(gantt)
  if (originalShowPopup !== undefined) {
    runtime.show_popup = (options: CalendarGanttPopupShowOptions) => {
      originalShowPopup(options)
      const activePopupWrapper = runtime.popup?.parent ?? runtime.$popup_wrapper
      if (activePopupWrapper === undefined) {
        return
      }

      activePopupWrapper.classList.add('calendar-gantt-popup-wrapper')
      if (activePopupWrapper.parentElement !== document.body) {
        document.body.appendChild(activePopupWrapper)
      }
      positionCalendarGanttPopup(activePopupWrapper, options.target ?? null)
    }
  }

  runtime.__calendarGanttPopupEnhanced = true
}

function cleanupGanttPopupPositioning(gantt: Gantt | null): void {
  if (gantt === null) {
    return
  }

  const runtime = gantt as GanttPrivateRuntime
  const popupWrapper = runtime.popup?.parent ?? runtime.$popup_wrapper
  if (popupWrapper?.parentElement === document.body) {
    popupWrapper.remove()
  }
}

interface GanttBar {
  gantt: Gantt
  task: GanttTask & { _start: Date; _end: Date }
  x: number
  y: number
  width: number
  height: number
  duration: number
  compute_duration: () => void
  update_bar_position: (options: { x?: number | null; width?: number | null }) => void
  $bar: SVGElement
  $bar_progress: SVGElement
}

const GANTT_DURATION_MS_PER_UNIT: Record<string, number> = {
  millisecond: 1,
  second: 1000,
  minute: 60000,
  hour: 3600000,
  day: 86400000,
  month: 2592000000,
  year: 31536000000,
}

function fixGanttBarDurationComputation(gantt: Gantt): void {
  const runtime = gantt as GanttPrivateRuntime
  if (runtime.__calendarGanttDurationFixed === true) {
    return
  }

  const bars = (gantt as unknown as Record<string, unknown>).bars as GanttBar[] | undefined
  const barPrototype = bars?.[0] !== undefined
    ? Object.getPrototypeOf(bars[0])
    : null

  if (barPrototype === null) {
    return
  }

  barPrototype.compute_duration = function (this: GanttBar) {
    const config = (this.gantt as unknown as { config: { unit: string; step: number } }).config
    const startMs = this.task._start.getTime()
    const endMs = this.task._end.getTime()
    const msDiff = endMs - startMs
    const msPer = GANTT_DURATION_MS_PER_UNIT[config.unit] ?? 86400000
    this.duration = (msDiff / msPer) / config.step
  }

  runtime.__calendarGanttDurationFixed = true
}

function correctGanttBarDurations(gantt: Gantt): void {
  const bars = (gantt as unknown as Record<string, unknown>).bars as GanttBar[] | undefined
  if (bars === undefined || bars.length === 0) {
    return
  }

  for (const bar of bars) {
    const config = (bar.gantt as unknown as { config: { unit: string; step: number; column_width: number } }).config
    const startMs = bar.task._start.getTime()
    const endMs = bar.task._end.getTime()
    const msDiff = endMs - startMs
    const msPer = GANTT_DURATION_MS_PER_UNIT[config.unit] ?? 86400000
    bar.duration = (msDiff / msPer) / config.step
    bar.width = config.column_width * bar.duration

    // Directly update the SVG bar width to avoid triggering update_bar_position({}),
    // which calls date_changed() → compute_start_end_date() → date_utils.add().
    // date_utils.add() uses parseInt which truncates fractional day durations,
    // corrupting task._end for sub-day events (e.g. 59 minutes → same-day 00:00).
    bar.$bar.setAttribute('width', String(Math.max(1, bar.width)))
  }
}

function positionCalendarGanttPopup(popup: HTMLElement, target: Element | null): void {
  const targetRect = target?.getBoundingClientRect() ?? null
  const popupRect = popup.getBoundingClientRect()
  const maxLeft = Math.max(GANTT_POPUP_VIEWPORT_MARGIN, window.innerWidth - popupRect.width - GANTT_POPUP_VIEWPORT_MARGIN)
  const maxTop = Math.max(GANTT_POPUP_VIEWPORT_MARGIN, window.innerHeight - popupRect.height - GANTT_POPUP_VIEWPORT_MARGIN)

  const preferredLeft = targetRect === null
    ? popupRect.left
    : targetRect.left + Math.max(0, Math.min(targetRect.width - GANTT_POPUP_POINTER_OFFSET, targetRect.width * 0.55))
  const preferredBelow = targetRect === null ? popupRect.top : targetRect.bottom + GANTT_POPUP_GAP
  const preferredAbove = targetRect === null ? popupRect.top : targetRect.top - popupRect.height - GANTT_POPUP_GAP
  const preferredTop = preferredBelow + popupRect.height + GANTT_POPUP_VIEWPORT_MARGIN > window.innerHeight && preferredAbove >= GANTT_POPUP_VIEWPORT_MARGIN
    ? preferredAbove
    : preferredBelow

  popup.style.left = `${clampNumber(preferredLeft, GANTT_POPUP_VIEWPORT_MARGIN, maxLeft)}px`
  popup.style.top = `${clampNumber(preferredTop, GANTT_POPUP_VIEWPORT_MARGIN, maxTop)}px`
}

function scheduleGanttLabelStabilization(gantt: Gantt): void {
  stabilizeGanttBarLabels(gantt)
  window.requestAnimationFrame(() => stabilizeGanttBarLabels(gantt))
}

function stabilizeGanttBarLabels(gantt: Gantt): void {
  const svg = (gantt as GanttPrivateRuntime).$svg
  if (svg === undefined) {
    return
  }

  svg.querySelectorAll<SVGGElement>('.bar-wrapper').forEach((wrapper) => {
    const bar = wrapper.querySelector<SVGRectElement>('.bar')
    const label = wrapper.querySelector<SVGTextElement>('.bar-label')
    if (bar === null || label === null) {
      return
    }

    const barX = Number(bar.getAttribute('x'))
    const barWidth = Number(bar.getAttribute('width'))
    if (!Number.isFinite(barX) || !Number.isFinite(barWidth)) {
      return
    }

    label.classList.add('big')
    label.setAttribute('x', String(barX + barWidth + GANTT_LABEL_OUTSIDE_GAP))
  })
}

function resolveGanttScrollContainer(wrapper: HTMLDivElement): HTMLElement {
  return wrapper.querySelector<HTMLElement>('.gantt-container') ?? wrapper
}

function syncGanttVerticalScrollAffordance(wrapper: HTMLDivElement, taskCount: number): void {
  const scrollContainer = resolveGanttScrollContainer(wrapper)
  scrollContainer.classList.toggle('calendar-gantt-container--vertical-scrollable', taskCount > GANTT_MAX_VISIBLE_ROWS)
}

function scheduleGanttTimelinePan(
  event: WheelEvent,
  scrollContainer: HTMLElement,
  rawDelta: number,
  state: GanttWheelInteractionState,
): void {
  cancelGanttZoomAnimation(state)

  const maxScrollLeft = getMaxScrollLeft(scrollContainer)
  const baseTargetScrollLeft = state.panTargetScrollLeft ?? scrollContainer.scrollLeft
  state.panTargetScrollLeft = clampNumber(
    baseTargetScrollLeft + normalizeWheelDelta(rawDelta, event.deltaMode, scrollContainer),
    0,
    maxScrollLeft,
  )

  if (state.panAnimationFrame !== null) {
    return
  }

  const animatePan = () => {
    const targetScrollLeft = state.panTargetScrollLeft
    if (targetScrollLeft === null) {
      state.panAnimationFrame = null
      return
    }

    const remainingDistance = targetScrollLeft - scrollContainer.scrollLeft
    if (Math.abs(remainingDistance) < 0.5) {
      scrollContainer.scrollLeft = targetScrollLeft
      state.panTargetScrollLeft = null
      state.panAnimationFrame = null
      return
    }

    scrollContainer.scrollLeft += remainingDistance * GANTT_SCROLL_EASING
    state.panAnimationFrame = window.requestAnimationFrame(animatePan)
  }

  state.panAnimationFrame = window.requestAnimationFrame(animatePan)
}

function scheduleGanttTimelineVerticalScroll(
  event: WheelEvent,
  scrollContainer: HTMLElement,
  rawDelta: number,
  state: GanttWheelInteractionState,
): void {
  cancelGanttPanAnimation(state)
  cancelGanttZoomAnimation(state)

  scrollContainer.scrollTop = clampNumber(
    scrollContainer.scrollTop + normalizeWheelDelta(rawDelta, event.deltaMode, scrollContainer, 'y'),
    0,
    getMaxScrollTop(scrollContainer),
  )
}

function scheduleGanttTimelineZoom(
  event: WheelEvent,
  scrollContainer: HTMLElement,
  gantt: Gantt | null,
  viewMode: CalendarGanttViewMode,
  setRenderError: (error: string | null) => void,
  state: GanttWheelInteractionState,
): void {
  cancelGanttPanAnimation(state)

  if (gantt === null) {
    return
  }

  const currentColumnWidth = getGanttColumnWidth(gantt)
  if (currentColumnWidth === null) {
    return
  }

  const zoomDelta = normalizeWheelDelta(event.deltaY !== 0 ? event.deltaY : event.deltaX, event.deltaMode, scrollContainer)
  if (zoomDelta === 0) {
    return
  }

  const baseTargetColumnWidth = state.zoomTargetColumnWidth ?? currentColumnWidth
  state.zoomTargetColumnWidth = clampNumber(
    Math.round(baseTargetColumnWidth * Math.exp(-zoomDelta * GANTT_WHEEL_ZOOM_SENSITIVITY)),
    GANTT_MIN_COLUMN_WIDTH,
    GANTT_MAX_COLUMN_WIDTH,
  )
  state.zoomAnchorClientX = event.clientX

  if (state.zoomAnimationFrame !== null) {
    return
  }

  state.zoomAnimationFrame = window.requestAnimationFrame(() => {
    const targetColumnWidth = state.zoomTargetColumnWidth
    const frameCurrentColumnWidth = getGanttColumnWidth(gantt)
    state.zoomAnimationFrame = null
    state.zoomTargetColumnWidth = null

    if (targetColumnWidth === null || frameCurrentColumnWidth === null) {
      return
    }

    const pointerOffset = state.zoomAnchorClientX - scrollContainer.getBoundingClientRect().left
    const anchorRatio = (scrollContainer.scrollLeft + pointerOffset) / frameCurrentColumnWidth

    try {
      gantt.update_options({ column_width: targetColumnWidth, view_mode: viewMode })
      scrollContainer.scrollLeft = clampNumber(anchorRatio * targetColumnWidth - pointerOffset, 0, getMaxScrollLeft(scrollContainer))
      scheduleGanttLabelStabilization(gantt)
      setRenderError(null)
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error))
    }
  })
}

function cancelGanttWheelInteraction(state: GanttWheelInteractionState): void {
  cancelGanttPanAnimation(state)
  cancelGanttZoomAnimation(state)
}

function cancelGanttPanAnimation(state: GanttWheelInteractionState): void {
  if (state.panAnimationFrame !== null) {
    window.cancelAnimationFrame(state.panAnimationFrame)
  }

  state.panAnimationFrame = null
  state.panTargetScrollLeft = null
}

function cancelGanttZoomAnimation(state: GanttWheelInteractionState): void {
  if (state.zoomAnimationFrame !== null) {
    window.cancelAnimationFrame(state.zoomAnimationFrame)
  }

  state.zoomAnimationFrame = null
  state.zoomTargetColumnWidth = null
}

function getGanttColumnWidth(gantt: Gantt): number | null {
  const ganttWithConfig = gantt as Gantt & { config?: { column_width?: number }; options?: { column_width?: number } }
  if (typeof ganttWithConfig.config?.column_width === 'number') {
    return ganttWithConfig.config.column_width
  }

  if (typeof ganttWithConfig.options?.column_width === 'number') {
    return ganttWithConfig.options.column_width
  }

  return null
}

function normalizeWheelDelta(delta: number, deltaMode: number, scrollContainer: HTMLElement, axis: 'x' | 'y' = 'x'): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return delta * GANTT_WHEEL_LINE_HEIGHT
  }

  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    const pageSize = axis === 'y' ? scrollContainer.clientHeight : scrollContainer.clientWidth

    return delta * pageSize * GANTT_WHEEL_PAGE_RATIO
  }

  return delta
}

function getMaxScrollLeft(scrollContainer: HTMLElement): number {
  return Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth)
}

function getMaxScrollTop(scrollContainer: HTMLElement): number {
  return Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function buildPopupHtml(task: GanttTask): string {
  const originalStartIso = typeof task._originalStartIso === 'string' ? task._originalStartIso : null
  const originalEndIso = typeof task._originalEndIso === 'string' ? task._originalEndIso : null

  // Prefer original ISO strings to avoid displaying Gantt-runtime-mutated dates.
  // When task._start / task._end are polluted by date_utils.add() truncation,
  // the popup would show a different time than the edit dialog and the actual DB.
  const start = originalStartIso !== null
    ? new Date(originalStartIso)
    : task._start instanceof Date ? task._start : new Date(task.start)
  const end = originalEndIso !== null
    ? new Date(originalEndIso)
    : task._end instanceof Date ? task._end : new Date(task.end)

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

const AMP = '&'
const LT = '<'
const GT = '>'
const QUOT = '"'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, AMP)
    .replace(/</g, LT)
    .replace(/>/g, GT)
    .replace(/"/g, QUOT)
    .replace(/'/g, '&#039;')
}
