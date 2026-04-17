import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  toolPermissionGroups,
  type ToolPermissionDelayAction,
  type ToolPermissionGroupId,
  type ToolPermissionMode,
  type ToolPermissionRecord,
} from './capabilities-demo'
import { ToolPermissionRow } from './ToolPermissionRow'

interface ToolPermissionsPanelProps {
  tools: readonly ToolPermissionRecord[]
  onModeChange: (toolId: string, mode: ToolPermissionMode) => void
  onDelayActionChange: (toolId: string, action: ToolPermissionDelayAction) => void
  onDelaySecondsChange: (toolId: string, seconds: number) => void
}

const initialCollapsedGroups: Record<ToolPermissionGroupId, boolean> = {
  workspace: false,
  remote: false,
}

export function ToolPermissionsPanel({
  tools,
  onModeChange,
  onDelayActionChange,
  onDelaySecondsChange,
}: ToolPermissionsPanelProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<ToolPermissionGroupId, boolean>>(initialCollapsedGroups)

  const groupedTools = useMemo(() => toolPermissionGroups
    .map((group) => ({
      ...group,
      tools: tools.filter((tool) => tool.groupId === group.id),
    }))
    .filter((group) => group.tools.length > 0), [tools])

  const handleToggleGroup = (groupId: ToolPermissionGroupId) => {
    setCollapsedGroups((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }))
  }

  return (
    <div className="tool-permission-groups" aria-label="工具权限列表">
      {groupedTools.map((group) => {
        const collapsed = collapsedGroups[group.id] ?? false

        return (
          <section
            key={group.id}
            className={`tool-permission-group${collapsed ? ' tool-permission-group--collapsed' : ''}`}
          >
            <button
              type="button"
              className="tool-permission-group__toggle"
              title={collapsed ? `展开${group.label}` : `收起${group.label}`}
              onClick={() => handleToggleGroup(group.id)}
            >
              <span className="tool-permission-group__toggle-main">
                <ChevronDown
                  size={14}
                  className={`tool-permission-group__chevron${collapsed ? ' tool-permission-group__chevron--collapsed' : ''}`}
                />
                <span className="tool-permission-group__label">{group.label}</span>
              </span>
              <span className="tool-permission-group__count">{group.tools.length}</span>
            </button>

            <div className={`tool-permission-group__body${collapsed ? ' tool-permission-group__body--collapsed' : ''}`}>
              <div className="tool-permission-group__body-inner">
                {group.tools.map((tool) => (
                  <ToolPermissionRow
                    key={tool.id}
                    tool={tool}
                    onModeChange={onModeChange}
                    onDelayActionChange={onDelayActionChange}
                    onDelaySecondsChange={onDelaySecondsChange}
                  />
                ))}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}
