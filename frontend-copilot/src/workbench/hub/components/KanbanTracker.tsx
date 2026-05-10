import React from 'react';

export function KanbanTracker() {
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
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em' }}>
            <span style={{ color: 'var(--vscode-list-warningForeground)' }}>●</span> 未开始
          </div>
          <div style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
            <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>四级考试</div>
            <div style={{ color: 'var(--vscode-descriptionForeground)' }}>中优先级</div>
          </div>
          <button style={{ background: 'none', border: '1px dashed var(--vscode-widget-border)', color: 'var(--vscode-textLink-foreground)', borderRadius: '4px', padding: '0.25rem', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center' }}>+ 新建任务</button>
        </div>

        {/* Kanban Column: 进行中 */}
        <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em' }}>
            <span style={{ color: 'var(--vscode-list-activeSelectionBackground)' }}>●</span> 进行中
          </div>
          <button style={{ background: 'none', border: '1px dashed var(--vscode-widget-border)', color: 'var(--vscode-textLink-foreground)', borderRadius: '4px', padding: '0.25rem', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'center' }}>+ 新建任务</button>
        </div>

        {/* Kanban Column: 已完成 */}
        <div style={{ flex: 1, minWidth: '220px', backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '6px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9em' }}>
            <span style={{ color: 'var(--vscode-testing-iconPassed)' }}>●</span> 已完成
          </div>
          <div style={{ backgroundColor: 'var(--vscode-editor-background)', border: '1px solid var(--vscode-widget-border)', borderRadius: '4px', padding: '0.5rem', fontSize: '0.85em' }}>
            <div style={{ fontWeight: 500, marginBottom: '0.25rem', textDecoration: 'line-through', color: 'var(--vscode-descriptionForeground)' }}>DSAA Lab.6</div>
            <div style={{ color: 'var(--vscode-descriptionForeground)' }}>中优先级 • 课程作业</div>
          </div>
        </div>
      </div>
    </section>
  );
}
