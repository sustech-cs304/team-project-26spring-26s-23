import React from 'react';

export function TimelineView() {
  return (
    <section
      className="calendar-timeline-view"
      style={{
        flex: '1 1 50%',
        minHeight: '250px',
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
        <h3 style={{ margin: 0, fontSize: '1.1em', fontWeight: 600 }}>时间轴 (Timeline)</h3>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85em', color: 'var(--vscode-descriptionForeground)' }}>*静待接入甘特图/Timeline组件*</span>
        </div>
      </header>
      
      {/* 静态骨架区域 - Timeline 空壳 */}
      <div style={{ flex: 1, backgroundColor: 'var(--vscode-editorWidget-background)', borderRadius: '4px', border: '1px dashed var(--vscode-widget-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--vscode-descriptionForeground)' }}>
        Timeline Component Placeholder
      </div>
    </section>
  );
}
