import type {
  ToolPermissionDelayAction,
  ToolPermissionMode,
  ToolPermissionRecord,
} from './capabilities-demo'
import { toolPermissionModes } from './capabilities-demo'
import { ToolPermissionDelayPanel } from './ToolPermissionDelayPanel'

interface ToolPermissionRowProps {
  tool: ToolPermissionRecord
  enterDelayMs?: number
  onModeChange: (toolId: string, mode: ToolPermissionMode) => void
  onDelayActionChange: (toolId: string, action: ToolPermissionDelayAction) => void
  onDelaySecondsChange: (toolId: string, seconds: number) => void
}

export function ToolPermissionRow({
  tool,
  enterDelayMs,
  onModeChange,
  onDelayActionChange,
  onDelaySecondsChange,
}: ToolPermissionRowProps) {
  const activeModeIndex = Math.max(toolPermissionModes.findIndex((option) => option.value === tool.mode), 0)
  const delayPanelOpen = tool.mode === 'delay'

  return (
    <article
      className={`tool-permission-row${delayPanelOpen ? ' tool-permission-row--expanded' : ''}`}
      style={enterDelayMs === undefined ? undefined : { animationDelay: `${enterDelayMs}ms` }}
    >
      <div className="tool-permission-row__meta">
        <div className="tool-permission-row__title-line">
          <h4 className="tool-permission-row__name">{tool.name}</h4>
        </div>
        <p className="tool-permission-row__description">{tool.description}</p>
        <code className="tool-permission-row__id">{tool.toolId}</code>
      </div>

      <div className="tool-permission-row__side">
        <div
          className={`tool-permission-segmented tool-permission-segmented--${tool.mode}`}
          role="group"
          aria-label={`${tool.name}审批模式`}
        >
          <div
            className="tool-permission-segmented__glider"
            aria-hidden="true"
            style={{ transform: `translateX(calc(${activeModeIndex} * 100%))` }}
          />

          {toolPermissionModes.map((option) => {
            const active = option.value === tool.mode

            return (
              <button
                key={option.value}
                type="button"
                className={`tool-permission-segmented__item tool-permission-segmented__item--${option.value}${active ? ' tool-permission-segmented__item--active' : ''}`}
                title={active ? `${option.label}（当前）` : option.label}
                onClick={() => onModeChange(tool.id, option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <div className={`tool-permission-delay-shell${delayPanelOpen ? ' tool-permission-delay-shell--open' : ''}`}>
          <div className="tool-permission-delay-shell__inner">
            <ToolPermissionDelayPanel
              open={delayPanelOpen}
              tool={tool}
              onDelayActionChange={onDelayActionChange}
              onDelaySecondsChange={onDelaySecondsChange}
            />
          </div>
        </div>
      </div>
    </article>
  )
}
