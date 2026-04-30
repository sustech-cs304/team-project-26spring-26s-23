import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  type ToolPermissionDelayAction,
  type ToolPermissionGroupId,
  type ToolPermissionMode,
  type ToolPermissionRecord,
} from './capabilities-demo'
import { resolveCapabilitiesListItemEnterDelayMs } from './capabilities-list-animation'
import { ToolPermissionRow } from './ToolPermissionRow'

interface ToolPermissionsPanelProps {
  tools: readonly ToolPermissionRecord[]
  statusMessage?: string | null
  onModeChange: (toolId: string, mode: ToolPermissionMode) => void
  onDelayActionChange: (toolId: string, action: ToolPermissionDelayAction) => void
  onDelaySecondsChange: (toolId: string, seconds: number) => void
}

const initialCollapsedGroups: Record<ToolPermissionGroupId, boolean> = {}

export function ToolPermissionsPanel({
  tools,
  statusMessage = null,
  onModeChange,
  onDelayActionChange,
  onDelaySecondsChange,
}: ToolPermissionsPanelProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<ToolPermissionGroupId, boolean>>(initialCollapsedGroups)

  const groupedTools = useMemo(() => {
    const groups = new Map<string, {
      id: ToolPermissionGroupId
      label: string
      order: number
      creationIndex: number
      tools: ToolPermissionRecord[]
    }>()

    tools.forEach((tool, index) => {
      const existingGroup = groups.get(tool.groupId)
      if (existingGroup) {
        existingGroup.tools.push(tool)
        return
      }

      groups.set(tool.groupId, {
        id: tool.groupId,
        label: tool.groupLabel,
        order: tool.groupOrder,
        creationIndex: index,
        tools: [tool],
      })
    })

    return [...groups.values()]
      .sort((left, right) => {
        const byOrder = left.order - right.order
        if (byOrder !== 0) {
          return byOrder
        }

        const byLabel = left.label.localeCompare(right.label, 'zh-CN')
        if (byLabel !== 0) {
          return byLabel
        }

        return left.creationIndex - right.creationIndex
      })
  }, [tools])

  const toolEnterDelayById = useMemo(() => {
    const delays = new Map<string, number>()
    let rowIndex = 0

    groupedTools.forEach((group) => {
      group.tools.forEach((tool) => {
        delays.set(tool.id, resolveCapabilitiesListItemEnterDelayMs(rowIndex))
        rowIndex += 1
      })
    })

    return delays
  }, [groupedTools])

  const handleToggleGroup = (groupId: ToolPermissionGroupId) => {
    setCollapsedGroups((previous) => ({
      ...previous,
      [groupId]: !previous[groupId],
    }))
  }

  if (groupedTools.length === 0) {
    return (
      <div className="tool-permission-groups" aria-label="工具权限列表">
        <div className="tool-permission-empty-state" role="status">
          {statusMessage ?? '尚未从运行时获取到可展示的工具目录。'}
        </div>
      </div>
    )
  }

  return (
    <div className="tool-permission-groups" aria-label="工具权限列表">
      {statusMessage ? (
        <div className="tool-permission-empty-state" role="status">{statusMessage}</div>
      ) : null}
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
                    enterDelayMs={toolEnterDelayById.get(tool.id) ?? 0}
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
