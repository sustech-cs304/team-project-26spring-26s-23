import type { ChangeEvent } from 'react'

import type { ToolPermissionDelayAction, ToolPermissionRecord } from './capabilities-demo'

interface ToolPermissionDelayPanelProps {
  open: boolean
  tool: ToolPermissionRecord
  onDelayActionChange: (toolId: string, action: ToolPermissionDelayAction) => void
  onDelaySecondsChange: (toolId: string, seconds: number) => void
}

export function ToolPermissionDelayPanel({
  open,
  tool,
  onDelayActionChange,
  onDelaySecondsChange,
}: ToolPermissionDelayPanelProps) {
  const handleSecondsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextSeconds = Number.parseInt(event.target.value, 10)
    onDelaySecondsChange(tool.id, Number.isNaN(nextSeconds) ? 3 : nextSeconds)
  }

  return (
    <section className="tool-permission-delay-panel" aria-label={`${tool.name}延迟处理设置`}>
      <button
        type="button"
        className={[
          'tool-permission-delay-action',
          'tool-permission-delay-action--approve',
          tool.delayAction === 'approve' ? 'tool-permission-delay-action--active' : '',
        ].filter((value) => value !== '').join(' ')}
        title={tool.delayAction === 'approve' ? '超时自动批准（当前）' : '超时自动批准'}
        disabled={!open}
        onClick={() => onDelayActionChange(tool.id, 'approve')}
      >
        超时自动批准
      </button>

      <button
        type="button"
        className={[
          'tool-permission-delay-action',
          'tool-permission-delay-action--deny',
          tool.delayAction === 'deny' ? 'tool-permission-delay-action--active' : '',
        ].filter((value) => value !== '').join(' ')}
        title={tool.delayAction === 'deny' ? '超时自动禁止（当前）' : '超时自动禁止'}
        disabled={!open}
        onClick={() => onDelayActionChange(tool.id, 'deny')}
      >
        超时自动禁止
      </button>

      <label className="tool-permission-delay-field">
        <div className="tool-permission-delay-field__input-shell">
          <input
            className="text-input tool-permission-delay-field__input"
            type="number"
            min={3}
            max={300}
            step={1}
            value={tool.delaySeconds}
            aria-label="超时秒数"
            disabled={!open}
            onChange={handleSecondsChange}
          />
          <span className="tool-permission-delay-field__suffix">秒</span>
        </div>
      </label>
    </section>
  )
}
