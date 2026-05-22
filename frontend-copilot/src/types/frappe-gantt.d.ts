declare module 'frappe-gantt' {
  export interface GanttTask {
    id: string
    name: string
    start: Date | string
    end: Date | string
    progress?: number
    dependencies?: string | string[]
    description?: string
    custom_class?: string
    color?: string
    color_progress?: string
    _start?: Date
    _end?: Date
    [key: string]: unknown
  }

  export interface GanttPopupContext {
    task: GanttTask
    chart: Gantt
    get_title: () => HTMLElement
    get_subtitle: () => HTMLElement
    get_details: () => HTMLElement
    set_title: (html: string) => void
    set_subtitle: (html: string) => void
    set_details: (html: string) => void
    add_action: (html: string, func: () => void) => void
  }

  export interface GanttOptions {
    arrow_curve?: number
    auto_move_label?: boolean
    bar_corner_radius?: number
    bar_height?: number
    container_height?: 'auto' | number
    column_width?: number
    date_format?: string
    upper_header_height?: number
    lower_header_height?: number
    snap_at?: string
    infinite_padding?: boolean
    holidays?: Record<string, unknown>
    ignore?: string | Array<string | Date> | ((date: Date) => boolean)
    language?: string
    lines?: 'none' | 'vertical' | 'horizontal' | 'both'
    move_dependencies?: boolean
    padding?: number
    popup?: false | ((context: GanttPopupContext) => string | false | undefined)
    popup_on?: 'click' | 'hover'
    readonly_progress?: boolean
    readonly_dates?: boolean
    readonly?: boolean
    scroll_to?: 'today' | 'start' | 'end' | string | null
    show_expected_progress?: boolean
    today_button?: boolean
    view_mode?: 'Hour' | 'Quarter Day' | 'Half Day' | 'Day' | 'Week' | 'Month' | 'Year' | string
    view_mode_select?: boolean
    view_modes?: Array<string | Record<string, unknown>>
    on_date_change?: (task: GanttTask, start: Date, end: Date) => void
    on_progress_change?: (task: GanttTask, progress: number) => void
    on_click?: (task: GanttTask) => void
    on_double_click?: (task: GanttTask) => void
    on_view_change?: (mode: unknown) => void
  }

  export default class Gantt {
    constructor(wrapper: string | HTMLElement | SVGElement, tasks: GanttTask[], options?: GanttOptions)
    tasks: GanttTask[]
    refresh(tasks: GanttTask[]): void
    update_task(taskId: string, newDetails: Partial<GanttTask>): void
    update_options(options: Partial<GanttOptions>): void
    change_view_mode(viewMode: string | Record<string, unknown>, maintainPosition?: boolean): void
    scroll_current(): void
  }
}
