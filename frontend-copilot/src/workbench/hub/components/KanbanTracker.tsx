// 这里为了通用，可以直接引入外部定义，先暂时在内部简单声明
interface UnifiedCalendarEvent {
  id: string | number
  source: string
  source_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string
  is_all_day: boolean
  location: string | null
  status: string
}

interface KanbanTrackerProps {
  events?: UnifiedCalendarEvent[]
}

export function KanbanTracker({ events = [] }: KanbanTrackerProps) {
  // 按照 status 过滤数据
  const notStartedEvents = events.filter(e => e.status === 'not_started')
  const inProgressEvents = events.filter(e => e.status === 'in_progress')
  const completedEvents = events.filter(e => e.status === 'completed')

  return (
    <section
      className="calendar-kanban-view"
      style={{
        flex: '1 1 50%',
        minHeight: '300px',

        backgroundColor: 'var(--vscode-editor-background)',
        borderRadius: '8px',
        border: '1px solid var(--vscode-widget-border)',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>任务跟踪器</h3>
      </header>

      <div style={{ flex: 1, display: 'flex', gap: '1rem', overflowX: 'auto' }}>
        {/* Kanban Column: 未开始 */}
        <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--vscode-list-warningForeground)' }}>●</span> 未开始 ({notStartedEvents.length})
          </div>
          {notStartedEvents.map((evt) => (
            <div key={evt.id} style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{evt.title}</div>
              <div style={{ color: 'var(--vscode-descriptionForeground)' }}>{evt.source.toUpperCase()}</div>
            </div>
          ))}
          <button style={{ background: 'none', border: '1px dashed var(--vscode-widget-border)', color: 'var(--vscode-textLink-foreground)', borderRadius: '4px', padding: '0.25rem', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center' }}>+ 新建任务</button>
        </div>

        {/* Kanban Column: 进行中 */}
        <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--vscode-list-activeSelectionBackground)' }}>●</span> 进行中 ({inProgressEvents.length})
          </div>
          {inProgressEvents.map((evt) => (
            <div key={evt.id} style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>{evt.title}</div>
              <div style={{ color: 'var(--vscode-descriptionForeground)' }}>{evt.source.toUpperCase()}</div>
            </div>
          ))}
          <button style={{ background: 'none', border: '1px dashed var(--vscode-widget-border)', color: 'var(--vscode-textLink-foreground)', borderRadius: '4px', padding: '0.25rem', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center' }}>+ 新建任务</button>
        </div>

        {/* Kanban Column: 已完成 */}
        <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em', marginBottom: '0.5rem' }}>
            <span style={{ color: 'var(--vscode-testing-iconPassed)' }}>●</span> 已完成 ({completedEvents.length})
          </div>
          {completedEvents.map((evt) => (
            <div key={evt.id} style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
              <div style={{ fontWeight: 500, marginBottom: '0.25rem', textDecoration: 'line-through', color: 'var(--vscode-descriptionForeground)' }}>{evt.title}</div>
              <div style={{ color: 'var(--vscode-descriptionForeground)' }}>{evt.source.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
